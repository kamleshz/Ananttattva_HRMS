import { env } from '../config/env.js'

const proxiedPaths = [/^\/api\/biometrics(?:\/|$)/, /^\/api\/employees\/[^/]+\/biometrics(?:\/|$)/, /^\/api\/admin\/biometrics(?:\/|$)/]

export async function biometricProxy(req, res, next) {
  if (!env.biometricServiceUrl || !proxiedPaths.some(pattern => pattern.test(req.originalUrl.split('?')[0]))) return next()
  try {
    const target = `${env.biometricServiceUrl}${req.originalUrl.replace(/^\/api/, '/api')}`
    const headers = { 'content-type': 'application/json', 'x-biometric-service-key': env.biometricServiceKey }
    if (req.get('authorization')) headers.authorization = req.get('authorization')
    if (req.get('x-request-id')) headers['x-request-id'] = req.get('x-request-id')
    const upstream = await fetch(target, { method:req.method, headers, body:['GET','HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body), signal:AbortSignal.timeout(env.biometricServiceTimeoutMs) })
    const body = await upstream.text()
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(body)
  } catch (error) {
    console.error('[biometric-proxy] upstream unavailable', { code:error?.code || error?.name, path:req.originalUrl })
    res.status(503).json({ success:false, message:'Biometric verification is temporarily unavailable.', details:[{code:'BIOMETRIC_SERVICE_UNAVAILABLE'}] })
  }
}
