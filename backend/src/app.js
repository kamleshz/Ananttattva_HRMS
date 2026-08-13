import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { rateLimit } from 'express-rate-limit'
import { env } from './config/env.js'
import authRoutes from './routes/authRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import employeeRoutes from './routes/employeeRoutes.js'
import dashboardRoutes from './routes/dashboardRoutes.js'
import leaveRoutes from './routes/leaveRoutes.js'
import biometricRoutes from './routes/biometricRoutes.js'
import holidayRoutes from './routes/holidayRoutes.js'
import allowanceRoutes from './routes/allowanceRoutes.js'
import recruitmentRoutes from './routes/recruitmentRoutes.js'
import publicOfferRoutes from './routes/publicOfferRoutes.js'
import organizationRoutes from './routes/organizationRoutes.js'
import workArrangementRoutes from './routes/workArrangementRoutes.js'
import reportsRoutes from './routes/reportsRoutes.js'
import offboardingRoutes from './routes/offboardingRoutes.js'
import { errorHandler, notFound } from './middleware/error.js'

export const app = express()
const allowedClientOrigins = [...new Set(env.clientUrls.flatMap((value) => {
  const url = new URL(value)
  if (env.nodeEnv !== 'development') return [url.origin]
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return [url.origin]

  const alias = new URL(url.origin)
  alias.hostname = url.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
  return [url.origin, alias.origin]
}))]

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedClientOrigins.includes(origin)) return callback(null, true)
    return callback(new Error(`Origin ${origin} is not allowed by CORS`))
  },
  credentials: true,
}))
app.use(express.json({ limit:'5mb' }))
app.use(express.urlencoded({ extended:true, limit:'5mb' }))
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))
app.use('/api', rateLimit({ windowMs:15*60*1000, limit:500, standardHeaders:'draft-8', legacyHeaders:false }))
app.get('/api/health', (_req,res) => res.json({success:true,message:'AT Connect API is healthy',timestamp:new Date().toISOString()}))
app.use('/api/auth', authRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/leaves', leaveRoutes)
app.use('/api/biometrics', biometricRoutes)
app.use('/api/holidays', holidayRoutes)
app.use('/api/allowances', allowanceRoutes)
app.use('/api/recruitment', recruitmentRoutes)
app.use('/api/public/offers', publicOfferRoutes)
app.use('/api/organization', organizationRoutes)
app.use('/api/work-arrangements', workArrangementRoutes)
app.use('/api/reports',reportsRoutes)
app.use('/api/offboarding',offboardingRoutes)
app.use(notFound)
app.use(errorHandler)
