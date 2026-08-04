import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { startOfLocalDay } from '../utils/date.js'
import { checkIn, checkOut } from '../services/attendanceService.js'
import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'
import writeXlsxFile from 'write-excel-file/node'
import { AttendanceCorrectionRequest } from '../models/AttendanceCorrectionRequest.js'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'

const router = Router()
router.use(authenticate)
const punchSchema = z.object({
  photo: z.string().startsWith('data:image/', 'A captured attendance photo is required').max(4_500_000),
  attendanceMode: z.enum(['office', 'wfh', 'client_location', 'field_visit']).default('office'),
  locationVerified: z.literal(true, { error: 'Verified location is required' }),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), address: z.string().max(300).optional() }),
  biometricToken: z.string().min(20),
})
const meta = (req) => ({ ipAddress: req.ip, device: req.get('user-agent') })
function verifiedPunch(req, mode) {
  const input = punchSchema.parse(req.body)
  let verification
  try { verification = jwt.verify(input.biometricToken, env.jwtSecret) }
  catch { throw new HttpError(401, 'Biometric verification expired. Please verify again') }
  const photoHash = createHash('sha256').update(input.photo).digest('hex')
  if (verification.purpose !== 'biometric_verification' || verification.sub !== req.user.id || verification.mode !== mode || verification.photoHash !== photoHash || verification.identityTemplateVersion < 2 || verification.faceMatchScore < .65) throw new HttpError(401, 'Invalid or insufficient biometric identity verification')
  input.biometricVerification = { verified:true, method:verification.identityTemplateVersion >= 3 ? 'active_liveness_multi_angle_face_embedding_v3' : 'active_liveness_face_embedding_v2', challenge:verification.challenge, livenessScore:verification.livenessScore, faceMatchScore:verification.faceMatchScore, verifiedAt:new Date() }
  return input
}
router.post('/check-in', asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await checkIn(req.user.employee, verifiedPunch(req,'check-in'), meta(req)) })))
router.post('/check-out', asyncHandler(async (req, res) => res.json({ success: true, data: await checkOut(req.user.employee, verifiedPunch(req,'check-out'), meta(req)) })))
router.get('/today', asyncHandler(async (req, res) => res.json({ success: true, data: req.user.employee ? await Attendance.findOne({ employee: req.user.employee._id, date: startOfLocalDay() }) : null })))
router.get('/all', authorize('super_admin','hr_admin','finance_admin','it_admin'), asyncHandler(async (req,res)=>{
  const input=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2020).max(2100)}).parse(req.query)
  const start=new Date(input.year,input.month-1,1)
  const end=new Date(input.year,input.month,1)
  const records=await Attendance.find({date:{$gte:start,$lt:end}}).populate('employee','employeeCode firstName lastName department designation').sort({date:-1,employee:1}).limit(5000)
  res.json({success:true,data:records})
}))
router.get('/corrections', asyncHandler(async (req,res)=>{
  const elevated=['super_admin','hr_admin'].includes(req.user.role)
  const filter=elevated&&req.query.scope==='all'?{}:{employee:req.user.employee?._id}
  const requests=await AttendanceCorrectionRequest.find(filter).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes').sort({createdAt:-1}).limit(100)
  res.json({success:true,data:requests})
}))
router.get('/export', authorize('super_admin','hr_admin','finance_admin','it_admin'), asyncHandler(async (req,res) => {
  const input=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2020).max(2100)}).parse(req.query)
  const start=new Date(input.year,input.month-1,1)
  const end=new Date(input.year,input.month,1)
  const records=await Attendance.find({date:{$gte:start,$lt:end}}).populate('employee','employeeCode firstName lastName department designation').sort({date:1,employee:1})
  const reportMonth=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(start)
  const headers=['Employee ID','Employee Name','Department','Designation','Date','Day','Attendance Mode','Status','Check In','Check Out','Working Hours','Late Minutes','Half-day Reason','Location','Location Verified','Face Match %','Liveness %']
  const emptyRow=Array(headers.length).fill(null)
  const sheetData=[
    [{value:`AT Connect – Attendance Report – ${reportMonth}`,columnSpan:headers.length,fontWeight:'bold',fontSize:16,color:'#FFFFFF',backgroundColor:'#187B72',height:28},...emptyRow.slice(1)],
    [{value:`Generated ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date())} · ${records.length} records`,columnSpan:headers.length,fontStyle:'italic',color:'#667085'},...emptyRow.slice(1)],
    emptyRow,
    headers.map(value=>({value,fontWeight:'bold',color:'#FFFFFF',backgroundColor:'#245D58',align:'center',wrap:true,height:30})),
  ]
  records.forEach((record,index)=>{
    const employee=record.employee||{}
    const fill=index%2===1?'#F3F8F7':undefined
    const cell=(value,extra={})=>({value,backgroundColor:fill,wrap:true,...extra})
    sheetData.push([
      cell(employee.employeeCode||''),cell(`${employee.firstName||''} ${employee.lastName||''}`.trim()),cell(employee.department||''),cell(employee.designation||''),cell(record.date,{type:Date,format:'dd-mmm-yyyy'}),
      cell(new Intl.DateTimeFormat('en-IN',{weekday:'long'}).format(record.date)),cell(String(record.attendanceMode||'').replaceAll('_',' ')),cell(String(record.status||'').replaceAll('_',' ')),
      record.checkIn?.time?cell(record.checkIn.time,{type:Date,format:'hh:mm AM/PM'}):cell(''),record.checkOut?.time?cell(record.checkOut.time,{type:Date,format:'hh:mm AM/PM'}):cell(''),cell(Number(((record.workingMinutes||0)/60).toFixed(2)),{type:Number,format:'0.00'}),cell(record.lateMinutes||0,{type:Number}),cell(record.halfDayReason||''),
      cell(record.checkIn?.address||''),cell(record.locationVerified?'Yes':'No'),record.biometricVerification?.faceMatchScore==null?cell(''):cell(record.biometricVerification.faceMatchScore,{type:Number,format:'0.0%'}),record.biometricVerification?.livenessScore==null?cell(''):cell(record.biometricVerification.livenessScore,{type:Number,format:'0.0%'}),
    ])
  })
  const columns=[14,22,18,20,14,13,18,16,14,14,15,13,24,30,18,15,15].map(width=>({width}))
  const buffer=await writeXlsxFile(sheetData,{sheet:'Attendance Report',columns,stickyRowsCount:4},{fontFamily:'Arial',fontSize:10}).toBuffer()
  const fileName=`AT_Connect_Attendance_${input.year}_${String(input.month).padStart(2,'0')}.xlsx`
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="${fileName}"`)
  res.send(Buffer.from(buffer))
}))
router.post('/:id/correction', asyncHandler(async (req,res)=>{
  if(!req.user.employee)throw new HttpError(409,'No employee profile is linked to this account')
  const input=z.object({requestedCheckoutTime:z.coerce.date(),reason:z.string().trim().min(10,'Please provide a detailed correction reason').max(1000)}).parse(req.body)
  const attendance=await Attendance.findById(req.params.id)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  if(String(attendance.employee)!==String(req.user.employee._id))throw new HttpError(403,'You cannot correct this attendance record')
  if(attendance.status!=='missing_checkout'||attendance.checkOut?.source!=='system_auto')throw new HttpError(409,'Only system auto-checkout records can be corrected')
  const nextDay=new Date(attendance.date);nextDay.setDate(nextDay.getDate()+1)
  if(input.requestedCheckoutTime<attendance.checkIn.time||input.requestedCheckoutTime>=nextDay)throw new HttpError(422,'Corrected checkout must be after check-in and before midnight on the attendance date')
  if(await AttendanceCorrectionRequest.exists({attendance:attendance._id,status:'pending'}))throw new HttpError(409,'A correction request is already pending for this record')
  const request=await AttendanceCorrectionRequest.create({attendance:attendance._id,employee:req.user.employee._id,requestedCheckoutTime:input.requestedCheckoutTime,reason:input.reason})
  const reviewers=await User.find({role:{$in:['hr_admin','super_admin']},isActive:true}).select('_id')
  if(reviewers.length)await Notification.insertMany(reviewers.map(reviewer=>({recipient:reviewer._id,type:'Attendance Correction',title:'Attendance correction requested',message:`${req.user.firstName} ${req.user.lastName} requested a corrected checkout time.`,employee:req.user.employee._id})))
  res.status(201).json({success:true,data:request})
}))
router.patch('/corrections/:id/:decision', authorize('super_admin','hr_admin'), asyncHandler(async (req,res)=>{
  if(!['approve','reject'].includes(req.params.decision))throw new HttpError(400,'Invalid correction decision')
  const input=z.object({reviewNote:z.string().trim().max(500).default('')}).parse(req.body)
  if(req.params.decision==='reject'&&input.reviewNote.length<3)throw new HttpError(422,'A rejection reason is required')
  const request=await AttendanceCorrectionRequest.findById(req.params.id)
  if(!request||request.status!=='pending')throw new HttpError(409,'This correction request is no longer pending')
  const attendance=await Attendance.findById(request.attendance)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  const approved=req.params.decision==='approve'
  request.status=approved?'approved':'rejected';request.reviewedBy=req.user._id;request.reviewedAt=new Date();request.reviewNote=input.reviewNote
  if(approved){
    const previousCheckoutTime=attendance.checkOut?.time
    attendance.checkOut.time=request.requestedCheckoutTime
    attendance.checkOut.source='hr_correction'
    attendance.checkOut.address='Checkout time approved through attendance correction'
    attendance.workingMinutes=Math.max(0,Math.floor((request.requestedCheckoutTime-attendance.checkIn.time)/60000))
    attendance.status=attendance.autoCheckout?.previousStatus||'present'
    attendance.correctionAudit.push({previousCheckoutTime,correctedCheckoutTime:request.requestedCheckoutTime,reason:request.reason,approvedBy:req.user._id,approvedAt:new Date()})
    await attendance.save()
  }
  await request.save()
  const employeeUser=await User.findOne({employee:request.employee,isActive:true}).select('_id')
  if(employeeUser)await Notification.create({recipient:employeeUser._id,type:`Attendance Correction ${approved?'Approved':'Rejected'}`,title:`Attendance correction ${approved?'approved':'rejected'}`,message:input.reviewNote||'Your corrected checkout time was approved.',employee:request.employee})
  const result=await AttendanceCorrectionRequest.findById(request._id).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes')
  res.json({success:true,data:result})
}))
router.get('/me', asyncHandler(async (req, res) => {
  const { month, year } = req.query
  const filter = { employee: req.user.employee._id }
  if (month && year) { filter.date = { $gte: new Date(Number(year), Number(month)-1, 1), $lt: new Date(Number(year), Number(month), 1) } }
  res.json({ success: true, data: await Attendance.find(filter).sort({ date: -1 }).limit(100) })
}))
export default router
