import mongoose from 'mongoose'

const approvalStepSchema = new mongoose.Schema({
  role: { type: String, enum: ['manager', 'hr_admin', 'super_admin'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'skipped'], default: 'pending' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  comment: { type: String, trim: true, maxlength: 500, default: '' },
  actedAt: Date,
  expectedActor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false })

const leaveRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
  leaveType: { type: String, enum: ['paid_leave', 'unpaid_leave', 'casual', 'sick', 'earned', 'unpaid'], required: true, index: true },
  dayType: { type: String, enum: ['full_day', 'half_day'], default: 'full_day', required: true },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true, min: 0.5 },
  workingDays: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: Date,
  reviewNote: { type: String, trim: true, maxlength: 500 },
  policySnapshot: {
    annualPaidLeaves: Number,
    cycleStartMonth: Number,
    entitledPaidLeaves: Number,
    eligibleMonths: Number,
    canApplyPaidLeave: Boolean,
    longLeave: {
      isLongLeave: Boolean,
      noticeDaysRequired: Number,
      calendarNoticeDays: Number,
      meetsAdvanceNotice: Boolean,
    },
  },
  payments: {
    mode: { type: String, enum: ['paid', 'unpaid', 'partially_paid'], default: 'paid' },
    paidDays: { type: Number, default: 0 },
    unpaidDays: { type: Number, default: 0 },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
  },
  workflow: {
    requiredSteps: { type: [String], default: [] },
    currentStepIndex: { type: Number, default: 0 },
    steps: { type: [approvalStepSchema], default: [] },
    nextRole: { type: String, enum: ['manager', 'hr_admin', 'super_admin'], default: null },
  },
  fyLabel: { type: String, trim: true },
}, { timestamps: true })

leaveRequestSchema.index({ employee: 1, startDate: -1 })
leaveRequestSchema.index({ reportingManager: 1, status: 1 })
leaveRequestSchema.index({ 'workflow.nextRole': 1, status: 1 })
export const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema)
