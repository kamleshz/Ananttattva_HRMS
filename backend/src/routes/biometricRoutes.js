import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticate } from '../middleware/auth.js'
import { Employee } from '../models/Employee.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'

const router = Router()
router.use(authenticate)
const challenges = ['blink', 'smile', 'turn']
const FACE_MATCH_THRESHOLD = .65
const MINIMUM_IDENTITY_TEMPLATE_VERSION = 2

router.post('/challenge', asyncHandler(async (req, res) => {
  if (!req.user.employee) throw new HttpError(409, 'No employee profile is linked to this account')
  const employee = await Employee.findById(req.user.employee._id).select('+biometricTemplate +biometricSamples biometricTemplateVersion')
  const templates = employee?.biometricSamples?.map(sample => sample.template).filter(template => template?.length >= 128) || []
  if (!templates.length && employee?.biometricTemplate?.length >= 128) templates.push(employee.biometricTemplate)
  if (!templates.length || employee.biometricTemplateVersion < MINIMUM_IDENTITY_TEMPLATE_VERSION) {
    throw new HttpError(409, 'Secure face re-enrollment is required. Ask an administrator to capture this employee’s face again.')
  }
  const mode = z.enum(['check-in','check-out']).default('check-in').parse(req.body.mode)
  const challenge = challenges[Math.floor(Math.random() * challenges.length)]
  const challengeToken = jwt.sign({ purpose:'biometric_challenge', challenge, mode }, env.jwtSecret, { subject:req.user.id, expiresIn:'2m', jwtid:randomUUID() })
  res.json({ success:true, data:{ challenge, challengeToken, expiresInSeconds:120 } })
}))

const verificationSchema = z.object({
  challengeToken: z.string().min(20),
  challenge: z.enum(['blink','smile','turn']),
  photo: z.string().startsWith('data:image/').max(4_500_000),
  faceTemplate: z.array(z.number().finite()).min(128).max(2048),
  livenessScore: z.number().min(.65).max(1),
  faceCount: z.literal(1),
})

function compareTemplates(reference, candidate) {
  if (!reference?.length || reference.length !== candidate.length) return 0
  const squaredDifference = reference.reduce((sum,value,index) => sum + ((value-candidate[index]) ** 2), 0)
  const distance = Math.round(100 * 25 * squaredDifference) / 100
  const normalized = (1 - (Math.sqrt(distance) / 100) - .2) / .6
  return Math.round(100 * Math.max(0, Math.min(1, normalized))) / 100
}

router.post('/verify', asyncHandler(async (req, res) => {
  const input = verificationSchema.parse(req.body)
  let challengePayload
  try { challengePayload = jwt.verify(input.challengeToken, env.jwtSecret) }
  catch { throw new HttpError(401, 'Biometric challenge expired. Please try again') }
  if (challengePayload.purpose !== 'biometric_challenge' || challengePayload.sub !== req.user.id || challengePayload.challenge !== input.challenge) throw new HttpError(401, 'Invalid biometric challenge')
  const employee = await Employee.findById(req.user.employee._id).select('+biometricTemplate +biometricSamples')
  if (!employee) throw new HttpError(404, 'Employee profile not found')
  const templates = employee.biometricSamples?.map(sample => sample.template).filter(template => template?.length >= 128) || []
  if (!templates.length && employee.biometricTemplate?.length >= 128) templates.push(employee.biometricTemplate)
  if (!templates.length || employee.biometricTemplateVersion < MINIMUM_IDENTITY_TEMPLATE_VERSION) throw new HttpError(409, 'Secure face re-enrollment is required before attendance can be recorded')
  const faceMatchScore = Math.max(...templates.map(template => compareTemplates(template, input.faceTemplate)))
  if (faceMatchScore < FACE_MATCH_THRESHOLD) throw new HttpError(403, 'Face does not match the enrolled employee. Attendance was not recorded.', { faceMatchScore:Number(faceMatchScore.toFixed(3)), requiredScore:FACE_MATCH_THRESHOLD })
  const photoHash = createHash('sha256').update(input.photo).digest('hex')
  const verificationToken = jwt.sign({ purpose:'biometric_verification', mode:challengePayload.mode, challenge:input.challenge, livenessScore:input.livenessScore, faceMatchScore, identityTemplateVersion:employee.biometricTemplateVersion, photoHash }, env.jwtSecret, { subject:req.user.id, expiresIn:'90s', jwtid:randomUUID() })
  res.json({ success:true, data:{ verificationToken, faceMatchScore, livenessScore:input.livenessScore } })
}))

export default router
