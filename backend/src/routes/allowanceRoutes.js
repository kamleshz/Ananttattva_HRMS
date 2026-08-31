import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { AllowanceClaim } from '../models/AllowanceClaim.js'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { allocateMonthlyAllowance, allowanceMonthKey, allowanceMonthRange, allowanceSubmissionDeadline, currency } from '../services/allowancePolicyService.js'
import writeXlsxFile from 'write-excel-file/node'
import { ATTENDANCE_REPORT_THEME, reportCell, reportHeaderRow, reportSectionRow, statusCellStyle } from '../utils/excelReportStyle.js'

const router=Router()
router.use(authenticate)
const proofSchema=z.object({fileName:z.string().min(1).max(150),mimeType:z.enum(['image/jpeg','image/png','image/webp','application/pdf']),data:z.string().min(20).max(4_000_000)})
const claimSchema=z.object({
  travelDate:z.coerce.date(),
  travelLocation:z.string().trim().min(2,'Enter at least 2 characters for travel location').max(200),
  travelAllowance:z.number().min(0).max(1000000),
  extraAllowance:z.number().min(0).max(1000000).default(0),
  extraAllowanceReason:z.string().trim().max(500).default(''),
  proof:proofSchema,
}).superRefine((input,ctx)=>{
  if(input.extraAllowance>0&&input.extraAllowanceReason.length<3){
    ctx.addIssue({code:'custom',path:['extraAllowanceReason'],message:'Please explain the extra allowance'})
  }
})
router.get('/', asyncHandler(async (req,res) => {
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
  const filter=elevated&&req.query.scope==='all'?{}:{employee:req.user.employee?._id}
  const claims=await AllowanceClaim.find(filter).populate('employee','firstName lastName employeeCode department').sort({createdAt:-1}).limit(100)
  res.json({success:true,data:claims})
}))
async function getMonthlyUsage(date,employeeId){
  const {start,end}=allowanceMonthRange(date)
  const [usage]=await AllowanceClaim.aggregate([
    {$match:{employee:employeeId,travelDate:{$gte:start,$lt:end},status:{$in:['pending','approved']}}},
    {$group:{_id:null,total:{$sum:{$ifNull:['$capAcceptableAmount',{$ifNull:['$acceptableAmount','$totalAmount']}]}}}},
  ])
  return currency(usage?.total||0)
}
router.get('/monthly-usage', asyncHandler(async (req,res) => {
  if(!req.user.employee)throw new HttpError(409,'No employee profile is linked to this account')
  const date=z.coerce.date().parse(req.query.date)
  const used=await getMonthlyUsage(date,req.user.employee._id)
  res.json({success:true,data:{limit:2000,used,remaining:currency(Math.max(0,2000-used))}})
}))
router.get('/export', authorize('super_admin','admin','hr_admin'), asyncHandler(async (_req,res) => {
  const claims=await AllowanceClaim.find({}).populate('employee','firstName lastName employeeCode department').sort({travelDate:-1,createdAt:-1}).lean()
  const headers=['Employee ID','Employee Name','Department','Travel Date','Travel Location','Travel Allowance','Extra Allowance','Extra Details','Total','Acceptable','Not Acceptable','Claim Status','Special Approval']
  const theme=ATTENDANCE_REPORT_THEME,empty=Array(headers.length).fill(null)
  const data=[[{value:'AT Connect – All Employee Allowances',columnSpan:headers.length,fontWeight:'bold',fontSize:18,textColor:'#FFFFFF',backgroundColor:theme.title,height:34,alignVertical:'center'},...empty.slice(1)],[{value:`Generated ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date())} · ${claims.length} records`,columnSpan:headers.length,fontStyle:'italic',fontSize:10,textColor:theme.subtitleText,backgroundColor:theme.subtitle,height:24,alignVertical:'center'},...empty.slice(1)],reportSectionRow([{label:'EMPLOYEE',span:3},{label:'CLAIM DETAILS',span:6},{label:'ALLOWANCE DECISION',span:4}],theme),reportHeaderRow(headers,[3,6,4],theme)]
  claims.forEach((claim,index)=>{const employee=claim.employee||{},cell=(value,extra={})=>reportCell(value,index,theme,extra);data.push([cell(employee.employeeCode||'',{fontWeight:'bold',textColor:theme.accent}),cell(`${employee.firstName||''} ${employee.lastName||''}`.trim(),{fontWeight:'bold'}),cell(employee.department||''),cell(claim.travelDate,{type:Date,format:'dd-mmm-yyyy',align:'center'}),cell(claim.travelLocation),cell(claim.travelAllowance,{type:Number,format:'₹#,##0.00',align:'right'}),cell(claim.extraAllowance,{type:Number,format:'₹#,##0.00',align:'right'}),cell(claim.extraAllowanceReason||''),cell(claim.totalAmount,{type:Number,format:'₹#,##0.00',align:'right',fontWeight:'bold'}),cell(claim.acceptableAmount??claim.totalAmount,{type:Number,format:'₹#,##0.00',align:'right',backgroundColor:'#E2F3E8',textColor:'#25633F'}),cell(claim.nonAcceptableAmount||0,{type:Number,format:'₹#,##0.00',align:'right',...((claim.nonAcceptableAmount||0)>0?{backgroundColor:'#FBE1E5',textColor:'#96394B'}:{})}),cell(claim.status,statusCellStyle(claim.status)),cell(claim.specialApproval?.status||'not requested',statusCellStyle(claim.specialApproval?.status))])})
  const columns=[14,23,18,15,30,17,17,32,16,16,18,16,18].map(width=>({width})),buffer=await writeXlsxFile(data,{sheet:'Employee Allowances',columns,stickyRowsCount:4,stickyColumnsCount:2,showGridLines:false,zoomScale:.85},{fontFamily:'Calibri',fontSize:10}).toBuffer()
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="AT_Connect_All_Employee_Allowances.xlsx"');res.send(Buffer.from(buffer))
}))
router.post('/', asyncHandler(async (req,res) => {
  if(!req.user.employee)throw new HttpError(409,'No employee profile is linked to this account')
  const input=claimSchema.parse(req.body)
  const deadline=allowanceSubmissionDeadline(input.travelDate)
  if(new Date()>deadline)throw new HttpError(422,`The submission deadline for this allowance month was ${deadline.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'})}`)
  const totalAmount=currency(input.travelAllowance+input.extraAllowance)
  const monthlyUsed=await getMonthlyUsage(input.travelDate,req.user.employee._id)
  const allocation=allocateMonthlyAllowance(monthlyUsed,totalAmount)
  const claim=await AllowanceClaim.create({...input,totalAmount,...allocation,capAcceptableAmount:allocation.acceptableAmount,allowanceMonth:allowanceMonthKey(input.travelDate),employee:req.user.employee._id})
  const safeClaim=claim.toObject();delete safeClaim.proof.data
  res.status(201).json({success:true,data:safeClaim})
}))
router.get('/:id/proof', asyncHandler(async (req,res) => {
  const claim=await AllowanceClaim.findById(req.params.id).select('+proof.data')
  if(!claim)throw new HttpError(404,'Allowance claim not found')
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
  if(!elevated&&String(claim.employee)!==String(req.user.employee?._id))throw new HttpError(403,'You cannot view this proof')
  res.json({success:true,data:claim.proof})
}))
router.post('/:id/special-approval', asyncHandler(async (req,res) => {
  const input=z.object({explanation:z.string().trim().min(10,'Please provide a detailed explanation').max(1000),proof:proofSchema}).parse(req.body)
  const claim=await AllowanceClaim.findById(req.params.id)
  if(!claim)throw new HttpError(404,'Allowance claim not found')
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
  if(!elevated&&String(claim.employee)!==String(req.user.employee?._id))throw new HttpError(403,'You cannot request special approval for this claim')
  if((claim.nonAcceptableAmount||0)<=0)throw new HttpError(409,'This claim has no amount requiring special approval')
  if(claim.specialApproval?.status==='pending')throw new HttpError(409,'A special approval request is already pending')
  claim.specialApproval={status:'pending',amount:currency(claim.nonAcceptableAmount),explanation:input.explanation,proof:input.proof,requestedBy:req.user._id,requestedAt:new Date(),reviewedBy:null,reviewedAt:null,reviewNote:''}
  await claim.save()
  const recipients=await User.find({role:{$in:['hr_admin','admin','super_admin']},isActive:true}).select('_id')
  if(recipients.length)await Notification.insertMany(recipients.map(recipient=>({recipient:recipient._id,type:'Allowance Special Approval',title:'Special allowance approval requested',message:`A special approval of ₹${claim.specialApproval.amount.toLocaleString('en-IN')} requires review.`,employee:claim.employee})))
  const result=claim.toObject();if(result.specialApproval?.proof)delete result.specialApproval.proof.data
  res.status(201).json({success:true,data:result})
}))
router.get('/:id/special-approval/proof', asyncHandler(async (req,res) => {
  const claim=await AllowanceClaim.findById(req.params.id).select('+specialApproval.proof.data')
  if(!claim)throw new HttpError(404,'Allowance claim not found')
  const elevated=['super_admin','admin','hr_admin'].includes(req.user.role)
  if(!elevated&&String(claim.employee)!==String(req.user.employee?._id))throw new HttpError(403,'You cannot view this proof')
  if(!claim.specialApproval?.proof?.data)throw new HttpError(404,'Special approval proof not found')
  res.json({success:true,data:claim.specialApproval.proof})
}))
router.patch('/:id/special-approval/:decision', authorize('super_admin','hr_admin'), asyncHandler(async (req,res) => {
  if(!['approve','reject'].includes(req.params.decision))throw new HttpError(400,'Invalid special approval decision')
  const input=z.object({reviewNote:z.string().trim().max(500).default('')}).parse(req.body)
  const claim=await AllowanceClaim.findById(req.params.id)
  if(!claim)throw new HttpError(404,'Allowance claim not found')
  if(claim.specialApproval?.status!=='pending')throw new HttpError(409,'This special approval request is no longer pending')
  if(req.params.decision==='reject'&&input.reviewNote.length<3)throw new HttpError(422,'A rejection reason is required')
  const approved=req.params.decision==='approve'
  const amount=currency(Math.min(claim.specialApproval.amount||0,claim.nonAcceptableAmount||0))
  claim.specialApproval.status=approved?'approved':'rejected'
  claim.specialApproval.reviewedBy=req.user._id
  claim.specialApproval.reviewedAt=new Date()
  claim.specialApproval.reviewNote=input.reviewNote
  if(approved){
    claim.acceptableAmount=currency((claim.acceptableAmount??claim.totalAmount)+amount)
    claim.nonAcceptableAmount=currency(Math.max(0,(claim.nonAcceptableAmount||0)-amount))
  }
  await claim.save()
  if(claim.specialApproval.requestedBy)await Notification.create({recipient:claim.specialApproval.requestedBy,type:`Allowance Special Approval ${approved?'Approved':'Rejected'}`,title:`Special allowance ${approved?'approved':'rejected'}`,message:input.reviewNote||`₹${amount.toLocaleString('en-IN')} was approved as acceptable.`,employee:claim.employee})
  const result=claim.toObject();if(result.specialApproval?.proof)delete result.specialApproval.proof.data
  res.json({success:true,data:result})
}))
router.patch('/:id/:decision', authorize('super_admin','hr_admin','manager'), asyncHandler(async (req,res) => {
  if(!['approve','reject'].includes(req.params.decision))throw new HttpError(400,'Invalid review decision')
  const claim=await AllowanceClaim.findById(req.params.id)
  if(!claim)throw new HttpError(404,'Allowance claim not found')
  if(claim.status!=='pending')throw new HttpError(409,'This claim has already been reviewed')
  claim.status=req.params.decision==='approve'?'approved':'rejected';claim.reviewedBy=req.user._id;claim.reviewedAt=new Date();claim.reviewNote=String(req.body.reviewNote||'')
  await claim.save();res.json({success:true,data:claim})
}))
export default router
