import test from 'node:test'
import assert from 'node:assert/strict'
import { approvalTimestamp, distanceMeters, validateFallbackEligibility } from '../services/manualAttendanceService.js'

test('approval preserves the immutable server request timestamp',()=>{const requestedAt=new Date('2026-08-10T06:00:00.000Z');assert.equal(approvalTimestamp({requestedAt,attemptedAt:new Date()}).toISOString(),requestedAt.toISOString())})
test('server-side geofence distance is deterministic',()=>{const distance=distanceMeters({latitude:19.076,longitude:72.8777},{latitude:19.0761,longitude:72.8777});assert.ok(distance>=10&&distance<=12)})
test('technical failures allow immediate fallback',()=>{assert.equal(validateFallbackEligibility({reasonCode:'CAMERA_PERMISSION_DENIED',attempts:0,technicalErrorCode:'CAMERA_PERMISSION_DENIED'}),true)})
test('recoverable failures require two attempts',()=>{assert.throws(()=>validateFallbackEligibility({reasonCode:'FACE_NOT_DETECTED',attempts:1}));assert.equal(validateFallbackEligibility({reasonCode:'FACE_NOT_DETECTED',attempts:2}),true)})
test('face mismatch requires trusted proof and two attempts',()=>{assert.throws(()=>validateFallbackEligibility({reasonCode:'FACE_MISMATCH',attempts:2,mismatchTrusted:false}));assert.equal(validateFallbackEligibility({reasonCode:'FACE_MISMATCH',attempts:2,mismatchTrusted:true}),true)})
