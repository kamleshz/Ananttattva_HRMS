import { Attendance } from '../models/Attendance.js'
import { HttpError } from '../utils/httpError.js'
import { atOrganizationTime, startOfLocalDay } from '../utils/date.js'
import { evaluateLatePolicy, lateCutoff, reportLateAttendanceEscalation } from './attendancePolicyService.js'

export async function checkIn(employee, payload, requestMeta, checkInTime = new Date()) {
  if (!employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const date = startOfLocalDay(checkInTime)
  if (await Attendance.exists({ employee: employee._id, date })) throw new HttpError(409, 'You have already checked in today')
  const now = checkInTime
  const applicableLatePolicy = payload.attendanceMode !== 'wfh' && now > lateCutoff(now)
  const lateMinutes = applicableLatePolicy ? Math.max(1, Math.floor((now - lateCutoff(now)) / 60000)) : 0
  const latePolicy = applicableLatePolicy ? await evaluateLatePolicy(employee._id,now) : null
  const record = await Attendance.create({ employee: employee._id, date, attendanceMode: payload.attendanceMode, locationVerified: Boolean(payload.locationVerified), biometricVerification:payload.biometricVerification, status: latePolicy?.becomesHalfDay ? 'half_day' : applicableLatePolicy ? 'late' : payload.attendanceMode === 'wfh' ? 'wfh' : 'present', lateMinutes, lateOccurrenceInMonth:latePolicy?.lateOccurrence||0, halfDayReason:latePolicy?.becomesHalfDay?'three_late_arrivals':null, policyHalfDayOccurrenceInMonth:latePolicy?.becomesHalfDay?latePolicy.halfDayOccurrence:0, checkIn: { ...payload.location, photo: payload.photo, time: now, ...requestMeta, source:payload.source||'biometric',manualRequest:payload.manualRequest,proofPhotoStorageKey:payload.proofPhotoStorageKey,verification:payload.biometricVerification } })
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
  record.biometricVerification = payload.biometricVerification
  const [endHour,endMinute]=(employee.shift?.endTime||'18:30').split(':').map(Number)
  const shiftEnd=atOrganizationTime(record.date,endHour,endMinute)
  record.earlyCheckoutMinutes=now<shiftEnd?Math.floor((shiftEnd-now)/60000):0
  record.overtimeMinutes=now>shiftEnd?Math.floor((now-shiftEnd)/60000):0
  record.checkoutType = payload.source==='system_auto'?'AUTO_CHECKOUT':payload.source==='hr_correction'?'HR_CORRECTION':'MANUAL_CHECKOUT'
  await record.save()
  return record
}
