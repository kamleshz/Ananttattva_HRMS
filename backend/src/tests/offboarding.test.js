import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateFinance, deriveExitStatus } from '../services/offboardingService.js'

const caseState=overrides=>({status:'employee_handover_pending',handover:{},managerReview:{status:'waiting'},assetClearance:{status:'waiting'},itClearance:{status:'waiting'},financeClearance:{status:'waiting'},hrClearance:{status:'waiting'},management:{status:'waiting'},acknowledgement:{otpVerified:false},...overrides})

test('exit status follows handover and manager review',()=>{
  assert.equal(deriveExitStatus(caseState({})),'employee_handover_pending')
  assert.equal(deriveExitStatus(caseState({handover:{submittedAt:new Date()}})),'manager_review_pending')
  assert.equal(deriveExitStatus(caseState({handover:{submittedAt:new Date()},managerReview:{status:'action_required'}})),'manager_action_required')
})

test('department clearances run in parallel before management',()=>{
  const base=caseState({handover:{submittedAt:new Date()},managerReview:{status:'cleared'},assetClearance:{status:'cleared'},itClearance:{status:'cleared'},financeClearance:{status:'pending'},hrClearance:{status:'waiting'}})
  assert.equal(deriveExitStatus(base),'department_clearance_in_progress')
  assert.equal(deriveExitStatus({...base,financeClearance:{status:'cleared'},hrClearance:{status:'cleared'}}),'management_approval_pending')
})

test('approval and acknowledgement produce final clearance',()=>{
  const ready=caseState({handover:{submittedAt:new Date()},managerReview:{status:'cleared'},assetClearance:{status:'cleared'},itClearance:{status:'cleared'},financeClearance:{status:'cleared'},hrClearance:{status:'cleared'},management:{status:'approved'}})
  assert.equal(deriveExitStatus(ready),'employee_acknowledgement_pending')
  assert.equal(deriveExitStatus({...ready,acknowledgement:{otpVerified:true}}),'exit_cleared')
})

test('management override advances an incomplete case with an audit-visible flag',()=>{
  const overridden=caseState({management:{status:'approved',overrideUsed:true},acknowledgement:{otpVerified:false}})
  assert.equal(deriveExitStatus(overridden),'employee_acknowledgement_pending')
})

test('finance calculation includes approved asset recovery',()=>{
  const result=calculateFinance({expenseReimbursement:5000,pendingPaymentToEmployee:20000,salaryAdvance:3000,noticePeriodRecovery:2000,otherRecovery:1000},[{financeApprovedRecoveryAmount:4000}])
  assert.equal(result.totalPayable,25000);assert.equal(result.totalRecovery,10000);assert.equal(result.netSettlement,15000);assert.equal(result.assetRecovery,4000)
})
