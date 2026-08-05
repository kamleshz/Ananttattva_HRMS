import assert from 'node:assert/strict'
import { calculateLatePolicy, lateCutoff } from '../services/attendancePolicyService.js'
import { allocateMonthlyAllowance, allowanceSubmissionDeadline } from '../services/allowancePolicyService.js'
import { allowanceReminderContext } from '../services/allowanceReminderService.js'
import { scheduledShiftCheckout } from '../services/missingCheckoutService.js'

assert.deepEqual(calculateLatePolicy(0,0),{lateOccurrence:1,becomesHalfDay:false,halfDayOccurrence:0,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(2,0),{lateOccurrence:3,becomesHalfDay:true,halfDayOccurrence:1,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(5,1),{lateOccurrence:6,becomesHalfDay:true,halfDayOccurrence:2,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(8,2),{lateOccurrence:9,becomesHalfDay:true,halfDayOccurrence:3,shouldEscalate:true})
const cutoff = lateCutoff(new Date('2026-08-04T03:30:00.000Z'))
assert.equal(cutoff.toISOString(),'2026-08-04T04:45:00.000Z')
assert.equal(new Date('2026-08-04T04:44:00.000Z') > lateCutoff(new Date('2026-08-04T04:44:00.000Z')),false)
assert.equal(new Date('2026-08-04T09:44:00.000Z') > lateCutoff(new Date('2026-08-04T09:44:00.000Z')),true)

assert.deepEqual(allocateMonthlyAllowance(0,800),{monthlyLimit:2000,acceptableAmount:800,nonAcceptableAmount:0})
assert.deepEqual(allocateMonthlyAllowance(1600,800),{monthlyLimit:2000,acceptableAmount:400,nonAcceptableAmount:400})
assert.deepEqual(allocateMonthlyAllowance(1600,689),{monthlyLimit:2000,acceptableAmount:400,nonAcceptableAmount:289})
assert.deepEqual(allocateMonthlyAllowance(2000,500),{monthlyLimit:2000,acceptableAmount:0,nonAcceptableAmount:500})
const julyDeadline=allowanceSubmissionDeadline(new Date(2026,6,15))
assert.equal(julyDeadline.getMonth(),7)
assert.equal(julyDeadline.getDate(),3)
assert.equal(allowanceReminderContext(new Date(2026,6,31,9,0)).period,'2026-07')
assert.equal(allowanceReminderContext(new Date(2026,6,30,9,0)),null)

const automaticCheckout=scheduledShiftCheckout(new Date(2026,6,31),new Date(2026,6,31,10,5),'18:30')
assert.equal(automaticCheckout.getHours(),18)
assert.equal(automaticCheckout.getMinutes(),30)
assert.equal(scheduledShiftCheckout(new Date(2026,6,31),new Date(2026,6,31,20,0),'18:30').getHours(),20)

console.log(JSON.stringify({latePolicy:'passed',halfDayEscalation:'passed',allowanceCap:'passed',allowanceDeadline:'passed',allowanceReminder:'passed',missingCheckout:'passed'}))
