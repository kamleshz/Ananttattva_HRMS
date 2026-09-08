import { Router } from 'express'
import PDFDocument from 'pdfkit'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { FaceAttendanceRequest } from '../models/FaceAttendanceRequest.js'
import { asyncHandler } from '../utils/asyncHandler.js'

const router=Router()
router.use(authenticate)

const MIS_ROLES=['super_admin','admin','hr_admin','finance_admin']
const TARGET_MINUTES=8*60+30

function monthRange(value){
  const match=String(value||'').match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if(!match)throw new Error('Month must use YYYY-MM format')
  const year=Number(match[1]),month=Number(match[2])-1
  return {start:new Date(Date.UTC(year,month,1)),end:new Date(Date.UTC(year,month+1,1)),label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month,1)))}
}

async function attendanceMis(month){
  const range=monthRange(month)
  const [employees,records]=await Promise.all([
    Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('employeeCode firstName lastName department designation').sort({firstName:1,lastName:1}).lean(),
    Attendance.find({date:{$gte:range.start,$lt:range.end}}).select('employee workingMinutes lateMinutes status halfDayReason checkIn checkOut').lean(),
  ])
  const byEmployee=new Map()
  for(const record of records){const key=String(record.employee);const list=byEmployee.get(key)||[];list.push(record);byEmployee.set(key,list)}
  const rows=employees.map(employee=>{
    const items=byEmployee.get(String(employee._id))||[]
    const completed=items.filter(item=>item.checkIn?.time&&item.checkOut?.time)
    const totalMinutes=completed.reduce((sum,item)=>sum+Number(item.workingMinutes||0),0)
    const lateAt1015=items.filter(item=>Number(item.lateMinutes)>0&&Number(item.lateMinutes)<=15).length
    const lateAt1030=items.filter(item=>Number(item.lateMinutes)>15).length
    const legacyLate=items.filter(item=>!Number(item.lateMinutes)&&(item.status==='late'||item.halfDayReason==='three_late_arrivals')).length
    return {employeeId:employee._id,employeeCode:employee.employeeCode,name:`${employee.firstName} ${employee.lastName}`.trim(),department:employee.department||'General',designation:employee.designation||'Employee',lateAt1015:lateAt1015+legacyLate,lateAt1030,lateArrivals:lateAt1015+lateAt1030+legacyLate,completedDays:completed.length,totalMinutes,lessThanTarget:completed.filter(item=>Number(item.workingMinutes||0)<TARGET_MINUTES).length,equalToTarget:completed.filter(item=>Number(item.workingMinutes||0)===TARGET_MINUTES).length,moreThanTarget:completed.filter(item=>Number(item.workingMinutes||0)>TARGET_MINUTES).length}
  })
  const summary=rows.reduce((result,row)=>({employees:result.employees+1,lateArrivals:result.lateArrivals+row.lateArrivals,completedDays:result.completedDays+row.completedDays,totalMinutes:result.totalMinutes+row.totalMinutes,lessThanTarget:result.lessThanTarget+row.lessThanTarget,equalToTarget:result.equalToTarget+row.equalToTarget,moreThanTarget:result.moreThanTarget+row.moreThanTarget}),{employees:0,lateArrivals:0,completedDays:0,totalMinutes:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0})
  return {month,label:range.label,targetMinutes:TARGET_MINUTES,summary,rows}
}

router.get('/attendance-mis',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>res.json({success:true,data:await attendanceMis(req.query.month)})))
router.get('/attendance-mis.pdf',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>{
  const report=await attendanceMis(req.query.month),doc=new PDFDocument({size:'A4',layout:'landscape',margin:30})
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="attendance-mis-${report.month}.pdf"`);doc.pipe(res)
  doc.save().translate(35,31).lineWidth(5).strokeColor('#f97316').moveTo(0,20).bezierCurveTo(24,20,28,0,46,0).bezierCurveTo(60,0,60,40,46,40).bezierCurveTo(28,40,24,20,0,20).stroke().circle(35,20,4).fill('#f97316').restore()
  doc.fillColor('#f97316').font('Helvetica').fontSize(25).text('ANANT',90,25,{continued:true}).fillColor('#111827').text(' TATTVA')
  doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(18).text('HRMS ATTENDANCE MIS DASHBOARD',30,72)
  doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(`${report.label}  |  Shift benchmark: 10:00 - 18:30 (8h 30m)`,30,96)
  const columns=[['Employee',30,135],['ID',165,52],['Department',217,112],['10:15',329,38],['10:30',367,38],['Days',405,42],['Hours',447,62],['< 8:30',509,55],['= 8:30',564,55],['> 8:30',619,55]]
  let y=125
  doc.rect(30,y,644,34).fill('#0f766e');doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);columns.forEach(([label,x,width],index)=>doc.text(index===3||index===4?label:index===5?'Completed':label,x+5,y+(index===3||index===4?19:12),{width:width-8}));doc.text('LATE ARRIVAL',329,y+5,{width:76,align:'center'})
  y+=34
  for(const [index,row] of report.rows.entries()){
    if(y>535){doc.addPage();y=35;doc.rect(30,y,644,34).fill('#0f766e');doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);columns.forEach(([label,x,width],columnIndex)=>doc.text(columnIndex===3||columnIndex===4?label:columnIndex===5?'Completed':label,x+5,y+(columnIndex===3||columnIndex===4?19:12),{width:width-8}));doc.text('LATE ARRIVAL',329,y+5,{width:76,align:'center'});y+=34}
    doc.rect(30,y,644,22).fill(index%2?'#f8fafc':'#ffffff');doc.fillColor('#334155').font('Helvetica').fontSize(7.5)
    const values=[row.name,row.employeeCode,row.department,String(row.lateAt1015),String(row.lateAt1030),String(row.completedDays),`${Math.floor(row.totalMinutes/60)}h ${String(row.totalMinutes%60).padStart(2,'0')}m`,String(row.lessThanTarget),String(row.equalToTarget),String(row.moreThanTarget)]
    columns.forEach(([,x,width],i)=>doc.text(values[i],x+5,y+7,{width:width-8,ellipsis:true}));y+=22
  }
  doc.fillColor('#64748b').fontSize(8).text('Less / Equal / More values show completed attendance days compared with the 8h 30m daily benchmark.',30,560)
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
