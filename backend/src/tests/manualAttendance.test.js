import test from 'node:test'
import assert from 'node:assert/strict'
import { Attendance } from '../models/Attendance.js'
import { checkOut } from '../services/attendanceService.js'
import { approvalTimestamp, distanceMeters, normalizeDeviceDetails, validateFallbackEligibility } from '../services/manualAttendanceService.js'

test('approval preserves the immutable server request timestamp',()=>{const requestedAt=new Date('2026-08-10T06:00:00.000Z');assert.equal(approvalTimestamp({requestedAt,attemptedAt:new Date()}).toISOString(),requestedAt.toISOString())})
test('server-side geofence distance is deterministic',()=>{const distance=distanceMeters({latitude:19.076,longitude:72.8777},{latitude:19.0761,longitude:72.8777});assert.ok(distance>=10&&distance<=12)})
test('technical failures allow immediate fallback',()=>{assert.equal(validateFallbackEligibility({reasonCode:'CAMERA_PERMISSION_DENIED',attempts:0,technicalErrorCode:'CAMERA_PERMISSION_DENIED'}),true)})
test('recoverable failures require two attempts',()=>{assert.throws(()=>validateFallbackEligibility({reasonCode:'FACE_NOT_DETECTED',attempts:1}));assert.equal(validateFallbackEligibility({reasonCode:'FACE_NOT_DETECTED',attempts:2}),true)})
test('face mismatch requires trusted proof and two attempts',()=>{assert.throws(()=>validateFallbackEligibility({reasonCode:'FACE_MISMATCH',attempts:2,mismatchTrusted:false}));assert.equal(validateFallbackEligibility({reasonCode:'FACE_MISMATCH',attempts:2,mismatchTrusted:true}),true)})
test('long mobile user-agent details are safely normalized',()=>{const details=normalizeDeviceDetails({browser:'Mobile Browser '.repeat(20),os:'Android 15',deviceType:'mobile'});assert.equal(details.browser.length,80);assert.equal(details.os,'Android 15');assert.equal(details.deviceType,'mobile')})
test('a delayed manual approval replaces only the scheduler auto-checkout',async t=>{
  const requestedAt=new Date('2026-08-14T14:00:00.000Z')
  const record={date:new Date('2026-08-14T00:00:00.000Z'),attendanceMode:'office',status:'missing_checkout',checkIn:{time:new Date('2026-08-14T04:30:00.000Z')},checkOut:{time:new Date('2026-08-14T13:00:00.000Z'),source:'system_auto'},autoCheckout:{previousStatus:'late'},save:async()=>{}}
  const originalFindOne=Attendance.findOne
  t.after(()=>{Attendance.findOne=originalFindOne})
  Attendance.findOne=async()=>record
  await checkOut({_id:'employee-1',shift:{endTime:'18:30'}},{attendanceMode:'office',source:'manual_fallback',replaceSystemAutoCheckout:true,location:{},biometricVerification:{}},{},requestedAt)
  assert.equal(record.checkOut.time.toISOString(),requestedAt.toISOString())
  assert.equal(record.checkOut.source,'manual_fallback')
  assert.equal(record.status,'late')
  assert.equal(record.checkoutType,'MANUAL_CHECKOUT')
})
