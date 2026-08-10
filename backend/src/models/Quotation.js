import mongoose from 'mongoose'
const objectId = mongoose.Schema.Types.ObjectId

const serviceLineSchema = new mongoose.Schema({
  businessCategory: { type: String, required: true, trim: true, index: true },
  serviceCategory: { type: String, required: true, trim: true, index: true },
  servicePeriodStart: { type: Date },
  servicePeriodEnd: { type: Date },
  servicesOffered: { type: String, required: true, trim: true },
  unit: { type: String, required: true, default: '1', trim: true },
  basicAmount: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true }
}, { _id: true, timestamps: false })

const quotationSchema = new mongoose.Schema({
  quotationCode: { type: String, required: true, unique: true, index: true },
  clientName: { type: String, required: true, trim: true, index: true },
  clientContactPerson: String,
  clientEmail: String,
  clientPhone: String,
  clientAddress: String,
  gstNumber: String,
  quotationDate: { type: Date, required: true, default: () => new Date() },
  validUntil: Date,
  status: { type: String, enum: ['Draft', 'Sent', 'Under Review', 'Approved', 'Rejected', 'Expired', 'Converted'], default: 'Draft', index: true },
  services: { type: [serviceLineSchema], required: true, validate: { validator: (val) => Array.isArray(val) && val.length > 0, message: 'At least one service line is required' } },
  subtotal: { type: Number, default: 0, min: 0 },
  gstRate: { type: Number, default: 0, min: 0, max: 100 },
  gstAmount: { type: Number, default: 0, min: 0 },
  grandTotal: { type: Number, default: 0, min: 0 },
  terms: String,
  notes: String,
  referenceNumber: String,
  createdBy: { type: objectId, ref: 'User', required: true, index: true },
  approvedBy: { type: objectId, ref: 'User' },
  approvedAt: Date,
  sentBy: { type: objectId, ref: 'User' },
  sentAt: Date,
  assignedTo: { type: objectId, ref: 'User' },
  attachments: [{ fileName: String, url: String, uploadedAt: { type: Date, default: () => new Date() } }],
  version: { type: Number, default: 1 },
  tags: [{ type: String, trim: true }]
}, { timestamps: true, collection: 'serviceQuotations' })

quotationSchema.index({ clientName: 'text', quotationCode: 'text', servicesOffered: 'text' })
quotationSchema.index({ status: 1, createdAt: -1 })
quotationSchema.pre('save', function (next) {
  const services = this.services || []
  this.subtotal = services.reduce((sum, s) => sum + (Number(s.basicAmount) || 0), 0)
  this.gstAmount = Math.round(this.subtotal * (Number(this.gstRate) || 0) * 100) / 10000
  this.grandTotal = this.subtotal + this.gstAmount
  next()
})

export const ServiceQuotation = mongoose.model('ServiceQuotation', quotationSchema)
export default ServiceQuotation
