import { Holiday } from '../models/Organization.js';

export const LONG_LEAVE_DAYS = 4;
export const LONG_LEAVE_NOTICE_DAYS = 10;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function cloneUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(value) {
  if (value instanceof Date) return cloneUtc(value);
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return cloneUtc(d);
}

export function financialYearRange(date, startMonth = 4) {
  const anchor = parseDate(date) || cloneUtc(new Date());
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + 1;
  const startYear = month >= startMonth ? year : year - 1;
  const fyStart = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const fyEnd = new Date(Date.UTC(startYear + 1, startMonth - 1, 0, 23, 59, 59, 999));
  return { fyStart, fyEnd, label: `${startYear}-${String(startYear + 1).slice(2)}` };
}

export function addMonths(date, months) {
  const d = cloneUtc(date);
  const targetMonth = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function diffDaysInclusive(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / MILLIS_PER_DAY) + 1);
}

export function diffCalendarDays(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / MILLIS_PER_DAY));
}

async function fetchHolidayDates(fyStart, fyEnd) {
  const docs = await Holiday.find({ date: { $gte: fyStart, $lte: fyEnd } }).select('date -_id').lean();
  return new Set(docs.map((doc) => parseDate(doc.date).toISOString().slice(0, 10)));
}

export function countWorkingDays(start, end, holidays = new Set(), options = {}) {
  const { excludeWeekends = true, excludedWeekdays = [0, 6] } = options;
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e || e < s) return 0;
  let count = 0;
  const cursor = cloneUtc(s);
  while (cursor <= e) {
    const key = cursor.toISOString().slice(0, 10);
    const isWeekend = excludeWeekends && excludedWeekdays.includes(cursor.getUTCDay());
    if (!isWeekend && !holidays.has(key)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function eligibleMonths({ confirmationDate, fyStart, fyEnd, joiningDate, confirmationCutoffDay = 15 } = {}) {
  const join = parseDate(joiningDate) || parseDate(fyStart);
  const confirmed = parseDate(confirmationDate);
  if (!confirmed) return 0;
  const effStart = join >= fyStart ? join : fyStart;
  const startForLeave = confirmed >= effStart ? confirmed : effStart;
  const effEnd = cloneUtc(fyEnd);
  if (startForLeave > effEnd) return 0;
  let months = 0;
  let cursor = new Date(Date.UTC(startForLeave.getUTCFullYear(), startForLeave.getUTCMonth(), 1));
  while (cursor <= effEnd) {
    const monthStart = cloneUtc(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const windowStart = monthStart >= startForLeave ? monthStart : startForLeave;
    const cutoff = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), confirmationCutoffDay));
    if (windowStart <= monthEnd) {
      if (startForLeave.getUTCFullYear() === monthStart.getUTCFullYear() && startForLeave.getUTCMonth() === monthStart.getUTCMonth()) {
        if (startForLeave <= cutoff) months += 1;
      } else {
        months += 1;
      }
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function proratedAnnualPaidLeaves({ employee, asOf = new Date(), holidays } = {}) {
  const plan = employee?.leavePlan || {};
  const probation = employee?.probation || {};
  const annualPaidLeaves = Number(plan.annualPaidLeaves || 18);
  const cycleStartMonth = Number(plan.cycleStartMonth || 4);
  const { fyStart, fyEnd, label } = financialYearRange(asOf, cycleStartMonth);
  const confirmed = probation.confirmationStatus === 'confirmed' && probation.confirmedAt;
  let entitled;
  let eligibleMonthsCount = 0;
  let canApplyPaidLeave = Boolean(confirmed);
  let blockedReason = '';
  if (!confirmed) {
    entitled = 0;
    blockedReason = 'Paid leaves unlock once HR confirms your probation.';
  } else {
    eligibleMonthsCount = eligibleMonths({
      confirmationDate: probation.confirmedAt,
      fyStart,
      fyEnd,
      joiningDate: employee.joiningDate,
    });
    entitled = Math.floor((annualPaidLeaves * eligibleMonthsCount) / 12);
  }
  const monthlyAccrual = annualPaidLeaves / 12;
  return {
    fyStart: fyStart.toISOString(),
    fyEnd: fyEnd.toISOString(),
    fyLabel: label,
    annualPaidLeaves,
    cycleStartMonth,
    eligibleMonths: eligibleMonthsCount,
    entitledPaidLeaves: entitled,
    monthlyAccrual,
    canApplyPaidLeave,
    blockedReason,
  };
}

export function longLeavePolicy({ startDate, days, asOf = new Date() } = {}) {
  const isLongLeave = Number(days || 0) >= LONG_LEAVE_DAYS;
  const start = parseDate(startDate);
  const today = parseDate(asOf);
  const calendarNoticeDays = start ? diffCalendarDays(today, start) : 0;
  const meetsAdvanceNotice = !isLongLeave || calendarNoticeDays >= LONG_LEAVE_NOTICE_DAYS;
  return {
    isLongLeave,
    noticeDaysRequired: isLongLeave ? LONG_LEAVE_NOTICE_DAYS : 0,
    calendarNoticeDays,
    meetsAdvanceNotice,
    requiredNoticeDate: start ? new Date(start.getTime() - LONG_LEAVE_NOTICE_DAYS * MILLIS_PER_DAY).toISOString().slice(0, 10) : null,
  };
}

export function buildApprovalChain({ days } = {}) {
  if (Number(days || 0) >= LONG_LEAVE_DAYS) {
    return ['manager', 'hr_admin', 'super_admin'];
  }
  return ['manager', 'hr_admin'];
}

export async function countPaidLeaveDaysForEmployee({ employeeId, leaveRequestModel, leaveTypeKey = 'paid_leave' } = {}) {
  const docs = await leaveRequestModel
    .find({ employee: employeeId, status: 'approved', 'payments.mode': 'paid' })
    .select('payments -_id')
    .lean();
  let total = 0;
  for (const doc of docs) {
    total += Number(doc.payments?.paidDays || 0);
  }
  return total;
}

export async function computeLeaveDays({ startDate, endDate }) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end < start) throw new Error('Invalid date range');
  const range = financialYearRange(start);
  const holidays = await fetchHolidayDates(range.fyStart, range.fyEnd);
  const calendarDays = diffDaysInclusive(start, end);
  const workingDays = countWorkingDays(start, end, holidays);
  return {
    calendarDays,
    workingDays,
    holidays,
    fyStart: range.fyStart,
    fyEnd: range.fyEnd,
  };
}

export function validateLeaveRequest({ employee, leaveType, workingDays, startDate, asOf = new Date() } = {}) {
  const warnings = [];
  const longPolicy = longLeavePolicy({ startDate, days: workingDays, asOf });
  const plan = proratedAnnualPaidLeaves({ employee, asOf });
  if (!['paid_leave', 'unpaid_leave', 'casual', 'sick', 'earned', 'unpaid'].includes(leaveType)) {
    throw new Error('Leave type is not supported');
  }
  const normalizedType = leaveType === 'unpaid' ? 'unpaid_leave' : leaveType;
  const isPaid = normalizedType !== 'unpaid_leave';
  if (normalizedType === 'paid_leave' && !plan.canApplyPaidLeave) {
    throw new Error(plan.blockedReason || 'You are not eligible for paid leave yet.');
  }
  if (!longPolicy.meetsAdvanceNotice) {
    throw new Error(`Leave of ${LONG_LEAVE_DAYS}+ working days must be applied at least ${LONG_LEAVE_NOTICE_DAYS} calendar days before the start date.`);
  }
  return {
    normalizedType,
    isPaid,
    longLeavePolicy: longPolicy,
    plan,
    warnings,
  };
}
