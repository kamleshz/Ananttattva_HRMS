import mongoose from 'mongoose'

const allowanceClaimSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  travelDate: { type: Date, required: true },
  travelLocation: { type: String, required: true, trim: true, maxlength: 200 },
  travelAllowance: { type: Number, required: true, min: 0 },
  extraAllowance: { type: Number, default: 0, min: 0 },
  extraAllowanceReason: { type: String, trim: true, maxlength: 500, default: '' },
  totalAmount: { type: Number, required: true, min: 0 },
  monthlyLimit: { type: Number, default: 2000, min: 0 },
  capAcceptableAmount: { type: Number, min: 0 },
  acceptableAmount: { type: Number, min: 0 },
  nonAcceptableAmount: { type: Number, default: 0, min: 0 },
  specialApproval: {
    status: { type: String, enum: ['not_requested', 'pending', 'approved', 'rejected'], default: 'not_requested' },
    amount: { type: Number, min: 0, default: 0 },
    explanation: { type: String, trim: true, maxlength: 1000, default: '' },
    proof: {
      fileName: String,
      mimeType: String,
      data: { type: String, select: false },
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  },
  allowanceMonth: { type: String, index: true },
  proof: {
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    data: { type: String, required: true, select: false },
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: Date,
  reviewNote: { type: String, trim: true, maxlength: 300 },
}, { timestamps: true })

allowanceClaimSchema.index({ employee: 1, travelDate: -1 })
allowanceClaimSchema.index({ employee:1, allowanceMonth:1, status:1 })
export const AllowanceClaim = mongoose.model('AllowanceClaim', allowanceClaimSchema)
