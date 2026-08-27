import mongoose from 'mongoose'

const scheduledEmailSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['allowance_month_end','birthday_greeting'], required: true, index: true },
  period: { type: String, required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ['processing', 'sent', 'failed'], default: 'processing', index: true },
  attempts: { type: Number, default: 0 },
  sentAt: Date,
  lastError: { type: String, default: '' },
}, { timestamps: true })

export const ScheduledEmail = mongoose.model('ScheduledEmail', scheduledEmailSchema)
