import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { User } from '../models/User.js'
import { sendAllowanceReminder } from './mailService.js'
import { allowanceMonthKey, allowanceSubmissionDeadline } from './allowancePolicyService.js'

const CHECK_INTERVAL_MS=30*60*1000
const INDIA_TIME_ZONE='Asia/Kolkata'
const monthLabel=date=>new Intl.DateTimeFormat('en-IN',{timeZone:INDIA_TIME_ZONE,month:'long',year:'numeric'}).format(date)
const dateLabel=date=>new Intl.DateTimeFormat('en-IN',{timeZone:INDIA_TIME_ZONE,day:'numeric',month:'long',year:'numeric'}).format(date)
function indiaDateParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:INDIA_TIME_ZONE,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]))}

export function allowanceReminderContext(now=new Date()){
  const {year,month,day}=indiaDateParts(now)
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate()
  if(day!==lastDay)return null
  const allowanceDate=new Date(Date.UTC(year,month-1,1,12))
  return {period:allowanceMonthKey(allowanceDate),allowanceMonth:monthLabel(allowanceDate),deadline:dateLabel(allowanceSubmissionDeadline(allowanceDate))}
}

async function acquireDispatch(user,context){
  const key=`allowance-month-end:${context.period}:${user.id}`
  const existing=await ScheduledEmail.findOne({key})
  if(existing?.status==='sent'||(existing?.status==='processing'&&existing.updatedAt>new Date(Date.now()-15*60*1000))||existing?.attempts>=3)return null
  if(existing){existing.status='processing';existing.attempts+=1;existing.lastError='';return existing.save()}
  try{return await ScheduledEmail.create({key,type:'allowance_month_end',period:context.period,recipient:user._id,email:user.email,status:'processing',attempts:1})}
  catch(error){if(error?.code===11000)return null;throw error}
}

export async function processAllowanceReminders(now=new Date()){
  const context=allowanceReminderContext(now)
  if(!context)return {eligible:false,sent:0,failed:0}
  const users=await User.find({isActive:true,employee:{$ne:null}}).select('firstName email employee').populate({path:'employee',select:'employeeStatus',match:{employeeStatus:'active'}})
  let sent=0,failed=0
  for(const user of users){
    if(!user.employee)continue
    const dispatch=await acquireDispatch(user,context)
    if(!dispatch)continue
    try{
      await sendAllowanceReminder({recipient:user.email,firstName:user.firstName,allowanceMonth:context.allowanceMonth,deadline:context.deadline})
      dispatch.status='sent';dispatch.sentAt=new Date();dispatch.lastError='';await dispatch.save();sent+=1
    }catch(error){dispatch.status='failed';dispatch.lastError=String(error?.message||error).slice(0,500);await dispatch.save();failed+=1}
  }
  return {eligible:true,sent,failed}
}

export function startAllowanceReminderScheduler(){
  const run=()=>processAllowanceReminders().then(result=>{if(result.eligible&&(result.sent||result.failed))console.log(`Allowance reminder emails: ${result.sent} sent, ${result.failed} failed`)}).catch(error=>console.error('Allowance reminder scheduler failed:',error?.message||error))
  run()
  const timer=setInterval(run,CHECK_INTERVAL_MS)
  timer.unref()
  return timer
}
