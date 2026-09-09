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
  locationStatus: { type: String, enum: ['verified', 'captured', 'unavailable', 'low_accuracy', 'outside_boundary', 'not_configured', 'destination_not_configured'], default: 'unavailable' },
  ipAddress: String,
  device: String,
  source: { type: String, enum: ['biometric', 'manual_fallback', 'manual_hr', 'manual_approval', 'system_auto', 'hr_correction'], default: 'biometric' },
  manualRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceAttendanceRequest' },
  proofPhotoStorageKey: String,
  verification: mongoose.Schema.Types.Mixed,
}, { _id: false })

const missingCheckoutSchema = new mongoose.Schema({
  detectedAt: Date,
  alertSentAt: Date,
  deadline: Date,
  justificationStatus: { type: String, enum: ['none', 'pending', 'submitted', 'approved', 'rejected', 'expired'], default: 'none' },
  justificationRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceCorrectionRequest' },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewAction: { type: String, enum: ['none', 'approved', 'rejected', 'expired'], default: 'none' },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  finalizedAt: Date,
  conversionReason: { type: String, maxlength: 120, default: '' },
  leaveRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest' },
  workingMinutesBefore: { type: Number, min: 0, default: 0 },
  workingMinutesRestored: { type: Number, min: 0, default: 0 },
  history: [{
    timestamp: Date,
    status: String,
    message: String,
    actor: String,
    _id: false,
  }],
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
  attendanceDayType: { type: String, enum: ['full_day','half_day'], default: 'full_day', index: true },
  expectedWorkingMinutes: { type: Number, default: 510 },
  completionStatus: { type: String, enum: ['pending','completed','incomplete'], default: 'pending', index: true },
  missedCheckIn: { type: Boolean, default: false },
  missedCheckOut: { type: Boolean, default: false },
  missingCheckout: missingCheckoutSchema,
  exceptionStatus: { type: String, trim: true, maxlength: 80, default: '' },
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

attendanceSchema.path('missedCheckOut').set(function (value) {
  if (value === true && (!this.missingCheckout || this.missingCheckout.justificationStatus === 'none')) {
    if (!this.missingCheckout) {
      this.missingCheckout = {}
    }
    this.missingCheckout.justificationStatus = 'pending'
  }
  return value
})

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true })
attendanceSchema.index({ employee: 1, date: 1, 'missingCheckout.justificationStatus': 1 }, { sparse: true })
export const Attendance = mongoose.model('Attendance', attendanceSchema)
