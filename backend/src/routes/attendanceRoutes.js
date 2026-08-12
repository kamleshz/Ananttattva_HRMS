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
import { OfficeLocation, OrganizationProfile } from '../models/Organization.js'
import { WorkArrangementRequest } from '../models/WorkArrangementRequest.js'
import { FaceAttendanceRequest } from '../models/FaceAttendanceRequest.js'
import { sendFaceCheckInApprovalRequest, sendFaceCheckInDecision } from '../services/mailService.js'
import manualAttendanceRoutes from './manualAttendanceRoutes.js'
import { BiometricVerificationUse } from '../models/BiometricVerificationUse.js'

const router = Router()
router.use(authenticate)
router.use('/manual',manualAttendanceRoutes)
const punchSchema = z.object({
  photo: z.string().startsWith('data:image/', 'A captured attendance photo is required').max(4_500_000),
  attendanceMode: z.enum(['office', 'wfh', 'client_location', 'field_visit']).default('office'),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters:z.number().positive().max(5000), address: z.string().max(300).optional() }).optional(),
  biometricToken: z.string().min(20),
})
const meta = (req) => ({ ipAddress: req.ip, device: req.get('user-agent') })
const faceRequestSchema = z.object({
  photo: z.string().startsWith('data:image/', 'A captured attendance photo is required').max(4_500_000),
  attendanceMode: z.enum(['office', 'wfh', 'client_location', 'field_visit']).default('office'),
  location: z.object({ latitude:z.number().min(-90).max(90), longitude:z.number().min(-180).max(180), accuracyMeters:z.number().positive().max(5000), address:z.string().max(300).optional() }),
  mismatchToken: z.string().min(20),
  reason: z.string().trim().min(10, 'Please explain why manual approval is required').max(1000),
})
function distanceMeters(from,to){
  const radians=value=>value*Math.PI/180
  const earthRadius=6371000
  const latitudeDelta=radians(to.latitude-from.latitude),longitudeDelta=radians(to.longitude-from.longitude)
  const value=Math.sin(latitudeDelta/2)**2+Math.cos(radians(from.latitude))*Math.cos(radians(to.latitude))*Math.sin(longitudeDelta/2)**2
  return Math.round(earthRadius*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value)))
}
async function verifyRequestedLocation(input,user,attemptedAt){
  const dayStart=startOfLocalDay(attemptedAt),dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);dayEnd.setMilliseconds(-1)
  if(input.attendanceMode==='office'){
    const offices=await OfficeLocation.find({isActive:true}).lean()
    if(!offices.length)throw new HttpError(409,'Attendance location is not configured. Please contact an administrator')
    const ranked=offices.map(office=>({...office,distanceMeters:distanceMeters(input.location,office)})).sort((a,b)=>a.distanceMeters-b.distanceMeters)
    const office=ranked[0]
    if(input.location.accuracyMeters>office.maximumAccuracyMeters)throw new HttpError(422,`GPS accuracy is ${Math.round(input.location.accuracyMeters)} metres. Retry when accuracy is within ${office.maximumAccuracyMeters} metres`)
    if(Math.max(0,office.distanceMeters-Math.round(input.location.accuracyMeters))>office.allowedRadiusMeters)throw new HttpError(403,`Your GPS position is outside the ${office.name} attendance boundary`)
    return {...input.location,address:office.address||input.location.address,officeLocation:office._id,officeName:office.name,distanceMeters:office.distanceMeters}
  }
  const arrangement=await WorkArrangementRequest.findOne({employee:user.employee?._id,type:input.attendanceMode,status:'approved',startDate:{$lte:dayEnd},endDate:{$gte:dayStart}}).lean()
  if(!arrangement)throw new HttpError(403,`An approved ${input.attendanceMode.replaceAll('_',' ')} request is required for the attempted date`)
  if(input.location.accuracyMeters>150)throw new HttpError(422,'Enable precise location and retry when GPS accuracy is within 150 metres')
  const destination=arrangement.destination
  if(destination?.latitude==null||destination?.longitude==null){
    if(input.attendanceMode==='wfh')return {...input.location,address:input.location.address||'Approved work from home',officeName:'Work from home'}
    throw new HttpError(409,'The approved destination is missing coordinates')
  }
  const travelledDistance=distanceMeters(input.location,destination),allowedRadius=destination.allowedRadiusMeters||250
  if(Math.max(0,travelledDistance-Math.round(input.location.accuracyMeters))>allowedRadius)throw new HttpError(403,'Your GPS position is outside the approved work location')
  return {...input.location,address:destination.address||input.location.address,officeName:input.attendanceMode==='wfh'?'Work from home':arrangement.clientName||destination.name||'Approved destination',distanceMeters:travelledDistance}
}
async function verifiedPunch(req, mode) {
  const input = punchSchema.parse(req.body)
  let verification
  try { verification = jwt.verify(input.biometricToken, env.jwtSecret) }
  catch { throw new HttpError(401, 'Biometric verification expired. Please verify again') }
  const photoHash = createHash('sha256').update(input.photo).digest('hex')
  const authoritativeUniFace=verification.engineName==='uniface'&&verification.verified===true&&Boolean(verification.modelVersion)
  if (verification.purpose !== 'biometric_verification' || verification.sub !== req.user.id || (verification.employeeId&&verification.employeeId!==String(req.user.employee?._id)) || verification.mode !== mode || (verification.attendanceMode&&verification.attendanceMode!==input.attendanceMode) || verification.photoHash !== photoHash || verification.identityTemplateVersion < 2 || (!authoritativeUniFace&&verification.faceMatchScore < .56)) throw new HttpError(401, 'Invalid or insufficient biometric identity verification')
  const dayStart=startOfLocalDay(),dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);dayEnd.setMilliseconds(-1)
  const existing=mode==='check-out'?await Attendance.findOne({employee:req.user.employee?._id,date:dayStart}).select('attendanceMode'):null
  if(existing&&existing.attendanceMode!==input.attendanceMode)throw new HttpError(409,`Check out using the same attendance mode used at check in (${existing.attendanceMode.replaceAll('_',' ')})`)
  if(input.attendanceMode!=='office'){
    if(!req.user.employee)throw new HttpError(409,'No employee profile is linked to this account')
    const approvedArrangement=await WorkArrangementRequest.findOne({employee:req.user.employee._id,type:input.attendanceMode,status:'approved',startDate:{$lte:dayEnd},endDate:{$gte:dayStart}}).lean()
    if(!approvedArrangement)throw new HttpError(403,`An approved ${input.attendanceMode.replaceAll('_',' ')} request is required for today`)
    if(mode==='check-in'){
      const current=new Date(),localMinutes=current.getHours()*60+current.getMinutes()
      const [startHour,startMinute]=approvedArrangement.startTime.split(':').map(Number),[endHour,endMinute]=approvedArrangement.endTime.split(':').map(Number)
      if(localMinutes<startHour*60+startMinute||localMinutes>endHour*60+endMinute)throw new HttpError(403,`This approval is valid from ${approvedArrangement.startTime} to ${approvedArrangement.endTime}`)
    }
  }
  if(!input.location){
    const evidence=verification.locationEvidence||{}
    input.location={
      latitude:evidence.latitude,
      longitude:evidence.longitude,
      accuracyMeters:evidence.accuracyMeters,
      distanceMeters:evidence.distanceMeters,
      officeLocation:evidence.officeId,
      locationStatus:evidence.status||'unavailable',
    }
    input.locationVerified=Boolean(verification.locationVerified)
  }else{
    input.location={...input.location,locationStatus:'captured'}
    input.locationVerified=false
  }
  input.locationVerified=Boolean(input.locationVerified)
  input.biometricVerification = { verified:true, method:verification.identityTemplateVersion >= 3 ? 'active_liveness_multi_angle_face_embedding_v3' : 'active_liveness_face_embedding_v2', challenge:verification.challenge, livenessScore:verification.livenessScore, faceMatchScore:verification.faceMatchScore, verifiedAt:new Date() }
  if(!verification.jti)throw new HttpError(401,'Biometric verification token is missing its replay identifier')
  try{await BiometricVerificationUse.create({jti:verification.jti,employee:req.user.employee._id,action:mode,engineName:verification.engineName||'legacy_browser',expiresAt:new Date(verification.exp*1000)})}
  catch(error){if(error?.code===11000)throw new HttpError(409,'This biometric verification has already been used');throw error}
  if(authoritativeUniFace)input.biometricVerification.method=`uniface_${verification.modelVersion}`
  return input
}
router.post('/check-in', asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await checkIn(req.user.employee, await verifiedPunch(req,'check-in'), meta(req)) })))
router.post('/check-out', asyncHandler(async (req, res) => res.json({ success: true, data: await checkOut(req.user.employee, await verifiedPunch(req,'check-out'), meta(req)) })))
router.post('/face-match-requests',(_req,_res,next)=>next(new HttpError(410,'This endpoint was replaced by the secure /api/attendance/manual workflow')))
router.patch('/face-match-requests/:id/:decision',(_req,_res,next)=>next(new HttpError(410,'Review this request through /api/attendance/manual instead')))
router.post('/face-match-requests', asyncHandler(async (req,res)=>{
  if(!req.user.employee)throw new HttpError(409,'No employee profile is linked to this account')
  const input=faceRequestSchema.parse(req.body)
  let proof
  try{proof=jwt.verify(input.mismatchToken,env.jwtSecret)}catch{throw new HttpError(401,'Face mismatch proof expired. Please repeat verification')}
  const photoHash=createHash('sha256').update(input.photo).digest('hex')
  if(proof.purpose!=='biometric_mismatch'||proof.sub!==req.user.id||proof.mode!=='check-in'||proof.photoHash!==photoHash||proof.livenessScore<.65)throw new HttpError(401,'Invalid face mismatch proof')
  const attemptedAt=new Date(proof.attemptedAt)
  if(Number.isNaN(attemptedAt.getTime()))throw new HttpError(401,'Invalid face mismatch attempt time')
  const date=startOfLocalDay(attemptedAt)
  if(await Attendance.exists({employee:req.user.employee._id,date}))throw new HttpError(409,'Attendance is already recorded for this date')
  if(await FaceAttendanceRequest.exists({employee:req.user.employee._id,date,status:'pending'}))throw new HttpError(409,'A manual check-in request is already pending for this date')
  const location=await verifyRequestedLocation(input,req.user,attemptedAt)
  const request=await FaceAttendanceRequest.create({employee:req.user.employee._id,requestedBy:req.user._id,date,attemptedAt,requestedAt:attemptedAt,action:'check_in',attendanceMode:input.attendanceMode,photo:input.photo,location,locationVerified:true,faceMatchScore:proof.faceMatchScore,livenessScore:proof.livenessScore,reason:input.reason,...meta(req)})
  const reviewers=await User.find({role:{$in:['hr_admin','admin','super_admin']},isActive:true}).select('_id email firstName')
  if(reviewers.length)await Notification.insertMany(reviewers.map(reviewer=>({recipient:reviewer._id,type:'Face Check-in Approval',title:'Manual check-in approval requested',message:`${req.user.firstName} ${req.user.lastName} could not complete face matching and requested check-in approval.`,employee:req.user.employee._id})))
  const employeeName=`${req.user.firstName} ${req.user.lastName}`.trim()
  const emailResults=await Promise.allSettled(reviewers.filter(reviewer=>reviewer.email).map(reviewer=>sendFaceCheckInApprovalRequest({recipient:reviewer.email,reviewerName:reviewer.firstName||'Reviewer',employeeName,employeeCode:req.user.employee.employeeCode,attemptedAt,attendanceMode:input.attendanceMode,reason:input.reason,faceMatchScore:proof.faceMatchScore})))
  emailResults.filter(result=>result.status==='rejected').forEach(result=>console.error('Manual check-in approval email failed:',result.reason?.message||result.reason))
  res.status(201).json({success:true,data:request})
}))
router.get('/face-match-requests', asyncHandler(async (req,res)=>{
  const reviewer=['super_admin','admin','hr_admin'].includes(req.user.role)
  const filter=reviewer&&req.query.scope==='all'?{}:{employee:req.user.employee?._id}
  const requests=await FaceAttendanceRequest.find(filter).populate('employee','firstName lastName employeeCode department designation').populate('reviewedBy','firstName lastName role').populate('attendance','date checkIn status attendanceMode').sort({createdAt:-1}).limit(100)
  res.json({success:true,data:requests})
}))
router.patch('/face-match-requests/:id/:decision', authorize('super_admin','hr_admin'), asyncHandler(async (req,res)=>{
  if(!['approve','reject'].includes(req.params.decision))throw new HttpError(400,'Invalid manual check-in decision')
  const input=z.object({reviewNote:z.string().trim().max(500).default('')}).parse(req.body)
  if(req.params.decision==='reject'&&input.reviewNote.length<3)throw new HttpError(422,'A rejection reason is required')
  const approved=req.params.decision==='approve',nextStatus=approved?'approved':'rejected',reviewedAt=new Date()
  const request=await FaceAttendanceRequest.findOneAndUpdate({_id:req.params.id,status:'pending'},{$set:{status:nextStatus,reviewedBy:req.user._id,reviewedAt,reviewNote:input.reviewNote}},{new:true}).populate('employee')
  if(!request)throw new HttpError(409,'This manual check-in request is no longer pending')
  try{
    if(approved){
      const attendance=await checkIn(request.employee,{attendanceMode:request.attendanceMode,locationVerified:true,location:request.location.toObject(),photo:request.photo,source:'manual_approval',biometricVerification:{verified:false,method:'hr_face_mismatch_approval',livenessScore:request.livenessScore,faceMatchScore:request.faceMatchScore,verifiedAt:request.reviewedAt}},{ipAddress:request.ipAddress,device:request.device},request.attemptedAt)
      request.attendance=attendance._id
      await request.save()
    }
  }catch(error){
    await FaceAttendanceRequest.updateOne({_id:request._id,status:nextStatus,reviewedBy:req.user._id},{$set:{status:'pending',reviewedBy:null,reviewedAt:null,reviewNote:''}})
    throw error
  }
  const employeeUser=await User.findOne({employee:request.employee._id,isActive:true}).select('_id email firstName')
  if(employeeUser)await Notification.create({recipient:employeeUser._id,type:`Manual Check-in ${approved?'Approved':'Rejected'}`,title:`Manual check-in ${approved?'approved':'rejected'}`,message:input.reviewNote||(approved?'Your attendance was recorded using the original check-in attempt time.':'Your manual check-in request was rejected.'),employee:request.employee._id})
  if(employeeUser?.email){
    const [emailResult]=await Promise.allSettled([sendFaceCheckInDecision({recipient:employeeUser.email,firstName:employeeUser.firstName||request.employee.firstName,decision:approved?'approved':'rejected',attemptedAt:request.attemptedAt,reviewerName:`${req.user.firstName} ${req.user.lastName}`.trim(),reviewNote:input.reviewNote})])
    if(emailResult.status==='rejected')console.error('Manual check-in decision email failed:',emailResult.reason?.message||emailResult.reason)
  }
  const result=await FaceAttendanceRequest.findById(request._id).populate('employee','firstName lastName employeeCode department designation').populate('reviewedBy','firstName lastName role').populate('attendance','date checkIn status attendanceMode')
  res.json({success:true,data:result})
}))
router.get('/today', asyncHandler(async (req, res) => {
  const employee=req.user.employee
  const [record,organization,pendingFaceRequest]=await Promise.all([
    employee?Attendance.findOne({employee:employee._id,date:startOfLocalDay()}).lean():null,
    OrganizationProfile.findOne({singletonKey:'organization'}).select('timeZone').lean(),
    employee?FaceAttendanceRequest.findOne({employee:employee._id,date:startOfLocalDay(),status:'pending'}).select('attemptedAt requestedAt action status reasonLabel riskLevel').lean():null,
  ])
  const shift=employee?.shift||{name:'General Shift',startTime:'10:00',endTime:'18:30'}
  const state=!record?.checkIn?.time?'NOT_CHECKED_IN':record?.checkOut?.time?'CHECKED_OUT':'CHECKED_IN'
  const attendanceDate=startOfLocalDay()
  const localDate=`${attendanceDate.getFullYear()}-${String(attendanceDate.getMonth()+1).padStart(2,'0')}-${String(attendanceDate.getDate()).padStart(2,'0')}`
  res.json({success:true,data:{
    state,
    manualCheckInRequest:pendingFaceRequest?.action==='check_in'?pendingFaceRequest:null,
    manualRequest:pendingFaceRequest,
    organizationTimezone:organization?.timeZone||'Asia/Kolkata',
    date:localDate,
    shift,
    checkIn:record?.checkIn||null,
    checkOut:record?.checkOut||null,
    status:record?.status||null,
    late:{isLate:Boolean(record?.lateMinutes),lateMinutes:record?.lateMinutes||0,monthlyLateCount:record?.lateOccurrenceInMonth||0,halfDayPenaltyApplied:Boolean(record?.halfDayReason)},
    checkoutType:record?.checkoutType||(record?.checkOut?.source==='system_auto'?'AUTO_CHECKOUT':record?.checkOut?.time?'MANUAL_CHECKOUT':null),
    workingMinutes:record?.workingMinutes||0,
    effectiveMinutes:record?.workingMinutes||0,
    overtimeMinutes:record?.overtimeMinutes||0,
    autoCheckout:record?.autoCheckout||null,
    attendanceId:record?._id||null,
    attendanceMode:record?.attendanceMode||null,
  }})
}))
router.get('/all', authorize('super_admin','hr_admin','finance_admin','it_admin'), asyncHandler(async (req,res)=>{
  const input=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2020).max(2100)}).parse(req.query)
  const start=new Date(input.year,input.month-1,1)
  const end=new Date(input.year,input.month,1)
  const records=await Attendance.find({date:{$gte:start,$lt:end}}).populate('employee','employeeCode firstName lastName department designation').sort({date:-1,employee:1}).limit(5000)
  res.json({success:true,data:records})
}))
router.get('/corrections', asyncHandler(async (req,res)=>{
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
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
  const reviewers=await User.find({role:{$in:['hr_admin','admin','super_admin']},isActive:true}).select('_id')
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
    attendance.checkoutType='HR_CORRECTION'
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
