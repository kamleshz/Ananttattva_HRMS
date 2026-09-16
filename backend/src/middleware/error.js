import multer from 'multer'
import { ZodError } from 'zod'
import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
}

function toReadableMessage(message) {
  if (message == null) return 'Unknown error'
  if (typeof message === 'string') return message
  if (typeof message === 'object') {
    if ('message' in message && typeof message.message === 'string' && message.message.length) {
      return message.message
    }
    try { return JSON.stringify(message) } catch (_e) { return String(message) }
  }
  return String(message)
}

function objectToDetailsArray(error, messageObj) {
  if (Array.isArray(messageObj)) {
    return messageObj.map((m, idx) => ({ code: 'http_error', path: [String(idx)], message: toReadableMessage(m) }))
  }
  if (typeof messageObj === 'object' && messageObj !== null) {
    const details = []
    if (messageObj.code) details.push({ code: messageObj.code })
    Object.entries(messageObj).forEach(([k, v]) => {
      if (k === 'code') return
      details.push({ code: messageObj.code || 'http_error', path: [k], message: toReadableMessage(v) })
    })
    return details.length ? details : undefined
  }
  return undefined
}

export function errorHandler(error, _req, res, _next) {
  let status = error.status || 500
  let message = toReadableMessage(error.message)
  let details = error.details
  const rawMessage = error.message
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
  if (!(error instanceof ZodError) && !(error instanceof mongoose.Error.ValidationError) && typeof rawMessage === 'object' && rawMessage !== null) {
    if (!details || !Array.isArray(details) || details.length === 0) {
      details = objectToDetailsArray(error, rawMessage)
    }
    if (rawMessage.code && status === 422) {
      message = toReadableMessage(rawMessage) || message
    }
  }
  if (error?.code === 11000) { status = 409; message = 'A record with this value already exists'; details = error.keyValue }
  if (status >= 500) console.error(error?.stack || error)
  res.status(status).json({ success: false, message, ...(details && Array.isArray(details) && details.length ? { details } : (details ? { details } : {})) })
}
