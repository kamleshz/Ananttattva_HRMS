import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { authenticate, authorize } from '../middleware/auth.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { Notification } from '../models/Recruitment.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import {
  buildApprovalChain,
  computeLeaveDays,
  countPaidLeaveDaysForEmployee,
  financialYearRange,
  proratedAnnualPaidLeaves,
  validateLeaveRequest,
} from '../services/leavePolicyService.js'
import { sendLeaveApprovalRequest, sendLeaveDecision, sendLeaveOverrideNotice } from '../services/mailService.js'
import { organizationDateKey } from '../services/workingDayService.js'
import { splitWeekByMonth } from '../services/attendanceCalculationService.js'

const router = Router()
router.use(authenticate)

function formatLeaveType(type) {
  return (type === 'paid_leave') ? 'Paid leave' : (type === 'unpaid_leave' || type === 'unpaid') ? 'Unpaid leave' : type
}
function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d)
  return date.toISOString().slice(0, 10)
}
function normalizeLeaveType(type) {
  if (type === 'unpaid') return 'unpaid_leave'
  return type
}
async function resolveEmployee(req) {
  if (req.user.employee?._id) return req.user.employee
  const employee = await Employee.findOne({ officialEmail: req.user.email, employeeStatus: { $in: ['active', 'notice_period'] } })
  if (employee) {
    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $set: { employee: employee._id } }),
      Employee.updateOne({ _id: employee._id }, { $set: { user: req.user._id } }),
    ])
    req.user.employee = employee
  }
  return employee
}

async function findNextManagerUser(employeeId, reportingManagerId) {
  const managerRef = reportingManagerId && new mongoose.Types.ObjectId(reportingManagerId.toString())
  if (!employeeId) return null
  if (managerRef) {
    const user = await User.findOne({ employee: managerRef, isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode')
    if (user) return user
  }
  const employee = await Employee.findById(employeeId).select('manager')
  if (!employee?.manager) return null
  return User.findOne({ employee: employee.manager, isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode')
}
async function notifyStep({ request, employeeUser, chainMap, notifyEmployee = false }) {
  const nextRole = request.workflow?.nextRole
  if (!nextRole) return
  const label = {
    manager: 'Manager review',
    hr_admin: 'HR review',
    super_admin: 'Super admin review',
  }[nextRole]
  let reviewers = []
  if (nextRole === 'manager') {
    const manager = chainMap.manager
    if (manager) reviewers = [manager]
  } else if (nextRole === 'hr_admin') {
    reviewers = chainMap.hr || []
  } else if (nextRole === 'super_admin') {
    reviewers = chainMap.superAdmins || []
  }
  const fullEmployee = await Employee.findById(request.employee).select('firstName lastName employeeCode')
  const employeeName = `${fullEmployee?.firstName || ''} ${fullEmployee?.lastName || ''}`.trim()
  const employeeCode = fullEmployee?.employeeCode || ''
  await Promise.all(reviewers.filter(Boolean).map(async (reviewer) => {
    await Notification.create({
      recipient: reviewer._id,
      type: nextRole === 'manager' ? 'Leave Manager Approval' : 'Leave Approval',
      title: 'Leave request awaiting your review',
      message: `${employeeName || 'An employee'} has submitted a leave request that needs ${label.toLowerCase()} by you.`,
      employee: request.employee,
    })
    if (reviewer.email) {
      const [result] = await Promise.allSettled([sendLeaveApprovalRequest({
        recipient: reviewer.email,
        reviewerName: reviewer.firstName || reviewer.employee?.firstName || 'Reviewer',
        employeeName,
        employeeCode,
        leaveType: formatLeaveType(request.leaveType),
        startDate: formatDate(request.startDate),
        endDate: formatDate(request.endDate),
        days: request.workingDays || request.days,
        reason: request.reason,
        stepLabel: label,
        longLeave: request.policySnapshot?.longLeave?.isLongLeave,
      })])
      if (result.status === 'rejected') console.error('Leave request approval email failed:', result.reason?.message || result.reason)
    }
  }))
  if (notifyEmployee && employeeUser) {
    await Notification.create({
      recipient: employeeUser._id,
      type: 'Leave Submitted',
      title: 'Your leave request was submitted',
      message: request.workflow.requiredSteps.length
        ? `Next: ${label || 'HR approval'}.`
        : 'Your request is now pending approval.',
      employee: request.employee,
    })
  }
}

async function loadReviewerFilters(currentEmployee, role) {
  const [hr, superAdmins] = await Promise.all([
    User.find({ role: 'hr_admin', isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode'),
    User.find({ role: { $in: ['super_admin', 'admin'] }, isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode'),
  ])
  let manager = null
  if (role === 'manager' && currentEmployee) {
    manager = await User.findOne({ employee: currentEmployee.manager, isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode')
  }
  return { hr, superAdmins, manager }
}

const DAY_MS = 86_400_000

function startOfLocalDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

function weekMondayFor(date) {
  const today = startOfLocalDay(date)
  const weekday = new Date(today.getTime() + 330 * 60_000).getUTCDay()
  const offset = weekday === 0 ? 6 : weekday - 1
  return new Date(today.getTime() - offset * DAY_MS)
}

async function invalidateWeeklyAuditKeysForLeaveDates(leave) {
  try {
    const employeeId = leave.employee?._id || leave.employee
    if (!employeeId) return
    const userDoc = await User.findOne({ employee: employeeId, isActive: true }).select('_id').lean()
    if (!userDoc) return
    const userId = userDoc._id
    const start = startOfLocalDay(leave.startDate)
    const end = startOfLocalDay(leave.endDate)
    const mondays = []
    let cursor = weekMondayFor(start)
    const endWeekMonday = weekMondayFor(end)
    while (cursor <= endWeekMonday) {
      mondays.push(new Date(cursor))
      cursor = new Date(cursor.getTime() + 7 * DAY_MS)
    }
    for (const monday of mondays) {
      const slices = splitWeekByMonth(monday)
      for (const slice of slices) {
        const periodStartKey = organizationDateKey(slice.startDate)
        const periodEndKey = organizationDateKey(slice.endDate)
        const escapedPrefix = `weekly-hours-shortfall:${periodStartKey}:${periodEndKey}:`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        await ScheduledEmail.updateMany(
          { key: { $regex: `^${escapedPrefix}` }, type: 'weekly_hours_shortfall', recipient: userId },
          { $set: { status: 'processing', lastError: 'Invalidated by leave approval', sentAt: null } }
        )
      }
    }
  } catch (error) {
    console.error('invalidateWeeklyAuditKeysForLeaveDates failed:', error?.message || error)
  }
}

router.get('/balance', asyncHandler(async (req, res) => {
  const currentEmployee = await resolveEmployee(req)
  if (!currentEmployee) throw new HttpError(404, 'Employee profile not found for your account')
  const employee = await Employee.findById(currentEmployee._id).populate('manager', 'firstName lastName employeeCode')
  if (!employee) throw new HttpError(404, 'Employee profile not found')
  const plan = proratedAnnualPaidLeaves({ employee, asOf: new Date() })
  const used = await countPaidLeaveDaysForEmployee({ employeeId: employee._id, leaveRequestModel: LeaveRequest })
  const usedUnpaid = await LeaveRequest.countDocuments({ employee: employee._id, status: 'approved', leaveType: { $in: ['unpaid', 'unpaid_leave'] } })
  const balance = Math.max(0, plan.entitledPaidLeaves - used)
  const manager = employee.manager
    ? { _id: employee.manager._id, firstName: employee.manager.firstName, lastName: employee.manager.lastName, employeeCode: employee.manager.employeeCode }
    : null
  res.json({
    success: true,
    data: {
      plan,
      paidUsed: used,
      paidAvailable: balance,
      paidEntitled: plan.entitledPaidLeaves,
      unpaidApprovedCount: usedUnpaid,
      manager,
      probation: employee.probation,
      leavePlan: employee.leavePlan,
    },
  })
}))

router.get('/', asyncHandler(async (req, res) => {
  const currentEmployee = await resolveEmployee(req)
  const elevated = ['super_admin', 'admin', 'hr_admin', 'it_admin', 'finance_admin'].includes(req.user.role)
  const currentEmployeeId = currentEmployee ? new mongoose.Types.ObjectId(currentEmployee._id.toString()) : null
  const directReportsCount = currentEmployeeId ? await Employee.countDocuments({ manager: currentEmployeeId, employeeStatus: { $in: ['active', 'notice_period'] } }) : 0
  const isReportingManager = currentEmployeeId && directReportsCount > 0
  let filter = {}
  const scope = req.query.scope || 'mine'
  // scope='team' is always permitted for any authenticated user: if the current
  // employee does not actually manage anyone, the $or clauses below simply match
  // zero rows (safe), and the meta.isReportingManager flag alerts the caller.
  // This avoids missed rows when dashboard/user flags are stale (e.g. manager was
  // just assigned & login session has cached user object without flag).
  const canUseTeamScope = true
  if (elevated && scope === 'all') {
    filter = {}
  } else if (canUseTeamScope && scope === 'team' && currentEmployee) {
    const managerId = currentEmployeeId
    const directReports = await Employee.find({ manager: managerId, employeeStatus: { $in: ['active', 'notice_period'] } }).distinct('_id')
    const directReportIds = (directReports || []).map(id => new mongoose.Types.ObjectId(id.toString()))
    const assignedAsReportingManager = { reportingManager: managerId }
    const assignedAsStepActor = { 'workflow.steps': { $elemMatch: { role: 'manager', expectedActorEmployee: managerId } } }
    const directReportLeaves = directReportIds.length ? { employee: { $in: directReportIds } } : null
    const orClauses = [assignedAsReportingManager, assignedAsStepActor]
    if (directReportLeaves) orClauses.push(directReportLeaves)
    filter = { $or: orClauses }
  } else if (req.user.role === 'hr_admin' && scope === 'approvals') {
    filter = { $or: [{ 'workflow.nextRole': 'hr_admin', status: 'pending' }, currentEmployee ? { employee: currentEmployee._id } : null].filter(Boolean) }
  } else if (['super_admin', 'admin'].includes(req.user.role) && scope === 'approvals') {
    filter = { 'workflow.nextRole': 'super_admin', status: 'pending' }
  } else if (currentEmployee) {
    filter = { employee: currentEmployee._id }
  } else {
    filter = { employee: null }
  }
  if (req.query.status) filter.status = req.query.status
  const items = await LeaveRequest.find(filter)
    .populate('employee', 'firstName lastName employeeCode profilePhoto department designation')
    .populate('reportingManager', 'firstName lastName employeeCode')
    .sort({ createdAt: -1 })
    .limit(200)
  res.json({ success: true, data: { items, meta: { isReportingManager: Boolean(isReportingManager), directReportsCount } } })
}))

const FULL_DAY_MINUTES_LEAVE = 510
const createSchema = z.object({
  leaveType: z.enum(['paid_leave', 'unpaid_leave', 'casual', 'sick', 'earned', 'unpaid']),
  dayType: z.enum(['full_day', 'half_day', 'early_leave']).default('full_day'),
  startDate: z.string().min(8).or(z.coerce.date()).transform(v => (v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10))),
  endDate: z.string().min(8).or(z.coerce.date()).transform(v => (v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10))),
  reason: z.preprocess((v) => String(v ?? '').trim(), z.string().min(5, 'Reason must be at least 5 characters').max(500)),
  earlyLeaveMinutes: z.coerce.number().int().min(1).max(FULL_DAY_MINUTES_LEAVE - 1).optional().nullable().transform(v => (v == null || Number.isNaN(Number(v)) ? undefined : Math.max(1, Math.min(FULL_DAY_MINUTES_LEAVE - 1, Math.floor(Number(v)))))),
}).refine(value => new Date(value.endDate) >= new Date(value.startDate), { message: 'End date must be on or after start date', path: ['endDate'] })
  .refine(value => value.dayType !== 'half_day' || new Date(value.startDate).toDateString() === new Date(value.endDate).toDateString(), { message: 'Half-day leave must start and end on the same date', path: ['endDate'] })
  .refine(value => value.dayType !== 'early_leave' || new Date(value.startDate).toDateString() === new Date(value.endDate).toDateString(), { message: 'Early leave must start and end on the same date', path: ['endDate'] })
  .refine(value => value.dayType !== 'early_leave' || (value.earlyLeaveMinutes && value.earlyLeaveMinutes >= 1 && value.earlyLeaveMinutes <= 509), { message: 'Early leave minutes required (1-509)', path: ['earlyLeaveMinutes'] })

router.post('/', asyncHandler(async (req, res) => {
  const currentEmployee = await resolveEmployee(req)
  if (!currentEmployee) throw new HttpError(404, 'Employee profile not found for your account')
  const input = createSchema.parse(req.body)
  const employee = await Employee.findById(currentEmployee._id)
  if (!employee) throw new HttpError(404, 'Employee profile not found')
  const normalizedLeaveType = normalizeLeaveType(input.leaveType)
  const { workingDays, fyStart, fyEnd, fyLabel } = await computeLeaveDays({ startDate: input.startDate, endDate: input.endDate })
  if (input.dayType === 'half_day' && workingDays !== 1) throw new HttpError(422, 'Half-day leave must be selected on a working day.')
  if (input.dayType === 'early_leave' && workingDays !== 1) throw new HttpError(422, 'Early leave must be selected on a working day.')
  let days
  if (input.dayType === 'half_day') days = 0.5
  else if (input.dayType === 'early_leave') days = Number((Number(input.earlyLeaveMinutes) / FULL_DAY_MINUTES_LEAVE).toFixed(4))
  else days = Math.max(1, workingDays)
  const { plan, longLeavePolicy, isPaid } = validateLeaveRequest({
    employee,
    leaveType: normalizedLeaveType,
    workingDays: days,
    startDate: input.startDate,
    asOf: new Date(),
  })
  const overlap = await LeaveRequest.exists({
    employee: employee._id,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: new Date(input.endDate) },
    endDate: { $gte: new Date(input.startDate) },
  })
  if (overlap) throw new HttpError(409, 'You already have a pending or approved leave for this date range.')
  const usedPaid = await countPaidLeaveDaysForEmployee({ employeeId: employee._id, leaveRequestModel: LeaveRequest })
  let payments
  const available = Math.max(0, plan.entitledPaidLeaves - usedPaid)
  if (input.dayType === 'early_leave') {
    payments = { mode: 'unpaid', paidDays: 0, unpaidDays: 0, balanceBefore: available, balanceAfter: available }
  } else if (normalizedLeaveType === 'unpaid_leave') {
    payments = { mode: 'unpaid', paidDays: 0, unpaidDays: days, balanceBefore: available, balanceAfter: available }
  } else {
    const paidDays = Math.min(available, days)
    const unpaidDays = Math.max(0, days - paidDays)
    payments = {
      mode: paidDays === days ? 'paid' : unpaidDays === days ? 'unpaid' : 'partially_paid',
      paidDays,
      unpaidDays,
      balanceBefore: available,
      balanceAfter: available - paidDays,
    }
  }
  if (input.dayType !== 'early_leave' && isPaid && payments.paidDays < Math.min(1, days)) {
    throw new HttpError(422, 'You do not have enough paid leave balance. Try unpaid leave or reduce the number of days.')
  }
  const requiredSteps = buildApprovalChain()
  const reportingManager = employee.manager || null
  const chainMap = await loadReviewerFilters(employee, req.user.role)
  chainMap.manager = await findNextManagerUser(employee._id, reportingManager)
  if (!chainMap.manager) throw new HttpError(422, 'An active reporting manager must be assigned before applying for leave.')
  if (!chainMap.hr.length) throw new HttpError(422, 'No active HR Admin is available to review leave requests.')
  if (!chainMap.superAdmins.length) throw new HttpError(422, 'No active Admin or Super Admin is available to review leave requests.')
  const steps = requiredSteps.map((role) => {
    const step = { role, status: 'pending', comment: '' }
    if (role === 'manager' && reportingManager) {
      step.expectedActorEmployee = reportingManager
    }
    return step
  })
  const request = await LeaveRequest.create({
    employee: employee._id,
    reportingManager,
    leaveType: normalizedLeaveType,
    dayType: input.dayType,
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    days,
    workingDays: days,
    reason: input.reason,
    fyLabel,
    earlyLeaveMinutes: input.dayType === 'early_leave' ? Number(input.earlyLeaveMinutes) : null,
    hrCompensationDecision: null,
    policySnapshot: {
      annualPaidLeaves: plan.annualPaidLeaves,
      cycleStartMonth: plan.cycleStartMonth,
      entitledPaidLeaves: plan.entitledPaidLeaves,
      eligibleMonths: plan.eligibleMonths,
      canApplyPaidLeave: plan.canApplyPaidLeave,
      longLeave: {
        isLongLeave: longLeavePolicy.isLongLeave,
        noticeDaysRequired: longLeavePolicy.noticeDaysRequired,
        calendarNoticeDays: longLeavePolicy.calendarNoticeDays,
        meetsAdvanceNotice: longLeavePolicy.meetsAdvanceNotice,
      },
    },
    payments,
    workflow: {
      requiredSteps,
      currentStepIndex: 0,
      steps,
      nextRole: requiredSteps[0] || null,
    },
  })
  await request.populate('employee', 'firstName lastName employeeCode department')
  await request.populate('reportingManager', 'firstName lastName employeeCode')
  const employeeUser = await User.findOne({ employee: employee._id, isActive: true }).select('_id email firstName')
  await notifyStep({ request, employeeUser, chainMap, notifyEmployee: true })
  const range = financialYearRange(new Date(input.startDate), plan.cycleStartMonth)
  res.status(201).json({ success: true, data: { ...request.toObject(), finance: { fyStart, fyEnd, fyLabel: range.label } } })
}))

const reviewSchema = z.object({
  reviewNote: z.string().trim().max(500).default(''),
  hrCompensationDecision: z.enum(['paid_deduction', 'unpaid', 'waived_no_deduction']).optional(),
})

router.patch('/:id/:decision', authorize('super_admin', 'admin', 'hr_admin', 'manager', 'employee'), asyncHandler(async (req, res) => {
  if (!['approve', 'reject'].includes(req.params.decision)) throw new HttpError(400, 'Invalid decision')
  const input = reviewSchema.parse(req.body)
  const request = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName employeeCode officialEmail manager')
    .populate('reportingManager', 'firstName lastName employeeCode')
  if (!request || request.status !== 'pending') throw new HttpError(409, 'This leave request is no longer pending')
  const currentEmployee = await resolveEmployee(req)
  // HARD BLOCK: self-review is never allowed (Tushar cannot approve his own leave even if Employee.manager=Tushar by accident)
  const selfRequest = Boolean(currentEmployee && String(request.employee?._id) === String(currentEmployee._id))
  if (selfRequest && req.params.decision === 'approve') {
    throw new HttpError(403, 'You cannot approve your own leave request. Please ask another manager or HR to review it.')
  }
  // Identity-based guard: employees with role='employee' can still act on a leave
  // request as its assigned Manager reviewer (Employee.manager assignment or
  // workflow.steps[manager].expectedActorEmployee). The per-request canAct check
  // below strictly enforces: only the assigned reviewer may act, and only at
  // the exact workflow stage matching the current nextRole.
  const elevatedReviewer = ['super_admin', 'admin', 'hr_admin', 'manager'].includes(req.user.role)
  if (!elevatedReviewer && currentEmployee) {
    const workflow = request.workflow || { requiredSteps: [], steps: [], currentStepIndex: 0, nextRole: null }
    const reportingManagerId = String(request.reportingManager?._id || request.employee?.manager?._id || '')
    const employeeId = String(request.employee?._id || '')
    const assignedManager = Boolean(reportingManagerId && reportingManagerId === String(currentEmployee._id) && employeeId !== String(currentEmployee._id))
    const managerStep = Array.isArray(workflow.steps) ? workflow.steps.find(s => s.role === 'manager' && s.status === 'pending') : null
    const expectedActor = Boolean(managerStep?.expectedActorEmployee && String(managerStep.expectedActorEmployee) === String(currentEmployee._id) && employeeId !== String(currentEmployee._id))
    if (workflow.nextRole === 'manager' && (assignedManager || expectedActor)) {
      // permitted: identity-based manager review gate passed
    } else {
      throw new HttpError(403, 'You do not have permission for this action')
    }
  }
  const workflow = request.workflow || { requiredSteps: [], steps: [], currentStepIndex: 0, nextRole: null }
  const nextRole = workflow.nextRole
  const approved = req.params.decision === 'approve'
  const isSuperAdminOverride = req.user.role === 'super_admin' && nextRole !== 'super_admin'
  if (req.params.decision === 'reject' && input.reviewNote.trim().length < 3) {
    throw new HttpError(422, 'A rejection reason is required.')
  }
  let canAct = false
  let activeRole = null
  const reportingManagerId = String(request.reportingManager?._id || request.employee?.manager?._id || '')
  const employeeId = String(request.employee?._id || '')
  const isAssignedManager = Boolean(currentEmployee && reportingManagerId === String(currentEmployee._id) && employeeId !== String(currentEmployee._id))
  const workflowManagerStep = Array.isArray(workflow.steps)
    ? workflow.steps.find(step => step.role === 'manager' && step.status === 'pending')
    : null
  const isExpectedManagerActor = Boolean(
    currentEmployee &&
    workflowManagerStep?.expectedActorEmployee &&
    String(workflowManagerStep.expectedActorEmployee) === String(currentEmployee._id) &&
    employeeId !== String(currentEmployee._id)
  )
  // A user may hold an elevated application role and still be this employee's
  // assigned reporting manager. Resolve the active workflow stage by identity
  // first so an Admin/HR account can complete its Manager responsibility.
  if (nextRole === 'manager' && (isAssignedManager || isExpectedManagerActor)) {
    canAct = true
    activeRole = 'manager'
  } else if (req.user.role === 'hr_admin') {
    if (nextRole === 'hr_admin' || !nextRole) {
      canAct = true
      activeRole = 'hr_admin'
    }
  } else if (req.user.role === 'super_admin') {
    canAct = true
    activeRole = 'super_admin'
  } else if (req.user.role === 'admin' && nextRole === 'super_admin') {
    canAct = true
    activeRole = 'super_admin'
  }
  if (!canAct) throw new HttpError(403, 'This request is not currently yours to review, or it is waiting for an earlier approval stage.')
  const chainMap = await loadReviewerFilters(currentEmployee, req.user.role)
  chainMap.manager = request.reportingManager
    ? await User.findOne({ employee: request.reportingManager._id, isActive: true }).select('_id email firstName').populate('employee', 'firstName lastName employeeCode')
    : null
  if (!approved) {
    request.status = 'rejected'
    request.reviewNote = input.reviewNote
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    if (activeRole && Array.isArray(workflow.steps)) {
      const stepIdx = workflow.steps.findIndex(step => step.role === activeRole && step.status === 'pending')
      if (stepIdx >= 0) {
        const step = workflow.steps[stepIdx]
        step.status = 'rejected'
        step.actor = req.user._id
        step.actorEmployee = currentEmployee?._id || null
        step.comment = input.reviewNote
        step.actedAt = new Date()
      }
    }
    workflow.nextRole = null
    request.workflow = workflow
    await request.save()
  } else {
    if (isSuperAdminOverride) {
      const actedAt = new Date()
      if (Array.isArray(workflow.steps)) {
        workflow.steps.forEach(step => {
          if (step.status !== 'pending') return
          step.status = step.role === 'super_admin' ? 'approved' : 'skipped'
          step.actor = req.user._id
          step.actorEmployee = currentEmployee?._id || null
          step.comment = input.reviewNote || 'Bypassed by final Super Admin approval.'
          step.actedAt = actedAt
        })
      }
      if (request.dayType === 'early_leave') {
        const compDecision = input.hrCompensationDecision || 'unpaid'
        request.hrCompensationDecision = compDecision
        const daysVal = Number(request.days || 0)
        const balBefore = Number(request.payments?.balanceBefore || 0)
        if (compDecision === 'paid_deduction') {
          const paidDays = Math.min(balBefore, daysVal)
          const unpaidDays = Math.max(0, daysVal - paidDays)
          request.payments = {
            mode: paidDays === daysVal ? 'paid' : unpaidDays === daysVal ? 'unpaid' : 'partially_paid',
            paidDays, unpaidDays,
            balanceBefore: balBefore,
            balanceAfter: balBefore - paidDays,
          }
        } else if (compDecision === 'waived_no_deduction') {
          request.payments = { mode: 'paid', paidDays: 0, unpaidDays: 0, balanceBefore: balBefore, balanceAfter: balBefore }
        } else {
          request.payments = { mode: 'unpaid', paidDays: 0, unpaidDays: 0, balanceBefore: balBefore, balanceAfter: balBefore }
        }
      }
      request.status = 'approved'
      request.reviewedBy = req.user._id
      request.reviewedAt = actedAt
      request.reviewNote = input.reviewNote || 'Final approval granted by Super Admin.'
      workflow.currentStepIndex = (workflow.requiredSteps || []).length
      workflow.nextRole = null
      request.workflow = workflow
      await request.save()
      await invalidateWeeklyAuditKeysForLeaveDates(request)
    } else {
      let currentStepIndex = workflow.currentStepIndex || 0
      const currentRole = activeRole || workflow.requiredSteps[currentStepIndex] || workflow.requiredSteps[Math.max(0, currentStepIndex - 1)]
      if (request.dayType === 'early_leave' && currentRole === 'hr_admin' && !input.hrCompensationDecision) {
        throw new HttpError(422, 'Please select a compensation decision for this early leave request (Paid deduction / Unpaid / Waived).')
      }
      if (Array.isArray(workflow.steps)) {
        const idx = workflow.steps.findIndex(step => step.role === currentRole && step.status === 'pending')
        if (idx >= 0) {
          const step = workflow.steps[idx]
          step.status = 'approved'
          step.actor = req.user._id
          step.actorEmployee = currentEmployee?._id || null
          step.comment = input.reviewNote
          step.actedAt = new Date()
        }
      }
      if (request.dayType === 'early_leave' && currentRole === 'hr_admin' && input.hrCompensationDecision) {
        const compDecision = input.hrCompensationDecision
        request.hrCompensationDecision = compDecision
        const daysVal = Number(request.days || 0)
        const balBefore = Number(request.payments?.balanceBefore || 0)
        if (compDecision === 'paid_deduction') {
          const paidDays = Math.min(balBefore, daysVal)
          const unpaidDays = Math.max(0, daysVal - paidDays)
          request.payments = {
            mode: paidDays === daysVal ? 'paid' : unpaidDays === daysVal ? 'unpaid' : 'partially_paid',
            paidDays, unpaidDays,
            balanceBefore: balBefore,
            balanceAfter: balBefore - paidDays,
          }
        } else if (compDecision === 'waived_no_deduction') {
          request.payments = { mode: 'paid', paidDays: 0, unpaidDays: 0, balanceBefore: balBefore, balanceAfter: balBefore }
        } else {
          request.payments = { mode: 'unpaid', paidDays: 0, unpaidDays: 0, balanceBefore: balBefore, balanceAfter: balBefore }
        }
      }
      const required = workflow.requiredSteps || []
      currentStepIndex = (currentRole && required.includes(currentRole))
        ? Math.max(currentStepIndex + 1, required.findIndex(role => role === currentRole) + 1)
        : currentStepIndex
      if (currentStepIndex >= required.length) {
        request.status = 'approved'
        request.reviewedBy = req.user._id
        request.reviewedAt = new Date()
        request.reviewNote = input.reviewNote || request.reviewNote
        workflow.nextRole = null
      } else {
        workflow.currentStepIndex = currentStepIndex
        workflow.nextRole = required[currentStepIndex]
      }
      request.workflow = workflow
      await request.save()
      if (approved && request.status === 'approved') {
        await invalidateWeeklyAuditKeysForLeaveDates(request)
      }
    }
  }
  const employee = request.employee
  const employeeUser = employee
    ? await User.findOne({ employee: employee._id, isActive: true }).select('_id email firstName')
    : null
  const isFinalDecision = !approved || request.status === 'approved'
  if (employeeUser?.email) {
    const roleLabel = { manager: 'Manager', hr_admin: 'HR', super_admin: 'Admin / Super Admin' }[activeRole] || 'Reviewer'
    const nextRoleLabel = { manager: 'Manager', hr_admin: 'HR', super_admin: 'Admin / Super Admin' }[request.workflow?.nextRole] || ''
    const decision = !approved ? 'rejected' : isFinalDecision ? 'approved' : `approved by ${roleLabel}`
    const finalApprover = req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : ''
    const [mailResult] = await Promise.allSettled([sendLeaveDecision({
      recipient: employeeUser.email,
      firstName: employeeUser.firstName || employee?.firstName || 'Team member',
      decision,
      leaveType: formatLeaveType(request.leaveType),
      startDate: formatDate(request.startDate),
      endDate: formatDate(request.endDate),
      reviewerName: finalApprover || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Reviewer',
      reviewNote: input.reviewNote || request.reviewNote || '',
      nextApprover: !isFinalDecision ? nextRoleLabel : '',
    })])
    if (mailResult.status === 'rejected') console.error('Leave decision email failed:', mailResult.reason?.message || mailResult.reason)
  }
  if (isFinalDecision && employeeUser) {
    await Notification.create({
      recipient: employeeUser._id,
      type: `Leave ${approved ? 'Approved' : 'Rejected'}`,
      title: `Your leave was ${approved ? 'approved' : 'rejected'}`,
      message: input.reviewNote || `Your leave request for ${formatDate(request.startDate)} to ${formatDate(request.endDate)} was ${approved ? 'approved.' : 'rejected.'}`,
      employee: employee._id,
    })
  }
  if (approved && isSuperAdminOverride) {
    const employeeName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim()
    const reviewerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Super Admin'
    const recipients = [chainMap.manager, ...(chainMap.hr || [])].filter(Boolean)
    const uniqueRecipients = [...new Map(recipients.map(recipient => [String(recipient._id), recipient])).values()]
    await Promise.all(uniqueRecipients.map(async recipient => {
      await Notification.create({ recipient: recipient._id, type: 'Leave Final Approval', title: 'Leave fully approved by Super Admin', message: `${employeeName}'s leave was approved directly by ${reviewerName}. No further action is required.`, employee: employee._id })
      if (!recipient.email) return
      const [mailResult] = await Promise.allSettled([sendLeaveOverrideNotice({ recipient: recipient.email, recipientName: recipient.firstName || recipient.employee?.firstName || 'Reviewer', employeeName, employeeCode: employee?.employeeCode || '', leaveType: formatLeaveType(request.leaveType), startDate: formatDate(request.startDate), endDate: formatDate(request.endDate), reviewerName, reviewNote: input.reviewNote || '' })])
      if (mailResult.status === 'rejected') console.error('Leave override notice email failed:', mailResult.reason?.message || mailResult.reason)
    }))
  }
  if (approved && request.status === 'pending') {
    await notifyStep({ request, employeeUser, chainMap })
  }
  await request.populate('employee', 'firstName lastName employeeCode department')
  await request.populate('reportingManager', 'firstName lastName employeeCode')
  res.json({ success: true, data: request })
}))

const cancelSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  confirm: z.boolean().default(true),
})

function cancellationDeadlineEligible(request, userRole) {
  if (['super_admin','admin','hr_admin'].includes(userRole)) return { ok:true, reason:null }
  const today = startOfLocalDay(new Date())
  const todayPlusGrace = new Date(today.getTime() + 10 * 60 * 60 * 1000) // 10:00 AM IST grace same-day cancel
  const start = new Date(request.startDate)
  if (start.getTime() > todayPlusGrace.getTime()) return { ok: true, reason: null }
  // Same-day: if start is today and time before grace 10 AM allowed, reject otherwise
  if (start.getTime() <= today.getTime()) return { ok: false, reason: 'Cancellation deadline passed. This leave already started. Contact HR for manual cancellation.' }
  const now = new Date()
  if (now.getTime() > todayPlusGrace.getTime()) return { ok: false, reason: 'Same-day cancellations are only allowed before 10:00 AM IST on the first day of leave. Contact HR.' }
  return { ok: true, reason: null }
}

async function notifyLeaveDecision({ request, decisionType, decisionByUser, decisionByRoleName='Reviewer', note, balanceDelta=null }) {
  const employee = request.employee
  if (!employee) return
  const employeeUser = await User.findOne({ employee: typeof employee === 'object' ? employee._id : employee, isActive: true }).select('_id email firstName')
  const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
  const decisionText = decisionType === 'cancel' ? 'cancelled' : decisionType === 'amend_extend' ? 'changed and re-submitted for approval' : 'amended'
  const notifMessage = note ? `${decisionText}: ${note}` : decisionText
  if (employeeUser) {
    await Notification.create({
      recipient: employeeUser._id,
      type: `Leave ${decisionType==='cancel' ? 'Cancelled' : 'Amended'}`,
      title: `Your leave request was ${decisionText}`,
      message: `Leave ${formatDate(request.startDate)} – ${formatDate(request.endDate)} was ${decisionText} by ${decisionByRoleName}. ${balanceDelta!==null ? `Balance change: ${balanceDelta >= 0 ? '+' : ''}${balanceDelta} paid days.` : ''} ${note ? `Note: ${note}` : ''}`.trim(),
      employee: typeof employee === 'object' ? employee._id : employee,
    })
    if (employeeUser.email) {
      const recipientName = employeeUser.firstName || employee.firstName || 'Team member'
      const [result] = await Promise.allSettled([sendLeaveDecision({
        recipient: employeeUser.email, firstName: recipientName, decision: decisionText,
        leaveType: formatLeaveType(request.leaveType), startDate: formatDate(request.startDate),
        endDate: formatDate(request.endDate), reviewerName: decisionByRoleName, reviewNote: note || '',
      })])
      if (result.status === 'rejected') console.error('Cancel/amend decision email send failed:', result.reason?.message || result.reason)
    }
  }
  // notify team / manager
  const reportingManager = request.reportingManager
  if (reportingManager) {
    const managerRef = typeof reportingManager === 'object' ? reportingManager._id : reportingManager
    const managerUser = await User.findOne({ employee: managerRef, isActive: true }).select('_id email firstName').populate('employee','firstName lastName employeeCode')
    if (managerUser) {
      await Notification.create({
        recipient: managerUser._id,
        type: decisionType==='cancel' ? 'Leave Cancelled' : 'Leave Amended',
        title: `${employeeName || 'An employee'}'s leave was ${decisionText}`,
        message: `${employeeName || 'An employee'}'s leave ${formatDate(request.startDate)} – ${formatDate(request.endDate)} was ${decisionText} by ${decisionByRoleName}. ${note ? `Note: ${note}` : ''}`,
        employee: typeof employee === 'object' ? employee._id : employee,
      })
    }
  }
}

router.patch('/:id/cancel', authorize('super_admin','admin','hr_admin','manager','employee'), asyncHandler(async (req, res) => {
  const input = cancelSchema.parse(req.body)
  if (!input.confirm) throw new HttpError(400, 'Confirmation checkbox required to cancel this leave request.')
  const request = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName employeeCode officialEmail manager profilePhoto')
    .populate('reportingManager', 'firstName lastName employeeCode')
  if (!request) throw new HttpError(404, 'Leave request not found')
  if (['cancelled','rejected'].includes(request.status)) throw new HttpError(409, 'This leave request has already been cancelled or rejected; no further action possible.')
  const currentEmployee = await resolveEmployee(req)
  // Role & identity permission checks
  const elevated = ['super_admin','admin','hr_admin'].includes(req.user.role)
  const employeeId = request.employee?._id || request.employee
  const managerId = request.reportingManager?._id || request.reportingManager
  const isManager = Boolean(currentEmployee && managerId && String(managerId) === String(currentEmployee._id) && String(employeeId) !== String(currentEmployee._id))
  const isOwnerEmployee = Boolean(currentEmployee && employeeId && String(employeeId) === String(currentEmployee._id))
  if (!elevated && !isManager && !isOwnerEmployee) throw new HttpError(403, 'You do not have permission to cancel this leave request. Only the employee, their reporting manager, HR, or Admin may cancel it.')
  // Non-owner managers cannot cancel HR/Admin approved fully without note (enforced min 8 chars already above)
  if (isManager && request.status === 'approved' && String(employeeId) === String(currentEmployee._id)) {
    // Self-manager accidentally - disallow self cancel of other employees? already handled above
  }
  // System generated leaves: employee can't cancel (HR only)
  if (request.systemGenerated && !elevated) throw new HttpError(403, 'This leave was automatically generated by the missing-checkout scheduler. Only HR or Admin may cancel it. Please apply a new leave request with Fill Punch from Attendance page first.')
  const deadlineCheck = cancellationDeadlineEligible(request, req.user.role)
  if (!deadlineCheck.ok && !elevated) throw new HttpError(422, deadlineCheck.reason || 'Cancellation is no longer available for this request.')
  // Save snapshots before mutation
  const fromSnapshot = {
    startDate: request.startDate, endDate: request.endDate,
    workingDays: request.workingDays, days: request.days,
    leaveType: request.leaveType, dayType: request.dayType,
    status: request.status, earlyLeaveMinutes: request.earlyLeaveMinutes || null,
    payments: request.payments ? { ...request.payments.toObject() } : null,
  }
  const wasApproved = request.status === 'approved'
  let balanceDelta = 0
  // Rollback balance if approved -> refund paid days back
  if (wasApproved && request.payments && (request.payments.paidDays || 0) > 0) {
    const refundPaidDays = Number(request.payments.paidDays) || 0
    balanceDelta = refundPaidDays
    request.payments = {
      mode: 'unpaid',
      paidDays: 0,
      unpaidDays: 0,
      balanceBefore: Number(request.payments.balanceBefore) || 0,
      balanceAfter: Number(request.payments.balanceAfter || 0) + refundPaidDays,
    }
  }
  // set status cancelled + cancellation fields
  request.status = 'cancelled'
  request.cancelledAt = new Date()
  request.cancelledBy = req.user._id
  request.cancelledByEmployee = currentEmployee?._id || null
  request.cancellationReason = input.reason
  if (wasApproved) {
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reviewNote = input.reason
  }
  const previousVersion = {
    ...fromSnapshot, snapshotAt: new Date(),
  }
  request.previousVersion = previousVersion
  const actorRoleName = req.user.role === 'employee' ? (isOwnerEmployee ? 'Employee' : 'Manager') : req.user.role === 'manager' ? 'Reporting Manager' : ({super_admin:'Super Admin', admin:'Admin', hr_admin:'HR Admin'})[req.user.role] || 'User'
  const toSnapshot = {
    startDate: request.startDate, endDate: request.endDate,
    workingDays: request.workingDays, days: request.days,
    leaveType: request.leaveType, dayType: request.dayType,
    status: 'cancelled', earlyLeaveMinutes: request.earlyLeaveMinutes || null,
    payments: request.payments ? { ...request.payments.toObject() } : null,
  }
  const amendmentRecord = {
    action: 'cancel',
    actorRole: req.user.role === 'employee' ? 'employee' : req.user.role === 'manager' ? 'manager' : req.user.role,
    actorUser: req.user._id,
    actorEmployee: currentEmployee?._id || null,
    reason: input.reason,
    from: fromSnapshot,
    to: toSnapshot,
    workingDayDelta: -Math.abs(Number(request.workingDays) || 0),
    paidLeaveBalanceDelta: balanceDelta,
  }
  if (!Array.isArray(request.amendmentHistory)) request.amendmentHistory = []
  request.amendmentHistory.push(amendmentRecord)
  // cancel workflow steps: mark remaining pending steps skipped & actor set to canceller
  if (Array.isArray(request.workflow?.steps)) {
    const actedAt = new Date()
    request.workflow.steps.forEach(step => {
      if (step.status === 'pending') {
        step.status = 'skipped'
        step.actor = req.user._id
        step.actorEmployee = currentEmployee?._id || null
        step.comment = `Leave cancelled before review: ${input.reason}`
        step.actedAt = actedAt
      }
    })
    request.workflow.nextRole = null
  }
  await request.save()
  // Invalidate weekly audit (if approved previously, restore shift to no-leave)
  if (wasApproved) await invalidateWeeklyAuditKeysForLeaveDates(request)
  const reviewerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || actorRoleName
  await notifyLeaveDecision({
    request, decisionType: 'cancel', decisionByUser: req.user, decisionByRoleName: reviewerName,
    note: input.reason, balanceDelta,
  })
  await request.populate('employee', 'firstName lastName employeeCode department')
  await request.populate('reportingManager', 'firstName lastName employeeCode')
  res.json({
    success: true, message: 'Leave request cancelled. Balance refunded where applicable.',
    data: { ...request.toObject(), meta: { wasApproved, balanceDeltaPaidDays: balanceDelta } },
  })
}))

const amendSchema = z.object({
  newStartDate: z.string().min(8).or(z.coerce.date()),
  newEndDate: z.string().min(8).or(z.coerce.date()),
  newLeaveType: z.enum(['paid_leave','unpaid_leave','casual','sick','earned','unpaid']).optional(),
  newDayType: z.enum(['full_day','half_day','early_leave']).optional(),
  newEarlyLeaveMinutes: z.number().int().min(1).max(FULL_DAY_MINUTES_LEAVE-1).optional(),
  newReason: z.string().trim().min(5).max(500).optional(),
  reason: z.string().trim().min(8).max(500),
}).refine(v => new Date(v.newEndDate) >= new Date(v.newStartDate), { message: 'New end date must be on or after new start date', path: ['newEndDate'] })
  .refine(v => (v.newDayType || 'full_day') !== 'half_day' || new Date(v.newStartDate).toDateString() === new Date(v.newEndDate).toDateString(), { message: 'Half-day leave must be a single date (same start and end)', path: ['newEndDate'] })
  .refine(v => (v.newDayType || 'full_day') !== 'early_leave' || new Date(v.newStartDate).toDateString() === new Date(v.newEndDate).toDateString(), { message: 'Early leave must be a single working date', path: ['newEndDate'] })
  .refine(v => (v.newDayType || 'full_day') !== 'early_leave' || (v.newEarlyLeaveMinutes && v.newEarlyLeaveMinutes >= 1 && v.newEarlyLeaveMinutes <= 509), { message: 'Early leave requires minutes 1-509', path: ['newEarlyLeaveMinutes'] })

router.patch('/:id/amend', authorize('super_admin','admin','hr_admin','manager','employee'), asyncHandler(async (req, res) => {
  const input = amendSchema.parse(req.body)
  const request = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName employeeCode officialEmail manager leavePlan probation profilePhoto')
    .populate('reportingManager', 'firstName lastName employeeCode')
  if (!request) throw new HttpError(404, 'Leave request not found')
  if (!['pending','approved'].includes(request.status)) throw new HttpError(409, `Only pending or approved requests can be amended. Current status: ${request.status}`)
  const currentEmployee = await resolveEmployee(req)
  const elevated = ['super_admin','admin','hr_admin'].includes(req.user.role)
  const employeeId = request.employee?._id || request.employee
  const managerId = request.reportingManager?._id || request.reportingManager
  const isManager = Boolean(currentEmployee && managerId && String(managerId) === String(currentEmployee._id) && String(employeeId) !== String(currentEmployee._id))
  const isOwnerEmployee = Boolean(currentEmployee && employeeId && String(employeeId) === String(currentEmployee._id))
  if (!elevated && !isManager && !isOwnerEmployee) throw new HttpError(403, 'Only the employee, reporting manager, HR or Admin may amend this leave.')
  if (request.systemGenerated && !elevated) throw new HttpError(403, 'Auto-generated missing-checkout leaves can only be amended by HR. Please contact HR.')
  const deadlineCheck = cancellationDeadlineEligible(request, req.user.role)
  if (!deadlineCheck.ok && !elevated) throw new HttpError(422, deadlineCheck.reason || 'Amendments are closed because this leave already started (HR/Admin override available).')
  // prepare fields
  const newLeaveType = normalizeLeaveType(input.newLeaveType || request.leaveType)
  const newDayType = input.newDayType || request.dayType
  const newStart = new Date(input.newStartDate)
  const newEnd = new Date(input.newEndDate)
  const newReason = input.newReason || request.reason
  const newEarly = newDayType === 'early_leave' ? Number(input.newEarlyLeaveMinutes || request.earlyLeaveMinutes || 150) : request.earlyLeaveMinutes || null
  if (newDayType === 'early_leave' && (!newEarly || newEarly < 1 || newEarly > 509)) {
    throw new HttpError(422, 'Early leave requires minutes between 1-509 on the new single date.')
  }
  // Compute working days & validate half-day/early rules are on working days
  const { workingDays: newWorkingDays } = await computeLeaveDays({ startDate: newStart, endDate: newEnd })
  if (newDayType === 'half_day' && newWorkingDays !== 1) throw new HttpError(422, 'Half-day leave must be applied on a single working day only.')
  if (newDayType === 'early_leave' && newWorkingDays !== 1) throw new HttpError(422, 'Early leave must be applied on a single working day only.')
  const employeeRef = await Employee.findById(employeeId)
  if (!employeeRef) throw new HttpError(404, 'Employee record for this leave not found.')
  // days calc (same as POST / create logic):
  const newDays = newDayType === 'half_day' ? 0.5 : newDayType === 'early_leave' ? Number((Number(newEarly) / FULL_DAY_MINUTES_LEAVE).toFixed(4)) : Math.max(1, newWorkingDays)
  // OVERLAP validation (new range should not collide with other pending/approved leaves of SAME employee excluding this one)
  const overlap = await LeaveRequest.exists({
    _id: { $ne: new mongoose.Types.ObjectId(request._id.toString()) },
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: newEnd },
    endDate: { $gte: newStart },
  })
  if (overlap) throw new HttpError(409, 'You already have another pending or approved leave overlapping this new date range. Cancel that first, or choose different dates.')
  // Save FROM snapshot (BEFORE):
  const fromSnapshot = {
    startDate: request.startDate, endDate: request.endDate, workingDays: request.workingDays,
    days: request.days, leaveType: request.leaveType, dayType: request.dayType,
    status: request.status, earlyLeaveMinutes: request.earlyLeaveMinutes || null,
    payments: request.payments ? { ...request.payments.toObject() } : null,
  }
  // --- Determine action type (SHORTEN vs EXTEND vs CHANGE TYPE):
  const prevPaidDays = Number(request.payments?.paidDays) || 0
  const prevBalanceBefore = Number(request.payments?.balanceBefore) || 0
  const prevBalanceAfter = Number(request.payments?.balanceAfter) || 0
  const prevWorkingDays = Number(request.workingDays) || 0
  const prevLeaveType = request.leaveType
  const normalizedOldType = normalizeLeaveType(prevLeaveType)
  const leaveTypeChanged = normalizedOldType !== newLeaveType
  let workingDayDelta = Number((newWorkingDays - prevWorkingDays).toFixed(4))  // negative => SHORTEN, positive => EXTEND
  const isShorteningOrSame = workingDayDelta <= 0 && !leaveTypeChanged
  const isExtendingOrTypeChange = workingDayDelta > 0 || leaveTypeChanged
  // Run policy validate if extending or changing leave type (must be within balance):
  const { plan } = validateLeaveRequest({ employee: employeeRef, leaveType: newLeaveType, workingDays: newDays, startDate: newStart, asOf: new Date() })
  const usedPaidTotal = await countPaidLeaveDaysForEmployee({ employeeId, leaveRequestModel: LeaveRequest })
  // Base available = plan.entitledPaidLeaves - usedPaidTotal + refund of OLD leave's paid days (because we're about to replace it)
  const availableBefore = Math.max(0, plan.entitledPaidLeaves - usedPaidTotal + prevPaidDays)
  // Recalculate payments payments (new):
  let newPayments
  if (newDayType === 'early_leave') {
    newPayments = { mode: 'unpaid', paidDays: 0, unpaidDays: 0, balanceBefore: availableBefore, balanceAfter: availableBefore }
  } else if (newLeaveType === 'unpaid_leave') {
    newPayments = { mode: 'unpaid', paidDays: 0, unpaidDays: newDays, balanceBefore: availableBefore, balanceAfter: availableBefore }
  } else {
    const paid = Math.min(availableBefore, newDays)
    const unpaid = Math.max(0, newDays - paid)
    newPayments = {
      mode: paid === newDays ? 'paid' : unpaid === newDays ? 'unpaid' : 'partially_paid',
      paidDays: paid, unpaidDays: unpaid,
      balanceBefore: availableBefore, balanceAfter: availableBefore - paid,
    }
  }
  // Insufficient balance if extending/changing to paid leave with no balance:
  if (isExtendingOrTypeChange && newLeaveType !== 'unpaid_leave' && newDayType !== 'early_leave' && newPayments.paidDays < Math.min(1, newDays)) {
    throw new HttpError(422, `Insufficient paid leave balance for amended ${newDays}-day leave. Reduce days or switch to unpaid leave.`)
  }
  // --- Decide final status + workflow for Shorten (self-approve instant) vs Extend/re-type => re-approve:
  const actorRoleName = req.user.role === 'employee' ? (isOwnerEmployee ? 'Employee' : 'Manager') : req.user.role === 'manager' ? 'Reporting Manager' : ({super_admin:'Super Admin', admin:'Admin', hr_admin:'HR Admin'})[req.user.role] || 'User'
  let amendmentAction
  let newStatus = request.status
  if (workingDayDelta < 0 && !leaveTypeChanged) amendmentAction = 'amend_shorten'
  else if (workingDayDelta > 0 && !leaveTypeChanged) amendmentAction = 'amend_extend'
  else if (leaveTypeChanged && workingDayDelta <= 0) amendmentAction = 'amend_change_type'
  else amendmentAction = 'amend_extend' // extend
  // SHORTEN (no leave type change): instant approve, refund balance delta, keep status 'approved' (if previously approved), or keep as pending
  // EXTEND / TYPE change: goes back to manager step for full re-approval, status = pending, steps reset
  const needsReApproval = isExtendingOrTypeChange || elevated ? (elevated && (req.user.role==='super_admin')) ? false : true : false
  let balanceDelta = 0
  balanceDelta = Number((newPayments.balanceAfter - prevBalanceAfter).toFixed(4))
  // Apply fields
  request.previousVersion = { ...fromSnapshot, snapshotAt: new Date() }
  request.startDate = newStart
  request.endDate = newEnd
  request.leaveType = newLeaveType
  request.dayType = newDayType
  request.earlyLeaveMinutes = newEarly
  request.workingDays = newWorkingDays
  request.days = newDays
  request.reason = newReason
  request.payments = newPayments
  // hr compensation cleared if NOT early leave anymore
  if (newDayType !== 'early_leave') {
    request.hrCompensationDecision = null
  } else if (!request.hrCompensationDecision) {
    // keep null; HR will review
  }
  // Recalculate fyLabel (FY financial year)
  try {
    const range = financialYearRange(newStart, plan.cycleStartMonth)
    request.fyLabel = range.label
  } catch { /* keep old */ }
  const wasApproved = request.status === 'approved'
  if (needsReApproval) {
    // Go back for full re-approval
    const requiredSteps = buildApprovalChain()
    const reportingManager = employeeRef.manager || null
    const steps = requiredSteps.map((role) => {
      const s = { role, status: 'pending', comment: '' }
      if (role === 'manager' && reportingManager) s.expectedActorEmployee = reportingManager
      return s
    })
    request.workflow = { requiredSteps, currentStepIndex: 0, steps, nextRole: requiredSteps[0] || null }
    request.status = 'pending'
    request.reviewedBy = null
    request.reviewedAt = null
    request.reviewNote = ''
  } else {
    // HR SUPER ADMIN doing an EXTEND but using override -> stays approved
    // Or SHORTEN case -> keep as existing status. If was approved stay approved. If was pending stay pending.
    request.workflow = request.workflow || { requiredSteps: [], currentStepIndex: 0, steps: [], nextRole: null }
    if (elevated && request.status === 'pending') {
      // elevated shortcut: approve while amending
      request.status = 'approved'
      request.reviewedBy = req.user._id
      request.reviewedAt = new Date()
      request.reviewNote = input.reason
      if (Array.isArray(request.workflow.steps)) {
        const actedAt = new Date()
        request.workflow.steps.forEach(step => {
          if (step.status === 'pending') {
            step.status = 'approved'
            step.actor = req.user._id
            step.actorEmployee = currentEmployee?._id || null
            step.comment = `Auto-approved during amendment: ${input.reason}`
            step.actedAt = actedAt
          }
        })
        request.workflow.nextRole = null
      }
    }
  }
  // if cancel -> invalidate audit; similarly amend = invalidate before dates and new dates
  if (wasApproved) await invalidateWeeklyAuditKeysForLeaveDates(request)
  // Apply to new dates as well if approved (future new dates):
  if (request.status === 'approved') await invalidateWeeklyAuditKeysForLeaveDates(request)
  const toSnapshot = {
    startDate: request.startDate, endDate: request.endDate, workingDays: request.workingDays, days: request.days,
    leaveType: request.leaveType, dayType: request.dayType, status: request.status,
    earlyLeaveMinutes: request.earlyLeaveMinutes || null,
    payments: { ...request.payments.toObject() },
  }
  request.amendmentCount = Number(request.amendmentCount || 0) + 1
  if (!Array.isArray(request.amendmentHistory)) request.amendmentHistory = []
  request.amendmentHistory.push({
    action: amendmentAction,
    actorRole: req.user.role === 'employee' ? 'employee' : req.user.role === 'manager' ? 'manager' : req.user.role,
    actorUser: req.user._id,
    actorEmployee: currentEmployee?._id || null,
    reason: input.reason,
    from: fromSnapshot, to: toSnapshot,
    workingDayDelta, paidLeaveBalanceDelta: balanceDelta,
  })
  await request.save()
  // Notifications & emails:
  const reviewerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || actorRoleName
  const decisionType = needsReApproval ? 'amend_extend' : amendmentAction
  await notifyLeaveDecision({
    request, decisionType, decisionByUser: req.user, decisionByRoleName: reviewerName,
    note: input.reason, balanceDelta,
  })
  if (needsReApproval) {
    // Notify NEW next reviewer:
    try {
      const chainMap = await loadReviewerFilters(employeeRef, req.user.role)
      chainMap.manager = request.reportingManager
        ? await findNextManagerUser(request.employee._id, typeof request.reportingManager === 'object' ? request.reportingManager._id : request.reportingManager)
        : await findNextManagerUser(request.employee._id, employeeRef.manager)
      const employeeUser = await User.findOne({ employee: request.employee._id, isActive: true }).select('_id email firstName')
      await notifyStep({ request, employeeUser, chainMap, notifyEmployee: false })
    } catch (err) { console.error('Amend re-approval notify step error (non-fatal):', err?.message || err) }
  }
  await request.populate('employee', 'firstName lastName employeeCode department')
  await request.populate('reportingManager', 'firstName lastName employeeCode')
  res.json({
    success: true,
    message: needsReApproval ? 'Leave amended and re-submitted for manager approval. Original approval chain restarted.' : 'Leave amended instantly (shortening or HR override). Balance updated where applicable.',
    data: {
      ...request.toObject(),
      meta: { amendmentAction, needsReApproval, workingDayDelta, balanceDeltaPaidDays: balanceDelta, amendmentCount: request.amendmentCount },
    },
  })
}))

export default router
