import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { ServiceQuotation } from '../models/Quotation.js'
import { OrganizationProfile } from '../models/Organization.js'
import { generateQuotationPdf } from '../services/quotationPdfService.js'

const router = Router()

const serviceLineSchema = z.object({
  _id: z.any().optional(),
  businessCategory: z.string().min(1, 'Business Category is required').max(120),
  serviceCategory: z.string().min(1, 'Service Category is required').max(120),
  servicePeriodStart: z.coerce.date().optional().nullable(),
  servicePeriodEnd: z.coerce.date().optional().nullable(),
  servicesOffered: z.string().min(1, 'Services Offered is required').max(500),
  unit: z.string().min(1, 'Unit is required').max(20).default('1'),
  basicAmount: z.coerce.number().min(0, 'Basic Amount cannot be negative'),
  notes: z.string().max(500).optional().nullable()
})

const quotationInput = z.object({
  clientName: z.string().min(1, 'Client Name is required').max(200),
  clientContactPerson: z.string().max(200).optional().nullable(),
  clientEmail: z.string().email('Valid email required').optional().or(z.literal('')).nullable(),
  clientPhone: z.string().max(30).optional().nullable(),
  clientAddress: z.string().max(600).optional().nullable(),
  gstNumber: z.string().max(30).optional().nullable(),
  quotationDate: z.coerce.date().optional().default(() => new Date()),
  validUntil: z.coerce.date().optional().nullable(),
  status: z.enum(['Draft', 'Sent', 'Under Review', 'Approved', 'Rejected', 'Expired', 'Converted']).optional(),
  services: z.array(serviceLineSchema).min(1, 'At least one service line is required'),
  gstRate: z.coerce.number().min(0).max(100).optional().default(0),
  terms: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
  assignedTo: z.string().regex(/^[0-9a-f]{24}$/).optional().nullable(),
  tags: z.array(z.string().max(40)).optional().default([])
})

function nextQuotationCode(today = new Date()) {
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  const r = Math.floor(1000 + Math.random() * 9000)
  return `QUO-${y}${m}${d}-${r}`
}

const bizRoles = ['super_admin', 'admin', 'hr_admin', 'finance_admin']

router.use(authenticate)

router.get('/', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const { q = '', status = '' } = req.query
  const filter = {}
  if (status) filter.status = String(status)
  if (q) {
    filter['$or'] = [
      { clientName: { $regex: String(q), $options: 'i' } },
      { quotationCode: { $regex: String(q), $options: 'i' } },
      { 'services.servicesOffered': { $regex: String(q), $options: 'i' } },
      { 'services.businessCategory': { $regex: String(q), $options: 'i' } },
      { 'services.serviceCategory': { $regex: String(q), $options: 'i' } }
    ]
  }
  const items = await ServiceQuotation.find(filter)
    .populate('createdBy assignedTo approvedBy sentBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()
  res.json({ success: true, data: items })
}))

router.get('/:id', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const doc = await ServiceQuotation.findById(req.params.id)
    .populate('createdBy assignedTo approvedBy sentBy', 'firstName lastName email')
    .lean()
  if (!doc) throw new HttpError(404, 'Quotation not found')
  res.json({ success: true, data: doc })
}))

router.post('/', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const input = quotationInput.parse(req.body)
  const existing = await ServiceQuotation.countDocuments()
  let code = nextQuotationCode()
  while (await ServiceQuotation.exists({ quotationCode: code })) code = nextQuotationCode()
  const created = await ServiceQuotation.create({ ...input, quotationCode: code, createdBy: req.user._id })
  await created.populate('createdBy assignedTo approvedBy sentBy', 'firstName lastName email')
  res.status(201).json({ success: true, data: created.toObject() })
  void existing
}))

router.put('/:id', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const doc = await ServiceQuotation.findById(req.params.id)
  if (!doc) throw new HttpError(404, 'Quotation not found')
  const input = quotationInput.partial().parse(req.body)
  Object.assign(doc, input)
  doc.version = (doc.version || 1) + 1
  await doc.save()
  await doc.populate('createdBy assignedTo approvedBy sentBy', 'firstName lastName email')
  res.json({ success: true, data: doc.toObject() })
}))

router.patch('/:id/status', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const { status, note } = z.object({ status: z.enum(['Draft', 'Sent', 'Under Review', 'Approved', 'Rejected', 'Expired', 'Converted']), note: z.string().max(1000).optional().nullable() }).parse(req.body)
  const doc = await ServiceQuotation.findById(req.params.id)
  if (!doc) throw new HttpError(404, 'Quotation not found')
  doc.status = status
  if (status === 'Approved') { doc.approvedBy = req.user._id; doc.approvedAt = new Date() }
  if (status === 'Sent') { doc.sentBy = req.user._id; doc.sentAt = new Date() }
  if (note) doc.notes = doc.notes ? `${doc.notes}\n${note}` : note
  await doc.save()
  await doc.populate('createdBy assignedTo approvedBy sentBy', 'firstName lastName email')
  res.json({ success: true, data: doc.toObject() })
}))

router.delete('/:id', authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const doc = await ServiceQuotation.findByIdAndDelete(req.params.id)
  if (!doc) throw new HttpError(404, 'Quotation not found')
  res.json({ success: true, data: { _id: doc._id } })
}))

router.get('/:id/pdf', authorize(...bizRoles), asyncHandler(async (req, res) => {
  const doc = await ServiceQuotation.findById(req.params.id)
  if (!doc) throw new HttpError(404, 'Quotation not found')
  const org = (await OrganizationProfile.findOne({ singletonKey: 'organization' }).lean()) || {}
  const pdfBuffer = await generateQuotationPdf(doc.toObject(), org)
  const fileName = `${doc.quotationCode}-${String(doc.clientName || 'client').replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${fileName}"`,
    'Cache-Control': 'private, no-store'
  })
  res.send(pdfBuffer)
}))

export default router
