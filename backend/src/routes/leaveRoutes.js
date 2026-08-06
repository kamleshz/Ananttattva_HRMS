import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'

const router = Router()
router.use(authenticate)

const requestSchema = z.object({
  leaveType: z.enum(['casual', 'sick', 'earned', 'unpaid']),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  reason: z.string().trim().min(5).max(500),
}).refine(value => value.endDate >= value.startDate, { message: 'End date must be on or after start date', path: ['endDate'] })

router.get('/', asyncHandler(async (req, res) => {
  const elevated = ['super_admin', 'admin', 'hr_admin', 'manager'].includes(req.user.role)
  const filter = elevated && req.query.scope === 'all' ? {} : { employee: req.user.employee?._id }
  if (req.query.status) filter.status = req.query.status
  const requests = await LeaveRequest.find(filter).populate('employee', 'firstName lastName employeeCode department').sort({ createdAt: -1 }).limit(100)
  res.json({ success: true, data: requests })
}))

router.post('/', asyncHandler(async (req, res) => {
  if (!req.user.employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const input = requestSchema.parse(req.body)
  const days = Math.floor((input.endDate - input.startDate) / 86400000) + 1
  const overlap = await LeaveRequest.exists({ employee: req.user.employee._id, status: { $in: ['pending','approved'] }, startDate: { $lte: input.endDate }, endDate: { $gte: input.startDate } })
  if (overlap) throw new HttpError(409, 'A leave request already exists for these dates')
  const request = await LeaveRequest.create({ ...input, days, employee: req.user.employee._id })
  res.status(201).json({ success: true, data: request })
}))

router.patch('/:id/:decision', authorize('super_admin','hr_admin','manager'), asyncHandler(async (req, res) => {
  if (!['approve','reject'].includes(req.params.decision)) throw new HttpError(400, 'Invalid review decision')
  const request = await LeaveRequest.findById(req.params.id)
  if (!request) throw new HttpError(404, 'Leave request not found')
  if (request.status !== 'pending') throw new HttpError(409, 'This request has already been reviewed')
  request.status = req.params.decision === 'approve' ? 'approved' : 'rejected'
  request.reviewedBy = req.user._id; request.reviewedAt = new Date(); request.reviewNote = String(req.body.reviewNote || '')
  await request.save()
  res.json({ success: true, data: request })
}))

export default router
