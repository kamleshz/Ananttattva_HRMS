import { Router } from 'express'
import bcrypt from 'bcryptjs'
import writeXlsxFile from 'write-excel-file/node'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { Notification } from '../models/Recruitment.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { EMPLOYEE_REPORT_THEME, reportCell, reportHeaderRow, reportSectionRow, statusCellStyle } from '../utils/excelReportStyle.js'
import { addMonths, proratedAnnualPaidLeaves } from '../services/leavePolicyService.js'
import { sendProbationConfirmation, sendWelcomeEmail } from '../services/mailService.js'

const router = Router()
const biometricSampleSchema = z.object({
  pose: z.enum(['front','left','right']),
  photo: z.string().startsWith('data:image/').max(4_500_000),
  template: z.array(z.number().finite()).min(128).max(2048),
})
const biometricEnrollmentSchema = z.object({
  profilePhoto:z.string().startsWith('data:image/').max(4_500_000),
  biometricTemplate:z.array(z.number().finite()).min(128).max(2048),
  biometricSamples:z.array(biometricSampleSchema).length(3).refine(
    samples => new Set(samples.map(sample => sample.pose)).size === 3,
    'Front, left and right biometric samples are required',
  ),
})
router.use(authenticate)
router.get('/', authorize('super_admin','admin','hr_admin','manager'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)))
  // Employee records are retained for HR history when a login user is deleted,
  // but orphaned records must not appear in the active People directory.
  const existingUserIds = await User.distinct('_id')
  const filter = { user: { $in: existingUserIds } }
  if (req.query.status) filter.employeeStatus = req.query.status
  if (req.query.search) filter.$text = { $search: req.query.search }
  if (req.user.role === 'manager' && !['super_admin','hr_admin'].includes(req.user.role)) {
    const currentEmployee = await Employee.findOne({ user: req.user._id }).select('_id')
    if (currentEmployee) filter.manager = currentEmployee._id
  }
  const [items,total] = await Promise.all([Employee.find(filter).populate('manager','firstName lastName').skip((page-1)*limit).limit(limit).sort({createdAt:-1}), Employee.countDocuments(filter)])
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
}))
router.get('/demographics/list',authorize('super_admin','admin','hr_admin','it_admin'),asyncHandler(async(req,res)=>{
  const group=z.enum(['male','female','other_private','not_specified']).parse(req.query.group)
  const gender=group==='other_private'?{$in:['non_binary','prefer_not_to_say']}:group
  const employees=await Employee.find({employeeStatus:'active',gender})
    .select('employeeCode firstName lastName profilePhoto department designation workLocation')
    .sort({firstName:1,lastName:1})
    .lean()
  res.json({success:true,data:employees})
}))
router.get('/organization-chart', authorize('super_admin','hr_admin','manager','it_admin'), asyncHandler(async (_req,res)=>{
  const existingUserIds=await User.distinct('_id',{isActive:true})
  const employees=await Employee.find({user:{$in:existingUserIds},employeeStatus:{$ne:'terminated'}}).select('employeeCode firstName lastName profilePhoto department designation workLocation employeeStatus manager').sort({firstName:1,lastName:1}).lean()
  const employeeIds=new Set(employees.map(employee=>String(employee._id)))
  const items=employees.map(employee=>({...employee,manager:employee.manager&&employeeIds.has(String(employee.manager))?employee.manager:null}))
  res.json({success:true,data:items})
}))
router.get('/export',authorize('super_admin','admin','hr_admin'),asyncHandler(async(_req,res)=>{
  const existingUserIds=await User.distinct('_id')
  const employees=await Employee.find({
    user:{$in:existingUserIds},
    employeeStatus:{$nin:['notice_period','resigned','terminated']},
  })
    .populate('manager','employeeCode firstName lastName')
    .sort({employeeCode:1})
    .lean()
  const headers=['Employee Number','Employee Name','Official Email','Mobile','Department','Designation','Branch','Work Location','Reporting Manager','Joining Date','Employment Type','Employee Status','Shift','Probation Status','Probation End Date','Annual Paid Leaves']
  const emptyRow=Array(headers.length).fill(null)
  const generatedAt=new Date()
  const theme=EMPLOYEE_REPORT_THEME
  const sheetData=[
    [{value:'AT Connect – Employee Master Report',columnSpan:headers.length,fontWeight:'bold',fontSize:18,textColor:'#FFFFFF',backgroundColor:theme.title,height:34,alignVertical:'center'},...emptyRow.slice(1)],
    [{value:`Generated ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(generatedAt)} · ${employees.length} employees`,columnSpan:headers.length,fontStyle:'italic',fontSize:10,textColor:theme.subtitleText,backgroundColor:theme.subtitle,height:24,alignVertical:'center'},...emptyRow.slice(1)],
    reportSectionRow([{label:'PERSONAL & CONTACT',span:4},{label:'ORGANIZATION',span:5},{label:'EMPLOYMENT & BENEFITS',span:7}],theme),
    reportHeaderRow(headers,[4,5,7],theme),
  ]
  employees.forEach((employee,index)=>{
    const cell=(value,extra={})=>reportCell(value,index,theme,extra)
    const manager=employee.manager?`${employee.manager.firstName||''} ${employee.manager.lastName||''}`.trim():''
    sheetData.push([
      cell(employee.employeeCode,{fontWeight:'bold',textColor:theme.accent}),cell(`${employee.firstName||''} ${employee.lastName||''}`.trim(),{fontWeight:'bold'}),cell(employee.officialEmail,{textColor:'#315F91'}),cell(employee.mobile),cell(employee.department,{backgroundColor:'#F0E8F5',textColor:'#624173',fontWeight:'bold'}),cell(employee.designation),cell(employee.branch),cell(employee.workLocation),cell(manager?`${manager}${employee.manager.employeeCode?` (${employee.manager.employeeCode})`:''}`:''),
      employee.joiningDate?cell(employee.joiningDate,{type:Date,format:'dd-mmm-yyyy',align:'center'}):cell('',{align:'center'}),cell(String(employee.employmentType||'').replaceAll('_',' '),statusCellStyle(employee.employmentType)),cell(String(employee.employeeStatus||'').replaceAll('_',' '),statusCellStyle(employee.employeeStatus)),cell(employee.shift?.name?`${employee.shift.name} (${employee.shift.startTime||''}–${employee.shift.endTime||''})`:''),cell(String(employee.probation?.confirmationStatus||'').replaceAll('_',' '),statusCellStyle(employee.probation?.confirmationStatus)),employee.probation?.expectedEndDate?cell(employee.probation.expectedEndDate,{type:Date,format:'dd-mmm-yyyy',align:'center'}):cell('',{align:'center'}),cell(employee.leavePlan?.annualPaidLeaves??'',employee.leavePlan?.annualPaidLeaves==null?{align:'right'}:{type:Number,align:'right',fontWeight:'bold'}),
    ])
  })
  const columns=[18,25,30,16,20,22,18,22,28,16,18,17,28,20,18,18].map(width=>({width}))
  const buffer=await writeXlsxFile(sheetData,{sheet:'Employee Master',columns,stickyRowsCount:4,stickyColumnsCount:2,showGridLines:false,zoomScale:.85},{fontFamily:'Calibri',fontSize:10}).toBuffer()
  const fileName='Employee_Onboard_Data.xlsx'
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="${fileName}"`)
  res.send(Buffer.from(buffer))
}))
router.get('/:id', asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).populate('manager','firstName lastName employeeCode')
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success: true, data: employee })
}))
const shiftSchema=z.object({name:z.string().trim().min(1),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),graceMinutes:z.coerce.number().int().min(0).max(180)})
const probationSchema=z.object({
  durationMonths:z.coerce.number().int().min(0).max(24).optional(),
  expectedEndDate:z.coerce.date().optional(),
  confirmationStatus:z.enum(['in_probation','pending_confirmation','confirmed','extended']).optional(),
  confirmedAt:z.coerce.date().nullable().optional(),
  confirmedBy:z.string().nullable().optional(),
  confirmationNote:z.string().trim().max(500).optional(),
})
const leavePlanSchema=z.object({
  annualPaidLeaves:z.coerce.number().int().min(0).max(60).optional(),
  cycleStartMonth:z.coerce.number().int().min(1).max(12).optional(),
  accrualMode:z.enum(['monthly_1_5','grant_on_confirmation']).optional(),
})
const employeeUpdateSchema=z.object({
  employeeCode:z.string().trim().min(3).optional(),
  firstName:z.string().trim().min(1).optional(),lastName:z.string().trim().min(1).optional(),
  dateOfBirth:z.coerce.date().max(new Date(),'Date of birth cannot be in the future').nullable().optional(),
  gender:z.enum(['male','female','non_binary','prefer_not_to_say','not_specified']).optional(),
  officialEmail:z.email().optional(),personalEmail:z.email().optional().or(z.literal('')),mobile:z.string().trim().max(30).optional(),
  department:z.string().trim().max(100).optional(),designation:z.string().trim().max(100).optional(),branch:z.string().trim().max(100).optional(),workLocation:z.string().trim().max(150).optional(),
  joiningDate:z.coerce.date().optional(),employmentType:z.enum(['permanent','probation','contract','intern','consultant']).optional(),employeeStatus:z.enum(['active','inactive','notice_period','resigned','terminated']).optional(),
  manager:z.string().nullable().optional(),
  shift:shiftSchema.optional(),
  probation:probationSchema.optional(),
  leavePlan:leavePlanSchema.optional(),
})
function deriveProbation(input, employee) {
  if (!input) return {}
  const current = employee?.probation || {}
  const joining = input.joiningDate ? new Date(input.joiningDate) : (employee?.joiningDate ? new Date(employee.joiningDate) : new Date())
  const result = { ...current, ...input }
  if (input.durationMonths !== undefined && input.expectedEndDate === undefined) {
    result.expectedEndDate = addMonths(joining, Number(input.durationMonths))
  }
  if (input.expectedEndDate && input.durationMonths === undefined) {
    const delta = ((new Date(input.expectedEndDate).getUTCFullYear() - joining.getUTCFullYear()) * 12) + (new Date(input.expectedEndDate).getUTCMonth() - joining.getUTCMonth())
    result.durationMonths = Math.max(0, Math.round(delta))
  }
  return result
}
router.put('/:id',authorize('super_admin','admin','hr_admin'),asyncHandler(async(req,res)=>{
  const input=employeeUpdateSchema.parse(req.body)
  const employee=await Employee.findById(req.params.id)
  if(!employee)throw new HttpError(404,'Employee not found')
  if(input.officialEmail&&await User.exists({email:input.officialEmail,_id:{$ne:employee.user}}))throw new HttpError(409,'Another login account already uses this official email')
  const patch = { ...input }
  if (input.probation || input.joiningDate) patch.probation = deriveProbation({ ...(input.probation || {}), ...(input.joiningDate ? { joiningDate: input.joiningDate } : {}) }, employee)
  if (patch.manager === '') patch.manager = null
  Object.assign(employee, patch)
  await employee.save()
  if(employee.user&&(input.officialEmail||input.firstName||input.lastName))await User.findByIdAndUpdate(employee.user,{email:input.officialEmail||employee.officialEmail,firstName:input.firstName||employee.firstName,lastName:input.lastName||employee.lastName},{runValidators:true})
  res.json({success:true,data:employee})
}))
router.get('/:id/biometrics', authorize('super_admin','admin','hr_admin'), asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).select('+biometricSamples')
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success:true, data:{
    employeeId:employee.id,
    biometricEnrolledAt:employee.biometricEnrolledAt,
    biometricTemplateVersion:employee.biometricTemplateVersion,
    photos:(employee.biometricSamples || []).map(({ pose, photo }) => ({ pose, photo })),
  } })
}))
router.put('/:id/biometrics', authorize('super_admin','admin','hr_admin'), asyncHandler(async (req, res) => {
  const input = biometricEnrollmentSchema.parse(req.body)
  const employee = await Employee.findByIdAndUpdate(req.params.id, { ...input, biometricTemplateVersion:3, biometricEnrolledAt:new Date() }, { new:true, runValidators:true })
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success:true, data:{ id:employee.id, employeeCode:employee.employeeCode, biometricEnrolledAt:employee.biometricEnrolledAt, biometricTemplateVersion:employee.biometricTemplateVersion } })
}))
router.patch('/:id/confirm-probation', authorize('super_admin','hr_admin'), asyncHandler(async (req, res) => {
  const input = z.object({
    reviewNote: z.string().trim().max(500).default(''),
    confirmationDate: z.coerce.date().default(() => new Date()),
    updateEmploymentType: z.boolean().default(true),
  }).parse(req.body)
  const employee = await Employee.findById(req.params.id).populate('manager','firstName lastName')
  if (!employee) throw new HttpError(404, 'Employee not found')
  if (!employee.user) throw new HttpError(409, 'This employee does not have a login user attached.')
  employee.probation = {
    ...(employee.probation || {}),
    confirmationStatus: 'confirmed',
    confirmedAt: input.confirmationDate,
    confirmedBy: req.user._id,
    confirmationNote: input.reviewNote,
    expectedEndDate: employee.probation?.expectedEndDate || employee.probation?.confirmedAt || null,
    durationMonths: employee.probation?.durationMonths || 0,
  }
  if (input.updateEmploymentType && employee.employmentType === 'probation') employee.employmentType = 'permanent'
  await employee.save()
  const user = await User.findOne({ employee: employee._id, isActive: true }).select('_id email firstName')
  if (user) {
    await Notification.create({
      recipient: user._id,
      type: 'Probation Confirmed',
      title: 'Your probation has been confirmed',
      message: input.reviewNote || 'You are now eligible for prorated paid leaves for the current financial year.',
      employee: employee._id,
    })
    if (user.email) {
      const [mailResult] = await Promise.allSettled([
        sendProbationConfirmation({
          recipient: user.email,
          firstName: user.firstName || employee.firstName,
          employeeCode: employee.employeeCode,
          confirmedAt: new Date(input.confirmationDate).toISOString().slice(0, 10),
          reviewNote: input.reviewNote,
        }),
      ])
      if (mailResult.status === 'rejected') console.error('Probation confirmation email failed:', mailResult.reason?.message || mailResult.reason)
    }
  }
  res.json({ success: true, data: employee })
}))
const createSchema = z.object({
  employeeCode:z.string().min(3),
  firstName:z.string().min(1),
  lastName:z.string().min(1),
  dateOfBirth:z.coerce.date().max(new Date(), 'Date of birth cannot be in the future'),
  gender:z.enum(['male','female','non_binary','prefer_not_to_say','not_specified']),
  officialEmail:z.email(),
  personalEmail:z.email().optional().or(z.literal('')),
  mobile:z.string().trim().max(30).optional(),
  department:z.string().trim().max(100).optional(),
  designation:z.string().trim().max(100).optional(),
  branch:z.string().trim().max(100).optional(),
  workLocation:z.string().trim().max(150).optional(),
  joiningDate:z.coerce.date().optional(),
  employmentType:z.enum(['permanent','probation','contract','intern','consultant']).default('probation'),
  employeeStatus:z.enum(['active','inactive','notice_period','resigned','terminated']).default('active'),
  manager:z.string().nullable().optional(),
  temporaryPassword:z.string().min(8),
  role:z.enum(['super_admin','admin','hr_admin','manager','finance_admin','it_admin','employee']).default('employee'),
  probation:probationSchema.optional(),
  leavePlan:leavePlanSchema.optional(),
  shift:shiftSchema.optional(),
  ...biometricEnrollmentSchema.partial().shape,
})
router.post('/', authorize('super_admin','admin','hr_admin'), asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body)
  if (input.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Only a Super Admin can create another Super Admin account')
  if (input.role === 'admin' && !['super_admin','admin'].includes(req.user.role)) throw new HttpError(403, 'Only an Admin or Super Admin can create an Admin account')
  if (input.manager && !await Employee.exists({ _id: input.manager })) throw new HttpError(422, 'Reporting manager not found')
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12)
  const user = await User.create({ firstName:input.firstName, lastName:input.lastName, email:input.officialEmail, passwordHash, role:input.role, mustChangePassword:true })
  let employee
  try {
    const probation = (() => {
      const plan = input.probation || {}
      const joining = input.joiningDate ? new Date(input.joiningDate) : new Date()
      const duration = plan.durationMonths !== undefined ? Number(plan.durationMonths) : (input.employmentType === 'probation' ? 3 : 0)
      const expectedEndDate = plan.expectedEndDate ? new Date(plan.expectedEndDate) : addMonths(joining, duration)
      return {
        durationMonths: duration,
        expectedEndDate,
        confirmationStatus: plan.confirmationStatus || (input.employmentType === 'probation' ? 'in_probation' : 'confirmed'),
        confirmedAt: plan.confirmedAt || (input.employmentType === 'permanent' ? new Date() : null),
        confirmedBy: plan.confirmedBy || null,
        confirmationNote: plan.confirmationNote || '',
      }
    })()
    const leavePlan = {
      annualPaidLeaves: Number(input.leavePlan?.annualPaidLeaves ?? 18),
      cycleStartMonth: Number(input.leavePlan?.cycleStartMonth ?? 4),
      accrualMode: input.leavePlan?.accrualMode || 'grant_on_confirmation',
    }
    employee = await Employee.create({
      ...input,
      manager: input.manager || null,
      probation,
      leavePlan,
      shift: input.shift || { name: 'General Shift', startTime: '10:00', endTime: '18:30', graceMinutes: 15 },
      biometricTemplateVersion: input.biometricSamples?.length===3 ? 3 : 1,
      biometricEnrolledAt: input.biometricSamples?.length===3 ? new Date() : null,
      user: user._id,
    })
    user.employee = employee._id
    await user.save()
    await sendWelcomeEmail({ recipient: user.email, firstName: user.firstName, loginId: user.email, temporaryPassword: input.temporaryPassword })
    const preview = proratedAnnualPaidLeaves({ employee, asOf: new Date() })
    const result = employee.toObject()
    result.leavePreview = preview
    res.status(201).json({ success: true, data: result })
  } catch (error) {
    if (employee) await Employee.findByIdAndDelete(employee._id)
    await User.findByIdAndDelete(user._id)
    throw error
  }
}))
export default router
