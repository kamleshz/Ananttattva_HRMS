import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { login, requestPasswordReset, resetPassword, sanitizeUser, verifyLoginOtp } from '../services/authService.js'

const router = Router()
router.post('/login', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.email(), password: z.string().min(8), loginType:z.enum(['admin','user']).default('user') }).parse(req.body)
  res.json({ success: true, data: await login(input.email, input.password, input.loginType) })
}))
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const input = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).parse(req.body)
  res.json({ success: true, data: await verifyLoginOtp(input.challengeId, input.code) })
}))
router.post('/forgot-password', asyncHandler(async (req,res)=>{
  const input=z.object({email:z.email()}).parse(req.body)
  res.json({success:true,data:await requestPasswordReset(input.email)})
}))
router.post('/reset-password', asyncHandler(async (req,res)=>{
  const input=z.object({challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/),newPassword:z.string().min(8).max(128)}).parse(req.body)
  res.json({success:true,data:await resetPassword(input.challengeId,input.code,input.newPassword)})
}))
router.get('/me', authenticate, (req, res) => res.json({ success: true, data: sanitizeUser(req.user) }))
router.post('/logout', authenticate, (_req, res) => res.json({ success: true, message: 'Signed out successfully' }))
export default router
