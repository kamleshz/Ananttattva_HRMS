import mongoose from 'mongoose'

const biometricSampleSchema = new mongoose.Schema({
  pose: { type: String, enum: ['front', 'left', 'right'], required: true },
  photo: { type: String, required: true },
  template: { type: [Number], required: true },
}, { _id: false })

const employeeSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, unique: true, trim: true, index: true },
  firstName: { type: String, required: true, trim: true },
  middleName: { type: String, trim: true },
  lastName: { type: String, required: true, trim: true },
  officialEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
  personalEmail: { type: String, lowercase: true, trim: true },
  mobile: { type: String, trim: true },
  dateOfBirth: { type: Date, default: null, index: true },
  gender: { type: String, enum: ['male','female','non_binary','prefer_not_to_say','not_specified'], default: 'not_specified', index: true },
  profilePhoto: { type: String, default: null },
  biometricTemplate: { type: [Number], select: false, default: undefined },
  biometricSamples: { type: [biometricSampleSchema], select: false, default: undefined },
  biometricTemplateVersion: { type: Number, default: 1 },
  biometricEnrolledAt: { type: Date, default: null },
  department: { type: String, default: 'General', index: true },
  designation: { type: String, default: 'Employee' },
  branch: { type: String, default: 'Head Office' },
  workLocation: { type: String, default: 'Main Office' },
  joiningDate: { type: Date, default: Date.now },
  employmentType: { type: String, enum: ['permanent', 'probation', 'contract', 'intern', 'consultant'], default: 'permanent' },
  employeeStatus: { type: String, enum: ['active', 'inactive', 'notice_period', 'resigned', 'terminated'], default: 'active', index: true },
  shift: {
    name: { type: String, default: 'General Shift' },
    startTime: { type: String, default: '10:00' },
    endTime: { type: String, default: '18:30' },
    graceMinutes: { type: Number, default: 15 },
  },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  probation: {
    durationMonths: { type: Number, min: 0, max: 24, default: 3 },
    expectedEndDate: { type: Date, default: null },
    confirmationStatus: { type: String, enum: ['in_probation', 'pending_confirmation', 'confirmed', 'extended'], default: 'in_probation', index: true },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmationNote: { type: String, trim: true, maxLength: 500, default: '' },
  },
  leavePlan: {
    annualPaidLeaves: { type: Number, min: 0, max: 60, default: 18 },
    cycleStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    accrualMode: { type: String, enum: ['monthly_1_5', 'grant_on_confirmation'], default: 'grant_on_confirmation' },
  },
}, { timestamps: true })

employeeSchema.index({ firstName: 'text', lastName: 'text', employeeCode: 'text', officialEmail: 'text' })
export const Employee = mongoose.model('Employee', employeeSchema)
