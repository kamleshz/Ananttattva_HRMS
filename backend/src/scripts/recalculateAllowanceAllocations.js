import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { AllowanceClaim } from '../models/AllowanceClaim.js'
import { allocateMonthlyAllowance, allowanceMonthKey, currency } from '../services/allowancePolicyService.js'

await connectDatabase()
const claims=await AllowanceClaim.find().sort({employee:1,createdAt:1,_id:1})
const usedByEmployeeMonth=new Map()
let updated=0

for(const claim of claims){
  const month=allowanceMonthKey(claim.travelDate)
  const key=`${claim.employee}:${month}`
  const total=currency(claim.totalAmount)
  if(claim.status==='rejected'){
    claim.capAcceptableAmount=0
    claim.acceptableAmount=0
    claim.nonAcceptableAmount=total
  }else{
    const used=usedByEmployeeMonth.get(key)||0
    const allocation=allocateMonthlyAllowance(used,total)
    claim.capAcceptableAmount=allocation.acceptableAmount
    let specialAmount=0
    if(['pending','approved'].includes(claim.specialApproval?.status)){
      specialAmount=currency(Math.min(claim.specialApproval.amount||0,allocation.nonAcceptableAmount))
      claim.specialApproval.amount=specialAmount
      if(specialAmount===0)claim.specialApproval.status='not_requested'
    }
    const speciallyApproved=claim.specialApproval?.status==='approved'?specialAmount:0
    claim.acceptableAmount=currency(allocation.acceptableAmount+speciallyApproved)
    claim.nonAcceptableAmount=currency(allocation.nonAcceptableAmount-speciallyApproved)
    usedByEmployeeMonth.set(key,currency(used+allocation.acceptableAmount))
  }
  claim.monthlyLimit=2000
  claim.allowanceMonth=month
  await claim.save()
  updated++
}

console.log(JSON.stringify({updated,employeeMonths:usedByEmployeeMonth.size,policy:'per_employee_month'}))
await mongoose.disconnect()
