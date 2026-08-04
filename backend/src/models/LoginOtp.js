import mongoose from 'mongoose'

const loginOtpSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attemptsRemaining: { type: Number, default: 5 },
  usedAt: { type: Date, default: null },
}, { timestamps: true })

export const LoginOtp = mongoose.model('LoginOtp', loginOtpSchema)
