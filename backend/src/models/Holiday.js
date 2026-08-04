import mongoose from 'mongoose'

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  date: { type: Date, required: true, unique: true, index: true },
  description: { type: String, trim: true, maxlength: 300 },
  type: { type: String, enum: ['public', 'company', 'optional'], default: 'public' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

export const Holiday = mongoose.model('Holiday', holidaySchema)
