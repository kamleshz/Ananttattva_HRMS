import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { authenticate, authorize } from '../middleware/auth.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { Notification } from '../models/Recruitment.js'
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
import { sendLeaveApprovalRequest, sendLeaveDecision } from '../services/mailService.js'

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
async function notifyStep({ request, employeeUser, chainMap }) {
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
  if (employeeUser) {
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
    User.find({ role: 'super_admin', isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode'),
  ])
  let manager = null
  if (role === 'manager' && currentEmployee) {
    manager = await User.findOne({ employee: currentEmployee.manager, isActive: true }).select('_id email firstName role').populate('employee', 'firstName lastName employeeCode')
  }
  return { hr, superAdmins, manager }
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
  let filter = {}
  const scope = req.query.scope || 'mine'
  if (elevated && scope === 'all') {
    filter = {}
  } else if (req.user.role === 'manager' && scope === 'team') {
    if (!currentEmployee) return res.json({ success: true, data: [] })
    const directReports = await Employee.find({ manager: currentEmployee._id }).distinct('_id')
    const myPendingForManager = { 'workflow.nextRole': 'manager', reportingManager: currentEmployee._id, status: 'pending' }
    filter = { $or: [{ employee: { $in: directReports } }, myPendingForManager] }
  } else if (req.user.role === 'hr_admin' && scope === 'approvals') {
    filter = { $or: [{ 'workflow.nextRole': 'hr_admin', status: 'pending' }, { employee: req.user.employee?._id && currentEmployee?._id }].filter(Boolean) }
  } else if (req.user.role === 'super_admin' && scope === 'approvals') {
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
  res.json({ success: true, data: items })
}))

const createSchema = z.object({
  leaveType: z.enum(['paid_leave', 'unpaid_leave', 'casual', 'sick', 'earned', 'unpaid']),
  startDate: z.string().min(8).or(z.coerce.date()),
  endDate: z.string().min(8).or(z.coerce.date()),
  reason: z.string().trim().min(5).max(500),
}).refine(value => new Date(value.endDate) >= new Date(value.startDate), { message: 'End date must be on or after start date', path: ['endDate'] })

router.post('/', asyncHandler(async (req, res) => {
  const currentEmployee = await resolveEmployee(req)
  if (!currentEmployee) throw new HttpError(404, 'Employee profile not found for your account')
  const input = createSchema.parse(req.body)
  const employee = await Employee.findById(currentEmployee._id)
  if (!employee) throw new HttpError(404, 'Employee profile not found')
  const normalizedLeaveType = normalizeLeaveType(input.leaveType)
  const { workingDays, fyStart, fyEnd, fyLabel } = await computeLeaveDays({ startDate: input.startDate, endDate: input.endDate })
  const days = Math.max(1, workingDays)
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
  if (normalizedLeaveType === 'unpaid_leave') {
    payments = { mode: 'unpaid', paidDays: 0, unpaidDays: days, balanceBefore: plan.entitledPaidLeaves - usedPaid, balanceAfter: plan.entitledPaidLeaves - usedPaid }
  } else {
    const available = Math.max(0, plan.entitledPaidLeaves - usedPaid)
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
  if (isPaid && payments.paidDays < Math.min(1, days)) {
    throw new HttpError(422, 'You do not have enough paid leave balance. Try unpaid leave or reduce the number of days.')
  }
  const requiredSteps = buildApprovalChain({ days })
  const reportingManager = employee.manager || null
  const now = new Date()
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
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    days: Math.max(1, workingDays),
    workingDays: Math.max(0, workingDays),
    reason: input.reason,
    fyLabel,
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
  const chainMap = await loadReviewerFilters(employee, req.user.role)
  chainMap.manager = await findNextManagerUser(employee._id, reportingManager)
  const employeeUser = await User.findOne({ employee: employee._id, isActive: true }).select('_id email firstName')
  await notifyStep({ request, employeeUser, chainMap })
  const range = financialYearRange(new Date(input.startDate), plan.cycleStartMonth)
  res.status(201).json({ success: true, data: { ...request.toObject(), finance: { fyStart, fyEnd, fyLabel: range.label } } })
}))

const reviewSchema = z.object({ reviewNote: z.string().trim().max(500).default('') })

router.patch('/:id/:decision', authorize('super_admin', 'hr_admin', 'manager'), asyncHandler(async (req, res) => {
  if (!['approve', 'reject'].includes(req.params.decision)) throw new HttpError(400, 'Invalid decision')
  const input = reviewSchema.parse(req.body)
  const request = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName employeeCode officialEmail manager')
    .populate('reportingManager', 'firstName lastName employeeCode')
  if (!request || request.status !== 'pending') throw new HttpError(409, 'This leave request is no longer pending')
  const currentEmployee = await resolveEmployee(req)
  const workflow = request.workflow || { requiredSteps: [], steps: [], currentStepIndex: 0, nextRole: null }
  const nextRole = workflow.nextRole
  const approved = req.params.decision === 'approve'
  if (req.params.decision === 'reject' && input.reviewNote.trim().length < 3) {
    throw new HttpError(422, 'A rejection reason is required.')
  }
  let canAct = false
  let activeRole = null
  if (req.user.role === 'manager') {
    const reportingManagerId = String(request.reportingManager?._id || request.employee?.manager?._id || '')
    if (currentEmployee && reportingManagerId === String(currentEmployee._id)) {
      if (nextRole === 'manager' || !workflow.requiredSteps.includes('hr_admin')) {
        canAct = true
        activeRole = 'manager'
      }
    }
  } else if (req.user.role === 'hr_admin') {
    if (nextRole === 'hr_admin' || !nextRole) {
      canAct = true
      activeRole = 'hr_admin'
    }
  } else if (req.user.role === 'super_admin') {
    canAct = true
    activeRole = nextRole === 'super_admin' ? 'super_admin' : (nextRole || 'super_admin')
  }
  if (!canAct) throw new HttpError(403, 'This request is not currently yours to review.')
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
        workflow.steps[stepIdx] = {
          ...workflow.steps[stepIdx],
          status: 'rejected',
          actor: req.user._id,
          actorEmployee: currentEmployee?._id || null,
          comment: input.reviewNote,
          actedAt: new Date(),
        }
      }
    }
    workflow.nextRole = null
    request.workflow = workflow
    await request.save()
  } else {
    let currentStepIndex = workflow.currentStepIndex || 0
    const currentRole = activeRole || workflow.requiredSteps[currentStepIndex] || workflow.requiredSteps[Math.max(0, currentStepIndex - 1)]
    if (Array.isArray(workflow.steps)) {
      const idx = workflow.steps.findIndex(step => step.role === currentRole && step.status === 'pending')
      if (idx >= 0) {
        workflow.steps[idx] = {
          ...workflow.steps[idx],
          status: 'approved',
          actor: req.user._id,
          actorEmployee: currentEmployee?._id || null,
          comment: input.reviewNote,
          actedAt: new Date(),
        }
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
  }
  const employee = request.employee
  const employeeUser = employee
    ? await User.findOne({ employee: employee._id, isActive: true }).select('_id email firstName')
    : null
  if (employeeUser?.email) {
    const decision = approved ? 'approved' : 'rejected'
    const finalApprover = approved ? (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : '') : ''
    const [mailResult] = await Promise.allSettled([sendLeaveDecision({
      recipient: employeeUser.email,
      firstName: employeeUser.firstName || employee?.firstName || 'Team member',
      decision,
      leaveType: formatLeaveType(request.leaveType),
      startDate: formatDate(request.startDate),
      endDate: formatDate(request.endDate),
      reviewerName: finalApprover || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Reviewer',
      reviewNote: input.reviewNote || request.reviewNote || '',
    })])
    if (mailResult.status === 'rejected') console.error('Leave decision email failed:', mailResult.reason?.message || mailResult.reason)
  }
  if (employeeUser) {
    await Notification.create({
      recipient: employeeUser._id,
      type: `Leave ${approved ? 'Approved' : 'Rejected'}`,
      title: `Your leave was ${approved ? 'approved' : 'rejected'}`,
      message: input.reviewNote || `Your leave request for ${formatDate(request.startDate)} to ${formatDate(request.endDate)} was ${approved ? 'approved.' : 'rejected.'}`,
      employee: employee._id,
    })
  }
  if (approved && request.status === 'pending') {
    await notifyStep({ request, employeeUser, chainMap })
  }
  await request.populate('employee', 'firstName lastName employeeCode department')
  await request.populate('reportingManager', 'firstName lastName employeeCode')
  res.json({ success: true, data: request })
}))

export default router
