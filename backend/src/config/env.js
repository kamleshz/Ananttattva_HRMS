import 'dotenv/config'

const defaultClientUrl = 'http://127.0.0.1:7173'
const clientUrls = (process.env.CLIENT_URLS || process.env.CLIENT_URL || defaultClientUrl)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 7000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/peoplepulse_hr',
  jwtSecret: process.env.JWT_SECRET || 'development-only-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  clientUrl: clientUrls[0] || defaultClientUrl,
  clientUrls,
  seedEmail: process.env.SEED_ADMIN_EMAIL || 'admin@peoplepulse.local',
  seedPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  otpExpiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES || 10),
  otpEmailsEnabled: process.env.OTP_EMAILS_ENABLED !== 'false',
  msClientId: process.env.MS_CLIENT_ID || '',
  msTenantId: process.env.MS_TENANT_ID || '',
  msClientSecret: process.env.MS_CLIENT_SECRET || '',
  otpSenderEmail: process.env.OTP_SENDER_EMAIL || '',
  mailFromName: process.env.MAIL_FROM_NAME || 'AT Connect',
  mailReplyTo: process.env.MAIL_REPLY_TO || '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  manualAttendanceReviewThreshold: Number(process.env.MANUAL_ATTENDANCE_REVIEW_THRESHOLD || 3),
  manualAttendanceFaceRetryLimit: Number(process.env.MANUAL_ATTENDANCE_FACE_RETRY_LIMIT || 2),
  manualAttendanceAllowLocationException: process.env.MANUAL_ATTENDANCE_ALLOW_LOCATION_EXCEPTION !== 'false',
}

if (env.nodeEnv === 'production' && env.jwtSecret.includes('development')) {
  throw new Error('JWT_SECRET must be configured in production')
}
