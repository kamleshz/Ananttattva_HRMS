import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { organizationExcelDate, organizationMonthBoundsFor, startOfLocalDay } from '../utils/date.js'
import { ATTENDANCE_REPORT_THEME, reportCell, reportHeaderRow, reportSectionRow, statusCellStyle } from '../utils/excelReportStyle.js'
import { applyAttendanceCompletion, checkIn, checkOut } from '../services/attendanceService.js'
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
import { sendFaceCheckInApprovalRequest, sendFaceCheckInDecision, sendGraphEmail } from '../services/mailService.js'
import manualAttendanceRoutes from './manualAttendanceRoutes.js'
import { BiometricVerificationUse } from '../models/BiometricVerificationUse.js'
import { Employee } from '../models/Employee.js'
import { buildAttendanceRoster } from '../services/attendanceRosterService.js'
import { ScheduledEmail } from '../models/ScheduledEmail.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'
import { getApprovedLeavesByDate, getDailyAttendancePlan, getOrganizationHolidayKeys } from '../services/attendanceCalculationService.js'
import { isScheduledWorkingDay } from '../services/workingDayService.js'
import { proratedAnnualPaidLeaves, countPaidLeaveDaysForEmployee, computeLeaveDays, financialYearRange } from '../services/leavePolicyService.js'

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

function pad2(n){return String(n).padStart(2,'0')}
function fmtDDMMYYYY(date){return `${pad2(date.getDate())}/${pad2(date.getMonth()+1)}/${date.getFullYear()}`}
function fmtHHMM(date){return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`}
function parseHHMMToMinutes(str){const [h,m]=String(str||'00:00').split(':').map(Number);return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0)}
function dateMinutes(date){return date.getHours()*60+date.getMinutes()}
function weekBounds(now){const today=startOfLocalDay(now),weekday=new Date(today.getTime()+330*60_000).getUTCDay(),offset=weekday===0?6:weekday-1;return{start:new Date(today.getTime()-offset*86_400_000),end:new Date(today.getTime()+(7-offset)*86_400_000)}}
function organizationDateKey(date){const d=new Date(date.getTime()+330*60_000);return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`}

function validateRequestedCheckoutTime({requestedCheckoutTime,attendance,shiftEnd}){
  if(!(requestedCheckoutTime>attendance.checkIn.time)){
    return {code:'CHECKOUT_BEFORE_CHECKIN',message:'Requested checkout time must be after check-in'}
  }
  const maxEnd=new Date(attendance.date);maxEnd.setDate(maxEnd.getDate()+2);maxEnd.setHours(23,59,59,999)
  if(!(requestedCheckoutTime<maxEnd)){
    return {code:'CHECKOUT_OUTSIDE_RANGE',message:'Checkout too far from attendance date, max 2 days after check-in date'}
  }
  const shiftMinutes=parseHHMMToMinutes(shiftEnd||'18:30')
  const checkoutMinutes=dateMinutes(requestedCheckoutTime)
  if(Math.abs(checkoutMinutes-shiftMinutes)>240){
    return {code:'CHECKOUT_OUTSIDE_RANGE',message:'Checkout must be within 4 hours of configured shift end'}
  }
  return null
}

async function invalidateWeeklyAuditKeysForDate(attendance){
  const {start,end}=weekBounds(attendance.date)
  const periodStartKey=organizationDateKey(start)
  const periodEndKey=organizationDateKey(new Date(end.getTime()-1))
  const keyPrefix=`weekly-hours-shortfall:${periodStartKey}:${periodEndKey}:`
  try{
    await ScheduledEmail.updateMany({key:{$regex:`^${keyPrefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`},type:'weekly_hours_shortfall'},{$set:{status:'processing',lastError:'Invalidated by attendance correction',sentAt:null}})
  }catch(error){
    console.error('invalidateWeeklyAuditKeysForDate failed:',error?.message||error)
  }
}

async function finalizeMissingCheckoutAsLeaveInline({attendance,reason,reviewerId}){
  const policy=await getAttendancePolicy()
  const employee=await Employee.findById(attendance.employee).lean()
  if(!employee)throw new HttpError(500,'Employee record not found for leave conversion')
  const employeeId=employee._id
  const {workingDays}=await computeLeaveDays({startDate:attendance.date,endDate:attendance.date})
  const {fyStart,fyEnd,fyLabel,annualPaidLeaves,cycleStartMonth,eligibleMonths,entitledPaidLeaves,canApplyPaidLeave}=proratedAnnualPaidLeaves({employee,asOf:attendance.date})
  let paymentsMode='unpaid',paidDays=0,unpaidDays=1,balanceBefore=0,balanceAfter=0
  if(policy.autoDeductPaidLeaveOnMissingCheckout&&canApplyPaidLeave){
    const usedPaidDays=await countPaidLeaveDaysForEmployee({employeeId,leaveRequestModel:LeaveRequest,leaveTypeKey:'paid_leave'})
    balanceBefore=Math.max(0,entitledPaidLeaves-usedPaidDays)
    if(balanceBefore>=1){
      paymentsMode='paid';paidDays=1;unpaidDays=0;balanceAfter=balanceBefore-1
    }
  }
  const leaveType=paymentsMode==='paid'?'paid_leave':'unpaid_leave'
  const workflowRequiredSteps=paymentsMode==='paid'?['manager','hr_admin']:['hr_admin']
  const workflowSteps=workflowRequiredSteps.map(role=>({role,status:'approved',actor:reviewerId,actedAt:new Date(),comment:reason||''}))
  const workflow={requiredSteps:workflowRequiredSteps,currentStepIndex:workflowRequiredSteps.length,steps:workflowSteps,nextRole:null}
  const leaveRequest=await LeaveRequest.create({
    employee:employeeId,
    reportingManager:employee.manager||null,
    leaveType,
    dayType:'full_day',
    startDate:attendance.date,
    endDate:attendance.date,
    days:1,
    workingDays:Math.max(1,workingDays),
    reason:reason||'Missing checkout auto conversion',
    status:'approved',
    reviewedBy:reviewerId||null,
    reviewedAt:new Date(),
    reviewNote:reason||'',
    policySnapshot:{annualPaidLeaves,cycleStartMonth,entitledPaidLeaves,eligibleMonths,canApplyPaidLeave,longLeave:{isLongLeave:false,noticeDaysRequired:0,calendarNoticeDays:0,meetsAdvanceNotice:true}},
    payments:{mode:paymentsMode,paidDays,unpaidDays,balanceBefore,balanceAfter},
    workflow,
    fyLabel,
    conversionReason:reason||'',
    systemGenerated:true,
  })
  const workingMinutesBefore=Number(attendance.workingMinutes)||0
  attendance.missingCheckout=attendance.missingCheckout||{}
  attendance.missingCheckout.justificationStatus='expired'
  attendance.missingCheckout.reviewAction='expired'
  attendance.missingCheckout.finalizedAt=new Date()
  attendance.missingCheckout.conversionReason=reason||''
  attendance.missingCheckout.leaveRequestId=leaveRequest._id
  attendance.missingCheckout.workingMinutesBefore=workingMinutesBefore
  attendance.missingCheckout.workingMinutesRestored=0
  attendance.status=paymentsMode==='paid'?'on_leave':'absent'
  attendance.exceptionStatus=`Missing Checkout – ${paymentsMode==='paid'?'Paid Leave Deducted':'Marked Absent'}`
  attendance.workingMinutes=0
  attendance.completionStatus='exception_pending'
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({timestamp:new Date(),status:'leave_converted',message:`${reason}. Leave: ${paymentsMode}`,actor:`system:${reviewerId||'auto'}`})
  await attendance.save()
  return leaveRequest
}

async function sendCorrectionDecisionNotification({employeeId,correctionId,attendance,approved,reviewNote,reviewerName}){
  const employeeUser=await User.findOne({employee:employeeId,isActive:true}).select('_id email firstName lastName').lean()
  if(!employeeUser)return
  const dedupeKey=`attendance-correction-decision:${employeeId}:${correctionId}`
  const type=approved?'Attendance Correction Approved':'Attendance Correction Rejected'
  const title=approved?'Checkout correction approved':'Checkout correction rejected'
  const dateLabel=fmtDDMMYYYY(attendance.date)
  let message
  if(approved){
    const actualMinutes=Math.max(0,Math.floor(((attendance.checkOut?.time||new Date())-attendance.checkIn.time)/60000))
    message=reviewNote||`Your checkout correction for ${dateLabel} was approved. Working minutes restored: ${actualMinutes} min.`
  }else{
    message=reviewNote||`Your checkout correction for ${dateLabel} was rejected and converted to leave.`
  }
  await Notification.create({recipient:employeeUser._id,type,title,message,employee:employeeId})
  if(employeeUser.email){
    let claim
    try{claim=await ScheduledEmail.create({key:dedupeKey,type:'attendance_miss',period:dateLabel,recipient:employeeUser._id,email:employeeUser.email,attempts:1})}catch(error){if(error?.code!==11000)throw error;claim=null}
    if(claim){
      const subject=approved?'Checkout correction approved':'Checkout correction rejected'
      const intro=approved
        ?`Hi ${employeeUser.firstName}, your checkout time correction request for ${dateLabel} has been approved by ${reviewerName||'HR'}.`
        :`Hi ${employeeUser.firstName}, your checkout time correction request for ${dateLabel} has been rejected by ${reviewerName||'HR'}.`
      const contentBlock=reviewNote?`<div style="margin-top:8px;padding:14px 16px;border-left:4px solid ${approved?'#087e70':'#a04a59'};border-radius:8px;background:${approved?'#f2faf7':'#fbf4f5'};color:${approved?'#0e514a':'#6e2b36'};font-size:12px;line-height:1.65"><strong>Review note:</strong><br>${String(reviewNote).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}</div>`:''
      const html=`<div style="font-family:Arial,sans-serif;color:#17213a;line-height:1.7"><h2 style="color:${approved?'#087e70':'#a04a59'}">${subject}</h2><p>${intro}</p>${contentBlock}<p>Review your attendance record in AT Connect for details.</p></div>`
      try{
        await sendGraphEmail({recipient:employeeUser.email,subject,html})
        claim.status='sent';claim.sentAt=new Date();await claim.save()
      }catch(error){
        claim.status='failed';claim.lastError=String(error?.message||error).slice(0,500);await claim.save()
        console.error('Correction decision email failed:',error?.message||error)
      }
    }
  }
}

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
    exceptionStatus:record?.exceptionStatus||'',
    missingCheckout:record?.missingCheckout||null,
  }})
}))
router.get('/all', authorize('super_admin','admin','hr_admin','finance_admin','it_admin'), asyncHandler(async (req,res)=>{
  const input=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2020).max(2100),complete:z.enum(['true','false']).default('false')}).parse(req.query)
  const {start,end}=organizationMonthBoundsFor(input.year,input.month)
  const [records, meta] = await Promise.all([
    Attendance.find({date:{$gte:start,$lt:end}}).populate('employee','employeeCode firstName lastName officialEmail department designation shift joiningDate').sort({date:-1,employee:1}),
    buildMetaPolicyEnvelope(),
  ])
  const canViewCompleteRoster=['super_admin','admin','hr_admin'].includes(req.user.role)
  if(input.complete!=='true'||!canViewCompleteRoster)return res.json({success:true,meta,data:records})
  const today=startOfLocalDay(),tomorrow=new Date(today.getTime()+24*60*60*1000)
  const rosterEnd=start>=tomorrow?start:end<tomorrow?end:tomorrow
  const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']},$or:[{joiningDate:{$lt:rosterEnd}},{joiningDate:null},{joiningDate:{$exists:false}}]}).select('employeeCode firstName lastName officialEmail department designation shift joiningDate').sort({firstName:1,lastName:1}).lean()
  res.json({success:true,meta,data:buildAttendanceRoster({employees,records,start,end:rosterEnd})})
}))
router.get('/corrections', asyncHandler(async (req,res)=>{
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
  const filter=elevated&&req.query.scope==='all'?{}:{employee:req.user.employee?._id}
  const requests=await AttendanceCorrectionRequest.find(filter).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes exceptionStatus missingCheckout').sort({createdAt:-1}).limit(100)
  res.json({success:true,data:requests})
}))
router.get('/export', authorize('super_admin','admin','hr_admin','finance_admin','it_admin'), asyncHandler(async (req,res) => {
  const input=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2020).max(2100)}).parse(req.query)
  const {start,end}=organizationMonthBoundsFor(input.year,input.month)
  let records=await Attendance.find({date:{$gte:start,$lt:end}}).populate('employee','employeeCode firstName lastName officialEmail department designation shift joiningDate').sort({date:1,employee:1})
  if(['super_admin','admin','hr_admin'].includes(req.user.role)){
    const today=startOfLocalDay(),tomorrow=new Date(today.getTime()+24*60*60*1000)
    const rosterEnd=start>=tomorrow?start:end<tomorrow?end:tomorrow
    const employees=await Employee.find({employeeStatus:{$in:['active','notice_period']},$or:[{joiningDate:{$lt:rosterEnd}},{joiningDate:null},{joiningDate:{$exists:false}}]}).select('employeeCode firstName lastName officialEmail department designation shift joiningDate').sort({firstName:1,lastName:1}).lean()
    records=buildAttendanceRoster({employees,records,start,end:rosterEnd}).sort((left,right)=>new Date(left.date)-new Date(right.date)||`${left.employee?.firstName||''} ${left.employee?.lastName||''}`.localeCompare(`${right.employee?.firstName||''} ${right.employee?.lastName||''}`))
  }
  const reportMonth=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(start)
  const headers=['Employee ID','Employee Name','Department','Designation','Date','Day','Attendance Mode','Status','First Check In','Check Out','Working Hours','Late Minutes','Half-day Reason','Original Target (min)','Adjusted Target (min)','Full-day Leave','Half-day Leave','Location','Location Verified','Face Match %','Liveness %']
  const emptyRow=Array(headers.length).fill(null)
  const theme=ATTENDANCE_REPORT_THEME
  const sheetData=[
    [{value:`AT Connect – Attendance Report – ${reportMonth}`,columnSpan:headers.length,fontWeight:'bold',fontSize:18,textColor:'#FFFFFF',backgroundColor:theme.title,height:34,alignVertical:'center'},...emptyRow.slice(1)],
    [{value:`Generated ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date())} · ${records.length} records · Times shown in IST`,columnSpan:headers.length,fontStyle:'italic',fontSize:10,textColor:theme.subtitleText,backgroundColor:theme.subtitle,height:24,alignVertical:'center'},...emptyRow.slice(1)],
    reportSectionRow([{label:'EMPLOYEE DETAILS',span:4},{label:'ATTENDANCE & WORK HOURS',span:10},{label:'LEAVE & ADJUSTMENTS',span:4},{label:'VERIFICATION',span:3}],theme),
    reportHeaderRow(headers,[4,10,4,3],theme),
  ]
  const policy = await getAttendancePolicy()
  const FULL_DAY_MINUTES = policy.fullDayWorkingMinutes
  const dateKeyStart = organizationDateKey(start)
  const yearNum = Number(dateKeyStart.slice(0,4))
  const holidayMap = await getOrganizationHolidayKeys([yearNum, yearNum])
  const holidaysSet = holidayMap.get(yearNum) || new Set()
  const employeeIds = [...new Set(records.map(r => String(r.employee?._id || r.employee)).filter(Boolean))]
  const allLeavesByEmployee = new Map()
  for (const empId of employeeIds) {
    try {
      const leavesMap = await getApprovedLeavesByDate(empId, start, new Date(end.getTime() - 1))
      allLeavesByEmployee.set(empId, leavesMap)
    } catch (_) {
      allLeavesByEmployee.set(empId, new Map())
    }
  }
  records.forEach((record,index)=>{
    const employee=record.employee||{}
    const cell=(value,extra={})=>reportCell(value,index,theme,extra)
    const statusLabel=String(record.status||'').replaceAll('_',' ')
    const modeLabel=String(record.attendanceMode||'').replaceAll('_',' ')
    const dateKey = organizationDateKey(record.date)
    const isWorkingDay = isScheduledWorkingDay(record.date, holidaysSet)
    const originalTarget = isWorkingDay ? FULL_DAY_MINUTES : 0
    const adjustedTarget = Number(record.expectedWorkingMinutes != null ? record.expectedWorkingMinutes : originalTarget)
    const empIdKey = String(employee._id || record.employee)
    const leavesForDate = allLeavesByEmployee.get(empIdKey)?.get(dateKey) || { fullDayLeaves: [], halfDayLeaves: [] }
    const fullDayLeave = Array.isArray(leavesForDate.fullDayLeaves) && leavesForDate.fullDayLeaves.length > 0 ? 'Yes' : 'No'
    const halfDayLeave = fullDayLeave === 'Yes' ? 'No' : (Array.isArray(leavesForDate.halfDayLeaves) && leavesForDate.halfDayLeaves.length > 0 ? 'Yes' : 'No')
    sheetData.push([
      cell(employee.employeeCode||'',{fontWeight:'bold',textColor:theme.accent}),cell(`${employee.firstName||''} ${employee.lastName||''}`.trim(),{fontWeight:'bold'}),cell(employee.department||''),cell(employee.designation||''),cell(organizationExcelDate(record.date),{type:Date,format:'dd-mmm-yyyy',align:'center'}),
      cell(new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'Asia/Kolkata'}).format(record.date),{align:'center'}),cell(modeLabel,{backgroundColor:'#E8F1FA',textColor:'#315F91',fontWeight:'bold',align:'center'}),cell(statusLabel,statusCellStyle(record.status)),
      record.checkIn?.time?cell(organizationExcelDate(record.checkIn.time),{type:Date,format:'hh:mm AM/PM',align:'center',fontWeight:'bold'}):cell('',{align:'center'}),record.checkOut?.time?cell(organizationExcelDate(record.checkOut.time),{type:Date,format:'hh:mm AM/PM',align:'center'}):cell('',{align:'center'}),cell(Number(((record.workingMinutes||0)/60).toFixed(2)),{type:Number,format:'0.00',align:'right',fontWeight:'bold'}),cell(record.lateMinutes||0,{type:Number,align:'right',...(record.lateMinutes?{backgroundColor:'#FFF0CC',textColor:'#865D13',fontWeight:'bold'}:{})}),cell(record.halfDayReason||''),
      cell(originalTarget,{type:Number,align:'right'}),cell(adjustedTarget,{type:Number,align:'right'}),cell(fullDayLeave,{align:'center',...(fullDayLeave==='Yes'?{backgroundColor:'#E8F5E9',textColor:'#2E7D32',fontWeight:'bold'}:{})}),cell(halfDayLeave,{align:'center',...(halfDayLeave==='Yes'?{backgroundColor:'#FFF3E0',textColor:'#E65100',fontWeight:'bold'}:{})}),
      cell(record.checkIn?.address||''),cell(record.locationVerified?'Yes':'No',{...(statusCellStyle(record.locationVerified?'verified':'rejected')),align:'center'}),record.biometricVerification?.faceMatchScore==null?cell('',{align:'right'}):cell(record.biometricVerification.faceMatchScore,{type:Number,format:'0.0%',align:'right'}),record.biometricVerification?.livenessScore==null?cell('',{align:'right'}):cell(record.biometricVerification.livenessScore,{type:Number,format:'0.0%',align:'right'}),
    ])
  })
  const columns=[14,22,18,20,14,13,18,16,14,14,15,13,24,16,16,14,14,30,18,15,15].map(width=>({width}))
  const buffer=await writeXlsxFile(sheetData,{sheet:'Attendance Report',columns,stickyRowsCount:4,stickyColumnsCount:2,showGridLines:false,zoomScale:.82},{fontFamily:'Calibri',fontSize:10}).toBuffer()
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
  const missingCheckout=attendance.missingCheckout||{}
  if((!missingCheckout.justificationStatus||missingCheckout.justificationStatus==='none')&&!attendance.missedCheckOut){
    throw new HttpError(409,'Attendance not missing checkout')
  }
  if(attendance.status!=='missing_checkout'||attendance.checkOut?.source!=='system_auto'){
    throw new HttpError(409,'Only system auto-checkout records can be corrected')
  }
  const now=new Date()
  const deadline=missingCheckout.deadline
  if(!deadline||now>=deadline){
    throw new HttpError(422,{code:'DEADLINE_EXPIRED',message:`Justification deadline passed on ${deadline?fmtDDMMYYYY(deadline):'unknown'}`,deadline})
  }
  const employeeFull=await Employee.findById(attendance.employee).select('shift').lean()
  const shiftEnd=employeeFull?.shift?.endTime||'18:30'
  const timeError=validateRequestedCheckoutTime({requestedCheckoutTime:input.requestedCheckoutTime,attendance,shiftEnd})
  if(timeError)throw new HttpError(422,timeError)
  if(await AttendanceCorrectionRequest.exists({attendance:attendance._id,status:'pending'}))throw new HttpError(409,'A correction request is already pending for this record')
  const request=await AttendanceCorrectionRequest.create({
    attendance:attendance._id,
    employee:req.user.employee._id,
    requestedCheckoutTime:input.requestedCheckoutTime,
    reason:input.reason,
    deadline,
    kind:'missing_checkout',
    submittedWithinDeadline:true,
    isHrOverride:false,
    overrideBy:null,
  })
  attendance.missingCheckout=attendance.missingCheckout||{}
  attendance.missingCheckout.justificationStatus='submitted'
  attendance.missingCheckout.justificationRequestId=request._id
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({
    timestamp:new Date(),
    status:'submitted',
    message:`Justification submitted: requested ${fmtHHMM(input.requestedCheckoutTime)} - ${input.reason.substring(0,60)}`,
    actor:'employee',
  })
  await attendance.save()
  const reviewers=await User.find({role:{$in:['hr_admin','admin','super_admin']},isActive:true}).select('_id')
  if(reviewers.length)await Notification.insertMany(reviewers.map(reviewer=>({recipient:reviewer._id,type:'Attendance Correction',title:'Attendance correction requested',message:`${req.user.firstName} ${req.user.lastName} requested a corrected checkout time.`,employee:req.user.employee._id})))
  res.status(201).json({success:true,data:request})
}))

router.post('/:id/correction/override', authorize('hr_admin','admin','super_admin'), asyncHandler(async (req,res)=>{
  if(!['hr_admin','admin','super_admin'].includes(req.user.role))throw new HttpError(403,'Only HR or Admin can override deadline')
  const input=z.object({requestedCheckoutTime:z.coerce.date(),reason:z.string().trim().min(10,'Please provide a detailed correction reason').max(1000),employeeId:z.string().optional()}).parse(req.body)
  const attendance=await Attendance.findById(req.params.id)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  if(attendance.status!=='missing_checkout'||attendance.checkOut?.source!=='system_auto'){
    throw new HttpError(409,'Only system auto-checkout records can be corrected')
  }
  const missingCheckout=attendance.missingCheckout||{}
  const employeeId=input.employeeId||String(attendance.employee)
  const employeeFull=await Employee.findById(attendance.employee).select('shift').lean()
  const shiftEnd=employeeFull?.shift?.endTime||'18:30'
  const timeError=validateRequestedCheckoutTime({requestedCheckoutTime:input.requestedCheckoutTime,attendance,shiftEnd})
  if(timeError)throw new HttpError(422,timeError)
  if(await AttendanceCorrectionRequest.exists({attendance:attendance._id,status:'pending'}))throw new HttpError(409,'A correction request is already pending for this record')
  const now=new Date()
  const deadline=missingCheckout.deadline
  const submittedWithinDeadline=Boolean(deadline&&now<deadline)
  const request=await AttendanceCorrectionRequest.create({
    attendance:attendance._id,
    employee:employeeId,
    requestedCheckoutTime:input.requestedCheckoutTime,
    reason:input.reason,
    deadline,
    kind:'missing_checkout',
    submittedWithinDeadline,
    isHrOverride:true,
    overrideBy:req.user._id,
  })
  attendance.missingCheckout=attendance.missingCheckout||{}
  if(!submittedWithinDeadline){
    attendance.missingCheckout.justificationStatus='submitted'
  }else{
    attendance.missingCheckout.justificationStatus='submitted'
  }
  attendance.missingCheckout.justificationRequestId=request._id
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({
    timestamp:new Date(),
    status:'submitted',
    message:`HR Override: justification submitted ${submittedWithinDeadline?'(within deadline)':'(DEADLINE OVERRIDE)'}: requested ${fmtHHMM(input.requestedCheckoutTime)} - ${input.reason.substring(0,60)}`,
    actor:`hr_override:${req.user._id}`,
  })
  await attendance.save()
  res.status(201).json({success:true,data:request})
}))

router.patch('/corrections/:id/approve', authorize('hr_admin','admin','super_admin'), asyncHandler(async (req,res)=>{
  if(!['hr_admin','admin','super_admin'].includes(req.user.role))throw new HttpError(403,'Only HR or Admin can approve corrections')
  const input=z.object({reviewNote:z.string().trim().max(500).default('')}).parse(req.body)
  const request=await AttendanceCorrectionRequest.findById(req.params.id)
  if(!request||request.status!=='pending')throw new HttpError(409,'This correction request is no longer pending')
  const attendance=await Attendance.findById(request.attendance)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  if(!(request.requestedCheckoutTime>=attendance.checkIn.time)){
    throw new HttpError(422,{code:'CHECKOUT_BEFORE_CHECKIN',message:'Requested checkout time must be after check-in'})
  }
  const actualMinutes=Math.max(0,Math.floor((request.requestedCheckoutTime-attendance.checkIn.time)/60000))
  attendance.workingMinutes=actualMinutes
  const previousCheckoutTime=attendance.checkOut?.time
  attendance.checkOut={
    ...(attendance.checkOut?.toObject?attendance.checkOut.toObject():attendance.checkOut||{}),
    time:request.requestedCheckoutTime,
    source:'hr_correction',
    device:'correction',
    address:'Checkout time approved through attendance correction',
  }
  attendance.checkOut.source='hr_correction'
  await applyAttendanceCompletion(attendance, attendance.employee)
  attendance.missedCheckOut=false
  attendance.status=attendance.autoCheckout?.previousStatus||(attendance.lateMinutes>0?'late':'present')
  attendance.checkoutType='HR_CORRECTION'
  attendance.exceptionStatus=''
  attendance.missingCheckout=attendance.missingCheckout||{}
  attendance.missingCheckout.justificationStatus='approved'
  attendance.missingCheckout.reviewerId=req.user._id
  attendance.missingCheckout.reviewAction='approved'
  attendance.missingCheckout.reviewNote=input.reviewNote||''
  attendance.missingCheckout.workingMinutesRestored=actualMinutes
  attendance.missingCheckout.finalizedAt=new Date()
  attendance.missingCheckout.conversionReason=''
  attendance.missingCheckout.leaveRequestId=null
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({
    timestamp:new Date(),
    status:'approved',
    message:`Correction approved. Working minutes restored: ${actualMinutes}`,
    actor:`hr:${req.user._id}`,
  })
  attendance.correctionAudit.push({
    previousCheckoutTime,
    correctedCheckoutTime:request.requestedCheckoutTime,
    reason:request.reason,
    approvedBy:req.user._id,
    approvedAt:new Date(),
  })
  await attendance.save()
  request.status='approved'
  request.reviewedBy=req.user._id
  request.reviewedAt=new Date()
  request.reviewNote=input.reviewNote
  await request.save()
  const reviewerName=`${req.user.firstName||''} ${req.user.lastName||''}`.trim()
  await sendCorrectionDecisionNotification({employeeId:request.employee,correctionId:request._id,attendance,approved:true,reviewNote:input.reviewNote,reviewerName})
  await invalidateWeeklyAuditKeysForDate(attendance)
  const result=await AttendanceCorrectionRequest.findById(request._id).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes exceptionStatus missingCheckout')
  res.json({success:true,data:result})
}))

router.patch('/corrections/:id/reject', authorize('hr_admin','admin','super_admin'), asyncHandler(async (req,res)=>{
  if(!['hr_admin','admin','super_admin'].includes(req.user.role))throw new HttpError(403,'Only HR or Admin can reject corrections')
  const input=z.object({reviewNote:z.string().trim().min(3,'A rejection reason is required').max(500)}).parse(req.body)
  const request=await AttendanceCorrectionRequest.findById(req.params.id)
  if(!request||request.status!=='pending')throw new HttpError(409,'This correction request is no longer pending')
  const attendance=await Attendance.findById(request.attendance)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  request.status='rejected'
  request.reviewedBy=req.user._id
  request.reviewedAt=new Date()
  request.reviewNote=input.reviewNote
  await request.save()
  await finalizeMissingCheckoutAsLeaveInline({attendance,reason:'Justification rejected',reviewerId:req.user._id})
  attendance.missingCheckout=attendance.missingCheckout||{}
  attendance.missingCheckout.reviewAction='rejected'
  attendance.missingCheckout.reviewerId=req.user._id
  attendance.missingCheckout.reviewNote=input.reviewNote
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({
    timestamp:new Date(),
    status:'rejected',
    message:`Correction rejected by HR. ${input.reviewNote.substring(0,80)}`,
    actor:`hr_reject:${req.user._id}`,
  })
  await attendance.save()
  const reviewerName=`${req.user.firstName||''} ${req.user.lastName||''}`.trim()
  await sendCorrectionDecisionNotification({employeeId:request.employee,correctionId:request._id,attendance,approved:false,reviewNote:input.reviewNote,reviewerName})
  await invalidateWeeklyAuditKeysForDate(attendance)
  const result=await AttendanceCorrectionRequest.findById(request._id).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes exceptionStatus missingCheckout')
  res.json({success:true,data:result})
}))

router.patch('/corrections/:id/reopen', authorize('hr_admin','admin','super_admin'), asyncHandler(async (req,res)=>{
  if(!['hr_admin','admin','super_admin'].includes(req.user.role))throw new HttpError(403,'Only HR or Admin can reopen corrections')
  const input=z.object({reopenReason:z.string().trim().max(500).default('Reopened by HR')}).parse(req.body)
  const request=await AttendanceCorrectionRequest.findById(req.params.id)
  if(!request)throw new HttpError(404,'Correction request not found')
  if(!['approved','rejected'].includes(request.status))throw new HttpError(409,'Only approved or rejected corrections can be reopened')
  const attendance=await Attendance.findById(request.attendance)
  if(!attendance)throw new HttpError(404,'Attendance record not found')
  attendance.missingCheckout=attendance.missingCheckout||{}
  const reviewAction=attendance.missingCheckout.reviewAction
  if(!reviewAction||reviewAction==='none')throw new HttpError(409,'Correction has no review action to reopen')
  attendance.missingCheckout.finalizedAt=undefined
  attendance.missingCheckout.workingMinutesRestored=0
  attendance.missingCheckout.reviewAction='none'
  attendance.missingCheckout.reviewerId=null
  if(attendance.missingCheckout.leaveRequestId){
    if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
    attendance.missingCheckout.history.push({
      timestamp:new Date(),
      status:'reopen_warning',
      message:'Note: A leave request was previously created and may need manual cancellation in the leave module.',
      actor:`hr_reopen:${req.user._id}`,
    })
  }
  if(request.status==='approved'){
    attendance.missingCheckout.justificationStatus='submitted'
  }else{
    attendance.missingCheckout.justificationStatus='submitted'
  }
  attendance.exceptionStatus='Missing Checkout – Justification Reopened'
  attendance.workingMinutes=0
  attendance.completionStatus='exception_pending'
  if(!Array.isArray(attendance.missingCheckout.history))attendance.missingCheckout.history=[]
  attendance.missingCheckout.history.push({
    timestamp:new Date(),
    status:'reopened',
    message:input.reopenReason||'Reopened by HR',
    actor:`hr_reopen:${req.user._id}`,
  })
  await attendance.save()
  request.status='pending'
  request.reviewedBy=null
  request.reviewedAt=null
  request.reviewNote=''
  await request.save()
  await invalidateWeeklyAuditKeysForDate(attendance)
  const result=await AttendanceCorrectionRequest.findById(request._id).populate('employee','firstName lastName employeeCode department').populate('attendance','date checkIn checkOut status autoCheckout workingMinutes exceptionStatus missingCheckout')
  res.json({success:true,data:result})
}))

async function buildMetaPolicyEnvelope() {
  const policy = await getAttendancePolicy()
  return {
    policy: {
      fullDayWorkingMinutes: policy.fullDayWorkingMinutes,
      halfDayWorkingMinutes: policy.halfDayWorkingMinutes,
      lateCutoffHour: policy.lateCutoff.hour,
      lateCutoffMinute: policy.lateCutoff.minute,
      missingCheckoutJustificationDays: policy.missingCheckoutJustificationDays,
    },
  }
}

router.get('/me', asyncHandler(async (req, res) => {
  const { month, year } = req.query
  const filter = { employee: req.user.employee._id }
  if (month && year) { const {start,end}=organizationMonthBoundsFor(Number(year),Number(month));filter.date={$gte:start,$lt:end} }
  const [data, meta] = await Promise.all([
    Attendance.find(filter).sort({ date: -1 }).limit(100),
    buildMetaPolicyEnvelope(),
  ])
  res.json({ success: true, meta, data })
}))
export default router
