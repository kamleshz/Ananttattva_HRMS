import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import { Notification } from '../models/Recruitment.js'
import { User } from '../models/User.js'

export const sectionRoles={managerReview:['manager'],assetClearance:['it_admin','hr_admin','admin','super_admin'],itClearance:['it_admin','admin','super_admin'],financeClearance:['finance_admin','admin','super_admin'],hrClearance:['hr_admin','admin','super_admin']}

export function calculateFinance(finance={},assetReturns=[]){
  const number=value=>Number(value)||0
  const assetRecovery=assetReturns.reduce((sum,item)=>sum+number(item.financeApprovedRecoveryAmount),0)
  const totalPayable=number(finance.expenseReimbursement)+number(finance.allowanceClaims)+number(finance.pendingPaymentToEmployee)
  const totalRecovery=number(finance.salaryAdvance)+number(finance.travelAdvance)+number(finance.employeeLoan)+number(finance.noticePeriodRecovery)+assetRecovery+number(finance.otherRecovery)
  return {...finance,assetRecovery,totalPayable,totalRecovery,netSettlement:totalPayable-totalRecovery}
}

export function deriveExitStatus(exitCase){
  if(['cancelled','separated'].includes(exitCase.status))return exitCase.status
  if(exitCase.management?.status==='approved'&&exitCase.management?.overrideUsed)return exitCase.acknowledgement?.otpVerified?'exit_cleared':'employee_acknowledgement_pending'
  if(!exitCase.handover?.submittedAt)return 'employee_handover_pending'
  if(exitCase.managerReview?.status==='action_required')return 'manager_action_required'
  if(exitCase.managerReview?.status!=='cleared')return 'manager_review_pending'
  const department=[exitCase.assetClearance?.status,exitCase.itClearance?.status,exitCase.financeClearance?.status,exitCase.hrClearance?.status]
  if(department.some(status=>status!=='cleared'))return 'department_clearance_in_progress'
  if(exitCase.management?.status!=='approved')return 'management_approval_pending'
  if(!exitCase.acknowledgement?.otpVerified)return 'employee_acknowledgement_pending'
  return 'exit_cleared'
}

export async function notifyUsers(users,payload){
  const docs=users.filter(Boolean).map(recipient=>({recipient,...payload,dedupeKey:`${payload.dedupeKey}:${recipient}`}))
  if(docs.length)await Promise.all(docs.map(doc=>Notification.findOneAndUpdate({recipient:doc.recipient,dedupeKey:doc.dedupeKey},{$setOnInsert:doc},{upsert:true,new:true})))
}

export async function usersByRoles(roles){return User.find({role:{$in:roles},isActive:true}).distinct('_id')}

const date=value=>value?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value)):'—'
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value)||0)
export function generateExitPdf(item,organization={}){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:44,info:{Title:`Employee Exit - ${item.exitId}`,Author:organization.companyName||'AT Connect'}}),chunks=[]
    doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)
    const heading=text=>{doc.moveDown(1).fillColor('#135f58').font('Helvetica-Bold').fontSize(13).text(text);doc.moveDown(.35).fillColor('#26334a').font('Helvetica').fontSize(9)}
    const row=(label,value)=>doc.font('Helvetica-Bold').text(`${label}: `,{continued:true}).font('Helvetica').text(String(value??'—'))
    doc.fillColor('#135f58').font('Helvetica-Bold').fontSize(20).text(organization.companyName||'Ananttattva Private Limited')
    doc.moveDown(.3).fillColor('#667085').fontSize(9).font('Helvetica').text('Employee Exit, Clearance & Handover Form')
    heading('Employee and exit details');row('Exit ID',item.exitId);row('Employee',`${item.employeeSnapshot.firstName} ${item.employeeSnapshot.lastName} (${item.employeeSnapshot.employeeCode})`);row('Department',item.employeeSnapshot.department);row('Designation',item.employeeSnapshot.designation);row('Exit type',item.exitType);row('Resignation date',date(item.resignationDate));row('Last working date',date(item.lastWorkingDate));row('Reason',item.exitReason)
    heading('Work and knowledge handover');row('Responsibilities',item.handover?.currentResponsibilities);row('Pending tasks',item.handover?.pendingTasks);row('Projects',item.handover?.projects);row('Client responsibilities',item.handover?.clientResponsibilities);row('Important deadlines',item.handover?.importantDeadlines);row('Knowledge transfer',item.handover?.knowledgeTransferStatus)
    heading('Clearance summary');[['Manager',item.managerReview],['Assets',item.assetClearance],['IT',item.itClearance],['Finance',item.financeClearance],['HR',item.hrClearance]].forEach(([label,value])=>row(label,`${value?.status||'waiting'}${value?.reviewedAt?` · ${date(value.reviewedAt)}`:''}`))
    heading('Asset return');if(!item.assetReturns?.length)doc.text('No assigned assets recorded.');item.assetReturns?.forEach(asset=>row(`${asset.assetCode} · ${asset.assetType}`,`${asset.returnStatus} · ${asset.condition||'condition not recorded'} · Recovery ${money(asset.financeApprovedRecoveryAmount)}`))
    const accessItems=item.it?.accessItems instanceof Map?Object.fromEntries(item.it.accessItems):item.it?.accessItems||{}
    heading('IT and data security');row('Access items reviewed',Object.keys(accessItems).length);row('IT comments',item.itClearance?.comments);row('Employee security declaration','Acknowledged as part of OTP-backed final acknowledgement')
    heading('Finance settlement');row('Total payable',money(item.finance?.totalPayable));row('Total recovery',money(item.finance?.totalRecovery));row('Net settlement',money(item.finance?.netSettlement));row('F&F status',item.finance?.fullAndFinalStatus)
    heading('Management and employee acknowledgement');row('Management status',item.management?.status);row('Management comments',item.management?.comments);row('Acknowledged name',item.acknowledgement?.typedName);row('Acknowledged at',date(item.acknowledgement?.acknowledgedAt));row('OTP verified',item.acknowledgement?.otpVerified?'Yes':'No')
    doc.moveDown(1.5).fillColor('#667085').fontSize(8).text(`Generated ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} · Revision ${(item.finalDocument?.revision||0)+1} · This is an immutable system-generated record.`)
    doc.end()
  })
}

export const otpHash=(otp,context='')=>crypto.createHash('sha256').update(`${context}:${otp}`).digest('hex')
