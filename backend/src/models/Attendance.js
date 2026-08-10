import mongoose from 'mongoose'

const punchSchema = new mongoose.Schema({
  time: Date,
  photo: String,
  latitude: Number,
  longitude: Number,
  accuracyMeters: Number,
  distanceMeters: Number,
  officeLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'OfficeLocation' },
  officeName: String,
  address: String,
  ipAddress: String,
  device: String,
  source: { type: String, enum: ['biometric', 'manual_fallback', 'manual_hr', 'manual_approval', 'system_auto', 'hr_correction'], default: 'biometric' },
  manualRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceAttendanceRequest' },
  proofPhotoStorageKey: String,
  verification: mongoose.Schema.Types.Mixed,
}, { _id: false })

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  date: { type: Date, required: true, index: true },
  checkIn: punchSchema,
  checkOut: punchSchema,
  attendanceMode: { type: String, enum: ['office', 'wfh', 'client_location', 'field_visit'], default: 'office' },
  locationVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['present', 'absent', 'late', 'half_day', 'wfh', 'on_leave', 'holiday', 'weekend', 'missing_checkout'], default: 'present' },
  workingMinutes: { type: Number, default: 0 },
  lateMinutes: { type: Number, default: 0 },
  lateOccurrenceInMonth: { type: Number, default: 0 },
  halfDayReason: { type: String, default: null },
  policyHalfDayOccurrenceInMonth: { type: Number, default: 0 },
  policyEscalatedAt: { type: Date, default: null },
  earlyCheckoutMinutes: { type: Number, default: 0 },
  overtimeMinutes: { type: Number, default: 0 },
  checkoutType: { type:String, enum:['MANUAL_CHECKOUT','AUTO_CHECKOUT','HR_CORRECTION'], default:null },
  autoCheckout: {
    appliedAt: Date,
    scheduledCheckoutTime: Date,
    previousStatus: String,
  },
  correctionAudit: [{
    previousCheckoutTime: Date,
    correctedCheckoutTime: Date,
    reason: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
  }],
  biometricVerification: {
    verified: { type: Boolean, default: false },
    method: String,
    challenge: String,
    livenessScore: Number,
    faceMatchScore: Number,
    verifiedAt: Date,
  },
}, { timestamps: true })

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true })
export const Attendance = mongoose.model('Attendance', attendanceSchema)
