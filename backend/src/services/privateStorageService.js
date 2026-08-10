import { createHash } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'

const configured=()=>Boolean(env.cloudinaryCloudName&&env.cloudinaryApiKey&&env.cloudinaryApiSecret)

function configure(){
  if(!configured())throw new HttpError(503,'Private attendance proof storage is not configured')
  cloudinary.config({cloud_name:env.cloudinaryCloudName,api_key:env.cloudinaryApiKey,api_secret:env.cloudinaryApiSecret,secure:true})
}

export async function uploadAttendanceProof(dataUri,employeeId,action){
  if(!dataUri)return null
  configure()
  const result=await cloudinary.uploader.upload(dataUri,{resource_type:'image',type:'authenticated',folder:`at-connect/attendance-proof/${employeeId}`,public_id:`${Date.now()}-${action}`,overwrite:false,unique_filename:true})
  return {storageKey:result.public_id,format:result.format,version:result.version,bytes:result.bytes,hash:createHash('sha256').update(dataUri).digest('hex')}
}

export async function fetchAttendanceProof(proof){
  configure()
  const metadata=proof?.biometricAttempt||proof
  if(!metadata?.proofPhotoStorageKey)throw new HttpError(404,'Attendance proof photo is not available')
  const url=cloudinary.url(metadata.proofPhotoStorageKey,{resource_type:'image',type:'authenticated',sign_url:true,secure:true,version:metadata.proofPhotoVersion,format:metadata.proofPhotoFormat})
  const response=await fetch(url)
  if(!response.ok)throw new HttpError(502,'Unable to load the private attendance proof')
  return {buffer:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')||'image/jpeg'}
}
