import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { User } from '../models/User.js'
import { LoginOtp } from '../models/LoginOtp.js'
import { env } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'
import { sendLoginOtp, sendPasswordResetOtp } from './mailService.js'

export async function login(email, password, loginType = 'user') {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash').populate('employee')
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password')
  if (!user.isActive) throw new HttpError(403, 'Your account is inactive')
  const isAdmin = ['super_admin', 'hr_admin', 'finance_admin', 'it_admin'].includes(user.role)
  if ((loginType === 'admin') !== isAdmin) throw new HttpError(403, `This account cannot use ${loginType === 'admin' ? 'Admin' : 'User'} Login`)
  const recentChallenge = await LoginOtp.findOne({ user: user._id, purpose:'login', createdAt: { $gt: new Date(Date.now() - 60_000) }, usedAt: null })
  if (recentChallenge) throw new HttpError(429, 'Please wait one minute before requesting another code')

  const challengeId = crypto.randomUUID()
  const code = String(crypto.randomInt(100000, 1000000))
  const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60_000)
  const challenge = await LoginOtp.create({ challengeId, user: user._id, purpose:'login', codeHash: hashCode(challengeId, code), expiresAt })
  try {
    if (env.otpEmailsEnabled && !user.email.endsWith('.local')) {
      await sendLoginOtp({ recipient: user.email, firstName: user.firstName, code, expiresMinutes: env.otpExpiresMinutes })
    } else if (env.nodeEnv !== 'development') {
      throw new HttpError(503, 'OTP email delivery is disabled')
    }
  } catch (error) {
    await LoginOtp.deleteOne({ _id: challenge._id })
    throw error
  }
  return {
    otpRequired: true, challengeId, email: maskEmail(user.email), expiresIn: env.otpExpiresMinutes * 60,
    ...(env.nodeEnv === 'development' && (!env.otpEmailsEnabled || user.email.endsWith('.local')) ? { developmentOtp: code } : {}),
  }
}

export async function verifyLoginOtp(challengeId, code) {
  const challenge = await LoginOtp.findOne({ challengeId, purpose:'login' }).select('+codeHash')
  if (!challenge || challenge.usedAt) throw new HttpError(401, 'This sign-in code is invalid or has already been used')
  if (challenge.expiresAt <= new Date()) throw new HttpError(401, 'This sign-in code has expired. Please sign in again.')
  if (challenge.attemptsRemaining <= 0) throw new HttpError(429, 'Too many incorrect attempts. Please sign in again.')
  const suppliedHash = hashCode(challengeId, code)
  const matches = crypto.timingSafeEqual(Buffer.from(challenge.codeHash, 'hex'), Buffer.from(suppliedHash, 'hex'))
  if (!matches) {
    challenge.attemptsRemaining -= 1
    await challenge.save()
    throw new HttpError(401, `Incorrect code. ${challenge.attemptsRemaining} attempt${challenge.attemptsRemaining === 1 ? '' : 's'} remaining.`)
  }
  challenge.usedAt = new Date()
  await challenge.save()
  const user = await User.findById(challenge.user).populate('employee')
  if (!user || !user.isActive) throw new HttpError(403, 'Your account is inactive')
  user.lastLogin = new Date()
  await user.save()
  const token = jwt.sign({ role: user.role }, env.jwtSecret, { subject: user.id, expiresIn: env.jwtExpiresIn })
  return { token, user: sanitizeUser(user) }
}

export async function requestPasswordReset(email) {
  const normalizedEmail=email.toLowerCase()
  const user=await User.findOne({email:normalizedEmail,isActive:true})
  const challengeId=crypto.randomUUID()
  if(!user) return {challengeId,email:maskEmail(normalizedEmail),expiresIn:env.otpExpiresMinutes*60}
  const recent=await LoginOtp.findOne({user:user._id,purpose:'password_reset',createdAt:{$gt:new Date(Date.now()-60_000)},usedAt:null})
  if(recent)throw new HttpError(429,'Please wait one minute before requesting another reset code')
  const code=String(crypto.randomInt(100000,1000000))
  const expiresAt=new Date(Date.now()+env.otpExpiresMinutes*60_000)
  const challenge=await LoginOtp.create({challengeId,user:user._id,purpose:'password_reset',codeHash:hashCode(challengeId,code),expiresAt})
  try{
    if(env.otpEmailsEnabled&&!user.email.endsWith('.local'))await sendPasswordResetOtp({recipient:user.email,firstName:user.firstName,code,expiresMinutes:env.otpExpiresMinutes})
    else if(env.nodeEnv!=='development')throw new HttpError(503,'Password reset email delivery is disabled')
  }catch(error){await LoginOtp.deleteOne({_id:challenge._id});throw error}
  return {challengeId,email:maskEmail(user.email),expiresIn:env.otpExpiresMinutes*60,...(env.nodeEnv==='development'&&(!env.otpEmailsEnabled||user.email.endsWith('.local'))?{developmentOtp:code}:{})}
}

export async function resetPassword(challengeId,code,newPassword){
  const challenge=await LoginOtp.findOne({challengeId,purpose:'password_reset'}).select('+codeHash')
  if(!challenge||challenge.usedAt)throw new HttpError(401,'This reset code is invalid or has already been used')
  if(challenge.expiresAt<=new Date())throw new HttpError(401,'This reset code has expired. Request a new code.')
  if(challenge.attemptsRemaining<=0)throw new HttpError(429,'Too many incorrect attempts. Request a new reset code.')
  const suppliedHash=hashCode(challengeId,code)
  const matches=crypto.timingSafeEqual(Buffer.from(challenge.codeHash,'hex'),Buffer.from(suppliedHash,'hex'))
  if(!matches){challenge.attemptsRemaining-=1;await challenge.save();throw new HttpError(401,`Incorrect code. ${challenge.attemptsRemaining} attempt${challenge.attemptsRemaining===1?'':'s'} remaining.`)}
  const user=await User.findById(challenge.user).select('+passwordHash')
  if(!user||!user.isActive)throw new HttpError(403,'This account is inactive')
  if(await bcrypt.compare(newPassword,user.passwordHash))throw new HttpError(422,'Choose a password different from your current password')
  user.passwordHash=await bcrypt.hash(newPassword,12)
  user.mustChangePassword=false
  await user.save()
  const usedAt=new Date()
  await LoginOtp.updateMany({user:user._id,usedAt:null},{$set:{usedAt}})
  return {message:'Password changed successfully. You can now sign in.'}
}

function hashCode(challengeId, code) {
  return crypto.createHash('sha256').update(`${challengeId}:${code}`).digest('hex')
}

function maskEmail(email) {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`
}

export function sanitizeUser(user) {
  return { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, employee: user.employee, mustChangePassword: user.mustChangePassword }
}
