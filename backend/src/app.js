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
import { biometricProxy } from './middleware/biometricProxy.js'
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

// -----------------------------------------------------------------------------
// CORS: whitelist + trusted regex fallback for Vercel/Render previews & prod
// -----------------------------------------------------------------------------
const productionClientOrigins = [
  'https://ananttattva-hrms.vercel.app',
  'https://ananttattva-hrms.onrender.com',
  'https://atconnect.ananttattva.com',
]
const trustedOriginRegexes = [
  /^https:\/\/[-a-z0-9]+--ananttattva-hrms\.vercel\.app$/i,   // Vercel preview deployments (<deploy>--<project>.vercel.app)
  /^https:\/\/[-a-z0-9]+\.ananttattva-hrms\.vercel\.app$/i,   // Vercel branch previews (branch-project.vercel.app)
  /^https:\/\/[-a-z0-9]+\.ananttattva-hrms\.onrender\.com$/i, // Render previews
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,            // Any local dev port (3000 / 5173 / 7173 / 8080)
]
const urlOrigin = (value) => {
  try { return new URL(value).origin } catch { return null }
}
const flatClientOrigins = env.clientUrls
  .map(urlOrigin)
  .filter(Boolean)
const allowedClientOrigins = [...new Set([
  ...flatClientOrigins,
  ...productionClientOrigins,
  ...(env.nodeEnv === 'development'
    ? flatClientOrigins.flatMap((origin) => {
        const u = new URL(origin)
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
          const alias = new URL(origin)
          alias.hostname = u.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
          return [origin, alias.origin]
        }
        return [origin]
      })
    : flatClientOrigins),
])]
const originAllowed = (origin) => {
  if (!origin) return true  // curl / server-to-server / same-origin no-origin requests
  if (allowedClientOrigins.includes(origin)) return true
  return trustedOriginRegexes.some((regex) => regex.test(origin))
}
const corsOptions = {
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Accept','Authorization','Content-Type','If-None-Match','x-biometric-service-key','x-requested-with','sentry-trace','baggage'],
  origin(origin, callback) {
    // Callback rule pattern: allow (null, true) OR reject (null, false) — NEVER throw new Error
    // because helmet + middleware stack can swallow stack & cause preflight 500 instead of clean 204.
    return callback(null, originAllowed(origin))
  },
  optionsSuccessStatus: 204,
  preflightContinue: false,
}

app.set('trust proxy', 1)

// Helmet with relaxed CSP (required for vercel.app ↔ onrender.com cross-origin XHR)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'","'unsafe-inline'"],
      styleSrc: ["'self'","'unsafe-inline'","https://fonts.gstatic.com","https://fonts.googleapis.com"],
      fontSrc: ["'self'","data:","https://fonts.gstatic.com"],
      imgSrc: ["'self'","data:","blob:"],
      connectSrc: ["'self'","https:","wss:"], // allow any HTTPS (Vercel/Render) + biometric service
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: env.nodeEnv === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow public-profile JSON to be loaded across origins
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: env.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  noSniff: true,
  permittedCrossDomainPolicies: { policy: 'none' },
  xssFilter: true,
  dnsPrefetchControl: { allow: true },
  ieNoOpen: true,
  originAgentCluster: true,
}))

// OPTIONS preflight -> EXPLICIT GLOBAL 204 handler before ANY other route runs.
// Ensures even if origin rejected, 204 with ACAO header sent (not 500/No-Access-*).
app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

// Additional safety: always re-apply Access-Control headers after route handler runs
// (protects against notFound/errorHandler clearing CORS state before response).
app.use((req, res, next) => {
  if (req.headers.origin) {
    const allowed = originAllowed(req.headers.origin)
    res.setHeader('Vary', 'Origin')
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Accept,Authorization,Content-Type,If-None-Match,x-biometric-service-key,x-requested-with')
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
      res.setHeader('Access-Control-Max-Age', '7200')
    } else {
      res.setHeader('Access-Control-Allow-Origin', 'null')
    }
  }
  next()
})

app.use(express.json({ limit:'5mb' }))
app.use(express.urlencoded({ extended:true, limit:'5mb' }))
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))
app.use('/api', rateLimit({ windowMs:15*60*1000, limit:500, standardHeaders:'draft-8', legacyHeaders:false }))
app.use(biometricProxy)
app.get('/api/health', (_req,res) => res.json({success:true,message:'AT Connect API is healthy',timestamp:new Date().toISOString()}))
app.get('/api/biometric-health', async (_req,res) => {
  if (!env.biometricServiceUrl) return res.json({success:true,data:{integrated:false,ready:false,status:'not_configured',message:'ML biometric service is not configured on this deployment.'}})
  try {
    const response=await fetch(`${env.biometricServiceUrl}/api/health`,{headers:{'x-biometric-service-key':env.biometricServiceKey},signal:AbortSignal.timeout(env.biometricServiceTimeoutMs)})
    const payload=await response.json()
    const face=payload?.services?.faceEngine||{}
    const ready=Boolean(response.ok&&face.healthy&&face.yunetLoaded&&face.sfaceLoaded&&face.livenessLoaded)
    return res.json({success:true,data:{integrated:true,ready,status:ready?'ready':'degraded',message:ready?'ML biometric check-in and check-out are ready.':'ML biometric models are configured but not fully ready.',engine:face.engine,modelVersion:payload?.version,yunetLoaded:Boolean(face.yunetLoaded),sfaceLoaded:Boolean(face.sfaceLoaded),livenessLoaded:Boolean(face.livenessLoaded)}})
  } catch (error) {
    console.error('[biometric-health] service unavailable', {code:error?.code||error?.name})
    return res.json({success:true,data:{integrated:true,ready:false,status:'unavailable',message:'ML biometric service is currently unavailable.'}})
  }
})
app.get('/api/ready', async (_req,res) => {
  if (!env.biometricServiceUrl) {
    return res.status(503).json({success:false,message:'Combined ML service is not configured.'})
  }
  try {
    const response=await fetch(`${env.biometricServiceUrl}/api/health`,{headers:{'x-biometric-service-key':env.biometricServiceKey},signal:AbortSignal.timeout(env.biometricServiceTimeoutMs)})
    const payload=await response.json()
    const face=payload?.services?.faceEngine||{}
    const ready=Boolean(response.ok&&face.healthy&&face.yunetLoaded&&face.sfaceLoaded&&face.livenessLoaded)
    return res.status(ready?200:503).json({success:ready,message:ready?'Node API and ML biometric service are ready.':'ML biometric models are not ready.'})
  } catch (error) {
    console.error('[readiness] combined ML service unavailable', {code:error?.code||error?.name})
    return res.status(503).json({success:false,message:'ML biometric service is unavailable.'})
  }
})
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
