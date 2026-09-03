import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { HttpError } from '../utils/httpError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required')
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret)
    const user = await User.findById(payload.sub).populate('employee')
    if (!user?.isActive) throw new HttpError(401, 'Account is inactive')
    // Older/imported accounts can have Employee.user populated while the
    // inverse User.employee reference is missing. Face enrollment is stored on
    // Employee, so repair that verified one-to-one link before biometric APIs
    // evaluate attendance eligibility.
    if (!user.employee) {
      const employee = await Employee.findOne({
        employeeStatus: { $in: ['active', 'notice_period'] },
        $or: [
          { user: user._id },
          { officialEmail: user.email.toLowerCase() },
        ],
      })
      if (employee) {
        user.employee = employee._id
        await user.save()
        if (!employee.user) await Employee.updateOne({ _id: employee._id, user: null }, { $set: { user: user._id } })
        await user.populate('employee')
        console.info('[auth] repaired employee account link', { userId: user.id, employeeCode: employee.employeeCode })
      }
    }
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
