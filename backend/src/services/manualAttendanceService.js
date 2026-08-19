import { env } from '../config/env.js'
import { Attendance } from '../models/Attendance.js'
import { FaceAttendanceRequest } from '../models/FaceAttendanceRequest.js'
import { Notification } from '../models/Recruitment.js'
import { OfficeLocation } from '../models/Organization.js'
import { WorkArrangementRequest } from '../models/WorkArrangementRequest.js'
import { User } from '../models/User.js'
import { HttpError } from '../utils/httpError.js'
import { startOfLocalDay } from '../utils/date.js'
import { checkIn, checkOut } from './attendanceService.js'
import { uploadAttendanceProof } from './privateStorageService.js'
import { recordAudit } from './auditService.js'

export const MANUAL_REASONS={CAMERA_PERMISSION_DENIED:'Camera permission denied',CAMERA_NOT_AVAILABLE:'Camera not available',CAMERA_INITIALIZATION_FAILED:'Camera initialization failed',CAMERA_CAPTURE_FAILED:'Camera capture failed',NO_FACE_DETECTED:'No face detected',FACE_NOT_DETECTED:'Face not detected',MULTIPLE_FACES:'Multiple faces detected',POOR_IMAGE_QUALITY:'Poor image quality',LIVENESS_FAILED:'Liveness verification failed',FACE_MATCH_FAILED:'Face match failed',FACE_MISMATCH:'Face mismatch',LOCATION_PERMISSION_DENIED:'Location permission denied',LOCATION_FAILED:'Location failed',NETWORK_FAILED:'Network failed',NETWORK_OR_DEVICE_ERROR:'Network or device error',BIOMETRIC_SERVICE_UNAVAILABLE:'Biometric service unavailable',BROWSER_NOT_SUPPORTED:'Browser not supported',UNKNOWN_ERROR:'Unknown technical error',OTHER:'Other'}

export function normalizeDeviceDetails(details={}){
  return Object.fromEntries(['browser','os','deviceType'].flatMap(key=>typeof details?.[key]==='string'&&details[key].trim()?[[key,details[key].trim().slice(0,80)]]:[]))
}

export function distanceMeters(from,to){
  const rad=value=>value*Math.PI/180,R=6371000,dLat=rad(to.latitude-from.latitude),dLon=rad(to.longitude-from.longitude)
  const a=Math.sin(dLat/2)**2+Math.cos(rad(from.latitude))*Math.cos(rad(to.latitude))*Math.sin(dLon/2)**2
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)))
}
export function approvalTimestamp(request){return new Date(request.requestedAt||request.attemptedAt)}
export function validateFallbackEligibility({reasonCode}){
  if(!MANUAL_REASONS[reasonCode])throw new HttpError(422,'Select a valid manual attendance reason')
  // A manual request never records attendance by itself; it only enters the
  // reviewer queue.  Retry counts and trusted mismatch evidence remain useful
  // audit/risk signals, but they must not make reasons shown in the manual form
  // impossible to submit (notably OTHER and a directly reported face failure).
  return true
}

async function assessLocation(input,employeeId,at){
  const location=input.location
  if(!location){
    if(!env.manualAttendanceAllowLocationException)throw new HttpError(422,'Location is required for manual attendance')
    return {location:{locationVerified:false,geofenceVerified:false},locationVerified:false,riskLevel:'high'}
  }
  if(input.attendanceMode==='office'){
    const offices=await OfficeLocation.find({isActive:true}).lean()
    if(!offices.length)return {location:{...location,locationVerified:false,geofenceVerified:false},locationVerified:false,riskLevel:'high'}
    const office=offices.map(item=>({...item,distanceMeters:distanceMeters(location,item)})).sort((a,b)=>a.distanceMeters-b.distanceMeters)[0]
    const verified=location.accuracyMeters<=office.maximumAccuracyMeters&&Math.max(0,office.distanceMeters-Math.round(location.accuracyMeters))<=office.allowedRadiusMeters
    return {location:{...location,officeLocation:office._id,officeName:office.name,address:office.address||location.address,distanceMeters:office.distanceMeters,locationVerified:verified,geofenceVerified:verified},locationVerified:verified,riskLevel:verified?'normal':'high'}
  }
  const start=startOfLocalDay(at),end=new Date(start);end.setDate(end.getDate()+1);end.setMilliseconds(-1)
  const arrangement=await WorkArrangementRequest.findOne({employee:employeeId,type:input.attendanceMode,status:'approved',startDate:{$lte:end},endDate:{$gte:start}}).lean()
  if(!arrangement)return {location:{...location,locationVerified:false,geofenceVerified:false},locationVerified:false,riskLevel:'high'}
  const destination=arrangement.destination
  if(destination?.latitude==null||destination?.longitude==null){
    const verified=input.attendanceMode==='wfh'&&location.accuracyMeters<=150
    return {location:{...location,arrangement:arrangement._id,officeName:'Approved work from home',locationVerified:verified,geofenceVerified:verified},locationVerified:verified,riskLevel:verified?'normal':'high'}
  }
  const distance=distanceMeters(location,destination),verified=location.accuracyMeters<=150&&Math.max(0,distance-Math.round(location.accuracyMeters))<=(destination.allowedRadiusMeters||250)
  return {location:{...location,arrangement:arrangement._id,address:destination.address||location.address,officeName:arrangement.clientName||destination.name||'Approved destination',distanceMeters:distance,locationVerified:verified,geofenceVerified:verified},locationVerified:verified,riskLevel:verified?'normal':'high'}
}

async function reviewersFor(employee){
  const conditions=[{role:{$in:['super_admin','admin','hr_admin']},isActive:true}]
  if(employee.manager)conditions.push({employee:employee.manager,isActive:true})
  return User.find({$or:conditions}).select('_id email firstName').lean()
}
async function notifyOnce(notification){
  return Notification.findOneAndUpdate({recipient:notification.recipient,dedupeKey:notification.dedupeKey},{$setOnInsert:notification},{upsert:true,new:true})
}

export async function createManualAttendanceRequest({req,input,mismatchProof}){
  const requestedAt=new Date(),employee=req.user.employee
  if(!employee||employee.employeeStatus!=='active')throw new HttpError(409,'An active employee profile is required')
  validateFallbackEligibility({reasonCode:input.reasonCode})
  if(input.reasonCode==='OTHER'&&input.remarks.trim().length<5)throw new HttpError(422,'Remarks are required when reason is Other')
  const date=startOfLocalDay(requestedAt),existingAttendance=await Attendance.findOne({employee:employee._id,date})
  if(input.action==='check_in'&&existingAttendance)throw new HttpError(409,'Attendance is already recorded for today')
  if(input.action==='check_out'&&(!existingAttendance?.checkIn?.time||existingAttendance?.checkOut?.time))throw new HttpError(409,existingAttendance?.checkOut?.time?'Attendance is already completed':'Check in before requesting manual check-out')
  if(existingAttendance&&input.action==='check_out'&&existingAttendance.attendanceMode!==input.attendanceMode)throw new HttpError(409,'Check out using the same attendance mode used at check in')
  if(input.clientRequestId){const repeated=await FaceAttendanceRequest.findOne({requestedBy:req.user._id,clientRequestId:input.clientRequestId});if(repeated)return repeated}
  if(await FaceAttendanceRequest.exists({employee:employee._id,date,action:input.action,status:{$in:['pending','processing']}}))throw new HttpError(409,`A manual ${input.action.replace('_','-')} request is already pending`)
  const locationAssessment=await assessLocation(input,employee._id,requestedAt)
  const proofPhoto=await uploadAttendanceProof(input.proofPhoto,employee._id,input.action)
  const request=await FaceAttendanceRequest.create({employee:employee._id,requestedBy:req.user._id,date,attemptedAt:requestedAt,requestedAt,action:input.action,attendanceMode:input.attendanceMode,...locationAssessment,reasonCode:input.reasonCode,reasonLabel:MANUAL_REASONS[input.reasonCode],remarks:input.remarks,reason:input.remarks||MANUAL_REASONS[input.reasonCode],clientRequestId:input.clientRequestId,ipAddress:req.ip,device:req.get('user-agent'),deviceDetails:normalizeDeviceDetails(input.deviceDetails),faceMatchScore:mismatchProof?.faceMatchScore??input.biometricAttempt?.faceMatchScore,livenessScore:mismatchProof?.livenessScore,biometricAttempt:{...input.biometricAttempt,attempted:Boolean(input.biometricAttempt?.attempts),trusted:Boolean(mismatchProof),photoAvailable:Boolean(proofPhoto),...(proofPhoto&&{proofPhotoStorageKey:proofPhoto.storageKey,proofPhotoFormat:proofPhoto.format,proofPhotoVersion:proofPhoto.version,proofPhotoBytes:proofPhoto.bytes,proofPhotoHash:proofPhoto.hash})}})
  const reviewers=await reviewersFor(employee),employeeName=`${employee.firstName} ${employee.lastName}`.trim()
  await Promise.all(reviewers.filter(item=>String(item._id)!==String(req.user._id)).map(item=>notifyOnce({recipient:item._id,dedupeKey:`manual-attendance:${request._id}:requested`,type:'Manual Attendance Approval',title:`Manual ${input.action.replace('_','-')} approval requested`,message:`${employeeName} requested manual attendance (${request.reasonLabel}).`,employee:employee._id})))
  await recordAudit({req,action:'MANUAL_ATTENDANCE_REQUESTED',entityType:'FaceAttendanceRequest',entityId:request._id,employeeId:employee._id,after:request.toObject(),metadata:{riskLevel:request.riskLevel,reasonCode:request.reasonCode}})
  const monthStart=new Date(requestedAt.getFullYear(),requestedAt.getMonth(),1),count=await FaceAttendanceRequest.countDocuments({employee:employee._id,requestedAt:{$gte:monthStart}})
  if(count>=env.manualAttendanceReviewThreshold){
    const riskReviewers=await User.find({role:{$in:['super_admin','hr_admin','it_admin']},isActive:true}).select('_id').lean()
    await Promise.all(riskReviewers.map(item=>notifyOnce({recipient:item._id,dedupeKey:`manual-attendance:${employee._id}:${monthStart.toISOString()}:threshold`,type:'Biometric Health Alert',title:'Frequent manual attendance fallback',message:`${employeeName} has used manual attendance ${count} times this month.`,employee:employee._id})))
  }
  return request
}

export async function canReview(req,request){
  if(['super_admin','admin','hr_admin'].includes(req.user.role))return true
  return req.user.role==='manager'&&String(request.employee?.manager||'')===String(req.user.employee?._id||'')
}
export async function reviewManualAttendanceRequest({req,id,decision,reviewNote}){
  const current=await FaceAttendanceRequest.findById(id).populate('employee')
  if(!current)throw new HttpError(404,'Manual attendance request not found')
  if(String(current.requestedBy)===String(req.user._id))throw new HttpError(403,'You cannot approve your own attendance request')
  if(!await canReview(req,current))throw new HttpError(403,'You are not an authorized reviewer for this request')
  if(decision==='reject'&&reviewNote.trim().length<3)throw new HttpError(422,'A rejection reason is required')
  const request=await FaceAttendanceRequest.findOneAndUpdate({_id:id,status:'pending'},{$set:{status:'processing'}},{new:true}).populate('employee')
  if(!request)throw new HttpError(409,'This request is no longer pending')
  const before=request.toObject(),approved=decision==='approve'
  try{
    let attendance
    if(approved){
      const payload={attendanceMode:request.attendanceMode,locationVerified:request.locationVerified,location:request.location?.toObject?.()||request.location,source:'manual_fallback',manualRequest:request._id,replaceSystemAutoCheckout:request.action==='check_out',proofPhotoStorageKey:request.biometricAttempt?.proofPhotoStorageKey,biometricVerification:{verified:false,method:'approved_manual_fallback',faceMatchScore:request.faceMatchScore,livenessScore:request.livenessScore,verifiedAt:new Date()}}
      const metadata={ipAddress:request.ipAddress,device:request.device}
      attendance=request.action==='check_in'?await checkIn(request.employee,payload,metadata,approvalTimestamp(request)):await checkOut(request.employee,payload,metadata,approvalTimestamp(request))
      request.attendance=attendance._id
    }
    request.status=approved?'approved':'rejected';request.reviewedBy=req.user._id;request.reviewedAt=new Date();request.reviewNote=reviewNote;await request.save()
  }catch(error){await FaceAttendanceRequest.updateOne({_id:id,status:'processing'},{$set:{status:'pending'}});throw error}
  const employeeUser=await User.findOne({employee:request.employee._id,isActive:true}).select('_id').lean()
  if(employeeUser)await notifyOnce({recipient:employeeUser._id,dedupeKey:`manual-attendance:${request._id}:${request.status}`,type:`Manual Attendance ${approved?'Approved':'Rejected'}`,title:`Manual ${request.action.replace('_','-')} ${request.status}`,message:reviewNote||(approved?'Your attendance was recorded at the original server request time.':'Your request was rejected.'),employee:request.employee._id})
  await recordAudit({req,action:`MANUAL_ATTENDANCE_${request.status.toUpperCase()}`,entityType:'FaceAttendanceRequest',entityId:request._id,employeeId:request.employee._id,before,after:request.toObject(),metadata:{decision,reviewNote}})
  return request
}
