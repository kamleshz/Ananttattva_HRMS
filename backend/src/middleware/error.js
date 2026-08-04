import multer from 'multer'
import { ZodError } from 'zod'

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
}

export function errorHandler(error, _req, res, _next) {
  let status = error.status || 500
  let message = error.message || 'Internal server error'
  let details = error.details
  if (error instanceof ZodError) { status = 422; message = 'Validation failed'; details = error.issues }
  if (error instanceof multer.MulterError) { status = 400; message = error.message }
  if (error?.code === 11000) { status = 409; message = 'A record with this value already exists'; details = error.keyValue }
  if (status >= 500) console.error(error?.stack || error)
  res.status(status).json({ success: false, message, ...(details && { details }) })
}
