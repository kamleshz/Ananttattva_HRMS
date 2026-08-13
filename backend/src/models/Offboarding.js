import mongoose from 'mongoose'

const objectId=mongoose.Schema.Types.ObjectId
const reviewStatus=['pending','cleared','action_required','rejected','waiting']
const assetTypes=['laptop','desktop','monitor','keyboard','mouse','charger','mobile','sim','headset','id_card','access_card','storage_device','dongle','laptop_bag','other']

const attachmentSchema=new mongoose.Schema({fileName:String,mimeType:String,data:String,uploadedAt:{type:Date,default:Date.now}},{_id:true})
const reviewSchema=new mongoose.Schema({status:{type:String,enum:reviewStatus,default:'waiting'},reviewedBy:{type:objectId,ref:'User'},reviewedAt:Date,comments:{type:String,maxlength:2000,default:''},returnedAt:Date},{_id:false})
const assetReturnSchema=new mongoose.Schema({
  assignment:{type:objectId,ref:'AssetAssignment'},asset:{type:objectId,ref:'Asset'},assetCode:String,assetType:String,brand:String,model:String,serialNumber:String,assignedDate:Date,
  returnStatus:{type:String,enum:['pending','returned','not_returned','damaged','lost','retained_with_approval'],default:'pending'},condition:{type:String,enum:['excellent','good','fair','damaged']},returnedDate:Date,receivedBy:{type:objectId,ref:'User'},remarks:{type:String,maxlength:1000,default:''},photo:String,proposedRecoveryAmount:{type:Number,min:0,default:0},financeApprovedRecoveryAmount:{type:Number,min:0,default:0},employeeAcknowledgedAt:Date,
},{_id:true})

const assetSchema=new mongoose.Schema({
  assetCode:{type:String,required:true,unique:true,trim:true,index:true},assetType:{type:String,enum:assetTypes,required:true,index:true},brand:{type:String,trim:true},model:{type:String,trim:true},serialNumber:{type:String,trim:true,index:true,sparse:true},purchaseDate:Date,warrantyUntil:Date,location:String,
  status:{type:String,enum:['available','assigned','under_repair','lost','retired','disposed'],default:'available',index:true},notes:{type:String,maxlength:1000,default:''},createdBy:{type:objectId,ref:'User'},
},{timestamps:true})

const assignmentSchema=new mongoose.Schema({
  asset:{type:objectId,ref:'Asset',required:true,index:true},employee:{type:objectId,ref:'Employee',required:true,index:true},assignedDate:{type:Date,default:Date.now},conditionAtAssignment:{type:String,enum:['excellent','good','fair','damaged'],default:'good'},accessories:[String],remarks:{type:String,maxlength:1000,default:''},assignedBy:{type:objectId,ref:'User'},returnedAt:Date,returnOutcome:String,isActive:{type:Boolean,default:true,index:true},
},{timestamps:true})
assignmentSchema.index({asset:1,isActive:1},{unique:true,partialFilterExpression:{isActive:true}})

const exitCaseSchema=new mongoose.Schema({
  exitId:{type:String,required:true,unique:true,index:true},employee:{type:objectId,ref:'Employee',required:true,index:true},employeeSnapshot:{employeeCode:String,firstName:String,lastName:String,officialEmail:String,personalEmail:String,department:String,designation:String,managerId:{type:objectId,ref:'Employee'},joiningDate:Date,workLocation:String},manager:{type:objectId,ref:'Employee',index:true},
  resignationDate:{type:Date,required:true},lastWorkingDate:{type:Date,required:true,index:true},exitType:{type:String,enum:['resignation','termination','retirement','contract_completion','absconding','transfer','other'],required:true},noticePeriodDays:{type:Number,min:0,max:365,default:0},exitReason:{type:String,required:true,maxlength:2000},
  status:{type:String,enum:['draft','employee_handover_pending','manager_review_pending','manager_action_required','department_clearance_in_progress','management_approval_pending','employee_acknowledgement_pending','exit_cleared','separated','cancelled'],default:'employee_handover_pending',index:true},initiatedBy:{type:objectId,ref:'User',required:true},initiatedAt:{type:Date,default:Date.now},completedAt:Date,cancelledAt:Date,cancelReason:String,
  handover:{currentResponsibilities:String,pendingTasks:String,projects:String,clientResponsibilities:String,vendorResponsibilities:String,pendingQuotations:String,pendingInvoices:String,pendingApprovals:String,importantDeadlines:String,importantFiles:String,processDocumentation:String,replacementEmployee:{type:objectId,ref:'Employee'},knowledgeTransferStatus:{type:String,enum:['not_started','in_progress','completed'],default:'not_started'},additionalNotes:String,attachments:[attachmentSchema],submittedAt:Date},
  managerReview:{type:reviewSchema,default:()=>({status:'waiting'})},assetClearance:{type:reviewSchema,default:()=>({status:'waiting'})},itClearance:{type:reviewSchema,default:()=>({status:'waiting'})},financeClearance:{type:reviewSchema,default:()=>({status:'waiting'})},hrClearance:{type:reviewSchema,default:()=>({status:'waiting'})},
  managerChecklist:{type:Map,of:Boolean,default:{}},assetReturns:[assetReturnSchema],
  it:{accessItems:{type:Map,of:String,default:{}},dataBackup:{type:Map,of:mongoose.Schema.Types.Mixed,default:{}},securityDeclaration:{type:Map,of:Boolean,default:{}},socialMedia:{type:Map,of:String,default:{}}},
  finance:{salaryAdvance:{type:Number,default:0},travelAdvance:{type:Number,default:0},employeeLoan:{type:Number,default:0},expenseReimbursement:{type:Number,default:0},allowanceClaims:{type:Number,default:0},noticePeriodRecovery:{type:Number,default:0},assetRecovery:{type:Number,default:0},otherRecovery:{type:Number,default:0},pendingPaymentToEmployee:{type:Number,default:0},totalPayable:{type:Number,default:0},totalRecovery:{type:Number,default:0},netSettlement:{type:Number,default:0},fullAndFinalStatus:{type:String,default:'pending'},comments:String},
  hrChecklist:{type:Map,of:Boolean,default:{}},management:{status:{type:String,enum:['waiting','pending','approved','returned'],default:'waiting'},reviewedBy:{type:objectId,ref:'User'},reviewedAt:Date,comments:String,overrideUsed:{type:Boolean,default:false},overrideReason:String},
  acknowledgement:{typedName:String,email:String,otpHash:{type:String,select:false},otpExpiresAt:{type:Date,select:false},otpAttempts:{type:Number,default:0,select:false},otpVerified:{type:Boolean,default:false},acknowledgedBy:{type:objectId,ref:'User'},acknowledgedAt:Date,ipAddress:String,userAgent:String},
  finalDocument:{pdfData:{type:Buffer,select:false},fileName:String,sha256:String,revision:{type:Number,default:0},generatedAt:Date},
},{timestamps:true})
exitCaseSchema.index({status:1,lastWorkingDate:1})
exitCaseSchema.index({manager:1,status:1})

export const Asset=mongoose.model('Asset',assetSchema)
export const AssetAssignment=mongoose.model('AssetAssignment',assignmentSchema)
export const ExitCase=mongoose.model('ExitCase',exitCaseSchema)
export { assetTypes }
