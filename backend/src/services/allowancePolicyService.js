export const MONTHLY_ALLOWANCE_LIMIT = 2000

export const currency = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export const allowanceMonthKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`

export const allowanceMonthRange = date => ({
  start:new Date(date.getFullYear(),date.getMonth(),1),
  end:new Date(date.getFullYear(),date.getMonth()+1,1),
})

export function allocateMonthlyAllowance(previouslyAccepted,claimTotal) {
  const remaining = currency(Math.max(0,MONTHLY_ALLOWANCE_LIMIT-previouslyAccepted))
  const acceptableAmount = currency(Math.min(claimTotal,remaining))
  return {
    monthlyLimit:MONTHLY_ALLOWANCE_LIMIT,
    acceptableAmount,
    nonAcceptableAmount:currency(Math.max(0,claimTotal-acceptableAmount)),
  }
}
