import mongoose from 'mongoose'
import { Attendance } from '../models/Attendance.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { HttpError } from '../utils/httpError.js'
import { atOrganizationTime, endOfLocalDay, startOfLocalDay } from '../utils/date.js'
import { evaluateLatePolicy, lateCutoff, reportLateAttendanceEscalation, getAttendancePolicy } from './attendancePolicyService.js'

export async function attendanceTarget(employeeId, date) {
  const policy = await getAttendancePolicy()
  if (!mongoose.isValidObjectId(employeeId)) return { attendanceDayType:'full_day', expectedWorkingMinutes: policy.fullDayWorkingMinutes }
  const halfDay = await LeaveRequest.exists({ employee:employeeId, status:'approved', dayType:'half_day', startDate:{ $lte:endOfLocalDay(date) }, endDate:{ $gte:startOfLocalDay(date) } })
  return halfDay ? { attendanceDayType:'half_day', expectedWorkingMinutes: policy.halfDayWorkingMinutes } : { attendanceDayType:'full_day', expectedWorkingMinutes: policy.fullDayWorkingMinutes }
}

export async function applyAttendanceCompletion(record, employeeId) {
  const target = await attendanceTarget(employeeId, record.date)
  record.attendanceDayType = target.attendanceDayType
  record.expectedWorkingMinutes = target.expectedWorkingMinutes
  record.completionStatus = record.checkOut?.time
    ? (Number(record.workingMinutes || 0) >= target.expectedWorkingMinutes ? 'completed' : 'incomplete')
    : 'pending'
  return record
}

export async function checkIn(employee, payload, requestMeta, checkInTime = new Date()) {
  if (!employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const date = startOfLocalDay(checkInTime)
  if (await Attendance.exists({ employee: employee._id, date })) throw new HttpError(409, 'You have already checked in today')
  const now = checkInTime
  const applicableLatePolicy = payload.attendanceMode !== 'wfh' && now > lateCutoff(now)
  const lateMinutes = applicableLatePolicy ? Math.max(1, Math.floor((now - lateCutoff(now)) / 60000)) : 0
  const latePolicy = applicableLatePolicy ? await evaluateLatePolicy(employee._id,now) : null
  const target = await attendanceTarget(employee._id, date)
  const record = await Attendance.create({ employee: employee._id, date, ...target, attendanceMode: payload.attendanceMode, locationVerified: Boolean(payload.locationVerified), biometricVerification:payload.biometricVerification, status: latePolicy?.becomesHalfDay ? 'half_day' : applicableLatePolicy ? 'late' : payload.attendanceMode === 'wfh' ? 'wfh' : 'present', lateMinutes, lateOccurrenceInMonth:latePolicy?.lateOccurrence||0, halfDayReason:latePolicy?.becomesHalfDay?'three_late_arrivals':null, policyHalfDayOccurrenceInMonth:latePolicy?.becomesHalfDay?latePolicy.halfDayOccurrence:0, checkIn: { ...payload.location, photo: payload.photo, time: now, ...requestMeta, source:payload.source||'biometric',manualRequest:payload.manualRequest,proofPhotoStorageKey:payload.proofPhotoStorageKey,verification:payload.biometricVerification } })
  if (latePolicy?.shouldEscalate) {
    try {
      await reportLateAttendanceEscalation(employee,now,latePolicy.halfDayOccurrence)
      record.policyEscalatedAt = new Date()
      await record.save()
    } catch (error) {
      console.error('Attendance escalation reporting failed:',error?.message||error)
    }
  }
  return record
}

export async function checkOut(employee, payload, requestMeta, checkOutTime = new Date()) {
  if (!employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const record = await Attendance.findOne({ employee: employee._id, date: startOfLocalDay(checkOutTime) })
  if (!record) throw new HttpError(404, 'Check in before checking out')
  const replacingSystemAutoCheckout = Boolean(payload.replaceSystemAutoCheckout && record.checkOut?.source === 'system_auto')
  if (record.checkOut?.time && !replacingSystemAutoCheckout) throw new HttpError(409, 'Attendance is already completed for this date')
  const now = checkOutTime
  if (replacingSystemAutoCheckout) record.status = record.autoCheckout?.previousStatus || (record.attendanceMode === 'wfh' ? 'wfh' : 'present')
  record.checkOut = { ...payload.location, photo: payload.photo, time: now, ...requestMeta, source:payload.source||'biometric',manualRequest:payload.manualRequest,proofPhotoStorageKey:payload.proofPhotoStorageKey,verification:payload.biometricVerification }
  record.workingMinutes = Math.max(0, Math.floor((now - record.checkIn.time) / 60000))
  await applyAttendanceCompletion(record, employee._id)
  record.missedCheckOut = false
  record.biometricVerification = payload.biometricVerification
  const [endHour,endMinute]=(employee.shift?.endTime||'18:30').split(':').map(Number)
  const shiftEnd=atOrganizationTime(record.date,endHour,endMinute)
  record.earlyCheckoutMinutes=now<shiftEnd?Math.floor((shiftEnd-now)/60000):0
  record.overtimeMinutes=now>shiftEnd?Math.floor((now-shiftEnd)/60000):0
  record.checkoutType = payload.source==='system_auto'?'AUTO_CHECKOUT':payload.source==='hr_correction'?'HR_CORRECTION':'MANUAL_CHECKOUT'

  // FIX #1: Late same-day checkout auto-resolve — employee checked out after shift-end but within
  // the same local calendar day (00:00..23:59:59). Clear the missing-checkout exception status
  // so weekly escalation counter does NOT treat this as a real miss (re-verification compatible).
  const exceptionPending = Boolean(record.missingCheckout?.detectedAt) &&
    ['Missing Checkout – Justification Pending','Absent – Missing Checkout Overdue'].includes(String(record.exceptionStatus || ''))
  if (exceptionPending) {
    const dayStart = startOfLocalDay(record.date)
    const dayEnd = endOfLocalDay(record.date)
    if (now >= dayStart && now <= dayEnd) {
      const resolveReason = now > shiftEnd ? 'late_actual_checkout_same_day' : 'checkout_same_day_after_flag'
      const prevStatus = record.missingCheckout || {}
      record.exceptionStatus = `Resolved – ${resolveReason === 'late_actual_checkout_same_day' ? 'Late same-day checkout (auto)' : 'Same-day checkout after detection (auto)'}`
      record.status = record.attendanceMode === 'wfh' ? 'wfh' : 'present'
      record.missingCheckout = {
        ...(prevStatus.toObject ? prevStatus.toObject() : prevStatus),
        justificationStatus: 'submitted',
        finalizedAt: new Date(),
        conversionReason: resolveReason,
        workingMinutesRestored: Number(record.workingMinutes || 0),
        reviewNote: `Auto-resolved: actual check-out on ${formatD(now)} at ${formatT(now)}`,
        history: [
          ...(prevStatus.history || []),
          {
            timestamp: new Date(),
            status: 'resolved_late_checkout',
            message: `Actual checkout @ ${formatT(now)} (${resolveReason}). Exception cleared.`,
            actor: 'system_auto_resolve'
          }
        ]
      }
      record.completionStatus = Number(record.workingMinutes||0) >= (record.expectedWorkingMinutes||0) ? 'completed' : 'incomplete'
    }
  }

  await record.save()
  return record
}

function formatD(date){const d=new Date(date);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function formatT(date){const d=new Date(date);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
