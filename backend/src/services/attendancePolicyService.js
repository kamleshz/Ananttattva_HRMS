import { Attendance } from '../models/Attendance.js'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'
import { OrganizationProfile } from '../models/Organization.js'
import { env } from '../config/env.js'
import { sendGraphEmail } from './mailService.js'
import { atOrganizationTime, organizationMonthBounds } from '../utils/date.js'

export const LATE_CUTOFF_HOUR = 10
export const LATE_CUTOFF_MINUTE = 15
export const LATES_PER_HALF_DAY = 3
export const HALF_DAYS_BEFORE_ESCALATION = 3

const DEFAULT_POLICY = {
  fullDayWorkingMinutes: 510,
  halfDayWorkingMinutes: 255,
  lateCutoff: { hour: 10, minute: 15 },
  checkoutReminder: { hour: 18, minute: 30 },
  autoDeductPaidLeaveOnMissingCheckout: false,
  missingCheckoutJustificationDays: 3,
}

let policyCache = null
let policyCacheTimestamp = 0
const POLICY_CACHE_TTL_MS = 10_000

export async function getAttendancePolicy() {
  const now = Date.now()
  if (policyCache && (now - policyCacheTimestamp) < POLICY_CACHE_TTL_MS) {
    return { ...policyCache }
  }

  let profile = await OrganizationProfile.findOne({ singletonKey: 'organization' }).lean()

  if (!profile || !profile.attendancePolicy) {
    profile = await OrganizationProfile.findOneAndUpdate(
      { singletonKey: 'organization' },
      { $setOnInsert: { attendancePolicy: DEFAULT_POLICY } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
  }

  const p = profile.attendancePolicy || {}
  const merged = {
    fullDayWorkingMinutes: Number(p.fullDayWorkingMinutes) || DEFAULT_POLICY.fullDayWorkingMinutes,
    halfDayWorkingMinutes: Number(p.halfDayWorkingMinutes) || DEFAULT_POLICY.halfDayWorkingMinutes,
    lateCutoff: {
      hour: Number(p.lateCutoff?.hour) ?? DEFAULT_POLICY.lateCutoff.hour,
      minute: Number(p.lateCutoff?.minute) ?? DEFAULT_POLICY.lateCutoff.minute,
    },
    checkoutReminder: {
      hour: Number(p.checkoutReminder?.hour) ?? DEFAULT_POLICY.checkoutReminder.hour,
      minute: Number(p.checkoutReminder?.minute) ?? DEFAULT_POLICY.checkoutReminder.minute,
    },
    autoDeductPaidLeaveOnMissingCheckout: Boolean(p.autoDeductPaidLeaveOnMissingCheckout ?? DEFAULT_POLICY.autoDeductPaidLeaveOnMissingCheckout),
    missingCheckoutJustificationDays: Number(p.missingCheckoutJustificationDays) || DEFAULT_POLICY.missingCheckoutJustificationDays,
  }

  policyCache = merged
  policyCacheTimestamp = now
  return { ...merged }
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[character])

export function monthBounds(date = new Date()) {
  return organizationMonthBounds(date)
}

export function lateCutoff(date = new Date()) {
  return atOrganizationTime(date,LATE_CUTOFF_HOUR,LATE_CUTOFF_MINUTE)
}

export function calculateLatePolicy(existingLateCount, existingPolicyHalfDays) {
  const lateOccurrence = existingLateCount + 1
  const becomesHalfDay = lateOccurrence % LATES_PER_HALF_DAY === 0
  const halfDayOccurrence = existingPolicyHalfDays + (becomesHalfDay ? 1 : 0)
  return {
    lateOccurrence,
    becomesHalfDay,
    halfDayOccurrence,
    shouldEscalate:becomesHalfDay && halfDayOccurrence === HALF_DAYS_BEFORE_ESCALATION,
  }
}

export async function evaluateLatePolicy(employeeId, now = new Date()) {
  const { start,end } = monthBounds(now)
  const [existingLateCount,existingPolicyHalfDays] = await Promise.all([
    Attendance.countDocuments({employee:employeeId,date:{$gte:start,$lt:end},lateMinutes:{$gt:0}}),
    Attendance.countDocuments({employee:employeeId,date:{$gte:start,$lt:end},halfDayReason:'three_late_arrivals'}),
  ])
  return calculateLatePolicy(existingLateCount,existingPolicyHalfDays)
}

export async function reportLateAttendanceEscalation(employee, monthDate, halfDayCount) {
  const recipients = await User.find({role:{$in:['hr_admin','admin','super_admin']},isActive:true}).select('_id email firstName')
  if (!recipients.length) return { notifications:0, emails:0 }
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim()
  const month = new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(monthDate)
  const title = 'Attendance escalation: 3 half-days'
  const message = `${employeeName} (${employee.employeeCode}) has reached ${halfDayCount} attendance-policy half-days in ${month} after repeated arrivals later than 10:15.`
  await Notification.insertMany(recipients.map(recipient=>({recipient:recipient._id,type:'Attendance Escalation',title,message,employee:employee._id})))

  const html = `<div style="font-family:Arial,sans-serif;color:#17213a;line-height:1.7"><h2>${title}</h2><p>${escapeHtml(message)}</p><table style="border-collapse:collapse"><tr><td style="padding:6px 14px 6px 0;color:#667085">Employee</td><td><strong>${escapeHtml(employeeName)}</strong></td></tr><tr><td style="padding:6px 14px 6px 0;color:#667085">Employee ID</td><td>${escapeHtml(employee.employeeCode)}</td></tr><tr><td style="padding:6px 14px 6px 0;color:#667085">Month</td><td>${escapeHtml(month)}</td></tr><tr><td style="padding:6px 14px 6px 0;color:#667085">Policy</td><td>Every 3 arrivals after 10:15 = 1 half-day</td></tr></table><p>Please review the employee’s attendance record in AT Connect.</p></div>`
  const deliverable = recipients.filter(recipient=>!(env.nodeEnv==='development'&&recipient.email.endsWith('.local')))
  const deliveries = await Promise.allSettled(deliverable.map(recipient=>sendGraphEmail({recipient:recipient.email,subject:`${title} – ${employeeName}`,html})))
  return { notifications:recipients.length, emails:deliveries.filter(result=>result.status==='fulfilled').length }
}
