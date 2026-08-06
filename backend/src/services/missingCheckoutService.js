import { Attendance } from '../models/Attendance.js'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'
import { startOfLocalDay } from '../utils/date.js'

const CHECK_INTERVAL_MS=60_000

export function scheduledShiftCheckout(attendanceDate,checkInTime,endTime='18:30'){
  const [hours,minutes]=String(endTime).split(':').map(Number)
  const scheduled=new Date(attendanceDate)
  scheduled.setHours(Number.isFinite(hours)?hours:18,Number.isFinite(minutes)?minutes:30,0,0)
  return scheduled<checkInTime?new Date(checkInTime):scheduled
}

export async function processMissingCheckouts(now=new Date()){
  const today=startOfLocalDay(now)
  const records=await Attendance.find({date:{$lt:today},'checkIn.time':{$exists:true},$or:[{'checkOut.time':{$exists:false}},{'checkOut.time':null}]}).populate('employee','firstName lastName employeeCode shift')
  let processed=0
  for(const record of records){
    if(!record.employee)continue
    const checkoutTime=scheduledShiftCheckout(record.date,record.checkIn.time,record.employee.shift?.endTime)
    const previousStatus=record.status
    record.checkOut={time:checkoutTime,address:'System auto checkout at configured shift end',device:'AT Connect scheduler',source:'system_auto'}
    record.checkoutType='AUTO_CHECKOUT'
    record.workingMinutes=Math.max(0,Math.floor((checkoutTime-record.checkIn.time)/60000))
    record.status='missing_checkout'
    record.autoCheckout={appliedAt:now,scheduledCheckoutTime:checkoutTime,previousStatus}
    await record.save()

    const recipients=await User.find({isActive:true,$or:[{employee:record.employee._id},{role:{$in:['hr_admin','admin','super_admin']}}]}).select('_id')
    if(recipients.length)await Notification.insertMany(recipients.map(recipient=>({recipient:recipient._id,type:'Missing Checkout',title:'Attendance auto-checked out',message:`${record.employee.firstName} ${record.employee.lastName} (${record.employee.employeeCode}) did not check out. The record was closed at the configured shift end and requires correction if inaccurate.`,employee:record.employee._id})))
    processed++
  }
  return processed
}

export function startMissingCheckoutScheduler(){
  processMissingCheckouts().then(count=>{if(count)console.log(`Auto-checked out ${count} missing attendance record(s)`) }).catch(error=>console.error('Missing checkout scheduler failed:',error?.message||error))
  const timer=setInterval(()=>processMissingCheckouts().then(count=>{if(count)console.log(`Auto-checked out ${count} missing attendance record(s)`) }).catch(error=>console.error('Missing checkout scheduler failed:',error?.message||error)),CHECK_INTERVAL_MS)
  timer.unref()
  return timer
}
