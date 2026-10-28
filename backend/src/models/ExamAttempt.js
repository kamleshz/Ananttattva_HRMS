import mongoose from 'mongoose'

const examAnswerSchema = new mongoose.Schema({
  questionId: { type: Number, required: true },
  section: { type: Number, required: true },
  selected: { type: String, default: '' },
  answered: { type: Boolean, default: false },
  correct: { type: Boolean, default: false },
}, { _id: false })

const examSectionScoreSchema = new mongoose.Schema({
  section: { type: Number, required: true },
  title: { type: String, default: '' },
  correct: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
}, { _id: false })

const examAttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress', index: true },
  questions: { type: [examAnswerSchema], default: [] },
  score: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  sectionScores: { type: [examSectionScoreSchema], default: [] },
  tabSwitches: { type: Number, default: 0 },
  screenshotAttempts: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0 },
}, { timestamps: true })

examAttemptSchema.index({ createdAt: -1, _id: -1 })
examAttemptSchema.index({ status: 1, submittedAt: -1, _id: -1 })
examAttemptSchema.index({ user: 1, createdAt: -1, _id: -1 })
export const ExamAttempt = mongoose.models.ExamAttempt || mongoose.model('ExamAttempt', examAttemptSchema)
