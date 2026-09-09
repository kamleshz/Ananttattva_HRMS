import { Router } from 'express'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { FaceAttendanceRequest } from '../models/FaceAttendanceRequest.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { dateFromKey, organizationDateKey } from '../services/workingDayService.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'

const router=Router()
router.use(authenticate)

const MIS_ROLES=['super_admin','admin','hr_admin','finance_admin']
const DAY_MS=86_400_000
const COMPANY_LOGO=fileURLToPath(new URL('../../../frontend/public/Screenshot 2026-09-08 121937.png',import.meta.url))

function formatMinutesToHoursMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

function monthRange(value){
  const match=String(value||'').match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if(!match)throw new Error('Month must use YYYY-MM format')
  const year=Number(match[1]),month=Number(match[2])-1
  return {start:new Date(Date.UTC(year,month,1)),end:new Date(Date.UTC(year,month+1,1)),label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month,1)))}
}

function reportRange(query){
  if(query.from&&query.to){const input=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(query),start=dateFromKey(input.from),endInclusive=dateFromKey(input.to);if(organizationDateKey(start)!==input.from||organizationDateKey(endInclusive)!==input.to)throw new HttpError(422,'Select valid report dates');if(endInclusive<start)throw new HttpError(422,'To date must be on or after From date');if(input.to>organizationDateKey())throw new HttpError(422,'Report dates cannot be in the future');if((endInclusive-start)/DAY_MS>366)throw new HttpError(422,'Report range cannot exceed 12 months');const end=new Date(endInclusive.getTime()+DAY_MS),label=`${input.from} to ${input.to}`;return{...input,start,end,label}}
  const range=monthRange(query.month);return{...range,from:organizationDateKey(range.start),to:organizationDateKey(new Date(range.end.getTime()-DAY_MS))}
}

async function attendanceMis(query){
  const range=reportRange(query)
  const [employees,records,halfDayLeaves,policy]=await Promise.all([
    Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('employeeCode firstName lastName department designation').sort({firstName:1,lastName:1}).lean(),
    Attendance.find({date:{$gte:range.start,$lt:range.end}}).select('employee date workingMinutes lateMinutes status halfDayReason checkIn checkOut attendanceDayType expectedWorkingMinutes completionStatus missedCheckOut').lean(),
    LeaveRequest.find({status:'approved',dayType:'half_day',startDate:{$lt:range.end},endDate:{$gte:range.start}}).select('employee startDate endDate').lean(),
    getAttendancePolicy(),
  ])
  const FULL_DAY_MINUTES=policy.fullDayWorkingMinutes
  const HALF_DAY_MINUTES=policy.halfDayWorkingMinutes
  const byEmployee=new Map()
  for(const record of records){const key=String(record.employee);const list=byEmployee.get(key)||[];list.push(record);byEmployee.set(key,list)}
  const rows=employees.map(employee=>{
    const items=byEmployee.get(String(employee._id))||[]
    const completed=items.filter(item=>item.checkIn?.time&&item.checkOut?.time)
    const classified=completed.map(item=>{const dayStart=dateFromKey(organizationDateKey(item.date)),dayEnd=new Date(dayStart.getTime()+DAY_MS-1),halfDay=item.attendanceDayType==='half_day'||halfDayLeaves.some(leave=>String(leave.employee)===String(employee._id)&&leave.startDate<=dayEnd&&leave.endDate>=dayStart),target=halfDay?HALF_DAY_MINUTES:FULL_DAY_MINUTES;return{...item,halfDay,target}})
    const totalMinutes=classified.reduce((sum,item)=>sum+Number(item.workingMinutes||0),0),fullDays=classified.filter(item=>!item.halfDay).length,halfDays=classified.filter(item=>item.halfDay).length,incompleteHalfDays=classified.filter(item=>item.halfDay&&Number(item.workingMinutes||0)<HALF_DAY_MINUTES).length
    const lateAt1015=items.filter(item=>Number(item.lateMinutes)>0&&Number(item.lateMinutes)<=15).length
    const lateAt1030=items.filter(item=>Number(item.lateMinutes)>15).length
    const legacyLate=items.filter(item=>!Number(item.lateMinutes)&&(item.status==='late'||item.halfDayReason==='three_late_arrivals')).length
    return {employeeId:employee._id,employeeCode:employee.employeeCode,name:`${employee.firstName} ${employee.lastName}`.trim(),department:employee.department||'General',designation:employee.designation||'Employee',lateAt1015:lateAt1015+legacyLate,lateAt1030,lateArrivals:lateAt1015+lateAt1030+legacyLate,completedDays:classified.length,fullDays,halfDays,incompleteHalfDays,totalMinutes,lessThanTarget:classified.filter(item=>Number(item.workingMinutes||0)<item.target).length,equalToTarget:classified.filter(item=>Number(item.workingMinutes||0)===item.target).length,moreThanTarget:classified.filter(item=>Number(item.workingMinutes||0)>item.target).length}
  })
  const summary=rows.reduce((result,row)=>({employees:result.employees+1,lateArrivals:result.lateArrivals+row.lateArrivals,completedDays:result.completedDays+row.completedDays,fullDays:result.fullDays+row.fullDays,halfDays:result.halfDays+row.halfDays,incompleteHalfDays:result.incompleteHalfDays+row.incompleteHalfDays,totalMinutes:result.totalMinutes+row.totalMinutes,lessThanTarget:result.lessThanTarget+row.lessThanTarget,equalToTarget:result.equalToTarget+row.equalToTarget,moreThanTarget:result.moreThanTarget+row.moreThanTarget}),{employees:0,lateArrivals:0,completedDays:0,fullDays:0,halfDays:0,incompleteHalfDays:0,totalMinutes:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0})
  return {from:range.from,to:range.to,label:range.label,targetMinutes:{fullDay:FULL_DAY_MINUTES,halfDay:HALF_DAY_MINUTES},fullDayHoursMinutes:formatMinutesToHoursMinutes(FULL_DAY_MINUTES),halfDayHoursMinutes:formatMinutesToHoursMinutes(HALF_DAY_MINUTES),summary,rows}
}

router.get('/attendance-mis',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>res.json({success:true,data:await attendanceMis(req.query)})))
router.get('/attendance-mis.pdf',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>{
  const report=await attendanceMis(req.query),doc=new PDFDocument({size:'A4',layout:'landscape',margin:30})
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="attendance-mis-${report.from}-to-${report.to}.pdf"`);doc.pipe(res)
  doc.image(COMPANY_LOGO,30,22,{width:165})
  doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(18).text('HRMS ATTENDANCE MIS DASHBOARD',30,72)
  doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(`${report.label} | Targets: Full ${report.fullDayHoursMinutes}, Half ${report.halfDayHoursMinutes}`,30,96)
  const columns=[['Employee',30,130],['ID',160,55],['Department',215,125],['10:15',340,42],['10:30',382,42],['Full',424,45],['Half',469,45],['Incomplete',514,65],['Hours',579,65],['Leave before\n8:30',644,55],['Leave on\n8:30',699,55],['Leave after\n8:30',754,56]]
  const drawHeader=headerY=>{doc.rect(30,headerY,780,42).fill('#0f766e');doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);columns.forEach(([label,x,width],index)=>doc.text(label,x+4,headerY+(index>=3&&index<=7?25:index>=9?10:16),{width:width-7,align:index>=3?'center':'left',lineGap:1}));doc.text('LATE ARRIVAL',340,headerY+6,{width:84,align:'center'});doc.text('COMPLETED DAYS',424,headerY+6,{width:155,align:'center'})}
  let y=125
  drawHeader(y)
  y+=42
  for(const [index,row] of report.rows.entries()){
    if(y>525){doc.addPage();y=35;drawHeader(y);y+=42}
    doc.rect(30,y,780,25).fill(index%2?'#f8fafc':'#ffffff');doc.fillColor('#334155').font('Helvetica').fontSize(9)
    const values=[row.name,row.employeeCode,row.department,String(row.lateAt1015),String(row.lateAt1030),String(row.fullDays),String(row.halfDays),String(row.incompleteHalfDays),`${Math.floor(row.totalMinutes/60)}h ${String(row.totalMinutes%60).padStart(2,'0')}m`,String(row.lessThanTarget),String(row.equalToTarget),String(row.moreThanTarget)]
    columns.forEach(([,x,width],i)=>doc.text(values[i],x+5,y+8,{width:width-8,ellipsis:true}));y+=25
  }
  doc.fillColor('#64748b').fontSize(8).text(`Target comparison uses ${report.fullDayHoursMinutes} for full days and ${report.halfDayHoursMinutes} for approved half days.`,30,560)
  doc.end()
}))
router.get('/biometric-health',authorize('super_admin','hr_admin','it_admin'),asyncHandler(async(req,res)=>{
  const input=z.object({from:z.coerce.date().optional(),to:z.coerce.date().optional(),reason:z.string().max(80).optional(),riskLevel:z.enum(['normal','high']).optional()}).parse(req.query)
  const from=input.from||new Date(new Date().getFullYear(),new Date().getMonth(),1),to=input.to||new Date(),match={requestedAt:{$gte:from,$lte:to},...(input.reason&&{reasonCode:input.reason}),...(input.riskLevel&&{riskLevel:input.riskLevel})}
  const [summary,reasons,frequentEmployees,devices,successCount]=await Promise.all([
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:null,total:{$sum:1},pending:{$sum:{$cond:[{$eq:['$status','pending']},1,0]}},approved:{$sum:{$cond:[{$eq:['$status','approved']},1,0]}},rejected:{$sum:{$cond:[{$eq:['$status','rejected']},1,0]}},highRisk:{$sum:{$cond:[{$eq:['$riskLevel','high']},1,0]}}}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:'$reasonCode',count:{$sum:1}}},{$sort:{count:-1}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:'$employee',count:{$sum:1},lastRequest:{$max:'$requestedAt'}}},{$sort:{count:-1}},{$limit:20},{$lookup:{from:'employees',localField:'_id',foreignField:'_id',as:'employee'}},{$unwind:'$employee'},{$project:{count:1,lastRequest:1,'employee.employeeCode':1,'employee.firstName':1,'employee.lastName':1,'employee.department':1}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:{deviceType:'$deviceDetails.deviceType',technicalError:'$biometricAttempt.technicalErrorCode'},count:{$sum:1}}},{$sort:{count:-1}},{$limit:20}]),
    Attendance.countDocuments({date:{$gte:from,$lte:to},$or:[{'checkIn.source':'biometric'},{'checkOut.source':'biometric'}]}),
  ])
  const totals=summary[0]||{total:0,pending:0,approved:0,rejected:0,highRisk:0},denominator=totals.total+successCount
  res.json({success:true,data:{range:{from,to},...totals,biometricSuccess:successCount,failureRate:denominator?Number((totals.total/denominator*100).toFixed(1)):0,reasons,frequentEmployees,devices}})
}))
export default router
