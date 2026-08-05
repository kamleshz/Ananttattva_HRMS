import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { sendWelcomeEmail } from '../services/mailService.js'

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
router.get('/', authorize('super_admin','hr_admin','manager'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)))
  // Employee records are retained for HR history when a login user is deleted,
  // but orphaned records must not appear in the active People directory.
  const existingUserIds = await User.distinct('_id')
  const filter = { user: { $in: existingUserIds } }
  if (req.query.status) filter.employeeStatus = req.query.status
  if (req.query.search) filter.$text = { $search: req.query.search }
  const [items,total] = await Promise.all([Employee.find(filter).populate('manager','firstName lastName').skip((page-1)*limit).limit(limit).sort({createdAt:-1}), Employee.countDocuments(filter)])
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
}))
router.get('/organization-chart', authorize('super_admin','hr_admin','manager','it_admin'), asyncHandler(async (_req,res)=>{
  const existingUserIds=await User.distinct('_id',{isActive:true})
  const employees=await Employee.find({user:{$in:existingUserIds},employeeStatus:{$ne:'terminated'}}).select('employeeCode firstName lastName profilePhoto department designation workLocation employeeStatus manager').sort({firstName:1,lastName:1}).lean()
  const employeeIds=new Set(employees.map(employee=>String(employee._id)))
  const items=employees.map(employee=>({...employee,manager:employee.manager&&employeeIds.has(String(employee.manager))?employee.manager:null}))
  res.json({success:true,data:items})
}))
router.get('/:id', asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).populate('manager','firstName lastName employeeCode')
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success: true, data: employee })
}))
router.get('/:id/biometrics', authorize('super_admin','hr_admin'), asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).select('+biometricSamples')
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success:true, data:{
    employeeId:employee.id,
    biometricEnrolledAt:employee.biometricEnrolledAt,
    biometricTemplateVersion:employee.biometricTemplateVersion,
    photos:(employee.biometricSamples || []).map(({ pose, photo }) => ({ pose, photo })),
  } })
}))
router.put('/:id/biometrics', authorize('super_admin','hr_admin'), asyncHandler(async (req, res) => {
  const input = biometricEnrollmentSchema.parse(req.body)
  const employee = await Employee.findByIdAndUpdate(req.params.id, { ...input, biometricTemplateVersion:3, biometricEnrolledAt:new Date() }, { new:true, runValidators:true })
  if (!employee) throw new HttpError(404, 'Employee not found')
  res.json({ success:true, data:{ id:employee.id, employeeCode:employee.employeeCode, biometricEnrolledAt:employee.biometricEnrolledAt, biometricTemplateVersion:employee.biometricTemplateVersion } })
}))
router.post('/', authorize('super_admin','hr_admin'), asyncHandler(async (req, res) => {
  const input = z.object({ employeeCode:z.string().min(3), firstName:z.string().min(1), lastName:z.string().min(1), dateOfBirth:z.coerce.date().max(new Date(), 'Date of birth cannot be in the future'), officialEmail:z.email(), department:z.string().optional(), designation:z.string().optional(), temporaryPassword:z.string().min(8), role:z.enum(['super_admin','hr_admin','manager','finance_admin','it_admin','employee']).default('employee'), ...biometricEnrollmentSchema.shape }).parse(req.body)
  if (input.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Only an Admin can create another Admin account')
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12)
  const user = await User.create({ firstName:input.firstName, lastName:input.lastName, email:input.officialEmail, passwordHash, role:input.role, mustChangePassword:true })
  let employee
  try {
    employee=await Employee.create({ ...input, biometricTemplateVersion:3, biometricEnrolledAt:new Date(), user:user._id })
    user.employee=employee._id
    await user.save()
    await sendWelcomeEmail({recipient:user.email,firstName:user.firstName,loginId:user.email,temporaryPassword:input.temporaryPassword})
    res.status(201).json({success:true,data:employee})
  } catch(error) {
    if(employee)await Employee.findByIdAndDelete(employee._id)
    await User.findByIdAndDelete(user._id)
    throw error
  }
}))
export default router
