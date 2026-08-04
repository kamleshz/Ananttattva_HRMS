import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { login, sanitizeUser, verifyLoginOtp } from '../services/authService.js'

const router = Router()
router.post('/login', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.email(), password: z.string().min(8), loginType:z.enum(['admin','user']).default('user') }).parse(req.body)
  res.json({ success: true, data: await login(input.email, input.password, input.loginType) })
}))
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const input = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).parse(req.body)
  res.json({ success: true, data: await verifyLoginOtp(input.challengeId, input.code) })
}))
router.get('/me', authenticate, (req, res) => res.json({ success: true, data: sanitizeUser(req.user) }))
router.post('/logout', authenticate, (_req, res) => res.json({ success: true, message: 'Signed out successfully' }))
export default router
