import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { User } from '../models/User.js'
import { endOfLocalDay, startOfLocalDay } from '../utils/date.js'
import { sendAttendanceEscalation, sendAttendanceMissNotice, sendCheckoutReminder, sendWeeklyHoursShortfall } from './mailService.js'
import { holidayKeysBetween, isScheduledWorkingDay, organizationDateKey, organizationTimeForKey } from './workingDayService.js'

const CHECK_INTERVAL_MS=60_000
const DAY_MS=86_400_000
let lastReminderKey=''
let lastDailyAuditKey=''
let lastWeeklyAuditKey=''

export function hoursAndMinutes(totalMinutes){const safe=Math.max(0,Math.round(Number(totalMinutes)||0));return `${Math.floor(safe/60)}h ${String(safe%60).padStart(2,'0')}m`}

export function previousClosedWeek(now=new Date()){
  const today=startOfLocalDay(now),weekday=new Date(today.getTime()+330*60_000).getUTCDay(),daysSinceMonday=weekday===0?6:weekday-1,currentMonday=new Date(today.getTime()-daysSinceMonday*DAY_MS)
  return {start:new Date(currentMonday.getTime()-7*DAY_MS),end:currentMonday}
}

export function splitPeriodByMonth(start,end){
  const periods=[]
  for(let cursor=new Date(start);cursor<end;){
    const key=organizationDateKey(cursor),[year,month]=key.split('-').map(Number),nextMonth=dateFromMonth(year,month+1),periodEnd=nextMonth<end?nextMonth:end
    periods.push({start:new Date(cursor),end:new Date(periodEnd)});cursor=periodEnd
  }
  return periods
}

function dateFromMonth(year,month){const normalizedYear=year+Math.floor((month-1)/12),normalizedMonth=((month-1)%12+12)%12+1;return new Date(Date.UTC(normalizedYear,normalizedMonth-1,1)-330*60_000)}

export function scheduledShiftCheckout(attendanceDate,checkInTime,endTime='18:30'){
  const [hours,minutes]=String(endTime).split(':').map(Number),scheduled=organizationTimeForKey(organizationDateKey(attendanceDate),Number.isFinite(hours)?hours:18,Number.isFinite(minutes)?minutes:30)
  return scheduled<checkInTime?new Date(checkInTime):scheduled
}

async function claimEmail({key,type,period,user}){try{return await ScheduledEmail.create({key,type,period,recipient:user._id,email:user.email,attempts:1})}catch(error){if(error?.code!==11000)throw error;return ScheduledEmail.findOneAndUpdate({key,status:'failed'},{$set:{status:'processing',lastError:'',email:user.email},$inc:{attempts:1}},{new:true})}}
async function deliver(claim,send){if(!claim)return false;try{await send();claim.status='sent';claim.sentAt=new Date();await claim.save();return true}catch(error){claim.status='failed';claim.lastError=String(error?.message||error).slice(0,500);await claim.save();return false}}
async function approvedLeave(employeeId,dayStart,dayEnd,dayType){return LeaveRequest.exists({employee:employeeId,status:'approved',...(dayType&&{dayType}),startDate:{$lte:dayEnd},endDate:{$gte:dayStart}})}

export async function processCheckoutReminders(now=new Date()){
  const key=organizationDateKey(now),reminderAt=organizationTimeForKey(key,18,30)
  if(now<reminderAt||now>=new Date(reminderAt.getTime()+60*60_000))return 0
  if(lastReminderKey===key)return 0
  const dayStart=startOfLocalDay(now),dayEnd=endOfLocalDay(now),holidays=await holidayKeysBetween(dayStart,dayEnd)
  if(!isScheduledWorkingDay(now,holidays))return 0
  const records=await Attendance.find({date:dayStart,'checkIn.time':{$exists:true},$or:[{'checkOut.time':{$exists:false}},{'checkOut.time':null}]}).populate('employee','firstName employeeCode shift user')
  let sent=0
  for(const record of records){const user=record.employee?.user?await User.findOne({_id:record.employee.user,isActive:true}).select('_id email firstName'):null;if(!user?.email)continue;const claim=await claimEmail({key:`checkout-reminder:${key}:${user._id}`,type:'checkout_reminder',period:key,user});if(await deliver(claim,()=>sendCheckoutReminder({recipient:user.email,firstName:user.firstName||record.employee.firstName,date:key,shiftEnd:'18:30'})))sent++}
  lastReminderKey=key
  return sent
}

export async function processMissingCheckouts(now=new Date()){
  const today=startOfLocalDay(now),records=await Attendance.find({date:{$lt:today},'checkIn.time':{$exists:true},$or:[{'checkOut.time':{$exists:false}},{'checkOut.time':null}]}).populate('employee','firstName lastName employeeCode shift user')
  let processed=0
  for(const record of records){
    if(!record.employee)continue
    const halfDay=await approvedLeave(record.employee._id,startOfLocalDay(record.date),endOfLocalDay(record.date),'half_day'),target=halfDay?270:510
    const checkoutTime=halfDay?new Date(record.checkIn.time.getTime()+270*60_000):scheduledShiftCheckout(record.date,record.checkIn.time,'18:30'),previousStatus=record.status
    record.checkOut={time:checkoutTime,address:halfDay?'System auto checkout after half-day target':'System auto checkout at configured shift end',device:'AT Connect scheduler',source:'system_auto'}
    record.checkoutType='AUTO_CHECKOUT';record.workingMinutes=Math.max(0,Math.floor((checkoutTime-record.checkIn.time)/60_000));record.status='missing_checkout';record.attendanceDayType=halfDay?'half_day':'full_day';record.expectedWorkingMinutes=target;record.completionStatus=record.workingMinutes>=target?'completed':'incomplete';record.missedCheckOut=true;record.autoCheckout={appliedAt:now,scheduledCheckoutTime:checkoutTime,previousStatus};await record.save()
    const user=record.employee.user?await User.findOne({_id:record.employee.user,isActive:true}).select('_id email firstName'):null
    if(user?.email){const date=organizationDateKey(record.date),claim=await claimEmail({key:`attendance-miss:checkout:${date}:${user._id}`,type:'attendance_miss',period:date,user});await deliver(claim,()=>sendAttendanceMissNotice({recipient:user.email,firstName:user.firstName||record.employee.firstName,date,missType:'check_out'}))}
    processed++
  }
  return processed
}

function weekBounds(now){const today=startOfLocalDay(now),weekday=new Date(today.getTime()+330*60_000).getUTCDay(),offset=weekday===0?6:weekday-1;return{start:new Date(today.getTime()-offset*DAY_MS),end:new Date(today.getTime()+(7-offset)*DAY_MS)}}

export async function processMissingCheckInsAndEscalations(now=new Date()){
  const auditKey=organizationDateKey(now)
  if(lastDailyAuditKey===auditKey)return 0
  const yesterday=new Date(startOfLocalDay(now).getTime()-DAY_MS),dateKey=organizationDateKey(yesterday),dayEnd=endOfLocalDay(yesterday),holidays=await holidayKeysBetween(yesterday,dayEnd)
  if(isScheduledWorkingDay(yesterday,holidays)){
    const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('_id firstName user').lean(),attended=new Set((await Attendance.find({date:yesterday,'checkIn.time':{$exists:true}}).distinct('employee')).map(String))
    for(const employee of employees){if(attended.has(String(employee._id))||await approvedLeave(employee._id,yesterday,dayEnd,'full_day'))continue;const user=employee.user?await User.findOne({_id:employee.user,isActive:true}).select('_id email firstName'):null;if(!user?.email)continue;const claim=await claimEmail({key:`attendance-miss:checkin:${dateKey}:${user._id}`,type:'attendance_miss',period:dateKey,user});await deliver(claim,()=>sendAttendanceMissNotice({recipient:user.email,firstName:user.firstName||employee.firstName,date:dateKey,missType:'check_in'}))}
  }
  const {start,end}=weekBounds(now),today=startOfLocalDay(now),weekKey=`${organizationDateKey(start)}:${organizationDateKey(new Date(end.getTime()-1))}`
  const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('_id firstName lastName employeeCode user manager').lean(),weekHolidays=await holidayKeysBetween(start,end)
  const attendance=await Attendance.find({date:{$gte:start,$lt:end}}).select('employee date checkIn checkOut missedCheckOut').lean(),leaves=await LeaveRequest.find({status:'approved',dayType:'full_day',startDate:{$lt:end},endDate:{$gte:start}}).select('employee startDate endDate').lean()
  const adminEmails=(await User.find({isActive:true,role:{$in:['hr_admin','admin','super_admin']}}).select('email').lean()).map(item=>item.email).filter(Boolean)
  for(const employee of employees){
    const records=attendance.filter(item=>String(item.employee)===String(employee._id)),misses=[]
    for(let day=new Date(start);day<end&&day<today;day=new Date(day.getTime()+DAY_MS)){if(!isScheduledWorkingDay(day,weekHolidays))continue;const date=organizationDateKey(day),record=records.find(item=>organizationDateKey(item.date)===date),onFullLeave=leaves.some(item=>String(item.employee)===String(employee._id)&&item.startDate<=endOfLocalDay(day)&&item.endDate>=startOfLocalDay(day));if(!record?.checkIn?.time&&!onFullLeave)misses.push(`${date} check-in`);else if(record?.missedCheckOut||record?.checkOut?.source==='system_auto')misses.push(`${date} checkout`)}
    if(misses.length<3||!employee.user||!adminEmails.length)continue
    const user=await User.findOne({_id:employee.user,isActive:true}).select('_id email'),manager=employee.manager?await User.findOne({employee:employee.manager,isActive:true}).select('email'):null
    if(!user?.email)continue
    const claim=await claimEmail({key:`attendance-escalation:${weekKey}:${user._id}`,type:'attendance_escalation',period:weekKey,user});await deliver(claim,()=>sendAttendanceEscalation({recipient:user.email,ccRecipients:[manager?.email,...adminEmails].filter(Boolean),employeeName:`${employee.firstName} ${employee.lastName}`.trim(),employeeCode:employee.employeeCode,week:weekKey,misses}))
  }
  lastDailyAuditKey=auditKey
}

export async function processWeeklyHoursCompliance(now=new Date()){
  const auditKey=organizationDateKey(now)
  if(lastWeeklyAuditKey===auditKey)return 0
  const {start,end}=previousClosedWeek(now),periods=splitPeriodByMonth(start,end)
  const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']},joiningDate:{$lt:end}}).select('_id firstName lastName employeeCode joiningDate user').lean()
  const attendance=await Attendance.find({date:{$gte:start,$lt:end}}).select('employee date workingMinutes').lean()
  const leaves=await LeaveRequest.find({status:'approved',startDate:{$lt:end},endDate:{$gte:start}}).select('employee startDate endDate dayType').lean()
  const adminEmails=[...new Set((await User.find({isActive:true,role:{$in:['hr_admin','admin','super_admin']}}).select('email').lean()).map(item=>item.email?.trim().toLowerCase()).filter(Boolean))]
  let sent=0
  for(const period of periods){
    const holidays=await holidayKeysBetween(period.start,new Date(period.end.getTime()-1)),periodStartKey=organizationDateKey(period.start),periodEndKey=organizationDateKey(new Date(period.end.getTime()-1)),periodLabel=`${periodStartKey} to ${periodEndKey}`
    for(const employee of employees){
      let expectedMinutes=0,scheduledDays=0
      for(let day=new Date(period.start);day<period.end;day=new Date(day.getTime()+DAY_MS)){
        if(day<startOfLocalDay(employee.joiningDate)||!isScheduledWorkingDay(day,holidays))continue
        const dayStart=startOfLocalDay(day),dayEnd=endOfLocalDay(day),leave=leaves.find(item=>String(item.employee)===String(employee._id)&&item.startDate<=dayEnd&&item.endDate>=dayStart)
        if(leave?.dayType==='full_day')continue
        const target=leave?.dayType==='half_day'?270:510
        expectedMinutes+=target;scheduledDays+=target/510
      }
      if(!expectedMinutes||!employee.user)continue
      const actualMinutes=attendance.filter(item=>String(item.employee)===String(employee._id)&&item.date>=period.start&&item.date<period.end).reduce((total,item)=>total+Math.max(0,Number(item.workingMinutes)||0),0)
      if(actualMinutes>=expectedMinutes)continue
      const user=await User.findOne({_id:employee.user,isActive:true}).select('_id email firstName').lean()
      if(!user?.email)continue
      const claim=await claimEmail({key:`weekly-hours-shortfall:${periodStartKey}:${periodEndKey}:${user._id}`,type:'weekly_hours_shortfall',period:periodLabel,user})
      if(await deliver(claim,()=>sendWeeklyHoursShortfall({recipient:user.email,ccRecipients:adminEmails,firstName:user.firstName||employee.firstName,employeeName:`${employee.firstName} ${employee.lastName}`.trim(),employeeCode:employee.employeeCode,period:periodLabel,scheduledDays:Number(scheduledDays.toFixed(1)),expectedHours:hoursAndMinutes(expectedMinutes),recordedHours:hoursAndMinutes(actualMinutes),shortfallHours:hoursAndMinutes(expectedMinutes-actualMinutes)})))sent++
    }
  }
  lastWeeklyAuditKey=auditKey
  return sent
}

export function startMissingCheckoutScheduler(){const run=async()=>{await processCheckoutReminders();await processMissingCheckouts();await processMissingCheckInsAndEscalations();await processWeeklyHoursCompliance()};run().catch(error=>console.error('Attendance scheduler failed:',error?.message||error));const timer=setInterval(()=>run().catch(error=>console.error('Attendance scheduler failed:',error?.message||error)),CHECK_INTERVAL_MS);timer.unref();return timer}
