import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { HttpError } from '../utils/httpError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required')
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret)
    const user = await User.findById(payload.sub).populate('employee')
    if (!user?.isActive) throw new HttpError(401, 'Account is inactive')
    req.user = user
    next()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'Invalid or expired access token')
  }
})

export const authorize = (...roles) => (req, _res, next) => {
  const allowed=roles.includes(req.user.role)||(req.user.role==='admin'&&roles.includes('super_admin'))
  if (!allowed) return next(new HttpError(403, 'You do not have permission for this action'))
  next()
}
