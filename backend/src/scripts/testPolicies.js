import assert from 'node:assert/strict'
import { calculateLatePolicy, lateCutoff } from '../services/attendancePolicyService.js'
import { allocateMonthlyAllowance } from '../services/allowancePolicyService.js'
import { scheduledShiftCheckout } from '../services/missingCheckoutService.js'

assert.deepEqual(calculateLatePolicy(0,0),{lateOccurrence:1,becomesHalfDay:false,halfDayOccurrence:0,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(2,0),{lateOccurrence:3,becomesHalfDay:true,halfDayOccurrence:1,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(5,1),{lateOccurrence:6,becomesHalfDay:true,halfDayOccurrence:2,shouldEscalate:false})
assert.deepEqual(calculateLatePolicy(8,2),{lateOccurrence:9,becomesHalfDay:true,halfDayOccurrence:3,shouldEscalate:true})
const cutoff = lateCutoff(new Date(2026,7,4,9,0))
assert.equal(cutoff.getHours(),10)
assert.equal(cutoff.getMinutes(),15)

assert.deepEqual(allocateMonthlyAllowance(0,800),{monthlyLimit:2000,acceptableAmount:800,nonAcceptableAmount:0})
assert.deepEqual(allocateMonthlyAllowance(1600,800),{monthlyLimit:2000,acceptableAmount:400,nonAcceptableAmount:400})
assert.deepEqual(allocateMonthlyAllowance(1600,689),{monthlyLimit:2000,acceptableAmount:400,nonAcceptableAmount:289})
assert.deepEqual(allocateMonthlyAllowance(2000,500),{monthlyLimit:2000,acceptableAmount:0,nonAcceptableAmount:500})

const automaticCheckout=scheduledShiftCheckout(new Date(2026,6,31),new Date(2026,6,31,10,5),'18:30')
assert.equal(automaticCheckout.getHours(),18)
assert.equal(automaticCheckout.getMinutes(),30)
assert.equal(scheduledShiftCheckout(new Date(2026,6,31),new Date(2026,6,31,20,0),'18:30').getHours(),20)

console.log(JSON.stringify({latePolicy:'passed',halfDayEscalation:'passed',allowanceCap:'passed',missingCheckout:'passed'}))
