export const MONTHLY_ALLOWANCE_LIMIT = 2000

export const currency = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export const allowanceMonthKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`

export const allowanceMonthRange = date => ({
  start:new Date(date.getFullYear(),date.getMonth(),1),
  end:new Date(date.getFullYear(),date.getMonth()+1,1),
})

export const allowanceSubmissionDeadline = date => new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,3,18,29,59,999))

export function allocateMonthlyAllowance(previouslyAcceptedTravel,travelAllowance,extraAllowance=0) {
  const remaining = currency(Math.max(0,MONTHLY_ALLOWANCE_LIMIT-previouslyAcceptedTravel))
  const acceptableTravel = currency(Math.min(travelAllowance,remaining))
  const acceptableAmount = currency(acceptableTravel+Number(extraAllowance||0))
  const nonAcceptableTravel = currency(Math.max(0,travelAllowance-acceptableTravel))
  return {
    monthlyLimit:MONTHLY_ALLOWANCE_LIMIT,
    acceptableTravel,
    acceptableAmount,
    nonAcceptableAmount:nonAcceptableTravel,
  }
}
