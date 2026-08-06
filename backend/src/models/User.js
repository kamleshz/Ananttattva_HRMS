import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['super_admin', 'admin', 'hr_admin', 'manager', 'finance_admin', 'it_admin', 'employee'], default: 'employee', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  lastLogin: Date,
}, { timestamps: true })

export const User = mongoose.model('User', userSchema)
