import multer from 'multer'
import { ZodError } from 'zod'
import mongoose from 'mongoose'

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
}

export function errorHandler(error, _req, res, _next) {
  let status = error.status || 500
  let message = error.message || 'Internal server error'
  let details = error.details
  if (error instanceof ZodError) { status = 422; message = 'Validation failed'; details = error.issues }
  if (error instanceof multer.MulterError) { status = 400; message = error.message }
  if (error instanceof mongoose.Error.ValidationError) {
    status = 422
    message = 'Validation failed'
    details = Object.values(error.errors || {}).map(err => ({
      code: 'mongoose_validation',
      path: [err.path || ''],
      message: err.message,
      kind: err.kind,
      ...(err.kind === 'enum' && Array.isArray(err.properties?.enum) ? { values: err.properties.enum } : {}),
    }))
  }
  if (error?.code === 11000) { status = 409; message = 'A record with this value already exists'; details = error.keyValue }
  if (status >= 500) console.error(error?.stack || error)
  res.status(status).json({ success: false, message, ...(details && { details }) })
}
