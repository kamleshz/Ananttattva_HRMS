import { AuditLog } from '../models/AuditLog.js'

const scrub=value=>{
  if(!value||typeof value!=='object')return value
  if(Array.isArray(value))return value.map(scrub)
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['photo','template','biometricTemplate','embedding','pdfData','otpHash'].includes(key)).map(([key,item])=>[key,scrub(item)]))
}

export async function recordAudit({req,action,entityType,entityId,employeeId,before,after,metadata}){
  await AuditLog.create({
    actorUserId:req?.user?._id||null,actorEmployeeId:req?.user?.employee?._id||null,role:req?.user?.role,
    action,entityType,entityId:String(entityId),beforeSnapshot:scrub(before),afterSnapshot:scrub(after),metadata:scrub(metadata),
    ip:req?.ip,userAgent:req?.get?.('user-agent'),requestId:req?.get?.('x-request-id'),timestamp:new Date(),
    ...(employeeId&&{metadata:{...scrub(metadata),employeeId:String(employeeId)}}),
  })
}
