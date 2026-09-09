import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { startOfLocalDay } from '../utils/date.js'
import { Holiday } from '../models/Holiday.js'
import { OrganizationProfile } from '../models/Organization.js'
import { getWeeklySummary, getMondayOfDate, splitWeekByMonth } from '../services/attendanceCalculationService.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'

const router = Router()
router.use(authenticate)

async function workforceDemographics(){
  const rows=await Employee.aggregate([{$match:{employeeStatus:'active'}},{$group:{_id:{$ifNull:['$gender','not_specified']},count:{$sum:1}}}])
  const counts=Object.fromEntries(rows.map(row=>[row._id,row.count]))
  return {male:counts.male||0,female:counts.female||0,nonBinary:counts.non_binary||0,preferNotToSay:counts.prefer_not_to_say||0,notSpecified:counts.not_specified||0}
}

function upcomingBirthday(employee, today) {
  const dateOfBirth = new Date(employee.dateOfBirth)
  let nextDate = new Date(today.getFullYear(), dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate())
  if (nextDate < today) nextDate = new Date(today.getFullYear()+1, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate())
  const daysUntil = Math.round((nextDate-today)/(24*60*60*1000))
  return { employeeId:employee.id, firstName:employee.firstName, lastName:employee.lastName, profilePhoto:employee.profilePhoto, date:nextDate, daysUntil }
}

router.get('/employee', asyncHandler(async (req, res) => {
  const employee = req.user.employee
  const today = startOfLocalDay()
  const currentWeekMonday = getMondayOfDate(today)
  const weekStart=new Date(currentWeekMonday)
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+7)
  const holidayEnd=new Date(today);holidayEnd.setDate(holidayEnd.getDate()+90)
  const directReportsCount = employee ? await Employee.countDocuments({ manager: employee._id, employeeStatus: { $in: ['active', 'notice_period'] } }) : 0
  const isReportingManager = directReportsCount > 0
  const [attendance,birthdayEmployees,weekRecords,holidays,organization, weeklySummary] = await Promise.all([
    employee ? Attendance.findOne({employee:employee._id,date:today}) : null,
    Employee.find({employeeStatus:'active',dateOfBirth:{$ne:null}}).select('firstName lastName profilePhoto dateOfBirth'),
    employee?Attendance.find({employee:employee._id,date:{$gte:weekStart,$lt:weekEnd}}).sort({date:1}).lean():[],
    Holiday.find({date:{$gte:today,$lte:holidayEnd}}).sort({date:1}).limit(5).lean(),
    OrganizationProfile.findOne({singletonKey:'organization'}).select('companyName shortName logo').lean(),
    employee?getWeeklySummary(employee, currentWeekMonday):null,
  ])
  const birthdays = birthdayEmployees.map(item=>upcomingBirthday(item,today)).filter(item=>item.daysUntil<=30).sort((a,b)=>a.daysUntil-b.daysUntil).slice(0,5)
  const week=Array.from({length:5},(_,index)=>{
    const date=new Date(weekStart);date.setDate(date.getDate()+index)
    const record=weekRecords.find(item=>new Date(item.date).toDateString()===date.toDateString())
    return {date,status:record?.status||(date>today?'upcoming':date.toDateString()===today.toDateString()?'today':'not_recorded'),workingMinutes:record?.workingMinutes||0,lateMinutes:record?.lateMinutes||0,halfDayPenaltyApplied:Boolean(record?.halfDayReason)}
  })
  const effectiveMinutes = weeklySummary ? weeklySummary.approvedWorkingMinutes : weekRecords.reduce((sum,item)=>sum+(item.workingMinutes||0),0)
  const completedDays = weeklySummary ? weeklySummary.dailyBreakdown.filter(d=>d.approvedWorkingMinutes>0).length : weekRecords.filter(item=>item.checkOut?.time).length
  const demographics=['super_admin','admin','hr_admin','it_admin'].includes(req.user.role)?await workforceDemographics():null
  const weekSummaryBackwardCompat = {
    effectiveMinutes,
    averageMinutes: completedDays ? Math.round(effectiveMinutes / completedDays) : 0,
    onTimeDays: weekRecords.filter(item => !item.lateMinutes).length,
    completedDays,
    monthlyLateCount: attendance?.lateOccurrenceInMonth || 0,
  }
  const weekSummary = weeklySummary ? {
    ...weekSummaryBackwardCompat,
    v2: {
      originalScheduledMinutes: weeklySummary.originalScheduledMinutes,
      fullDayLeaveAdjustmentMinutes: weeklySummary.fullDayLeaveAdjustmentMinutes,
      halfDayLeaveAdjustmentMinutes: weeklySummary.halfDayLeaveAdjustmentMinutes,
      adjustedTargetMinutes: weeklySummary.adjustedTargetMinutes,
      approvedWorkingMinutes: weeklySummary.approvedWorkingMinutes,
      shortfallExcessMinutes: weeklySummary.shortfallExcessMinutes,
      pendingExceptionsCount: weeklySummary.pendingExceptionsCount,
      complianceStatusText: weeklySummary.complianceStatusText,
    },
    dailyBreakdown: weeklySummary.dailyBreakdown,
  } : weekSummaryBackwardCompat
  const userWithFlags = {
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    role: req.user.role,
    isReportingManager,
    directReportsCount,
  }
  res.json({ success:true, data:{ user: userWithFlags, employee, organization, today:attendance, birthdays, holidays, week, demographics, weekSummary, tasks:[], away:[] } })
}))
router.get('/admin', authorize('super_admin','hr_admin','it_admin'), asyncHandler(async (_req, res) => {
  const date = startOfLocalDay()
  const [total, present, late, wfh,demographics] = await Promise.all([Employee.countDocuments({employeeStatus:'active'}),Attendance.countDocuments({date,status:'present'}),Attendance.countDocuments({date,status:'late'}),Attendance.countDocuments({date,status:'wfh'}),workforceDemographics()])
  res.json({success:true,data:{totalEmployees:total,presentToday:present,lateToday:late,wfhToday:wfh,notReported:Math.max(0,total-present-late-wfh),demographics}})
}))
export default router
