import { Holiday } from '../models/Holiday.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { ExitCase } from '../models/Offboarding.js'
import {
  ORGANIZATION_TIMEZONE_OFFSET_MINUTES,
  startOfLocalDay,
  endOfLocalDay,
  atOrganizationTime,
  organizationMonthBounds,
  organizationMonthBoundsFor,
} from '../utils/date.js'
import {
  organizationDateKey,
  dateFromKey,
  isScheduledWorkingDay,
} from './workingDayService.js'
import { getAttendancePolicy } from './attendancePolicyService.js'

const DAY_MS = 86_400_000

export async function getOrganizationHolidayKeys(yearRange) {
  const currentYear = new Date(new Date().getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000).getUTCFullYear()
  let years
  if (yearRange && Array.isArray(yearRange) && yearRange.length >= 2) {
    const [startY, endY] = yearRange
    years = []
    for (let y = Number(startY); y <= Number(endY); y++) years.push(y)
  } else {
    years = [currentYear - 1, currentYear, currentYear + 1]
  }

  const result = new Map()
  if (!years.length) return result

  const start = new Date(Date.UTC(years[0], 0, 1) - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
  const end = new Date(Date.UTC(years[years.length - 1] + 1, 0, 1) - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)

  const holidays = await Holiday.find({ date: { $gte: start, $lt: end } }).select('date -_id').lean()

  for (const year of years) {
    result.set(year, new Set())
  }

  for (const h of holidays) {
    const key = organizationDateKey(h.date)
    const yearPart = Number(key.slice(0, 4))
    if (result.has(yearPart)) {
      result.get(yearPart).add(key)
    }
  }

  return result
}

export async function getApprovedLeavesByDate(employeeId, startDate, endDate) {
  const result = new Map()
  const leaves = await LeaveRequest.find({
    employee: employeeId,
    status: 'approved',
    startDate: { $lte: endOfLocalDay(endDate) },
    endDate: { $gte: startOfLocalDay(startDate) },
  }).lean()

  for (const leave of leaves) {
    const dayStartCursor = startOfLocalDay(leave.startDate)
    const leaveEnd = endOfLocalDay(leave.endDate)
    for (let cursor = new Date(dayStartCursor); cursor <= leaveEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
      if (cursor < startOfLocalDay(startDate) || cursor > endOfLocalDay(endDate)) continue
      const key = organizationDateKey(cursor)
      if (!result.has(key)) {
        result.set(key, { fullDayLeaves: [], halfDayLeaves: [] })
      }
      const entry = result.get(key)
      if (leave.dayType === 'full_day') {
        entry.fullDayLeaves.push(leave)
      } else if (leave.dayType === 'half_day') {
        entry.halfDayLeaves.push(leave)
      }
    }
  }

  return result
}

export async function getAttendanceRecordsMap(employeeId, startDate, endDate) {
  const result = new Map()
  const records = await Attendance.find({
    employee: employeeId,
    date: { $gte: startOfLocalDay(startDate), $lte: endOfLocalDay(endDate) },
  }).lean()

  for (const rec of records) {
    const key = organizationDateKey(rec.date)
    result.set(key, rec)
  }

  return result
}

export function getMondayOfDate(date) {
  const localDayStart = startOfLocalDay(date)
  const shifted = new Date(localDayStart.getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
  const weekday = shifted.getUTCDay()
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
  const mondayShifted = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysSinceMonday))
  return new Date(mondayShifted.getTime() - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
}

export function splitWeekByMonth(weekStartMonday) {
  const slices = []
  const weekStart = new Date(weekStartMonday)
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)

  let cursor = new Date(weekStart)
  while (cursor < weekEnd) {
    const key = organizationDateKey(cursor)
    const [yearStr, monthStr] = key.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const nextMonthDate = organizationMonthBoundsFor(year, month + 1).start
    const periodEnd = nextMonthDate < weekEnd ? nextMonthDate : weekEnd

    slices.push({
      month,
      year,
      startDate: new Date(cursor),
      endDate: new Date(periodEnd.getTime() - 1),
    })
    cursor = periodEnd
  }

  return slices
}

async function resolveFinalWorkingDate(employee) {
  const statusesNeedingCheck = ['resigned', 'terminated', 'inactive']
  if (!statusesNeedingCheck.includes(employee.employeeStatus)) {
    return null
  }

  const offboardingDate = employee.offboarding?.finalWorkingDate || employee.offboarding?.lastWorkingDate
  if (offboardingDate) return new Date(offboardingDate)

  try {
    const exitCase = await ExitCase.findOne({
      employee: employee._id,
      status: { $nin: ['cancelled', 'separated'] },
    }).select('lastWorkingDate -_id').lean()
    if (exitCase?.lastWorkingDate) return new Date(exitCase.lastWorkingDate)
  } catch (_) {
  }

  return null
}

export async function getDailyAttendancePlan(employee, date, opts = {}) {
  const policy = opts.policy || await getAttendancePolicy()

  const dateKey = organizationDateKey(date)
  const dayOfWeek = new Date(new Date(date).getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000).getUTCDay()
  const isWeeklyOff = dayOfWeek === 0 || (dayOfWeek === 6 && ![2, 4, 5].includes(Math.ceil(Number(dateKey.slice(8, 10)) / 7)))

  let holidaysSetForYear = opts.holidaysSetForYear
  if (!holidaysSetForYear) {
    const year = Number(dateKey.slice(0, 4))
    const holidayMap = await getOrganizationHolidayKeys([year, year])
    holidaysSetForYear = holidayMap.get(year) || new Set()
  }
  const isHoliday = holidaysSetForYear.has(dateKey)
  const isWorkingDay = isScheduledWorkingDay(date, holidaysSetForYear)

  const joiningEligibleDate = employee.joiningDate ? startOfLocalDay(employee.joiningDate) : null
  const isJoiningEligible = !joiningEligibleDate || startOfLocalDay(date) >= joiningEligibleDate

  let finalWorkingDate = opts.finalWorkingDate !== undefined ? opts.finalWorkingDate : await resolveFinalWorkingDate(employee)
  const isFinalWorkingEligible = !finalWorkingDate || startOfLocalDay(date) <= endOfLocalDay(finalWorkingDate)

  let leavesForDate = opts.leavesForDate
  if (!leavesForDate) {
    const leavesMap = await getApprovedLeavesByDate(employee._id, date, date)
    leavesForDate = leavesMap.get(dateKey) || { fullDayLeaves: [], halfDayLeaves: [] }
  }
  const fullDayLeaveApproved = Array.isArray(leavesForDate.fullDayLeaves) && leavesForDate.fullDayLeaves.length > 0
  const halfDayLeaveApproved = !fullDayLeaveApproved && Array.isArray(leavesForDate.halfDayLeaves) && leavesForDate.halfDayLeaves.length > 0

  let attendanceForDate = opts.attendanceForDate
  if (!attendanceForDate) {
    const attMap = await getAttendanceRecordsMap(employee._id, date, date)
    attendanceForDate = attMap.get(dateKey) || null
  }

  let exceptionStatus = attendanceForDate?.exceptionStatus || ''
  if (!exceptionStatus && attendanceForDate?.checkIn?.time && !attendanceForDate?.checkOut?.time) {
    exceptionStatus = 'Missing Checkout – Justification Pending'
  }

  const originalScheduledMinutes = (isWorkingDay && isJoiningEligible && isFinalWorkingEligible) ? policy.fullDayWorkingMinutes : 0
  const fullDayLeaveAdjustmentMinutes = 0 - (fullDayLeaveApproved ? policy.fullDayWorkingMinutes : 0)
  const halfDayLeaveAdjustmentMinutes = halfDayLeaveApproved ? policy.halfDayWorkingMinutes : 0
  const expectedWorkingMinutes = originalScheduledMinutes + fullDayLeaveAdjustmentMinutes - halfDayLeaveAdjustmentMinutes

  let approvedWorkingMinutes = 0
  if (attendanceForDate) {
    const hasCheckOut = Boolean(attendanceForDate.checkOut?.time)
    const justificationStatus = attendanceForDate.missingCheckout?.justificationStatus
    const justificationPending = justificationStatus && ['pending', 'submitted'].includes(justificationStatus)
    if (hasCheckOut && !justificationPending) {
      approvedWorkingMinutes = Number(attendanceForDate.workingMinutes) || 0
    }
  }

  return {
    date: new Date(date),
    dateKey,
    isWorkingDay,
    isWeeklyOff,
    isHoliday,
    isJoiningEligible,
    isFinalWorkingEligible,
    fullDayLeaveApproved,
    halfDayLeaveApproved,
    exceptionStatus,
    originalScheduledMinutes,
    fullDayLeaveAdjustmentMinutes,
    halfDayLeaveAdjustmentMinutes,
    expectedWorkingMinutes,
    approvedWorkingMinutes,
  }
}

export async function getWeeklySummary(employee, weekStartMonday) {
  const policy = await getAttendancePolicy()
  const weekStart = new Date(weekStartMonday)
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS - 1)

  const yearStart = Number(organizationDateKey(weekStart).slice(0, 4))
  const yearEnd = Number(organizationDateKey(weekEnd).slice(0, 4))
  const holidayMap = await getOrganizationHolidayKeys([Math.min(yearStart, yearEnd), Math.max(yearStart, yearEnd)])

  const leavesMap = await getApprovedLeavesByDate(employee._id, weekStart, weekEnd)
  const attendanceMap = await getAttendanceRecordsMap(employee._id, weekStart, weekEnd)

  const finalWorkingDate = await resolveFinalWorkingDate(employee)

  const dailyBreakdown = []
  let originalScheduledMinutes = 0
  let fullDayLeaveAdjustmentMinutes = 0
  let halfDayLeaveAdjustmentMinutes = 0
  let adjustedTargetMinutes = 0
  let approvedWorkingMinutes = 0
  let pendingExceptionsCount = 0

  for (let cursor = new Date(weekStart); cursor <= weekEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const key = organizationDateKey(cursor)
    const yearNum = Number(key.slice(0, 4))
    const holidaysSetForYear = holidayMap.get(yearNum) || new Set()
    const plan = await getDailyAttendancePlan(employee, cursor, {
      policy,
      holidaysSetForYear,
      leavesForDate: leavesMap.get(key) || { fullDayLeaves: [], halfDayLeaves: [] },
      attendanceForDate: attendanceMap.get(key) || null,
      finalWorkingDate,
    })
    dailyBreakdown.push(plan)
    originalScheduledMinutes += plan.originalScheduledMinutes
    fullDayLeaveAdjustmentMinutes += plan.fullDayLeaveAdjustmentMinutes
    halfDayLeaveAdjustmentMinutes += plan.halfDayLeaveAdjustmentMinutes
    adjustedTargetMinutes += plan.expectedWorkingMinutes
    approvedWorkingMinutes += plan.approvedWorkingMinutes
    if (plan.exceptionStatus && plan.exceptionStatus.includes('Pending')) {
      pendingExceptionsCount++
    }
  }

  const shortfallExcessMinutes = approvedWorkingMinutes - adjustedTargetMinutes

  let complianceStatusText
  if (pendingExceptionsCount > 0) {
    complianceStatusText = 'Pending exceptions'
  } else if (adjustedTargetMinutes === 0) {
    complianceStatusText = 'No scheduled days'
  } else if (approvedWorkingMinutes >= adjustedTargetMinutes) {
    complianceStatusText = 'Target achieved'
  } else {
    complianceStatusText = 'Shortfall'
  }

  const monthSlices = splitWeekByMonth(weekStart)

  return {
    weekStart,
    weekEnd,
    monthSlices,
    dailyBreakdown,
    originalScheduledMinutes,
    fullDayLeaveAdjustmentMinutes,
    halfDayLeaveAdjustmentMinutes,
    adjustedTargetMinutes,
    approvedWorkingMinutes,
    shortfallExcessMinutes,
    pendingExceptionsCount,
    complianceStatusText,
  }
}

export async function getMonthlyLeaveSummary(employee, month, year) {
  const { start: monthStart, end: monthEndExclusive } = organizationMonthBoundsFor(year, month)
  const monthEnd = new Date(monthEndExclusive.getTime() - 1)

  const policy = await getAttendancePolicy()
  const holidayMap = await getOrganizationHolidayKeys([year, year])
  const holidaysSetForYear = holidayMap.get(year) || new Set()

  const leaves = await LeaveRequest.find({
    employee: employee._id,
    status: 'approved',
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  }).lean()

  const finalWorkingDate = await resolveFinalWorkingDate(employee)
  const joiningDate = employee.joiningDate ? startOfLocalDay(employee.joiningDate) : null

  const byDateLeaveBuckets = new Map()
  const leavesByType = {}

  for (const leave of leaves) {
    const type = leave.leaveType || 'other'
    if (!leavesByType[type]) {
      leavesByType[type] = { full: 0, half: 0, total: 0 }
    }
    const cursorStart = startOfLocalDay(leave.startDate)
    const leaveEnd = endOfLocalDay(leave.endDate)
    for (let cursor = new Date(cursorStart); cursor <= leaveEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
      if (cursor < monthStart || cursor > monthEnd) continue
      const key = organizationDateKey(cursor)
      if (!byDateLeaveBuckets.has(key)) byDateLeaveBuckets.set(key, { full: 0, half: 0 })
      const bucket = byDateLeaveBuckets.get(key)
      if (leave.dayType === 'full_day') {
        bucket.full++
        leavesByType[type].full++
        leavesByType[type].total++
      } else if (leave.dayType === 'half_day') {
        bucket.half++
        leavesByType[type].half++
        leavesByType[type].total += 0.5
      }
    }
  }

  let fullDayLeaves = 0
  let halfDayLeaves = 0
  let workingDaysPlanned = 0
  let minutesExpectedMonth = 0
  let minutesWorkedMonth = 0

  const attendanceMap = await getAttendanceRecordsMap(employee._id, monthStart, monthEnd)
  const leavesMap = await getApprovedLeavesByDate(employee._id, monthStart, monthEnd)

  for (let cursor = new Date(monthStart); cursor <= monthEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const key = organizationDateKey(cursor)
    const holidaySet = holidaysSetForYear
    const isWorkingDay = isScheduledWorkingDay(cursor, holidaySet)
    const isJoiningEligible = !joiningDate || startOfLocalDay(cursor) >= joiningDate
    const isFinalWorkingEligible = !finalWorkingDate || startOfLocalDay(cursor) <= endOfLocalDay(finalWorkingDate)
    const eligible = isWorkingDay && isJoiningEligible && isFinalWorkingEligible

    if (eligible) workingDaysPlanned++

    const leaveEntry = byDateLeaveBuckets.get(key)
    if (leaveEntry) {
      fullDayLeaves += leaveEntry.full > 0 ? 1 : 0
      halfDayLeaves += leaveEntry.half > 0 ? 1 : 0
    }

    const plan = await getDailyAttendancePlan(employee, cursor, {
      policy,
      holidaysSetForYear,
      leavesForDate: leavesMap.get(key) || { fullDayLeaves: [], halfDayLeaves: [] },
      attendanceForDate: attendanceMap.get(key) || null,
      finalWorkingDate,
    })
    minutesExpectedMonth += plan.expectedWorkingMinutes
    minutesWorkedMonth += plan.approvedWorkingMinutes
  }

  const totalLeaveDaysConsumed = fullDayLeaves + halfDayLeaves * 0.5

  return {
    fullDayLeaves,
    halfDayLeaves,
    totalLeaveDaysConsumed,
    workingDaysPlanned,
    minutesExpectedMonth,
    minutesWorkedMonth,
    leavesByType,
  }
}

export async function recalculateAffectedPeriods(employeeId, dateRangeStart, dateRangeEnd) {
  const startKey = organizationDateKey(dateRangeStart)
  const endKey = organizationDateKey(dateRangeEnd)
  console.log(`[recalculateAffectedPeriods] Stub: employee=${String(employeeId)} range=${startKey}..${endKey} – reports are live, nothing to do.`)
}
