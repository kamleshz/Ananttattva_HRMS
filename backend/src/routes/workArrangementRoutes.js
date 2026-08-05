import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Employee } from '../models/Employee.js'
import { WorkArrangementRequest } from '../models/WorkArrangementRequest.js'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'

const router=Router()
router.use(authenticate)
async function resolveEmployee(req,{link=false}={}){
  if(req.user.employee?._id)return req.user.employee
  const employee=await Employee.findOne({officialEmail:req.user.email,employeeStatus:{$in:['active','notice_period']}})
  if(employee&&link){
    await Promise.all([User.updateOne({_id:req.user._id},{$set:{employee:employee._id}}),Employee.updateOne({_id:employee._id},{$set:{user:req.user._id}})])
    req.user.employee=employee
  }
  return employee
}
const arrangementInput=z.object({
  type:z.enum(['wfh','client_location','field_visit']),
  startDate:z.coerce.date(),endDate:z.coerce.date(),
  startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('00:00'),
  endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('23:59'),
  reason:z.string().trim().min(10).max(1000),
  clientName:z.string().trim().max(150).optional().or(z.literal('')),
  destination:z.object({name:z.string().trim().max(150).optional(),address:z.string().trim().max(500).optional(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),allowedRadiusMeters:z.number().min(25).max(10000).default(250)}).optional(),
  proof:z.object({fileName:z.string().max(200),mimeType:z.enum(['application/pdf','image/jpeg','image/png','image/webp']),data:z.string().max(4_500_000)}).optional(),
})

router.get('/',asyncHandler(async(req,res)=>{
  const currentEmployee=await resolveEmployee(req)
  const elevated=['super_admin','hr_admin'].includes(req.user.role)
  let filter=elevated&&req.query.scope==='all'?{}:{employee:currentEmployee?._id}
  if(req.user.role==='manager'&&req.query.scope==='team'){
    const reports=await Employee.find({manager:currentEmployee?._id}).distinct('_id')
    filter={employee:{$in:reports}}
  }
  const items=await WorkArrangementRequest.find(filter).populate('employee','employeeCode firstName lastName department designation').populate('reviewedBy','firstName lastName').sort({createdAt:-1}).limit(200)
  res.json({success:true,data:items})
}))

router.get('/today',asyncHandler(async(req,res)=>{
  const currentEmployee=await resolveEmployee(req)
  if(!currentEmployee)return res.json({success:true,data:{modes:['office'],requests:[]}})
  const now=new Date(),dayStart=new Date(now);dayStart.setHours(0,0,0,0);const dayEnd=new Date(now);dayEnd.setHours(23,59,59,999)
  const requests=await WorkArrangementRequest.find({employee:currentEmployee._id,status:'approved',startDate:{$lte:dayEnd},endDate:{$gte:dayStart}}).select('type startTime endTime clientName destination').lean()
  res.json({success:true,data:{modes:['office',...new Set(requests.map(item=>item.type))],requests}})
}))

router.post('/',asyncHandler(async(req,res)=>{
  const currentEmployee=await resolveEmployee(req,{link:true})
  if(!currentEmployee)throw new HttpError(409,'No active employee profile matches this account email. Ask HR to link the account')
  const input=arrangementInput.parse(req.body)
  input.startDate.setHours(0,0,0,0)
  input.endDate.setHours(23,59,59,999)
  if(input.endDate<input.startDate)throw new HttpError(422,'End date must be on or after the start date')
  if(input.endTime<=input.startTime&&input.startDate.toDateString()===input.endDate.toDateString())throw new HttpError(422,'End time must be after start time')
  if(!input.destination)throw new HttpError(422,'Capture the approved attendance location before submitting')
  if(input.type!=='wfh'&&!input.clientName)throw new HttpError(422,'Client or visit name is required for travel attendance')
  const overlap=await WorkArrangementRequest.exists({employee:currentEmployee._id,status:{$in:['pending','approved']},startDate:{$lte:input.endDate},endDate:{$gte:input.startDate}})
  if(overlap)throw new HttpError(409,'A pending or approved work arrangement already covers these dates')
  const request=await WorkArrangementRequest.create({...input,employee:currentEmployee._id})
  const reviewerFilters=[{role:{$in:['hr_admin','super_admin']}}]
  if(currentEmployee.manager)reviewerFilters.push({employee:currentEmployee.manager})
  const reviewers=await User.find({isActive:true,$or:reviewerFilters}).select('_id')
  if(reviewers.length)await Notification.insertMany(reviewers.map(reviewer=>({recipient:reviewer._id,type:'Work Arrangement',title:'Work arrangement approval required',message:`${req.user.firstName} ${req.user.lastName} requested ${input.type.replaceAll('_',' ')} attendance.`,employee:currentEmployee._id})))
  res.status(201).json({success:true,data:request})
}))

router.patch('/:id/:decision',authorize('super_admin','hr_admin','manager'),asyncHandler(async(req,res)=>{
  const currentEmployee=await resolveEmployee(req)
  if(!['approve','reject'].includes(req.params.decision))throw new HttpError(400,'Invalid approval decision')
  const input=z.object({reviewNote:z.string().trim().max(500).default('')}).parse(req.body)
  if(req.params.decision==='reject'&&input.reviewNote.length<3)throw new HttpError(422,'A rejection reason is required')
  const request=await WorkArrangementRequest.findById(req.params.id).populate('employee','firstName lastName manager')
  if(!request||request.status!=='pending')throw new HttpError(409,'This work arrangement is no longer pending')
  if(req.user.role==='manager'&&String(request.employee?.manager)!==String(currentEmployee?._id))throw new HttpError(403,'You can only review requests from your direct reports')
  request.status=req.params.decision==='approve'?'approved':'rejected';request.reviewedBy=req.user._id;request.reviewedAt=new Date();request.reviewNote=input.reviewNote;await request.save()
  const employeeUser=await User.findOne({employee:request.employee._id,isActive:true}).select('_id')
  if(employeeUser)await Notification.create({recipient:employeeUser._id,type:`Work Arrangement ${request.status}`,title:`Work arrangement ${request.status}`,message:input.reviewNote||`Your ${request.type.replaceAll('_',' ')} request was ${request.status}.`,employee:request.employee._id})
  res.json({success:true,data:request})
}))

export default router
