import { Attendance } from '../models/Attendance.js'
import { HttpError } from '../utils/httpError.js'
import { startOfLocalDay } from '../utils/date.js'
import { evaluateLatePolicy, lateCutoff, reportLateAttendanceEscalation } from './attendancePolicyService.js'

export async function checkIn(employee, payload, requestMeta) {
  if (!employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const date = startOfLocalDay()
  if (await Attendance.exists({ employee: employee._id, date })) throw new HttpError(409, 'You have already checked in today')
  const now = new Date()
  const applicableLatePolicy = payload.attendanceMode !== 'wfh' && now > lateCutoff(now)
  const lateMinutes = applicableLatePolicy ? Math.max(1, Math.floor((now - lateCutoff(now)) / 60000)) : 0
  const latePolicy = applicableLatePolicy ? await evaluateLatePolicy(employee._id,now) : null
  const record = await Attendance.create({ employee: employee._id, date, attendanceMode: payload.attendanceMode, locationVerified: Boolean(payload.locationVerified), biometricVerification:payload.biometricVerification, status: latePolicy?.becomesHalfDay ? 'half_day' : applicableLatePolicy ? 'late' : payload.attendanceMode === 'wfh' ? 'wfh' : 'present', lateMinutes, lateOccurrenceInMonth:latePolicy?.lateOccurrence||0, halfDayReason:latePolicy?.becomesHalfDay?'three_late_arrivals':null, policyHalfDayOccurrenceInMonth:latePolicy?.becomesHalfDay?latePolicy.halfDayOccurrence:0, checkIn: { ...payload.location, photo: payload.photo, time: now, ...requestMeta } })
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

export async function checkOut(employee, payload, requestMeta) {
  const record = await Attendance.findOne({ employee: employee._id, date: startOfLocalDay() })
  if (!record) throw new HttpError(404, 'Check in before checking out')
  if (record.checkOut?.time) throw new HttpError(409, 'Attendance is already completed for today')
  const now = new Date()
  record.checkOut = { ...payload.location, photo: payload.photo, time: now, ...requestMeta }
  record.workingMinutes = Math.max(0, Math.floor((now - record.checkIn.time) / 60000))
  record.biometricVerification = payload.biometricVerification
  await record.save()
  return record
}
