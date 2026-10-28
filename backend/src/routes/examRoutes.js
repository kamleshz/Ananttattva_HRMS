import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { ExamAttempt } from '../models/ExamAttempt.js'
import { PWM_QUESTIONS, PWM_SECTIONS, PWM_TOTAL } from '../data/pwmQuestionBank.js'

const router = Router()

// The assessment is restricted to HR and administrators.
router.use(authenticate, authorize('super_admin', 'admin', 'hr_admin'))

// Only these sections are included in the assessment paper.
const ACTIVE_SECTION_IDS = [6, 8]
const QUESTIONS_PER_SECTION = 10
const SECONDS_PER_QUESTION = 30
const PASS_PERCENT = 60
const OBJECT_ID = /^[0-9a-f]{24}$/i

const EXAM_SECTIONS = PWM_SECTIONS.filter((section) => ACTIVE_SECTION_IDS.includes(section.id))
const SECTION_TITLES = new Map(PWM_SECTIONS.map((section) => [section.id, section.title]))
const QUESTIONS_BY_ID = new Map(PWM_QUESTIONS.map((item) => [item.id, item]))
const QUESTIONS_BY_SECTION = (() => {
  const groups = new Map()
  for (const item of PWM_QUESTIONS) {
    if (!groups.has(item.s)) groups.set(item.s, [])
    groups.get(item.s).push(item)
  }
  return groups
})()

const shuffle = (items) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}

const loadOwnAttempt = async (attemptId, userId) => {
  const attempt = await ExamAttempt.findOne({ _id: attemptId, user: userId })
  if (!attempt) throw new HttpError(404, 'Exam attempt not found')
  return attempt
}

const attemptToRow = (attempt) => {
  const user = attempt.user || {}
  const employee = attempt.employee || {}
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
    || [employee.firstName, employee.lastName].filter(Boolean).join(' ')
    || user.email
    || 'Unknown user'
  return {
    id: String(attempt._id),
    name,
    email: user.email || '',
    role: user.role || '',
    employeeCode: employee.employeeCode || '',
    department: employee.department || '',
    score: attempt.score,
    total: attempt.total,
    percent: attempt.percent,
    passed: Boolean(attempt.passed),
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    tabSwitches: attempt.tabSwitches,
    screenshotAttempts: attempt.screenshotAttempts,
    sectionScores: (attempt.sectionScores || []).map((item) => ({
      section: item.section,
      title: item.title,
      correct: item.correct,
      total: item.total,
    })),
  }
}

router.get('/meta', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      bankSize: PWM_TOTAL,
      sectionCount: EXAM_SECTIONS.length,
      perSection: QUESTIONS_PER_SECTION,
      questionsPerExam: EXAM_SECTIONS.length * QUESTIONS_PER_SECTION,
      secondsPerQuestion: SECONDS_PER_QUESTION,
      passPercent: PASS_PERCENT,
      sections: EXAM_SECTIONS,
    },
  })
}))

// Starts a new attempt. The paper is drawn evenly from the active sections, the
// question order and option order are reshuffled every time, and the answer key
// stays on the server. The attempt row records what was asked so the report can
// be rebuilt without trusting the client.
router.get('/questions', asyncHandler(async (req, res) => {
  const requested = Number.parseInt(req.query.perSection, 10)
  const perSection = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : QUESTIONS_PER_SECTION
  const picked = []
  for (const section of shuffle(EXAM_SECTIONS)) {
    const pool = QUESTIONS_BY_SECTION.get(section.id) || []
    picked.push(...shuffle(pool).slice(0, perSection))
  }
  const paper = shuffle(picked)

  const attempt = await ExamAttempt.create({
    user: req.user._id,
    employee: req.user.employee?._id || req.user.employee || null,
    questions: paper.map((item) => ({ questionId: item.id, section: item.s })),
    total: paper.length,
    startedAt: new Date(),
  })

  res.json({
    success: true,
    data: {
      attemptId: attempt._id,
      secondsPerQuestion: SECONDS_PER_QUESTION,
      questions: paper.map((item) => ({
        id: item.id,
        section: item.s,
        sectionTitle: SECTION_TITLES.get(item.s) || '',
        question: item.q,
        // Options are shuffled so the correct choice is not always the same letter.
        options: shuffle(item.o),
      })),
    },
  })
}))

const answerSchema = z.object({
  attemptId: z.string().trim().regex(OBJECT_ID, 'Invalid exam attempt'),
  questionId: z.coerce.number().int(),
  selected: z.string().trim().max(1000).optional(),
})

// Graded one answer at a time, so the client only learns the correct option
// after the candidate has committed. The result is stored on the attempt.
router.post('/answer', asyncHandler(async (req, res) => {
  const parsed = answerSchema.parse(req.body)
  const attempt = await loadOwnAttempt(parsed.attemptId, req.user._id)
  if (attempt.status !== 'in_progress') throw new HttpError(409, 'This exam has already been submitted.')

  const entry = attempt.questions.find((item) => item.questionId === parsed.questionId)
  if (!entry) throw new HttpError(404, 'Question not found in this attempt')

  const source = QUESTIONS_BY_ID.get(entry.questionId)
  const correctOption = source.o[source.a]
  const selected = source.o.includes(parsed.selected) ? parsed.selected : ''

  entry.selected = selected
  entry.answered = selected.length > 0
  entry.correct = selected.length > 0 && selected === correctOption
  await attempt.save()

  res.json({
    success: true,
    data: {
      id: entry.questionId,
      selected: entry.selected,
      answered: entry.answered,
      correct: entry.correct,
      correctOption,
      explanation: source.e || '',
    },
  })
}))

const submitSchema = z.object({
  attemptId: z.string().trim().regex(OBJECT_ID, 'Invalid exam attempt'),
  tabSwitches: z.coerce.number().int().min(0).max(1000).optional(),
  screenshotAttempts: z.coerce.number().int().min(0).max(1000).optional(),
})

// Scores the attempt server-side and stores the report row.
router.post('/submit', asyncHandler(async (req, res) => {
  const parsed = submitSchema.parse(req.body)
  const attempt = await loadOwnAttempt(parsed.attemptId, req.user._id)
  if (attempt.status === 'submitted') throw new HttpError(409, 'This exam has already been submitted.')

  const total = attempt.questions.length
  const score = attempt.questions.filter((entry) => entry.correct).length
  const percent = total ? Math.round((score / total) * 100) : 0

  const grouped = new Map()
  for (const entry of attempt.questions) {
    if (!grouped.has(entry.section)) {
      grouped.set(entry.section, {
        section: entry.section,
        title: SECTION_TITLES.get(entry.section) || '',
        correct: 0,
        total: 0,
      })
    }
    const bucket = grouped.get(entry.section)
    bucket.total += 1
    if (entry.correct) bucket.correct += 1
  }

  attempt.score = score
  attempt.total = total
  attempt.percent = percent
  attempt.passed = percent >= PASS_PERCENT
  attempt.sectionScores = [...grouped.values()].sort((a, b) => a.section - b.section)
  attempt.status = 'submitted'
  attempt.submittedAt = new Date()
  attempt.durationSeconds = Math.max(0, Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000))
  attempt.tabSwitches = parsed.tabSwitches ?? 0
  attempt.screenshotAttempts = parsed.screenshotAttempts ?? 0
  await attempt.save()

  res.json({
    success: true,
    data: {
      attemptId: attempt._id,
      score,
      total,
      percent,
      passed: attempt.passed,
      passPercent: PASS_PERCENT,
      submittedAt: attempt.submittedAt,
      durationSeconds: attempt.durationSeconds,
      sectionScores: attempt.sectionScores,
    },
  })
}))

// Full question-by-question review for a submitted attempt.
router.get('/reports/:attemptId', asyncHandler(async (req, res) => {
  const parsed = z.object({
    attemptId: z.string().trim().regex(OBJECT_ID, 'Invalid exam attempt'),
  }).parse(req.params)

  const attempt = await ExamAttempt.findOne({ _id: parsed.attemptId, status: 'submitted' })
    .populate('user', 'firstName lastName email role')
    .populate('employee', 'firstName lastName employeeCode department')
    .lean()

  if (!attempt) throw new HttpError(404, 'Exam attempt not found')

  const detail = {
    ...attemptToRow(attempt),
    questions: (attempt.questions || []).map((entry) => {
      const source = QUESTIONS_BY_ID.get(entry.questionId)
      const options = source?.o || []
      return {
        id: entry.questionId,
        section: entry.section,
        sectionTitle: SECTION_TITLES.get(entry.section) || '',
        question: source?.q || 'Question not found',
        options,
        selected: entry.selected || '',
        answered: Boolean(entry.answered),
        correct: Boolean(entry.correct),
        correctOption: source ? options[source.a] : '',
        explanation: source?.e || '',
      }
    }),
  }

  res.json({ success: true, data: detail })
}))

// Report of every submitted attempt, for HR and administrators.
router.get('/reports', asyncHandler(async (_req, res) => {
  const attempts = await ExamAttempt.find({ status: 'submitted' })
    .allowDiskUse(true)
    .populate('user', 'firstName lastName email role')
    .populate('employee', 'firstName lastName employeeCode department')
    .sort({ submittedAt: -1, _id: -1 })
    .limit(500)
    .lean()

  const rows = attempts.map(attemptToRow)

  const passedCount = rows.filter((row) => row.passed).length
  const summary = {
    attempts: rows.length,
    passed: passedCount,
    failed: rows.length - passedCount,
    passRate: rows.length ? Math.round((passedCount / rows.length) * 100) : 0,
    averagePercent: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.percent, 0) / rows.length) : 0,
    bestPercent: rows.reduce((best, row) => Math.max(best, row.percent), 0),
    passPercent: PASS_PERCENT,
  }

  res.json({ success: true, data: { summary, attempts: rows, sections: EXAM_SECTIONS } })
}))

export default router
