import { Attendance } from '../models/Attendance.js'
import { AttendanceCorrectionRequest } from '../models/AttendanceCorrectionRequest.js'
import { Employee } from '../models/Employee.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { User } from '../models/User.js'
import { Notification } from '../models/Recruitment.js'
import mongoose from 'mongoose'
import { endOfLocalDay, startOfLocalDay, atOrganizationTime } from '../utils/date.js'
import { sendAttendanceEscalation, sendAttendanceMissNotice, sendCheckoutReminder, sendWeeklyHoursShortfall } from './mailService.js'
import { holidayKeysBetween, isScheduledWorkingDay, organizationDateKey, organizationTimeForKey } from './workingDayService.js'
import { getAttendancePolicy } from './attendancePolicyService.js'
import { getWeeklySummary, splitWeekByMonth } from './attendanceCalculationService.js'
import { financialYearRange, proratedAnnualPaidLeaves, computeLeaveDays } from './leavePolicyService.js'

const CHECK_INTERVAL_MS=60_000
const DAY_MS=86_400_000
let lastReminderKey=''
let lastDailyAuditKey=''
let lastWeeklyAuditKey=''

export function hoursAndMinutes(totalMinutes){const safe=Math.max(0,Math.round(Number(totalMinutes)||0));return `${Math.floor(safe/60)}h ${String(safe%60).padStart(2,'0')}m`}

function formatDate(date){
  const d=new Date(date)
  const day=String(d.getDate()).padStart(2,'0')
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const month=months[d.getMonth()]
  const year=d.getFullYear()
  return `${day} ${month} ${year}`
}

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

async function claimEmail({key,type,period,user,email}){try{const emailAddr=email||user.email;return await ScheduledEmail.create({key,type,period,recipient:user._id,email:emailAddr,attempts:1})}catch(error){if(error?.code!==11000)throw error;return ScheduledEmail.findOneAndUpdate({key,status:'failed'},{$set:{status:'processing',lastError:'',email:email||user.email},$inc:{attempts:1}},{new:true})}}
async function deliver(claim,send){if(!claim)return false;try{await send();claim.status='sent';claim.sentAt=new Date();await claim.save();return true}catch(error){claim.status='failed';claim.lastError=String(error?.message||error).slice(0,500);await claim.save();return false}}
async function approvedLeave(employeeId,dayStart,dayEnd,dayType){return LeaveRequest.exists({employee:employeeId,status:'approved',...(dayType&&{dayType}),startDate:{$lte:dayEnd},endDate:{$gte:dayStart}})}

function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + Number(days))
  return result
}

export async function processCheckoutReminders(now=new Date()){
  const key=organizationDateKey(now)
  const policy=await getAttendancePolicy()
  const reminderHour=Number(policy.checkoutReminder?.hour)??18
  const reminderMinute=Number(policy.checkoutReminder?.minute)??30
  const reminderAt=organizationTimeForKey(key,reminderHour,reminderMinute)
  if(now<reminderAt||now>=new Date(reminderAt.getTime()+60*60_000))return 0
  if(lastReminderKey===key)return 0
  const dayStart=startOfLocalDay(now),dayEnd=endOfLocalDay(now),holidays=await holidayKeysBetween(dayStart,dayEnd)
  if(!isScheduledWorkingDay(now,holidays))return 0
  const records=await Attendance.find({date:dayStart,'checkIn.time':{$exists:true},$or:[{'checkOut.time':{$exists:false}},{'checkOut.time':null}]}).populate('employee','firstName employeeCode shift user')
  let sent=0
  for(const record of records){const user=record.employee?.user?await User.findOne({_id:record.employee.user,isActive:true}).select('_id email firstName'):null;if(!user?.email)continue;const claim=await claimEmail({key:`checkout-reminder:${key}:${user._id}`,type:'checkout_reminder',period:key,user});if(await deliver(claim,()=>sendCheckoutReminder({recipient:user.email,firstName:user.firstName||record.employee.firstName,date:key,shiftEnd:`${String(reminderHour).padStart(2,'0')}:${String(reminderMinute).padStart(2,'0')}`})))sent++}
  lastReminderKey=key
  return sent
}

export async function processMissingCheckouts(now=new Date()){
  const today=startOfLocalDay(now)
  const records=await Attendance.find({
    date:{$lt:today},
    'checkIn.time':{$exists:true},
    $or:[{'checkOut.time':{$exists:false}},{'checkOut.time':null}],
    $and:[
      {$or:[
        {'missingCheckout.justificationStatus':'none'},
        {'missingCheckout.justificationStatus':{$exists:false}},
        {missingCheckout:null}
      ]},
      {missedCheckOut:{$ne:true}}
    ]
  }).populate('employee','firstName lastName employeeCode shift user')

  const policy=await getAttendancePolicy()
  const justificationDays=Number(policy.missingCheckoutJustificationDays)||3
  let processed=0
  const bulkOps=[]

  for(const record of records){
    if(!record.employee)continue
    if(record.missingCheckout?.detectedAt)continue

    const attendanceDate=record.date
    const deadlineDate=addDays(attendanceDate,justificationDays+1)
    const deadline=atOrganizationTime(deadlineDate,0,0)

    if(!record.missingCheckout){
      record.missingCheckout={}
    }
    record.missedCheckOut=true
    record.missingCheckout.detectedAt=new Date()
    record.missingCheckout.justificationStatus='pending'
    record.missingCheckout.deadline=deadline
    record.missingCheckout.workingMinutesBefore=0
    record.missingCheckout.history=record.missingCheckout.history||[]
    record.missingCheckout.history.push({
      timestamp:new Date(),
      status:'pending',
      message:`Missing checkout detected. Justification window open until ${formatDate(deadline)}`,
      actor:'scheduler'
    })
    record.exceptionStatus='Missing Checkout – Justification Pending'
    record.status='missing_checkout'
    record.workingMinutes=0
    record.completionStatus='exception_pending'

    bulkOps.push({
      updateOne:{
        filter:{_id:record._id},
        update:{
          $set:{
            missedCheckOut:true,
            'missingCheckout.detectedAt':record.missingCheckout.detectedAt,
            'missingCheckout.justificationStatus':'pending',
            'missingCheckout.deadline':deadline,
            'missingCheckout.workingMinutesBefore':0,
            'missingCheckout.history':record.missingCheckout.history,
            exceptionStatus:'Missing Checkout – Justification Pending',
            status:'missing_checkout',
            workingMinutes:0,
            completionStatus:'exception_pending'
          }
        }
      }
    })
    processed++
  }

  if(bulkOps.length>0){
    await Attendance.bulkWrite(bulkOps,{ordered:false})
  }
  return processed
}

export async function processMissingCheckoutAlerts(now=new Date()){
  const today=startOfLocalDay(now)
  const yesterday=new Date(today.getTime()-DAY_MS)

  const records=await Attendance.find({
    'missingCheckout.justificationStatus':'pending',
    date:{$lte:yesterday},
    $or:[
      {'missingCheckout.alertSentAt':{$exists:false}},
      {'missingCheckout.alertSentAt':null}
    ]
  }).populate('employee','firstName lastName employeeCode officialEmail personalEmail user')

  let sent=0

  for(const record of records){
    if(!record.employee)continue
    const employee=record.employee
    const employeeId=employee._id
    const dateKey=organizationDateKey(record.date)
    const deadline=record.missingCheckout?.deadline
    const deadlineStr=deadline?formatDate(deadline):''

    const user=employee.user?await User.findOne({_id:employee.user,isActive:true}).select('_id email firstName').lean():null
    if(!user)continue

    const employeeEmail=employee.officialEmail||employee.personalEmail||user.email

    try{
      await Notification.create({
        recipient:user._id,
        type:'Missing Checkout Alert',
        title:'Action Required: Missing Checkout',
        message:`You forgot to check out on ${formatDate(record.date)}. Submit checkout justification by ${deadlineStr}. Link: /attendance?highlight=${dateKey}`,
        employee:employeeId,
        dedupeKey:`missing-checkout-alert:${employeeId}:${dateKey}`
      })
    }catch(error){
      if(error?.code!==11000)throw error
    }

    const monthParts=dateKey.split('-')
    const period=`${monthParts[1]}/${monthParts[0]}`

    try{
      await claimEmail({
        key:`missing-checkout-alert:${employeeId}:${dateKey}`,
        type:'attendance_miss',
        period:period,
        user:user,
        email:employeeEmail
      })
    }catch(error){
      if(error?.code!==11000)throw error
    }

    await Attendance.updateOne(
      {_id:record._id},
      {
        $set:{
          'missingCheckout.alertSentAt':new Date()
        },
        $push:{
          'missingCheckout.history':{
            timestamp:new Date(),
            status:'alert_sent',
            message:'In-app and email alert sent to employee',
            actor:'scheduler'
          }
        }
      }
    )
    sent++
  }

  return sent
}

async function finalizeMissingCheckoutAsLeave(attendance,reason,policy,employeeDoc,leavePolicySnapshot,userDoc){
  if(attendance.missingCheckout?.finalizedAt)return null
  if(attendance.missingCheckout?.reviewAction&&attendance.missingCheckout.reviewAction!=='none')return null

  const autoDeduct=Boolean(policy.autoDeductPaidLeaveOnMissingCheckout)
  const balanceBefore=Number(leavePolicySnapshot?.balanceBefore)||0
  let mode='unpaid'
  let paidDays=0
  let unpaidDays=1
  let leaveType='unpaid_leave'

  if(autoDeduct&&balanceBefore>0){
    if(balanceBefore>=1){
      mode='paid'
      paidDays=1
      unpaidDays=0
      leaveType='paid_leave'
    }else{
      mode='partially_paid'
      paidDays=balanceBefore
      unpaidDays=1-balanceBefore
      leaveType='paid_leave'
    }
  }

  const leavePlan=employeeDoc?.leavePlan||{annualPaidLeaves:18,cycleStartMonth:4}
  const fy=financialYearRange(attendance.date,Number(leavePlan.cycleStartMonth)||4)
  const fyLabel=fy.label
  const dateKey=organizationDateKey(attendance.date)
  const [yearStr,monthStr]=dateKey.split('-')

  let reportManagerId=null
  try{
    const empFull=await Employee.findById(employeeDoc._id).select('manager -_id').lean()
    reportManagerId=empFull?.manager||null
  }catch(_){}

  const leaveDoc=await LeaveRequest.create({
    employee:attendance.employee,
    reportingManager:reportManagerId,
    startDate:attendance.date,
    endDate:attendance.date,
    leaveType:leaveType,
    dayType:'full_day',
    days:1.0,
    workingDays:1.0,
    reason:reason,
    status:'approved',
    reviewedBy:null,
    reviewedAt:new Date(),
    conversionReason:reason,
    systemGenerated:true,
    policySnapshot:{
      annualPaidLeaves:Number(leavePlan.annualPaidLeaves)||18,
      cycleStartMonth:Number(leavePlan.cycleStartMonth)||4,
      entitledPaidLeaves:balanceBefore,
      eligibleMonths:12,
      canApplyPaidLeave:autoDeduct,
      longLeave:{
        isLongLeave:false,
        noticeDaysRequired:0,
        calendarNoticeDays:0,
        meetsAdvanceNotice:true
      }
    },
    payments:{
      mode:mode,
      paidDays:paidDays,
      unpaidDays:unpaidDays,
      balanceBefore:balanceBefore,
      balanceAfter:Math.max(0,balanceBefore-paidDays),
      plan:leavePolicySnapshot?.plan||leavePlan
    },
    workflow:{
      requiredSteps:[],
      currentStepIndex:0,
      steps:[],
      nextRole:null
    },
    fyLabel:fyLabel
  })

  const attendanceStatus=mode==='paid'||mode==='partially_paid'?'on_leave':'absent'
  const reviewAction=reason.includes('expired')?'expired':'rejected'

  await Attendance.updateOne(
    {_id:attendance._id},
    {
      $set:{
        status:attendanceStatus,
        workingMinutes:0,
        completionStatus:'finalized',
        exceptionStatus:`Absent – ${reason}`,
        'missingCheckout.finalizedAt':new Date(),
        'missingCheckout.conversionReason':reason,
        'missingCheckout.leaveRequestId':leaveDoc._id,
        'missingCheckout.reviewAction':reviewAction,
        'missingCheckout.workingMinutesRestored':0
      },
      $push:{
        'missingCheckout.history':{
          timestamp:new Date(),
          status:'finalized',
          message:`Finalized: ${reason}. Leave ID: ${leaveDoc._id}`,
          actor:'scheduler'
        }
      }
    }
  )

  return leaveDoc
}

export async function processMissingCheckoutFinalization(now=new Date()){
  const today=startOfLocalDay(now)
  const policy=await getAttendancePolicy()

  const records=await Attendance.find({
    $or:[
      {'missingCheckout.justificationStatus':'pending'},
      {'missingCheckout.justificationStatus':'submitted'}
    ],
    'missingCheckout.deadline':{$lte:today}
  }).populate('employee','firstName lastName employeeCode officialEmail personalEmail user leavePlan probation')

  let finalized=0

  for(const record of records){
    if(!record.employee)continue
    if(record.missingCheckout?.finalizedAt)continue

    if(record.missingCheckout?.justificationStatus==='submitted'&&record.missingCheckout?.justificationRequestId){
      continue
    }

    const employeeDoc=record.employee
    const leavePlan=proratedAnnualPaidLeaves({employee:employeeDoc,asOf:now})
    const usedLeaves=await LeaveRequest.countDocuments({
      employee:employeeDoc._id,
      status:'approved',
      createdAt:{$gte:new Date(leavePlan.fyStart)}
    })
    const entitled=Number(leavePlan.entitledPaidLeaves)||0
    const balanceBefore=Math.max(0,entitled-usedLeaves)

    const snapshot={
      balanceBefore:balanceBefore,
      paidAvailable:balanceBefore,
      plan:leavePlan
    }

    const userDoc=employeeDoc.user?await User.findById(employeeDoc.user).select('_id email firstName').lean():null

    try{
      await finalizeMissingCheckoutAsLeave(
        record,
        'Missing checkout justification expired',
        policy,
        employeeDoc,
        snapshot,
        userDoc
      )
      finalized++
    }catch(error){
      console.error('Failed to finalize missing checkout:',error?.message||error)
    }
  }

  return finalized
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
  const rawAttendance=await Attendance.find({date:{$gte:start,$lt:end}}).select('_id employee date checkIn checkOut missedCheckOut missingCheckout exceptionStatus status').lean(),leaves=await LeaveRequest.find({status:'approved',dayType:'full_day',startDate:{$lt:end},endDate:{$gte:start}}).select('employee startDate endDate').lean()
  const adminEmails=(await User.find({isActive:true,role:{$in:['hr_admin','admin','super_admin']}}).select('email').lean()).map(item=>item.email).filter(Boolean)
  for(const employee of employees){
    if(!employee.user||!adminEmails.length)continue
    // FIX #2 + #3: buildEscalationMisses with RE-VERIFICATION pass before email.
    // Filters out Resolved statuses (Fix #1 auto-resolve) and pending/approved correction requests.
    const escalation = await buildEscalationMisses({ employee, weekStart:start, weekEnd:end, today, rawAttendance, leaves, weekHolidays })
    const { trueMisses, allTagged, totalTrue } = escalation
    // Threshold is based on TRUE MISS count only (excludes late-resolved and pending-correction items).
    if(totalTrue < 3)continue
    const user=await User.findOne({_id:employee.user,isActive:true}).select('_id email'),manager=employee.manager?await User.findOne({employee:employee.manager,isActive:true}).select('email'):null
    if(!user?.email)continue
    const claim=await claimEmail({key:`attendance-escalation:${weekKey}:${user._id}`,type:'attendance_escalation',period:weekKey,user});await deliver(claim,()=>sendAttendanceEscalation({recipient:user.email,ccRecipients:[manager?.email,...adminEmails].filter(Boolean),employeeName:`${employee.firstName} ${employee.lastName}`.trim(),employeeCode:employee.employeeCode,week:weekKey,misses:trueMisses,allTagged,totalTrue}))
  }
  lastDailyAuditKey=auditKey
}

/**
 * buildEscalationMisses — FIX #2 (correction request exclude) + FIX #3 (re-ver pass)
 *
 * For a given employee in a given week:
 *  (a) enumerates candidate misses (check-in absent and not on approved full leave;
 *      checkout missing/system-auto or exception pending and not review=approved / leave-converted)
 *  (b) FIX #2: cross-check AttendanceCorrectionRequest for every candidate:
 *        · status='pending' or 'approved' → exclude from TRUE MISS count, tag [CORRECTION PENDING]
 *          or [CORRECTION APPROVED] respectively
 *        · status='rejected' → include as TRUE MISS, tag [CORR REJECTED = MISS]
 *  (c) FIX #1 (auto-resolved): exceptionStatus.startsWith('Resolved') → exclude TRUE MISS,
 *        tag [LATE SAME-DAY CHECKOUT] (informational only)
 *  (d) system leave override converted (reviewAction=approved leaveRequestId set) → exclude,
 *        tag [AUTO LEAVE CONVERTED] (informational)
 *
 * Re-ver is done at the moment of calling — ensures 100% latest DB state used
 * (not stale snapshotted data from earlier passes of processMissingCheckouts).
 *
 * Returns: { trueMisses (raw strings for counter + old mail compat), allTagged (tagged strings for
 * detailed email new field), totalTrue (len trueMisses for threshold). }
 */
export async function buildEscalationMisses({ employee, weekStart, weekEnd, today, rawAttendance, leaves, weekHolidays }) {
  const records = rawAttendance.filter(item => String(item.employee) === String(employee._id))
  const candidates = []
  for(let day = new Date(weekStart); day < weekEnd && day < today; day = new Date(day.getTime() + DAY_MS)) {
    if(!isScheduledWorkingDay(day, weekHolidays)) continue
    const date = organizationDateKey(day)
    const record = records.find(item => organizationDateKey(item.date) === date)
    const onFullLeave = leaves.some(item =>
      String(item.employee) === String(employee._id) &&
      item.startDate <= endOfLocalDay(day) &&
      item.endDate >= startOfLocalDay(day)
    )
    if(!record?.checkIn?.time && !onFullLeave) {
      candidates.push({ date, type: 'check-in', record: null })
    } else if(
      record?.missedCheckOut ||
      record?.checkOut?.source === 'system_auto' ||
      (
        record?.missingCheckout?.reviewAction === 'none' &&
        record?.missingCheckout?.justificationStatus &&
        String(record.missingCheckout.justificationStatus) !== 'approved'
      )
    ) {
      candidates.push({ date, type: 'checkout', record })
    }
  }

  if(candidates.length === 0) return { trueMisses: [], allTagged: [], totalTrue: 0 }

  // Lookup correction requests (Fix #2): any kind='missing_checkout' or 'other' for this
  // employee within the week window, grouped by Attendance._id string.
  const attendanceIds = candidates
    .map(c => c.record?._id)
    .filter(Boolean)
    .map(id => (id && id.toString ? id.toString() : String(id)))
  const correctionsByAttendance = new Map()
  if(attendanceIds.length > 0) {
    const corrections = await AttendanceCorrectionRequest.find({
      attendance: { $in: attendanceIds.map(id => new mongoose.Types.ObjectId(id)) },
      kind: { $in: ['missing_checkout', 'other'] }
    }).select('attendance status requestedCheckoutTime reviewedAt reviewNote').lean()
    for(const req of corrections) {
      const key = String(req.attendance)
      if(!correctionsByAttendance.has(key)) correctionsByAttendance.set(key, [])
      correctionsByAttendance.get(key).push(req)
    }
  }

  const trueMisses = []
  const allTagged = []
  for(const cand of candidates) {
    const base = `${cand.date} ${cand.type}`
    const attId = cand.record?._id ? (cand.record._id.toString ? cand.record._id.toString() : String(cand.record._id)) : null
    const correctionRequests = attId ? (correctionsByAttendance.get(attId) || []) : []

    // FIX #1 auto-resolve classification
    const exceptionResolved = String(cand.record?.exceptionStatus || '').startsWith('Resolved')
    const autoLeaveConverted =
      cand.record?.missingCheckout?.reviewAction === 'approved' &&
      (cand.record?.missingCheckout?.leaveRequestId || String(cand.record?.missingCheckout?.conversionReason || '').toLowerCase().includes('leave'))

    // Fix #2 correction request most relevant status (priority order: approved > pending > rejected)
    const corrApproved = correctionRequests.some(r => String(r.status) === 'approved')
    const corrPending = correctionRequests.some(r => String(r.status) === 'pending')
    const corrRejected = correctionRequests.some(r => String(r.status) === 'rejected')

    let tag = 'TRUE MISS'
    let countAsTrue = true
    if(autoLeaveConverted) { tag = 'AUTO LEAVE CONVERTED'; countAsTrue = false }
    else if(exceptionResolved) { tag = 'LATE SAME-DAY CHECKOUT'; countAsTrue = false }
    else if(corrApproved) { tag = 'CORRECTION APPROVED'; countAsTrue = false }
    else if(corrPending) { tag = 'CORRECTION PENDING'; countAsTrue = false }
    else if(corrRejected) { tag = 'CORR REJECTED = MISS'; countAsTrue = true }

    if(countAsTrue) trueMisses.push(base)
    allTagged.push(`${base}  [${tag}]`)
  }

  return { trueMisses, allTagged, totalTrue: trueMisses.length }
}

export async function processWeeklyHoursCompliance(now=new Date()){
  const auditKey=organizationDateKey(now)
  if(lastWeeklyAuditKey===auditKey)return 0
  const {start,end}=previousClosedWeek(now)
  const weekMonday=new Date(start)
  const monthSlices=splitWeekByMonth(weekMonday)
  const policy=await getAttendancePolicy()

  const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']},joiningDate:{$lt:end}}).select('_id firstName lastName employeeCode joiningDate user leavePlan probation').lean()
  const adminEmails=[...new Set((await User.find({isActive:true,role:{$in:['hr_admin','admin','super_admin']}}).select('email').lean()).map(item=>item.email?.trim().toLowerCase()).filter(Boolean))]

  let sent=0

  for(const monthSlice of monthSlices){
    const periodStart=monthSlice.startDate
    const periodEnd=new Date(monthSlice.endDate.getTime()+DAY_MS)
    const periodStartKey=organizationDateKey(periodStart)
    const periodEndKey=organizationDateKey(monthSlice.endDate)
    const periodLabel=`${periodStartKey} to ${periodEndKey}`

    for(const empLean of employees){
      if(empLean.joiningDate&&startOfLocalDay(empLean.joiningDate)>periodEnd)continue

      let employeeDoc=empLean
      try{
        const fullEmp=await Employee.findById(empLean._id).lean()
        if(fullEmp)employeeDoc=fullEmp
      }catch(_){}

      const weekSummary=await getWeeklySummary(employeeDoc,weekMonday)
      const adjustedTargetMinutes=weekSummary.adjustedTargetMinutes||0
      const approvedMinutes=weekSummary.approvedWorkingMinutes||0

      const holidays=await holidayKeysBetween(periodStart,new Date(periodEnd.getTime()-1))
      let scheduledDays=0
      for(let day=new Date(periodStart);day<periodEnd;day=new Date(day.getTime()+DAY_MS)){
        if(empLean.joiningDate&&startOfLocalDay(empLean.joiningDate)>endOfLocalDay(day))continue
        if(isScheduledWorkingDay(day,holidays))scheduledDays++
      }

      if(adjustedTargetMinutes===0||scheduledDays<=0)continue
      if(approvedMinutes>=adjustedTargetMinutes)continue
      if(!employeeDoc.user)continue

      const user=await User.findOne({_id:employeeDoc.user,isActive:true}).select('_id email firstName').lean()
      if(!user?.email)continue

      const expectedMinutes=adjustedTargetMinutes
      const actualMinutes=approvedMinutes
      const shortfall=Math.max(0,expectedMinutes-actualMinutes)

      const claim=await claimEmail({key:`weekly-hours-shortfall:${periodStartKey}:${periodEndKey}:${user._id}`,type:'weekly_hours_shortfall',period:periodLabel,user})
      if(await deliver(claim,()=>sendWeeklyHoursShortfall({
        recipient:user.email,
        ccRecipients:adminEmails,
        firstName:user.firstName||employeeDoc.firstName,
        employeeName:`${employeeDoc.firstName} ${employeeDoc.lastName}`.trim(),
        employeeCode:employeeDoc.employeeCode,
        period:periodLabel,
        scheduledDays:Number(scheduledDays.toFixed(1)),
        expectedHours:hoursAndMinutes(expectedMinutes),
        recordedHours:hoursAndMinutes(actualMinutes),
        shortfallHours:hoursAndMinutes(shortfall)
      })))sent++
    }
  }
  lastWeeklyAuditKey=auditKey
  return sent
}

export function startMissingCheckoutScheduler(){const run=async()=>{await processCheckoutReminders();await processMissingCheckouts();await processMissingCheckoutAlerts();await processMissingCheckoutFinalization();await processMissingCheckInsAndEscalations();await processWeeklyHoursCompliance()};run().catch(error=>console.error('Attendance scheduler failed:',error?.message||error));const timer=setInterval(()=>run().catch(error=>console.error('Attendance scheduler failed:',error?.message||error)),CHECK_INTERVAL_MS);timer.unref();return timer}
