import { ExitCase } from '../models/Offboarding.js'
import { User } from '../models/User.js'
import { notifyUsers } from './offboardingService.js'

const CHECK_INTERVAL_MS=6*60*60*1000
const indiaDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)

export async function processOffboardingReminders(now=new Date()){
  const until=new Date(now.getTime()+7*86400000),items=await ExitCase.find({status:{$nin:['exit_cleared','separated','cancelled']},lastWorkingDate:{$lte:until}}).lean(),roles=await User.find({isActive:true,role:{$in:['it_admin','finance_admin','hr_admin','super_admin']}}).select('_id role').lean(),day=indiaDay(now)
  let sent=0
  for(const item of items){
    const employeeUser=await User.findOne({employee:item.employee,isActive:true}).select('_id').lean(),managerUser=item.manager?await User.findOne({employee:item.manager,isActive:true}).select('_id').lean():null
    const recipients=[]
    if(!item.handover?.submittedAt)recipients.push(employeeUser?._id)
    if(item.handover?.submittedAt&&item.managerReview?.status!=='cleared')recipients.push(managerUser?._id)
    if(item.managerReview?.status==='cleared'){
      if(item.assetClearance?.status!=='cleared')recipients.push(...roles.filter(user=>['it_admin','hr_admin','super_admin'].includes(user.role)).map(user=>user._id))
      if(item.itClearance?.status!=='cleared')recipients.push(...roles.filter(user=>['it_admin','super_admin'].includes(user.role)).map(user=>user._id))
      if(item.financeClearance?.status!=='cleared')recipients.push(...roles.filter(user=>['finance_admin','super_admin'].includes(user.role)).map(user=>user._id))
      if(item.hrClearance?.status!=='cleared')recipients.push(...roles.filter(user=>['hr_admin','super_admin'].includes(user.role)).map(user=>user._id))
    }
    const unique=[...new Set(recipients.filter(Boolean).map(String))]
    await notifyUsers(unique,{type:'Exit clearance reminder',title:new Date(item.lastWorkingDate)<now?'Overdue employee exit clearance':'Upcoming last working date',message:`${item.exitId} for ${item.employeeSnapshot.firstName} ${item.employeeSnapshot.lastName} requires action before ${new Date(item.lastWorkingDate).toLocaleDateString('en-IN')}.`,employee:item.employee,dedupeKey:`exit-reminder:${item._id}:${day}`});sent+=unique.length
  }
  return {cases:items.length,notifications:sent}
}

export function startOffboardingReminderScheduler(){const run=()=>processOffboardingReminders().catch(error=>console.error('Offboarding reminder scheduler failed:',error?.message||error));run();const timer=setInterval(run,CHECK_INTERVAL_MS);timer.unref();return timer}
