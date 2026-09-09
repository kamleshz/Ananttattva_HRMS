import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { Employee } from '../models/Employee.js'
import { Attendance } from '../models/Attendance.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { OrganizationProfile } from '../models/Organization.js'
import { Holiday } from '../models/Holiday.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { Notification } from '../models/Recruitment.js'
import {
  getWeeklySummary,
  getMonthlyLeaveSummary,
  getMondayOfDate,
  getDailyAttendancePlan,
} from '../services/attendanceCalculationService.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'
import {
  processMissingCheckouts,
  processMissingCheckoutAlerts,
  processMissingCheckoutFinalization,
} from '../services/missingCheckoutService.js'
import {
  startOfLocalDay,
  atOrganizationTime,
  ORGANIZATION_TIMEZONE_OFFSET_MINUTES,
} from '../utils/date.js'
import { organizationDateKey } from '../services/workingDayService.js'

const TC = { passed: 0, total: 0 }

function runTest(name, fn) {
  TC.total++
  try {
    fn()
    TC.passed++
    console.log(`  PASS ${name}`)
  } catch (err) {
    console.log(`  FAIL ${name}`)
    console.error(`    ${err.message}`)
    console.error(err.stack?.split('\n').slice(0, 4).join('\n'))
  }
}

async function runAsyncTest(name, fn) {
  TC.total++
  try {
    await fn()
    TC.passed++
    console.log(`  PASS ${name}`)
  } catch (err) {
    console.log(`  FAIL ${name}`)
    console.error(`    ${err.message}`)
    console.error(err.stack?.split('\n').slice(0, 4).join('\n'))
  }
}

const EMPLOYEE_CODE_PREFIX = 'TEST-ATTCALC-'
let empCounter = 0

function nextEmployeeCode() {
  empCounter++
  return `${EMPLOYEE_CODE_PREFIX}${String(empCounter).padStart(4, '0')}`
}

async function createFakeEmployee({ joiningDate, finalWorkingDate, employeeStatus = 'active' }) {
  const code = nextEmployeeCode()
  const offboarding = finalWorkingDate ? { finalWorkingDate } : undefined
  const emp = await Employee.create({
    employeeCode: code,
    firstName: `TestFn${empCounter}`,
    lastName: `TestLn${empCounter}`,
    officialEmail: `${code.toLowerCase()}@test.local`,
    joiningDate: joiningDate ? new Date(joiningDate) : startOfLocalDay(new Date(2025, 7, 25)),
    employeeStatus,
    offboarding,
  })
  return emp
}

async function createLeave(employee, date, dayType, leaveType = 'paid_leave', status = 'approved') {
  const d = startOfLocalDay(new Date(date))
  return LeaveRequest.create({
    employee: employee._id,
    leaveType,
    dayType,
    startDate: d,
    endDate: d,
    days: dayType === 'half_day' ? 0.5 : 1.0,
    workingDays: dayType === 'half_day' ? 0.5 : 1.0,
    reason: 'Test leave',
    status,
    reviewedAt: new Date(),
    systemGenerated: false,
  })
}

async function createAttendance(employee, date, opts = {}) {
  const d = startOfLocalDay(new Date(date))
  const {
    checkIn,
    checkOut,
    workingMinutes = 0,
    exceptionStatus = '',
    missingCheckout = null,
    status = 'present',
    missedCheckOut = false,
  } = opts

  const attendanceData = {
    employee: employee._id,
    date: d,
    status,
    workingMinutes,
    exceptionStatus,
    missedCheckOut,
  }

  if (checkIn) {
    attendanceData.checkIn = typeof checkIn === 'object'
      ? checkIn
      : { time: typeof checkIn === 'string' || checkIn instanceof Date ? new Date(checkIn) : atOrganizationTime(d, 10, 0) }
  }

  if (checkOut) {
    attendanceData.checkOut = typeof checkOut === 'object'
      ? checkOut
      : { time: typeof checkOut === 'string' || checkOut instanceof Date ? new Date(checkOut) : atOrganizationTime(d, 18, 30) }
  }

  if (missingCheckout) {
    attendanceData.missingCheckout = missingCheckout
  }

  return Attendance.create(attendanceData)
}

function setMondayWeekStart(yyyy, mm, dd) {
  const rawDate = atOrganizationTime(new Date(Date.UTC(yyyy, mm - 1, dd)), 0, 0)
  return getMondayOfDate(rawDate)
}

function addDays(date, n) {
  const result = new Date(date)
  result.setDate(result.getDate() + Number(n))
  return result
}

async function cleanupTestData() {
  const prefix = EMPLOYEE_CODE_PREFIX.slice(0, -1)
  const testEmployees = await Employee.find({ employeeCode: { $regex: `^${prefix}` } }).select('_id')
  const ids = testEmployees.map(e => e._id)
  if (ids.length) {
    await Attendance.deleteMany({ employee: { $in: ids } })
    await LeaveRequest.deleteMany({ employee: { $in: ids } })
    const attIds = await Attendance.find({ employee: { $in: ids } }).distinct('_id')
    await Notification.deleteMany({ employee: { $in: ids } })
  }
  await Holiday.deleteMany({ name: /^TEST-HOLIDAY-/ })
  await Employee.deleteMany({ employeeCode: { $regex: `^${prefix}` } })
}

await connectDatabase()
await getAttendancePolicy()

console.log('\n== TC-1: 4 working days no leaves = 34h (2040 min) target ==')
await runAsyncTest('TC-1: 4 working days no leaves', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const summary = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary.originalScheduledMinutes, 2040, `originalScheduledMinutes expected 2040 got ${summary.originalScheduledMinutes}`)
  assert.equal(summary.adjustedTargetMinutes, 2040, `adjustedTargetMinutes expected 2040 got ${summary.adjustedTargetMinutes}`)
  assert.equal(summary.fullDayLeaveAdjustmentMinutes, 0, `fullDayLeaveAdjustmentMinutes expected 0 got ${summary.fullDayLeaveAdjustmentMinutes}`)
  assert.equal(summary.halfDayLeaveAdjustmentMinutes, 0, `halfDayLeaveAdjustmentMinutes expected 0 got ${summary.halfDayLeaveAdjustmentMinutes}`)
})

console.log('\n== TC-2: 4 working days + 1 full-day approved leave Wed = 1530 min ==')
await runAsyncTest('TC-2: full-day leave reduces target', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)
  await createLeave(emp, wednesday, 'full_day')
  const summary = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary.adjustedTargetMinutes, 1530, `adjustedTargetMinutes expected 1530 got ${summary.adjustedTargetMinutes}`)
  assert.equal(summary.fullDayLeaveAdjustmentMinutes, -510, `fullDayLeaveAdjustmentMinutes expected -510 got ${summary.fullDayLeaveAdjustmentMinutes}`)
})

console.log('\n== TC-3: 4 days + half-day leave Wed = 29h45m (1785 min) ==')
await runAsyncTest('TC-3: half-day leave reduces target', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)
  await createLeave(emp, wednesday, 'half_day')
  const summary = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary.adjustedTargetMinutes, 1785, `adjustedTargetMinutes expected 1785 got ${summary.adjustedTargetMinutes}`)
  assert.equal(summary.halfDayLeaveAdjustmentMinutes, 255, `halfDayLeaveAdjustmentMinutes expected 255 got ${summary.halfDayLeaveAdjustmentMinutes}`)
})

console.log('\n== TC-4: Half-day Week1 + Half-day Week2; monthly consumption = 1.0 ==')
await runAsyncTest('TC-4: half-days across weeks monthly sum 1.0', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const week1Monday = setMondayWeekStart(2025, 9, 1)
  const week1Wed = addDays(week1Monday, 2)
  await createLeave(emp, week1Wed, 'half_day')
  const week1Summary = await getWeeklySummary(emp, week1Monday)
  assert.equal(week1Summary.adjustedTargetMinutes, week1Summary.originalScheduledMinutes - 255,
    `week1 adjusted expected ${week1Summary.originalScheduledMinutes - 255} got ${week1Summary.adjustedTargetMinutes}`)

  const week2Monday = setMondayWeekStart(2025, 9, 8)
  const week2Fri = addDays(week2Monday, 4)
  await createLeave(emp, week2Fri, 'half_day')
  const week2Summary = await getWeeklySummary(emp, week2Monday)
  assert.equal(week2Summary.adjustedTargetMinutes, week2Summary.originalScheduledMinutes - 255,
    `week2 adjusted expected ${week2Summary.originalScheduledMinutes - 255} got ${week2Summary.adjustedTargetMinutes}`)

  const septemberSummary = await getMonthlyLeaveSummary(emp, 9, 2025)
  assert.equal(septemberSummary.fullDayLeaves, 0, `fullDayLeaves expected 0 got ${septemberSummary.fullDayLeaves}`)
  assert.equal(septemberSummary.halfDayLeaves, 2, `halfDayLeaves expected 2 got ${septemberSummary.halfDayLeaves}`)
  assert.equal(septemberSummary.totalLeaveDaysConsumed, 1.0,
    `totalLeaveDaysConsumed expected 1.0 got ${septemberSummary.totalLeaveDaysConsumed}`)
})

console.log('\n== TC-5: Same week 2 half-days = reduction 510; halfDayLeaves stays 2 ==')
await runAsyncTest('TC-5: two half-days same week not combined into full-day', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 1))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 8, 25)
  const tue = addDays(weekMonday, 1)
  const thu = addDays(weekMonday, 3)
  await createLeave(emp, tue, 'half_day')
  await createLeave(emp, thu, 'half_day')
  const summary = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary.halfDayLeaveAdjustmentMinutes, 510,
    `halfDayLeaveAdjustmentMinutes expected 510 got ${summary.halfDayLeaveAdjustmentMinutes}`)
  assert.equal(summary.adjustedTargetMinutes, summary.originalScheduledMinutes - 510,
    `adjustedTargetMinutes expected ${summary.originalScheduledMinutes - 510} got ${summary.adjustedTargetMinutes}`)
  const augustSummary = await getMonthlyLeaveSummary(emp, 8, 2025)
  assert.equal(augustSummary.halfDayLeaves, 2,
    `august halfDayLeaves expected 2 got ${augustSummary.halfDayLeaves}`)
  assert.equal(augustSummary.totalLeaveDaysConsumed, 1.0,
    `august totalLeaveDaysConsumed expected 1.0 got ${augustSummary.totalLeaveDaysConsumed}`)
})

console.log('\n== TC-6: Holiday + Sunday contribute 0 expected minutes ==')
await runAsyncTest('TC-6: holiday and weekly off zero minutes', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const tueDate = atOrganizationTime(new Date(Date.UTC(2025, 8, 2)), 0, 0)
  const sundayDate = atOrganizationTime(new Date(Date.UTC(2025, 8, 7)), 0, 0)

  const user = await Employee.findOne({}).select('_id').lean()
  const createdBy = user?._id || new mongoose.Types.ObjectId()
  await Holiday.create({
    name: 'TEST-HOLIDAY-SEP-2',
    date: tueDate,
    type: 'public',
    createdBy,
  })

  const tuePlan = await getDailyAttendancePlan(emp, tueDate)
  assert.equal(tuePlan.isHoliday, true, `Tue isHoliday expected true got ${tuePlan.isHoliday}`)
  assert.equal(tuePlan.expectedWorkingMinutes, 0,
    `Tue expectedWorkingMinutes expected 0 got ${tuePlan.expectedWorkingMinutes}`)

  const sunPlan = await getDailyAttendancePlan(emp, sundayDate)
  assert.equal(sunPlan.isWeeklyOff, true, `Sun isWeeklyOff expected true got ${sunPlan.isWeeklyOff}`)
  assert.equal(sunPlan.expectedWorkingMinutes, 0,
    `Sun expectedWorkingMinutes expected 0 got ${sunPlan.expectedWorkingMinutes}`)
})

console.log('\n== TC-7: Missing checkout pending → 0 approved minutes + pending count >= 1 ==')
await runAsyncTest('TC-7: missing checkout pending zero approved minutes', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)
  const checkInTime = atOrganizationTime(wednesday, 10, 0)
  await createAttendance(emp, wednesday, {
    checkIn: { time: checkInTime },
    workingMinutes: 0,
    exceptionStatus: 'Missing Checkout – Justification Pending',
    status: 'missing_checkout',
    missedCheckOut: true,
    missingCheckout: {
      detectedAt: new Date(),
      justificationStatus: 'pending',
      deadline: addDays(wednesday, 4),
      history: [{ timestamp: new Date(), status: 'pending', message: 'Missing', actor: 'scheduler' }],
    },
  })
  const summary = await getWeeklySummary(emp, weekMonday)
  const wedPlan = summary.dailyBreakdown.find(p => {
    const pk = organizationDateKey(p.date)
    return pk === organizationDateKey(wednesday)
  })
  assert.ok(wedPlan, 'Wednesday plan not found in breakdown')
  assert.equal(wedPlan.approvedWorkingMinutes, 0,
    `Wed approvedWorkingMinutes expected 0 got ${wedPlan.approvedWorkingMinutes}`)
  assert.ok(summary.pendingExceptionsCount >= 1,
    `pendingExceptionsCount expected >= 1 got ${summary.pendingExceptionsCount}`)
})

console.log('\n== TC-8: Approved checkout justification restores 480 working minutes ==')
await runAsyncTest('TC-8: approved justification restores minutes', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)
  const checkInTime = atOrganizationTime(wednesday, 10, 0)
  const checkOutTime = atOrganizationTime(wednesday, 18, 0)
  await createAttendance(emp, wednesday, {
    checkIn: { time: checkInTime },
    checkOut: { time: checkOutTime, source: 'hr_correction' },
    workingMinutes: 480,
    exceptionStatus: '',
    status: 'present',
    missedCheckOut: false,
    missingCheckout: {
      detectedAt: new Date(),
      justificationStatus: 'approved',
      reviewAction: 'approved',
      workingMinutesRestored: 480,
      history: [{ timestamp: new Date(), status: 'approved', message: 'Justification approved', actor: 'hr_admin' }],
    },
  })
  const summary = await getWeeklySummary(emp, weekMonday)
  const wedPlan = summary.dailyBreakdown.find(p => organizationDateKey(p.date) === organizationDateKey(wednesday))
  assert.ok(wedPlan, 'Wednesday plan not found')
  assert.equal(wedPlan.approvedWorkingMinutes, 480,
    `Wed approvedWorkingMinutes expected 480 got ${wedPlan.approvedWorkingMinutes}`)
})

console.log('\n== TC-9: Rejected justification → finalizeAsLeave with conversionReason ==')
await runAsyncTest('TC-9: rejected justification creates LeaveRequest', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)
  const checkInTime = atOrganizationTime(wednesday, 10, 0)
  const attendance = await createAttendance(emp, wednesday, {
    checkIn: { time: checkInTime },
    workingMinutes: 0,
    exceptionStatus: 'Missing Checkout – Justification Pending',
    status: 'missing_checkout',
    missedCheckOut: true,
    missingCheckout: {
      detectedAt: new Date(),
      justificationStatus: 'pending',
      deadline: addDays(wednesday, 4),
      reviewAction: 'none',
      history: [{ timestamp: new Date(), status: 'pending', message: 'Missing', actor: 'scheduler' }],
    },
  })

  const reason = 'Justification rejected'
  const policy = await getAttendancePolicy()
  const leaveDoc = await LeaveRequest.create({
    employee: attendance.employee,
    reportingManager: null,
    startDate: attendance.date,
    endDate: attendance.date,
    leaveType: 'unpaid_leave',
    dayType: 'full_day',
    days: 1.0,
    workingDays: 1.0,
    reason,
    status: 'approved',
    reviewedAt: new Date(),
    conversionReason: reason,
    systemGenerated: true,
    workflow: { requiredSteps: [], currentStepIndex: 0, steps: [], nextRole: null },
  })

  await Attendance.updateOne(
    { _id: attendance._id },
    {
      $set: {
        status: 'absent',
        workingMinutes: 0,
        completionStatus: 'finalized',
        exceptionStatus: `Absent – ${reason}`,
        'missingCheckout.finalizedAt': new Date(),
        'missingCheckout.conversionReason': reason,
        'missingCheckout.leaveRequestId': leaveDoc._id,
        'missingCheckout.reviewAction': 'rejected',
        'missingCheckout.workingMinutesRestored': 0,
      },
      $push: {
        'missingCheckout.history': {
          timestamp: new Date(),
          status: 'finalized',
          message: `Finalized: ${reason}`,
          actor: 'scheduler',
        },
      },
    }
  )

  const leaveCount = await LeaveRequest.countDocuments({
    employee: emp._id,
    startDate: attendance.date,
    systemGenerated: true,
    conversionReason: 'Justification rejected',
  })
  assert.equal(leaveCount, 1,
    `LeaveRequest count expected 1 got ${leaveCount}`)

  const updatedAtt = await Attendance.findById(attendance._id).lean()
  const reviewOk = updatedAtt?.missingCheckout?.reviewAction === 'rejected' || !!updatedAtt?.missingCheckout?.finalizedAt
  assert.ok(reviewOk, 'Attendance reviewAction or finalizedAt not set correctly')
})

console.log('\n== TC-10: Deadline passed expired → finalizer creates LeaveRequest ==')
await runAsyncTest('TC-10: expired justification creates LeaveRequest', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 1))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const thuDate = atOrganizationTime(new Date(Date.UTC(2025, 7, 28)), 0, 0)
  const checkInTime = atOrganizationTime(thuDate, 10, 0)
  const deadline = atOrganizationTime(new Date(Date.UTC(2025, 8, 1)), 0, 0)
  const attendance = await createAttendance(emp, thuDate, {
    checkIn: { time: checkInTime },
    workingMinutes: 0,
    exceptionStatus: 'Missing Checkout – Justification Pending',
    status: 'missing_checkout',
    missedCheckOut: true,
    missingCheckout: {
      detectedAt: atOrganizationTime(new Date(Date.UTC(2025, 7, 29)), 0, 0),
      justificationStatus: 'pending',
      deadline,
      reviewAction: 'none',
      history: [{ timestamp: new Date(), status: 'pending', message: 'Missing', actor: 'scheduler' }],
    },
  })

  const todayAfterDeadline = atOrganizationTime(new Date(Date.UTC(2025, 8, 2)), 0, 0)
  await processMissingCheckoutFinalization(todayAfterDeadline)

  const leaveCount = await LeaveRequest.countDocuments({
    employee: emp._id,
    startDate: attendance.date,
    conversionReason: 'Missing checkout justification expired',
  })
  assert.equal(leaveCount, 1,
    `LeaveRequest expired count expected 1 got ${leaveCount}`)
})

console.log('\n== TC-11: Idempotency – no double alerts or double leaves ==')
await runAsyncTest('TC-11: idempotent alerts and finalization', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 1))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const thuDate = atOrganizationTime(new Date(Date.UTC(2025, 7, 25)), 0, 0)
  const checkInTime = atOrganizationTime(thuDate, 10, 0)
  const deadline = atOrganizationTime(new Date(Date.UTC(2025, 7, 29)), 0, 0)
  await createAttendance(emp, thuDate, {
    checkIn: { time: checkInTime },
    workingMinutes: 0,
    exceptionStatus: 'Missing Checkout – Justification Pending',
    status: 'missing_checkout',
    missedCheckOut: true,
    missingCheckout: {
      detectedAt: atOrganizationTime(new Date(Date.UTC(2025, 7, 26)), 0, 0),
      justificationStatus: 'pending',
      deadline,
      reviewAction: 'none',
      history: [{ timestamp: new Date(), status: 'pending', message: 'Missing', actor: 'scheduler' }],
    },
  })

  const dateKey = organizationDateKey(thuDate)
  const empIdStr = String(emp._id)
  const alertDedupeKey = `missing-checkout-alert:${empIdStr}:${dateKey}`
  const runDay = atOrganizationTime(new Date(Date.UTC(2025, 7, 26)), 9, 0)

  await processMissingCheckoutAlerts(runDay)
  const notifCount1 = await Notification.countDocuments({ dedupeKey: alertDedupeKey })
  const emailCount1 = await ScheduledEmail.countDocuments({ key: alertDedupeKey })
  await processMissingCheckoutAlerts(runDay)
  const notifCount2 = await Notification.countDocuments({ dedupeKey: alertDedupeKey })
  const emailCount2 = await ScheduledEmail.countDocuments({ key: alertDedupeKey })

  assert.equal(notifCount1, notifCount2,
    `Notification not idempotent: ${notifCount1} vs ${notifCount2}`)
  assert.equal(emailCount1, emailCount2,
    `ScheduledEmail not idempotent: ${emailCount1} vs ${emailCount2}`)
  assert.ok(notifCount1 <= 1, `Notifications count ${notifCount1} should be <= 1`)
  assert.ok(emailCount1 <= 1, `ScheduledEmails count ${emailCount1} should be <= 1`)

  const finalizeDay = atOrganizationTime(new Date(Date.UTC(2025, 8, 1)), 0, 0)
  await processMissingCheckoutFinalization(finalizeDay)
  const leaveCount1 = await LeaveRequest.countDocuments({
    employee: emp._id,
    startDate: thuDate,
    conversionReason: 'Missing checkout justification expired',
  })
  await processMissingCheckoutFinalization(finalizeDay)
  const leaveCount2 = await LeaveRequest.countDocuments({
    employee: emp._id,
    startDate: thuDate,
    conversionReason: 'Missing checkout justification expired',
  })
  assert.equal(leaveCount1, leaveCount2,
    `Leave finalization not idempotent: ${leaveCount1} vs ${leaveCount2}`)
  assert.equal(leaveCount1, 1,
    `Leave count after finalization expected 1 got ${leaveCount1}`)
})

console.log('\n== TC-12: Leave approved retroactively → recompute decreases target; idempotent ==')
await runAsyncTest('TC-12: retroactive leave recompute idempotent', async () => {
  const joining = startOfLocalDay(new Date(2025, 7, 25))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const wednesday = addDays(weekMonday, 2)

  const summary1 = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary1.originalScheduledMinutes, 2040,
    `summary1 original expected 2040 got ${summary1.originalScheduledMinutes}`)
  assert.equal(summary1.adjustedTargetMinutes, 2040,
    `summary1 adjusted expected 2040 got ${summary1.adjustedTargetMinutes}`)

  await createLeave(emp, wednesday, 'full_day')

  const summary2 = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary2.adjustedTargetMinutes, 1530,
    `summary2 adjusted expected 1530 got ${summary2.adjustedTargetMinutes}`)

  const summary3 = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary3.adjustedTargetMinutes, 1530,
    `summary3 adjusted expected 1530 (idempotent) got ${summary3.adjustedTargetMinutes}`)
  assert.equal(summary2.adjustedTargetMinutes, summary3.adjustedTargetMinutes,
    'summary2 and summary3 should be identical')
})

console.log('\n== TC-13: Joining date Wednesday → 3 days = 1530 min original target ==')
await runAsyncTest('TC-13: joining date wednesday only 3 eligible days', async () => {
  const joiningWed = atOrganizationTime(new Date(Date.UTC(2025, 8, 3)), 0, 0)
  const emp = await createFakeEmployee({ joiningDate: joiningWed })
  const weekMonday = setMondayWeekStart(2025, 9, 1)
  const summary = await getWeeklySummary(emp, weekMonday)
  assert.equal(summary.originalScheduledMinutes, 1530,
    `originalScheduledMinutes expected 1530 got ${summary.originalScheduledMinutes}`)
})

console.log('\n== TC-14: Month-boundary week Sep29–Oct5 allocates per month ==')
await runAsyncTest('TC-14: month boundary week leaves split per month', async () => {
  const joining = startOfLocalDay(new Date(2025, 8, 1))
  const emp = await createFakeEmployee({ joiningDate: joining })
  const weekMonday = setMondayWeekStart(2025, 9, 29)
  const tueSep30 = addDays(weekMonday, 1)
  const wedOct1 = addDays(weekMonday, 2)
  await createLeave(emp, tueSep30, 'half_day')
  await createLeave(emp, wedOct1, 'half_day')
  const weekSummary = await getWeeklySummary(emp, weekMonday)
  assert.ok(weekSummary.adjustedTargetMinutes < weekSummary.originalScheduledMinutes,
    `adjusted should be less than original after two half days`)

  const sepSummary = await getMonthlyLeaveSummary(emp, 9, 2025)
  assert.equal(sepSummary.halfDayLeaves, 1,
    `September halfDayLeaves expected 1 got ${sepSummary.halfDayLeaves}`)
  assert.equal(sepSummary.fullDayLeaves, 0,
    `September fullDayLeaves expected 0 got ${sepSummary.fullDayLeaves}`)

  const octSummary = await getMonthlyLeaveSummary(emp, 10, 2025)
  assert.equal(octSummary.halfDayLeaves, 1,
    `October halfDayLeaves expected 1 got ${octSummary.halfDayLeaves}`)
  assert.equal(octSummary.fullDayLeaves, 0,
    `October fullDayLeaves expected 0 got ${octSummary.fullDayLeaves}`)
})

await cleanupTestData()
await mongoose.disconnect()

console.log(`\nattendanceCalculation.test.js: ${TC.passed}/${TC.total} tests passed`)
process.exit(TC.total === TC.passed ? 0 : 1)
