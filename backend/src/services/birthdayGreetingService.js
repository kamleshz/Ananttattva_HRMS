import { OrganizationProfile } from '../models/Organization.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { User } from '../models/User.js'
import { sendBirthdayGreeting } from './mailService.js'

const CHECK_INTERVAL_MS=30*60*1000
const INDIA_TIME_ZONE='Asia/Kolkata'
function indiaDateParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:INDIA_TIME_ZONE,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]))}
export function birthdayPeriod(now=new Date()){const {year,month,day}=indiaDateParts(now);return {period:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,month,day}}
export function isBirthday(dateOfBirth,now=new Date()){if(!dateOfBirth)return false;const today=birthdayPeriod(now),birth=indiaDateParts(new Date(dateOfBirth));return birth.month===today.month&&birth.day===today.day}

async function acquireDispatch(user,period){
  const key=`birthday:${period}:${user.id}`,existing=await ScheduledEmail.findOne({key})
  if(existing?.status==='sent'||(existing?.status==='processing'&&existing.updatedAt>new Date(Date.now()-15*60*1000))||existing?.attempts>=3)return null
  if(existing){existing.status='processing';existing.attempts+=1;existing.lastError='';return existing.save()}
  try{return await ScheduledEmail.create({key,type:'birthday_greeting',period,recipient:user._id,email:user.email,status:'processing',attempts:1})}catch(error){if(error?.code===11000)return null;throw error}
}

export async function processBirthdayGreetings(now=new Date()){
  const {period}=birthdayPeriod(now),organization=await OrganizationProfile.findOne({singletonKey:'organization'}).select('companyName logo').lean()
  const users=await User.find({isActive:true,employee:{$ne:null}}).select('firstName email employee').populate({path:'employee',select:'employeeStatus dateOfBirth',match:{employeeStatus:'active',dateOfBirth:{$ne:null}}})
  let eligible=0,sent=0,failed=0
  for(const user of users){
    if(!user.employee||!isBirthday(user.employee.dateOfBirth,now)||user.email.endsWith('.local'))continue
    eligible+=1;const dispatch=await acquireDispatch(user,period);if(!dispatch)continue
    try{await sendBirthdayGreeting({recipient:user.email,firstName:user.firstName,companyName:organization?.companyName,logo:organization?.logo});dispatch.status='sent';dispatch.sentAt=new Date();dispatch.lastError='';await dispatch.save();sent+=1}
    catch(error){dispatch.status='failed';dispatch.lastError=String(error?.message||error).slice(0,500);await dispatch.save();failed+=1}
  }
  return {period,eligible,sent,failed}
}

export function startBirthdayGreetingScheduler(){const run=()=>processBirthdayGreetings().then(result=>{if(result.eligible&&(result.sent||result.failed))console.log(`Birthday greeting emails: ${result.sent} sent, ${result.failed} failed`)}).catch(error=>console.error('Birthday greeting scheduler failed:',error?.message||error));run();const timer=setInterval(run,CHECK_INTERVAL_MS);timer.unref();return timer}
