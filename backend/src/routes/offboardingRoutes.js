import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { Asset, AssetAssignment, ExitCase, assetTypes } from '../models/Offboarding.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { OrganizationProfile } from '../models/Organization.js'
import { AuditLog } from '../models/AuditLog.js'
import { recordAudit } from '../services/auditService.js'
import { calculateFinance, deriveExitStatus, generateExitPdf, notifyUsers, otpHash, usersByRoles } from '../services/offboardingService.js'
import { sendGraphEmail } from '../services/mailService.js'
import { env } from '../config/env.js'

const router=Router(),hrRoles=['hr_admin','admin','super_admin'],assetRoles=['it_admin','hr_admin','admin','super_admin']
const itRequired=['microsoft365','outlookMailbox','atConnect','vpn','sharedFolders','cloudStorage','thirdPartyApps','apiCredentials','mfaSessions','companySim','companyMobile','localAdmin','dataBackupVerified']
const hrRequired=['resignationAccepted','noticePeriodVerified','lastWorkingDateConfirmed','managerClearanceCompleted','itClearanceCompleted','assetClearanceCompleted','financeClearanceCompleted','leaveBalanceVerified','attendanceVerified','ndaConfidentialityReminder','fullAndFinalInitiated','employeeDocumentsCompleted']
router.use(authenticate)
const id=z.string().regex(/^[a-f\d]{24}$/i,'Invalid identifier')
const text=max=>z.string().trim().max(max).default('')
const reviewInput=z.object({status:z.enum(['cleared','action_required','rejected']),comments:text(2000),checklist:z.record(z.string(),z.boolean()).optional()})

function canView(req,item){
  if(['super_admin','admin','hr_admin','it_admin','finance_admin'].includes(req.user.role))return true
  if(String(item.employee)===String(req.user.employee?._id))return true
  return req.user.role==='manager'&&String(item.manager)===String(req.user.employee?._id)
}
async function findCase(req,{pdf=false,secrets=false}={}){
  let query=ExitCase.findById(req.params.id)
  if(pdf)query=query.select('+finalDocument.pdfData')
  if(secrets)query=query.select('+acknowledgement.otpHash +acknowledgement.otpExpiresAt +acknowledgement.otpAttempts')
  const item=await query
  if(!item)throw new HttpError(404,'Exit case not found')
  if(!canView(req,item))throw new HttpError(403,'You cannot access this exit case')
  return item
}
const snapshot=item=>item.toObject({depopulate:true})
async function audit(req,item,action,before,metadata){await recordAudit({req,action,entityType:'ExitCase',entityId:item._id,employeeId:item.employee,before,after:snapshot(item),metadata})}
async function refreshStatus(item){item.status=deriveExitStatus(item);await item.save()}
function assertMutable(item){if(['exit_cleared','separated','cancelled'].includes(item.status)||item.finalDocument?.sha256)throw new HttpError(409,'This finalized exit record is immutable')}
function safeCaseForRole(item,role){
  const value=item.toObject?item.toObject():structuredClone(item)
  delete value.employeeSnapshot?.personalEmail
  if(role==='finance_admin'){delete value.handover;delete value.managerChecklist;delete value.it;delete value.hrChecklist;delete value.acknowledgement;value.assetReturns=(value.assetReturns||[]).map(asset=>({_id:asset._id,assetCode:asset.assetCode,assetType:asset.assetType,returnStatus:asset.returnStatus,proposedRecoveryAmount:asset.proposedRecoveryAmount,financeApprovedRecoveryAmount:asset.financeApprovedRecoveryAmount}))}
  if(role==='it_admin'){delete value.finance;delete value.hrChecklist;delete value.acknowledgement}
  if(role==='manager'){delete value.finance;delete value.it;delete value.hrChecklist;delete value.acknowledgement;value.assetReturns=(value.assetReturns||[]).map(asset=>({_id:asset._id,assetCode:asset.assetCode,assetType:asset.assetType,returnStatus:asset.returnStatus}))}
  return value
}

router.get('/dashboard',asyncHandler(async(req,res)=>{
  const filter=req.user.role==='employee'?{employee:req.user.employee?._id}:req.user.role==='manager'?{manager:req.user.employee?._id}:{}
  const [items,counts]=await Promise.all([ExitCase.find(filter).select('-handover.attachments.data').populate('manager','firstName lastName employeeCode').sort({lastWorkingDate:1}).limit(300).lean(),ExitCase.aggregate([{$match:filter},{$group:{_id:'$status',count:{$sum:1}}}])])
  const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1),monthEnd=new Date(now.getFullYear(),now.getMonth()+1,1)
  const summaries=items.map(item=>({_id:item._id,exitId:item.exitId,employee:item.employee,employeeSnapshot:{employeeCode:item.employeeSnapshot.employeeCode,firstName:item.employeeSnapshot.firstName,lastName:item.employeeSnapshot.lastName,department:item.employeeSnapshot.department,designation:item.employeeSnapshot.designation},manager:item.manager,resignationDate:item.resignationDate,lastWorkingDate:item.lastWorkingDate,exitType:item.exitType,status:item.status,managerReview:{status:item.managerReview?.status},assetClearance:{status:item.assetClearance?.status},itClearance:{status:item.itClearance?.status},financeClearance:{status:item.financeClearance?.status},hrClearance:{status:item.hrClearance?.status},management:{status:item.management?.status}}))
  res.json({success:true,data:{items:summaries,counts:Object.fromEntries(counts.map(row=>[row._id,row.count])),summary:{servingNotice:items.filter(item=>!['separated','cancelled'].includes(item.status)).length,exitsThisMonth:items.filter(item=>new Date(item.lastWorkingDate)>=monthStart&&new Date(item.lastWorkingDate)<monthEnd).length,overdue:items.filter(item=>!['separated','cancelled'].includes(item.status)&&new Date(item.lastWorkingDate)<now).length}}})
}))

router.get('/assets',authorize(...assetRoles),asyncHandler(async(_req,res)=>res.json({success:true,data:{assets:await Asset.find().sort({assetCode:1}).lean(),assignments:await AssetAssignment.find({isActive:true}).populate('asset').populate('employee','employeeCode firstName lastName').sort({assignedDate:-1}).lean(),employees:await Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('employeeCode firstName lastName').sort({firstName:1,lastName:1}).lean()}})))
router.post('/assets',authorize(...assetRoles),asyncHandler(async(req,res)=>{
  const input=z.object({assetCode:z.string().trim().min(2).max(60),assetType:z.enum(assetTypes),brand:text(100),model:text(100),serialNumber:text(150),location:text(150),notes:text(1000)}).parse(req.body)
  const item=await Asset.create({...input,createdBy:req.user._id});await recordAudit({req,action:'ASSET_CREATED',entityType:'Asset',entityId:item._id,after:item.toObject()});res.status(201).json({success:true,data:item})
}))
router.post('/assets/:id/assign',authorize(...assetRoles),asyncHandler(async(req,res)=>{
  const input=z.object({employeeId:id,conditionAtAssignment:z.enum(['excellent','good','fair','damaged']).default('good'),accessories:z.array(z.string().trim().max(80)).max(30).default([]),remarks:text(1000)}).parse(req.body)
  const asset=await Asset.findById(req.params.id);if(!asset)throw new HttpError(404,'Asset not found');if(asset.status!=='available')throw new HttpError(409,'Only an available asset can be assigned')
  const employee=await Employee.findById(input.employeeId);if(!employee)throw new HttpError(404,'Employee not found')
  const assignment=await AssetAssignment.create({asset:asset._id,employee:employee._id,...input,assignedBy:req.user._id});asset.status='assigned';await asset.save();await recordAudit({req,action:'ASSET_ASSIGNED',entityType:'AssetAssignment',entityId:assignment._id,employeeId:employee._id,after:assignment.toObject()});res.status(201).json({success:true,data:assignment})
}))

router.post('/cases',authorize(...hrRoles),asyncHandler(async(req,res)=>{
  const input=z.object({employeeId:id,resignationDate:z.coerce.date(),lastWorkingDate:z.coerce.date(),exitType:z.enum(['resignation','termination','retirement','contract_completion','absconding','transfer','other']),noticePeriodDays:z.number().int().min(0).max(365).default(0),exitReason:z.string().trim().min(5).max(2000)}).parse(req.body)
  if(input.lastWorkingDate<input.resignationDate)throw new HttpError(422,'Last working date cannot be before resignation date')
  const employee=await Employee.findById(input.employeeId);if(!employee)throw new HttpError(404,'Employee not found')
  if(await ExitCase.exists({employee:employee._id,status:{$nin:['cancelled','separated']}}))throw new HttpError(409,'An active exit case already exists for this employee')
  const assignments=await AssetAssignment.find({employee:employee._id,isActive:true}).populate('asset').lean(),year=new Date().getFullYear(),unique=`${Date.now().toString().slice(-7)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  const item=await ExitCase.create({exitId:`EXIT-${year}-${unique}`,employee:employee._id,manager:employee.manager,employeeSnapshot:{employeeCode:employee.employeeCode,firstName:employee.firstName,lastName:employee.lastName,officialEmail:employee.officialEmail,personalEmail:employee.personalEmail,department:employee.department,designation:employee.designation,managerId:employee.manager,joiningDate:employee.joiningDate,workLocation:employee.workLocation},...input,employee:employee._id,initiatedBy:req.user._id,managerReview:{status:'waiting'},assetClearance:{status:assignments.length?'waiting':'pending'},itClearance:{status:'waiting'},financeClearance:{status:'waiting'},hrClearance:{status:'waiting'},assetReturns:assignments.map(row=>({assignment:row._id,asset:row.asset?._id,assetCode:row.asset?.assetCode,assetType:row.asset?.assetType,brand:row.asset?.brand,model:row.asset?.model,serialNumber:row.asset?.serialNumber,assignedDate:row.assignedDate}))})
  if(input.exitType==='resignation')await Employee.updateOne({_id:employee._id},{$set:{employeeStatus:'notice_period'}})
  const employeeUser=await User.findOne({employee:employee._id}).select('_id'),managerUser=employee.manager?await User.findOne({employee:employee.manager}).select('_id'):null
  await notifyUsers([employeeUser?._id,managerUser?._id],{type:'Exit initiated',title:'Employee exit workflow initiated',message:`${item.exitId} has been initiated. Last working date: ${input.lastWorkingDate.toLocaleDateString('en-IN')}.`,employee:employee._id,dedupeKey:`exit-initiated:${item._id}`});await audit(req,item,'EXIT_CASE_INITIATED',null,{assignmentCount:assignments.length});res.status(201).json({success:true,data:item})
}))

router.get('/cases/:id',asyncHandler(async(req,res)=>{const item=await findCase(req);await item.populate([{path:'managerReview.reviewedBy',select:'firstName lastName'},{path:'assetClearance.reviewedBy',select:'firstName lastName'},{path:'itClearance.reviewedBy',select:'firstName lastName'},{path:'financeClearance.reviewedBy',select:'firstName lastName'},{path:'hrClearance.reviewedBy',select:'firstName lastName'}]);res.json({success:true,data:safeCaseForRole(item,req.user.role)})}))
router.get('/cases/:id/timeline',asyncHandler(async(req,res)=>{const item=await findCase(req);res.json({success:true,data:await AuditLog.find({entityType:'ExitCase',entityId:String(item._id)}).select('action timestamp actorUserId role').populate('actorUserId','firstName lastName role').sort({timestamp:1}).lean()})}))
router.put('/cases/:id/handover',asyncHandler(async(req,res)=>{
  const item=await findCase(req);if(String(item.employee)!==String(req.user.employee?._id)&&!hrRoles.includes(req.user.role))throw new HttpError(403,'Only the employee or HR can update handover')
  if(['management_approval_pending','employee_acknowledgement_pending','exit_cleared','separated','cancelled'].includes(item.status))throw new HttpError(409,'Handover can no longer be edited')
  const input=z.object({currentResponsibilities:text(5000),pendingTasks:text(5000),projects:text(5000),clientResponsibilities:text(5000),vendorResponsibilities:text(5000),pendingQuotations:text(3000),pendingInvoices:text(3000),pendingApprovals:text(3000),importantDeadlines:text(3000),importantFiles:text(3000),processDocumentation:text(5000),replacementEmployee:id.optional().or(z.literal('')),knowledgeTransferStatus:z.enum(['not_started','in_progress','completed']),additionalNotes:text(5000),submit:z.boolean().default(false)}).parse(req.body),before=snapshot(item)
  Object.assign(item.handover,input);if(input.replacementEmployee)item.handover.replacementEmployee=input.replacementEmployee;if(input.submit){if(!input.currentResponsibilities&&!input.pendingTasks)throw new HttpError(422,'Document responsibilities or pending tasks before submission');item.handover.submittedAt=new Date();item.managerReview.status='pending'}
  await refreshStatus(item);await audit(req,item,input.submit?'EXIT_HANDOVER_SUBMITTED':'EXIT_HANDOVER_UPDATED',before);res.json({success:true,data:item})
}))

router.patch('/cases/:id/manager-review',authorize('manager','hr_admin','admin','super_admin'),asyncHandler(async(req,res)=>{
  const item=await findCase(req);if(req.user.role==='manager'&&String(item.manager)!==String(req.user.employee?._id))throw new HttpError(403,'Managers may review only direct reports');if(!item.handover?.submittedAt)throw new HttpError(409,'Employee handover has not been submitted')
  assertMutable(item)
  const input=reviewInput.parse(req.body),before=snapshot(item);Object.assign(item.managerReview,{status:input.status,comments:input.comments,reviewedBy:req.user._id,reviewedAt:new Date()});if(input.checklist)item.managerChecklist=input.checklist
  if(input.status==='cleared'){item.assetClearance.status='pending';item.itClearance.status='pending';item.financeClearance.status='pending';item.hrClearance.status='pending'}
  await refreshStatus(item);await audit(req,item,`MANAGER_REVIEW_${input.status.toUpperCase()}`,before);const employeeUser=await User.findOne({employee:item.employee}).select('_id');await notifyUsers([employeeUser?._id],{type:'Exit manager review',title:`Manager review: ${input.status.replace('_',' ')}`,message:input.comments||`Manager review is ${input.status}.`,employee:item.employee,dedupeKey:`manager-review:${item._id}:${item.managerReview.reviewedAt.getTime()}`});if(input.status==='cleared')await notifyUsers(await usersByRoles(['it_admin','finance_admin','hr_admin','super_admin']),{type:'Exit clearance pending',title:'Department clearance required',message:`${item.exitId} is ready for parallel IT, asset, finance and HR clearance.`,employee:item.employee,dedupeKey:`department-clearance:${item._id}`});res.json({success:true,data:item})
}))

router.patch('/cases/:id/assets',authorize(...assetRoles),asyncHandler(async(req,res)=>{
  const item=await findCase(req),before=snapshot(item),input=z.object({assets:z.array(z.object({_id:id,returnStatus:z.enum(['returned','not_returned','damaged','lost','retained_with_approval']),condition:z.enum(['excellent','good','fair','damaged']).optional(),remarks:text(1000),photo:z.string().startsWith('data:image/').max(4_500_000).optional(),proposedRecoveryAmount:z.number().min(0).default(0)}).superRefine((asset,ctx)=>{if(['returned','damaged'].includes(asset.returnStatus)&&!asset.condition)ctx.addIssue({code:'custom',message:'Condition is required for returned or damaged assets',path:['condition']})})).default([]),comments:text(2000),clear:z.boolean().default(false)}).parse(req.body)
  assertMutable(item)
  if(item.managerReview?.status!=='cleared')throw new HttpError(409,'Manager handover must be cleared before asset receipt')
  const today=new Date();today.setHours(0,0,0,0);const lwd=new Date(item.lastWorkingDate);lwd.setHours(0,0,0,0);if(today<lwd)throw new HttpError(409,'Asset receipt can be recorded only on or after the employee’s last working date')
  for(const update of input.assets){const target=item.assetReturns.id(update._id);if(!target)throw new HttpError(404,'Assigned exit asset not found');Object.assign(target,update,{returnedDate:new Date(),receivedBy:req.user._id});if(['returned','damaged'].includes(update.returnStatus)){await AssetAssignment.updateOne({_id:target.assignment},{$set:{isActive:false,returnedAt:new Date(),returnOutcome:update.returnStatus}});await Asset.updateOne({_id:target.asset},{$set:{status:update.returnStatus==='returned'?'available':'under_repair'}})}else if(update.returnStatus==='lost')await Asset.updateOne({_id:target.asset},{$set:{status:'lost'}})}
  const unresolved=item.assetReturns.some(asset=>asset.returnStatus==='pending');Object.assign(item.assetClearance,{status:input.clear&&!unresolved?'cleared':unresolved?'pending':'action_required',comments:input.comments,reviewedBy:req.user._id,reviewedAt:new Date()});item.finance=calculateFinance(item.finance,item.assetReturns);await refreshStatus(item);await audit(req,item,'ASSET_EXIT_RECEIPT_RECORDED',before,{clearRequested:input.clear});res.json({success:true,data:item})
}))

router.patch('/cases/:id/clearance/:section',asyncHandler(async(req,res)=>{
  const item=await findCase(req),section=req.params.section,map={it:{field:'itClearance',roles:['it_admin','admin','super_admin']},finance:{field:'financeClearance',roles:['finance_admin','admin','super_admin']},hr:{field:'hrClearance',roles:hrRoles}}[section]
  if(!map)throw new HttpError(404,'Clearance section not found');if(!map.roles.includes(req.user.role))throw new HttpError(403,'You cannot update this clearance')
  assertMutable(item)
  if(item.managerReview?.status!=='cleared')throw new HttpError(409,'Manager handover must be cleared before departmental clearance')
  const input=z.object({status:z.enum(['cleared','action_required','rejected']),comments:text(2000),checklist:z.record(z.string(),z.union([z.boolean(),z.string(),z.number()])).default({}),finance:z.record(z.string(),z.union([z.string(),z.number()])).optional()}).parse(req.body),before=snapshot(item)
  if(section==='it'&&input.status==='cleared'&&itRequired.some(key=>!['disabled','transferred','archived','not_applicable','confirmed','true'].includes(String(input.checklist[key]))))throw new HttpError(422,'Complete every required IT access and data-backup item before clearance')
  if(section==='hr'&&input.status==='cleared'&&hrRequired.some(key=>input.checklist[key]!==true))throw new HttpError(422,'Complete every required HR checklist item before clearance')
  if(section==='hr'&&input.status==='cleared'&&[item.managerReview.status,item.assetClearance.status,item.itClearance.status,item.financeClearance.status].some(status=>status!=='cleared'))throw new HttpError(409,'Manager, asset, IT and finance clearances must be completed before HR clearance')
  Object.assign(item[map.field],{status:input.status,comments:input.comments,reviewedBy:req.user._id,reviewedAt:new Date()})
  if(section==='it'){item.it.accessItems=input.checklist}else if(section==='hr'){item.hrChecklist=input.checklist}else if(section==='finance'){for(const returned of item.assetReturns)returned.financeApprovedRecoveryAmount=returned.proposedRecoveryAmount||0;item.finance=calculateFinance({...item.finance,...input.finance,comments:input.comments},item.assetReturns)}
  await refreshStatus(item);await audit(req,item,`${section.toUpperCase()}_CLEARANCE_${input.status.toUpperCase()}`,before);if(item.status==='management_approval_pending')await notifyUsers(await usersByRoles(['super_admin']),{type:'Exit management approval',title:'Final exit approval required',message:`All required clearances for ${item.exitId} are complete.`,employee:item.employee,dedupeKey:`management-ready:${item._id}`});res.json({success:true,data:item})
}))

router.patch('/cases/:id/management',authorize('super_admin'),asyncHandler(async(req,res)=>{
  const item=await findCase(req),input=z.object({decision:z.enum(['approve','return']),comments:text(2000),override:z.boolean().default(false),overrideReason:text(1000)}).parse(req.body),before=snapshot(item),incomplete=[['manager',item.managerReview.status],['assets',item.assetClearance.status],['IT',item.itClearance.status],['finance',item.financeClearance.status],['HR',item.hrClearance.status]].filter(([,status])=>status!=='cleared')
  assertMutable(item)
  if(input.decision==='approve'&&incomplete.length&&!input.override)throw new HttpError(409,`Incomplete clearance: ${incomplete.map(([name])=>name).join(', ')}`);if(input.override&&!input.overrideReason)throw new HttpError(422,'A mandatory override reason is required')
  Object.assign(item.management,{status:input.decision==='approve'?'approved':'returned',reviewedBy:req.user._id,reviewedAt:new Date(),comments:input.comments,overrideUsed:input.override,overrideReason:input.overrideReason});if(input.decision==='return')item.hrClearance.status='action_required';await refreshStatus(item);await audit(req,item,`MANAGEMENT_EXIT_${input.decision.toUpperCase()}`,before,{override:input.override,overrideReason:input.overrideReason});const employeeUser=await User.findOne({employee:item.employee,isActive:true}).select('_id');await notifyUsers([employeeUser?._id],{type:'Exit management review',title:input.decision==='approve'?'Final exit approved — acknowledgement required':'Exit returned for action',message:input.comments||`Management ${input.decision}d the exit case.`,employee:item.employee,dedupeKey:`management:${item._id}:${item.management.reviewedAt.getTime()}`});res.json({success:true,data:item})
}))

router.post('/cases/:id/acknowledgement/request-otp',asyncHandler(async(req,res)=>{
  const item=await findCase(req,{secrets:true});if(String(item.employee)!==String(req.user.employee?._id))throw new HttpError(403,'Only the exiting employee can acknowledge');if(item.status!=='employee_acknowledgement_pending')throw new HttpError(409,'This exit is not ready for employee acknowledgement')
  const recipient=item.employeeSnapshot.personalEmail||item.employeeSnapshot.officialEmail,otp=String(crypto.randomInt(100000,1000000));item.acknowledgement.otpHash=otpHash(otp,item.exitId);item.acknowledgement.otpExpiresAt=new Date(Date.now()+10*60*1000);item.acknowledgement.otpAttempts=0;item.acknowledgement.email=recipient;await item.save()
  if(env.nodeEnv!=='development'||!recipient.endsWith('.local'))await sendGraphEmail({recipient,subject:`${item.exitId} acknowledgement code`,html:`<p>Your AT Connect employee exit acknowledgement code is <strong>${otp}</strong>.</p><p>It expires in 10 minutes. Do not share this code.</p>`})
  res.json({success:true,data:{message:`Acknowledgement code sent to ${recipient.replace(/(^.).*(@.*$)/,'$1***$2')}`,...(env.nodeEnv==='development'&&recipient.endsWith('.local')?{developmentCode:otp}:{})}})
}))
router.post('/cases/:id/acknowledgement/verify',asyncHandler(async(req,res)=>{
  const item=await findCase(req,{secrets:true});if(String(item.employee)!==String(req.user.employee?._id))throw new HttpError(403,'Only the exiting employee can acknowledge');const input=z.object({typedName:z.string().trim().min(3).max(150),otp:z.string().regex(/^\d{6}$/),securityDeclaration:z.literal(true),representationDeclaration:z.literal(true)}).parse(req.body)
  if(item.status!=='employee_acknowledgement_pending')throw new HttpError(409,'This exit is not ready for acknowledgement')
  if(!item.acknowledgement.otpHash||item.acknowledgement.otpExpiresAt<new Date())throw new HttpError(401,'Acknowledgement code expired');if(item.acknowledgement.otpAttempts>=5)throw new HttpError(429,'Too many invalid acknowledgement attempts')
  if(otpHash(input.otp,item.exitId)!==item.acknowledgement.otpHash){item.acknowledgement.otpAttempts+=1;await item.save();throw new HttpError(401,'Invalid acknowledgement code')}
  const before=snapshot(item);item.it.securityDeclaration.set('companyDataReturnedOrDeleted',true);item.it.securityDeclaration.set('personalLocationsCleared',true);item.it.securityDeclaration.set('confidentialityAcknowledged',true);item.it.socialMedia.set('companyRepresentationAcknowledged','confirmed');Object.assign(item.acknowledgement,{typedName:input.typedName,otpVerified:true,acknowledgedBy:req.user._id,acknowledgedAt:new Date(),ipAddress:req.ip,userAgent:req.get('user-agent'),otpHash:undefined,otpExpiresAt:undefined});item.status='exit_cleared';const organization=await OrganizationProfile.findOne({singletonKey:'organization'}).lean()||{},pdf=await generateExitPdf(item.toObject(),organization);item.finalDocument={pdfData:pdf,fileName:`${item.exitId}-Exit-Clearance.pdf`,sha256:crypto.createHash('sha256').update(pdf).digest('hex'),revision:(item.finalDocument?.revision||0)+1,generatedAt:new Date()};await item.save();await audit(req,item,'EXIT_ACKNOWLEDGED',before,{pdfHash:item.finalDocument.sha256,securityDeclaration:true,representationDeclaration:true});res.json({success:true,data:item})
}))

router.post('/cases/:id/separate',authorize(...hrRoles),asyncHandler(async(req,res)=>{
  const item=await findCase(req);if(item.status!=='exit_cleared')throw new HttpError(409,'Final clearance and employee acknowledgement are required before separation');const before=snapshot(item),employeeStatus=item.exitType==='termination'||item.exitType==='absconding'?'terminated':'resigned';await Employee.updateOne({_id:item.employee},{$set:{employeeStatus}});item.status='separated';item.completedAt=new Date();await item.save();await audit(req,item,'EMPLOYEE_SEPARATED',before,{employeeStatus});res.json({success:true,data:item})
}))
router.post('/cases/:id/cancel',authorize(...hrRoles),asyncHandler(async(req,res)=>{const item=await findCase(req),input=z.object({reason:z.string().trim().min(5).max(1000)}).parse(req.body);if(['exit_cleared','separated','cancelled'].includes(item.status)||item.finalDocument?.sha256)throw new HttpError(409,'This finalized exit case cannot be cancelled');const before=snapshot(item);item.status='cancelled';item.cancelledAt=new Date();item.cancelReason=input.reason;await item.save();await Employee.updateOne({_id:item.employee,employeeStatus:'notice_period'},{$set:{employeeStatus:'active'}});await audit(req,item,'EXIT_CASE_CANCELLED',before,{reason:input.reason});res.json({success:true,data:item})}))
router.get('/cases/:id/pdf',asyncHandler(async(req,res)=>{const item=await findCase(req,{pdf:true});if(!['super_admin','admin','hr_admin'].includes(req.user.role)&&String(item.employee)!==String(req.user.employee?._id))throw new HttpError(403,'You cannot access the final exit document');if(!item.finalDocument?.pdfData)throw new HttpError(404,'Final exit document is not available');res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${item.finalDocument.fileName}"`,'Cache-Control':'private, no-store','X-Document-SHA256':item.finalDocument.sha256}).send(item.finalDocument.pdfData)}))

export default router
