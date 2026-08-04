import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Holiday } from '../models/Holiday.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'

const router = Router()
router.use(authenticate)
const holidaySchema = z.object({ name:z.string().trim().min(2).max(100), date:z.coerce.date(), description:z.string().trim().max(300).optional(), type:z.enum(['public','company','optional']).default('public') })

router.get('/', asyncHandler(async (req,res) => {
  const year = Number(req.query.year || new Date().getFullYear())
  const holidays = await Holiday.find({ date:{ $gte:new Date(year,0,1), $lt:new Date(year+1,0,1) } }).sort({date:1})
  res.json({success:true,data:holidays})
}))
router.post('/', authorize('super_admin','hr_admin'), asyncHandler(async (req,res) => {
  const input=holidaySchema.parse(req.body)
  res.status(201).json({success:true,data:await Holiday.create({...input,createdBy:req.user._id})})
}))
router.put('/:id', authorize('super_admin','hr_admin'), asyncHandler(async (req,res) => {
  const holiday=await Holiday.findByIdAndUpdate(req.params.id,holidaySchema.parse(req.body),{new:true,runValidators:true})
  if(!holiday)throw new HttpError(404,'Holiday not found')
  res.json({success:true,data:holiday})
}))
router.delete('/:id', authorize('super_admin','hr_admin'), asyncHandler(async (req,res) => {
  const holiday=await Holiday.findByIdAndDelete(req.params.id)
  if(!holiday)throw new HttpError(404,'Holiday not found')
  res.json({success:true,message:'Holiday removed'})
}))
export default router
