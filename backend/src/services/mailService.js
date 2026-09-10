import { env } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'

function assertMailConfiguration() {
  if (!env.msClientId || !env.msTenantId || !env.msClientSecret || !env.otpSenderEmail) {
    throw new HttpError(503, 'Email delivery is not configured. Contact your administrator.')
  }
}

async function getGraphAccessToken() {
  const body = new URLSearchParams({ client_id: env.msClientId, client_secret: env.msClientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  let response
  try {
    response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.msTenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
  } catch (error) {
    console.error('Microsoft Graph token connection failed:', error?.message || error, error?.cause?.code || '', error?.cause?.message || '')
    throw new HttpError(502, 'The email service could not be reached. Check the server internet connection and try again.')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) {
    console.error('Microsoft Graph token request failed:', response.status, payload?.error || 'unknown_error', payload?.error_description || '')
    throw new HttpError(502, 'Microsoft email authentication failed. Check the tenant, client ID, and client secret.')
  }
  return payload.access_token
}

export async function sendGraphEmail({ recipient, subject, html, attachments = [], ccRecipients = [] }) {
  assertMailConfiguration()
  const accessToken = await getGraphAccessToken()
  const normalizedRecipient=String(recipient).trim().toLowerCase()
  const uniqueCc=[...new Set(ccRecipients.map(address=>String(address).trim().toLowerCase()).filter(address=>address&&address!==normalizedRecipient))]
  let response
  try {
    response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.otpSenderEmail)}/sendMail`, {
      method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ message:{ subject, body:{ contentType:'HTML', content:html }, toRecipients:[{emailAddress:{address:recipient}}], ...(uniqueCc.length?{ccRecipients:uniqueCc.map(address=>({emailAddress:{address}}))}:{}), attachments:attachments.map(file => ({ '@odata.type':'#microsoft.graph.fileAttachment', name:file.name, contentType:file.contentType || 'application/octet-stream', contentBytes:Buffer.from(file.content).toString('base64') })), ...(env.mailReplyTo ? {replyTo:[{emailAddress:{address:env.mailReplyTo}}]} : {}) }, saveToSentItems:true }),
    })
  } catch (error) {
    console.error('Microsoft Graph sendMail connection failed:', error?.message || error, error?.cause?.code || '', error?.cause?.message || '')
    throw new HttpError(502, 'The email service could not be reached. Check the server internet connection and try again.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    console.error('Microsoft Graph sendMail failed:', response.status, payload?.error?.code || 'unknown_error', payload?.error?.message || '')
    throw new HttpError(502, response.status === 403
      ? 'Microsoft Graph denied sending email. Grant the application Mail.Send permission and admin consent.'
      : 'Email delivery failed. Verify the sender mailbox and Microsoft Graph configuration.')
  }
  return response.headers.get('request-id') || response.headers.get('client-request-id') || null
}

export function buildVerificationCodeEmail({recipient,code,expiresMinutes,context='signing in to AT Connect'}) {
  const safeRecipient=escapeHtml(recipient)
  const safeCode=escapeHtml(code)
  const safeContext=escapeHtml(context)
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your verification code</title><style>@media only screen and (max-width:480px){.otp-card-pad{padding-left:20px!important;padding-right:20px!important}.otp-title{font-size:29px!important}.otp-copy{font-size:15px!important}.otp-code{font-size:34px!important;letter-spacing:6px!important;padding-left:6px!important}.otp-code-cell{padding-top:34px!important;padding-bottom:32px!important}.otp-security{padding-left:24px!important;padding-right:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#f1f1f6;font-family:Arial,Helvetica,sans-serif;color:#202b3c">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your AT Connect verification code is ${safeCode}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f1f6">
    <tr><td align="center" style="padding:24px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:626px;background:#ffffff;border-radius:20px">
        <tr><td align="center" class="otp-card-pad" style="padding:46px 38px 18px">
          <div style="margin:0 0 20px;color:#187b72;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">AT Connect · Secure verification</div>
          <h1 class="otp-title" style="margin:0;color:#202b3c;font-size:36px;line-height:1.2;font-weight:700;letter-spacing:-.7px">Your verification code</h1>
          <p class="otp-copy" style="margin:20px auto 0;max-width:510px;color:#202b3c;font-size:17px;line-height:1.55">Hi <a href="mailto:${safeRecipient}" style="color:#075fcb;text-decoration:underline;font-weight:700">${safeRecipient}</a>,<br>Enter the code below to confirm it’s you and continue ${safeContext}.</p>
        </td></tr>
        <tr><td class="otp-card-pad" style="padding:10px 38px 0">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eaf8f2;border:2px dashed #72c9aa;border-radius:16px">
            <tr><td align="center" class="otp-code-cell" style="padding:43px 18px 40px"><div class="otp-code" style="padding-left:10px;color:#135c46;font-family:'Courier New',Courier,monospace;font-size:46px;line-height:1;font-weight:700;letter-spacing:10px">${safeCode}</div></td></tr>
          </table>
        </td></tr>
        <tr><td align="center" class="otp-security" style="padding:26px 45px 46px">
          <p style="margin:0;color:#202b3c;font-size:15px;line-height:1.6">This code expires in <strong>${Number(expiresMinutes)} minutes</strong>. For your security, never share it with anyone. If you didn’t request it, you can safely ignore this email — your account stays secure.</p>
        </td></tr>
      </table>
      <p style="margin:15px 0 0;color:#8992a3;font-size:11px;line-height:1.5">Automated security message from ${escapeHtml(env.mailFromName)}.</p>
    </td></tr>
  </table>
</body></html>`
}

export async function sendLoginOtp({ recipient, code, expiresMinutes }) {
  return sendGraphEmail({recipient,subject:'Your AT Connect verification code',html:buildVerificationCodeEmail({recipient,code,expiresMinutes,context:'signing in to AT Connect'})})
}

function iconForLabel(label) {
  const key = String(label || '').toLowerCase().trim()
  if (/employee|name|person|user/.test(key)) return '👤'
  if (/leave.*type|type|category/.test(key)) return '💼'
  if (/date/.test(key)) return '📅'
  if (/working.*day|day|duration/.test(key)) return '⏱️'
  if (/reason|note|comment|message/.test(key)) return '🗒️'
  if (/reviewer|approved.*by|reviewed|manager|hr/.test(key)) return '✅'
  if (/next.*approval|chain|stage|step/.test(key)) return '🔗'
  if (/decision|status|action|result/.test(key)) return '🎯'
  if (/exception|miss.*type|status/.test(key)) return '⚠️'
  if (/week|period|attendance.*period/.test(key)) return '📆'
  if (/scheduled|required|expected|recorded|hours|shortfall|regularize/.test(key)) return '⏳'
  if (/shift|checkout|check.?in|check-in|check-out/.test(key)) return '🖐️'
  if (/mode|work.*mode|attempt|score|face/.test(key)) return '🔐'
  if (/claim|claimed|acceptable|not.*acceptable|amount|total/.test(key)) return '₹'
  if (/login|temporary|password|credential|id/.test(key)) return '🔑'
  if (/deadline|submission|final/.test(key)) return '🚀'
  return '📌'
}

function toneForLabel(label, value) {
  const key = String(label || '').toLowerCase().trim()
  const val = String(value || '').toLowerCase()
  if (/(approved|confirmed|recorded|success|yes)/.test(val)) return { bg:'#ecfdf5', fg:'#047857', border:'#a7f3d0' }
  if (/(rejected|cancelled|not.*approved|unpaid|absent|expired)/.test(val)) return { bg:'#fef2f2', fg:'#b91c1c', border:'#fecaca' }
  if (/(pending|awaiting|review|pending|processing)/.test(val)) return { bg:'#fffbeb', fg:'#b45309', border:'#fde68a' }
  if (/(paid|eligible|active|confirmed)/.test(val)) return { bg:'#eff6ff', fg:'#1d4ed8', border:'#bfdbfe' }
  if (/leave.*type|type|category/.test(key)) return { bg:'#f0fdf4', fg:'#15803d', border:'#bbf7d0' }
  if (/amount|acceptable|total/.test(key)) return { bg:'#ecfeff', fg:'#0e7490', border:'#a5f3fc' }
  if (/date|week|period|deadline/.test(key)) return { bg:'#f5f3ff', fg:'#6d28d9', border:'#ddd6fe' }
  return { bg:'#f8fafc', fg:'#0f172a', border:'#e2e8f0' }
}

function modernMail({ preview, eyebrow, title, intro, content, actionLabel, actionUrl, secondaryLabel, secondaryUrl, footer, headerAccent, heroAvatar, heroAvatarInitials }) {
  const gradient = headerAccent === 'warm' ? 'linear-gradient(135deg,#9a3412,#ea580c)'
    : headerAccent === 'blue' ? 'linear-gradient(135deg,#0c4a6e,#0284c7)'
    : headerAccent === 'red' ? 'linear-gradient(135deg,#7f1d1d,#dc2626)'
    : headerAccent === 'violet' ? 'linear-gradient(135deg,#4c1d95,#7c3aed)'
    : 'linear-gradient(135deg,#0e514a 0%,#087e70 55%,#10b981 100%)'
  const avatarBlock = heroAvatarInitials
    ? `<div style="display:inline-flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:999px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.32);font-size:19px;font-weight:800;letter-spacing:-.2px;color:#fff">${escapeHtml(heroAvatarInitials.slice(0, 2).toUpperCase())}</div>`
    : ''
  const eyebrowFinal = eyebrow || 'AT Connect · Notification'
  const actions = []
  if (actionLabel && actionUrl) {
    actions.push(`<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:${headerAccent === 'red' ? '#dc2626' : headerAccent === 'blue' ? '#0284c7' : headerAccent === 'warm' ? '#ea580c' : headerAccent === 'violet' ? '#7c3aed' : '#087e70'};color:#fff;text-decoration:none;font-size:13px;font-weight:750;letter-spacing:.1px;box-shadow:0 8px 20px rgba(0,0,0,.12)">${escapeHtml(actionLabel)}</a>`)
  }
  if (secondaryLabel && secondaryUrl) {
    actions.push(`<a href="${escapeHtml(secondaryUrl)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#fff;color:#0f172a;text-decoration:none;font-size:13px;font-weight:700;border:1px solid #cbd5e1;margin-left:10px">${escapeHtml(secondaryLabel)}</a>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(preview)}</title></head>
  <body style="margin:0;padding:0;background:linear-gradient(180deg,#f0f7f4 0%,#eef4fb 100%);font-family:Arial,Helvetica,sans-serif;color:#17213a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:38px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #e5eeea;border-radius:26px;overflow:hidden;box-shadow:0 22px 60px rgba(14,81,74,.12), 0 4px 12px rgba(15,23,42,.05)">
        <tr><td style="padding:26px 32px;background:${gradient};color:#fff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td align="left" style="vertical-align:middle">
              ${avatarBlock ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-right:14px;vertical-align:middle">${avatarBlock}</td><td style="vertical-align:middle">` : ''}
              <div style="font-size:11px;font-weight:750;letter-spacing:1.6px;text-transform:uppercase;color:rgba(255,255,255,.86);opacity:.95">AT CONNECT</div>
              <div style="margin-top:3px;font-size:19px;font-weight:800;letter-spacing:-.2px">Ananttattva Private Limited</div>
              ${avatarBlock ? `</td></tr></table>` : ''}
            </td>
            <td align="right" style="vertical-align:middle;font-size:10px;color:rgba(255,255,255,.82);line-height:1.5">
              <div style="padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.14);display:inline-block;white-space:nowrap">
                ${new Date().toLocaleDateString('en-IN', { dateStyle:'medium', timeZone:'Asia/Kolkata' })}
              </div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:38px 38px 16px">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:10.5px;font-weight:750;letter-spacing:1.1px;text-transform:uppercase;border:1px solid #a7f3d0">${escapeHtml(eyebrowFinal)}</div>
          <h1 style="margin:14px 0 12px;font-size:30px;line-height:1.22;letter-spacing:-.9px;color:#0f172a;font-weight:800">${escapeHtml(title)}</h1>
          <p style="margin:0;color:#475569;font-size:15px;line-height:1.78">${intro}</p>
        </td></tr>
        <tr><td style="padding:12px 38px 28px">
          ${content}
          ${actions.length ? `<div style="padding-top:24px">${actions.join('')}</div>` : ''}
        </td></tr>
        <tr><td style="padding:24px 34px;background:linear-gradient(180deg,#f8faf9,#f1f5f9);border-top:1px solid #e6eeeb">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td style="vertical-align:top;color:#5b6b67;font-size:11px;line-height:1.7">
              <div style="font-weight:750;color:#2f3b38">Ananttattva Private Limited</div>
              ${footer || ''}
            </td>
            <td align="right" style="vertical-align:top;font-size:11px;color:#8899a0;line-height:1.75">
              <div style="color:#64748b;font-weight:700">Questions?</div>
              <div>HR: <a href="mailto:hr@ananttattva.com" style="color:#087e70;text-decoration:none">hr@ananttattva.com</a></div>
              <div style="margin-top:4px;color:#94a3b8">Sent by ${escapeHtml(env.mailFromName || 'AT Connect')}</div>
            </td>
          </tr></table>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#94a3b8;font-size:10.5px;text-align:center;line-height:1.6">🔒 Secure automated message from AT Connect · Please do not share OTPs, passwords or verification codes with anyone.</p>
    </td></tr></table>
  </body></html>`
}

export async function sendPasswordResetOtp({recipient,code,expiresMinutes}){
  return sendGraphEmail({recipient,subject:'Your AT Connect password reset code',html:buildVerificationCodeEmail({recipient,code,expiresMinutes,context:'resetting your AT Connect password'})})
}

export async function sendOffboardingAcknowledgementOtp({recipient,code,expiresMinutes=10,exitId}){
  return sendGraphEmail({recipient,subject:`${exitId} acknowledgement verification code`,html:buildVerificationCodeEmail({recipient,code,expiresMinutes,context:`confirming your ${exitId} employee exit acknowledgement in AT Connect`})})
}

export async function sendWelcomeEmail({recipient,firstName,loginId,temporaryPassword}){
  const html=modernMail({
    preview:'Welcome to Ananttattva Private Limited and AT Connect',eyebrow:'Welcome aboard',title:`Welcome to Ananttattva, ${firstName}!`,
    intro:'Your employee account is ready. AT Connect gives you secure access to attendance, allowances and your workplace information.',
    content:`<div style="margin-top:8px;border:1px solid #dce9e6;border-radius:15px;overflow:hidden"><div style="padding:13px 18px;background:#f1f8f6;color:#52746d;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Your AT Connect credentials</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:17px 18px;border-bottom:1px solid #edf1f0;color:#7a8682;font-size:12px">Login ID</td><td align="right" style="padding:17px 18px;border-bottom:1px solid #edf1f0;color:#17213a;font-size:13px;font-weight:700">${escapeHtml(loginId)}</td></tr><tr><td style="padding:17px 18px;color:#7a8682;font-size:12px">Temporary password</td><td align="right" style="padding:17px 18px;color:#17213a;font-family:'Courier New',monospace;font-size:13px;font-weight:700">${escapeHtml(temporaryPassword)}</td></tr></table></div><div style="margin-top:16px;padding:14px 16px;border-left:4px solid #d89a31;border-radius:8px;background:#fff9ed;color:#735923;font-size:12px;line-height:1.65"><strong>Action required:</strong> Kindly change this temporary password after your first sign-in and do not share it with anyone.</div>`,
    actionLabel:'Open AT Connect',actionUrl:env.clientUrl,
    footer:'We are delighted to have you with Ananttattva Private Limited.',
  })
  return sendGraphEmail({recipient,subject:'Welcome to Ananttattva Private Limited | Your AT Connect account',html})
}

export async function sendAllowanceReminder({recipient,firstName,allowanceMonth,deadline}){
  const html=modernMail({
    preview:`Submit your ${allowanceMonth} allowance by ${deadline}`,eyebrow:'Monthly allowance reminder',title:`Your ${allowanceMonth} allowance window is open`,
    intro:`Hi ${escapeHtml(firstName)}, today is the final day of ${escapeHtml(allowanceMonth)}. Please prepare and submit your travel and extra allowance claims in AT Connect.`,
    content:`<div style="margin-top:8px;padding:20px;border:1px solid #dce9e6;border-radius:15px;background:#f5faf8"><div style="color:#71817d;font-size:11px">Submission deadline</div><div style="margin-top:6px;color:#08776b;font-size:24px;font-weight:750;letter-spacing:-.4px">${escapeHtml(deadline)}</div><div style="margin-top:13px;padding-top:13px;border-top:1px solid #dde9e6;color:#62716d;font-size:12px;line-height:1.7">Include the travel date, location, amount and supporting proof. Claims for ${escapeHtml(allowanceMonth)} submitted after this deadline will not be accepted.</div></div>`,
    actionLabel:'Submit allowance',actionUrl:`${env.clientUrl.replace(/\/$/,'')}/allowances`,
    footer:'Please complete your submission before the deadline.',
  })
  return sendGraphEmail({recipient,subject:`Allowance reminder: submit ${allowanceMonth} claims by ${deadline}`,html})
}

export async function sendFaceCheckInApprovalRequest({recipient,reviewerName,employeeName,employeeCode,attemptedAt,attendanceMode,reason,faceMatchScore}){
  const attemptLabel=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(attemptedAt))
  const modeLabel=String(attendanceMode).replaceAll('_',' ')
  const html=modernMail({
    preview:`Manual check-in approval required for ${employeeName}`,eyebrow:'Attendance approval',title:'A manual check-in needs review',
    intro:`Hi ${escapeHtml(reviewerName)}, ${escapeHtml(employeeName)} could not complete face matching after passing the live capture check. Review the request before attendance is recorded.`,
    content:`<div style="margin-top:8px;border:1px solid #dce9e6;border-radius:15px;overflow:hidden"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:13px 17px;background:#f2f8f6;color:#71817d;font-size:11px">Employee</td><td align="right" style="padding:13px 17px;background:#f2f8f6;color:#17213a;font-size:12px;font-weight:700">${escapeHtml(employeeName)} (${escapeHtml(employeeCode)})</td></tr><tr><td style="padding:13px 17px;border-top:1px solid #edf1f0;color:#71817d;font-size:11px">Original attempt</td><td align="right" style="padding:13px 17px;border-top:1px solid #edf1f0;color:#17213a;font-size:12px">${escapeHtml(attemptLabel)}</td></tr><tr><td style="padding:13px 17px;border-top:1px solid #edf1f0;color:#71817d;font-size:11px">Work mode</td><td align="right" style="padding:13px 17px;border-top:1px solid #edf1f0;color:#17213a;font-size:12px;text-transform:capitalize">${escapeHtml(modeLabel)}</td></tr><tr><td style="padding:13px 17px;border-top:1px solid #edf1f0;color:#71817d;font-size:11px">Face match score</td><td align="right" style="padding:13px 17px;border-top:1px solid #edf1f0;color:#a04a59;font-size:12px;font-weight:700">${Math.round(Number(faceMatchScore||0)*100)}%</td></tr></table></div><div style="margin-top:16px;padding:15px;border-left:4px solid #d89a31;border-radius:8px;background:#fff9ed;color:#735923;font-size:12px;line-height:1.65"><strong>Employee reason:</strong><br>${escapeHtml(reason)}</div>`,
    actionLabel:'Review check-in request',actionUrl:`${env.clientUrl.replace(/\/$/,'')}/attendance`,
    footer:'Approve only after reviewing the captured evidence in AT Connect.',
  })
  return sendGraphEmail({recipient,subject:`Manual check-in approval: ${employeeName} (${employeeCode})`,html})
}

export async function sendFaceCheckInDecision({recipient,firstName,decision,attemptedAt,reviewerName,reviewNote}){
  const approved=decision==='approved'
  const attemptLabel=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(attemptedAt))
  const html=modernMail({
    preview:`Your manual check-in was ${decision}`,eyebrow:'Attendance update',title:`Manual check-in ${decision}`,
    intro:`Hi ${escapeHtml(firstName)}, your manual check-in request for ${escapeHtml(attemptLabel)} was ${escapeHtml(decision)} by ${escapeHtml(reviewerName)}.`,
    content:`<div style="margin-top:8px;padding:19px;border:1px solid ${approved?'#cfe7dd':'#efd5da'};border-radius:14px;background:${approved?'#f1f9f5':'#fff4f5'};color:${approved?'#27694e':'#934557'};font-size:13px;line-height:1.7"><strong>${approved?'Attendance recorded':'Attendance not recorded'}</strong><br>${approved?'Your check-in uses the original failed face-match attempt time.':'Contact HR if you need clarification or believe the request should be reconsidered.'}</div>${reviewNote?`<div style="margin-top:15px;padding:14px 16px;border-radius:10px;background:#f6f8f8;color:#56636a;font-size:12px;line-height:1.65"><strong>Review note:</strong><br>${escapeHtml(reviewNote)}</div>`:''}`,
    actionLabel:'View attendance',actionUrl:`${env.clientUrl.replace(/\/$/,'')}/attendance`,
    footer:'This decision is recorded in the attendance audit history.',
  })
  return sendGraphEmail({recipient,subject:`Manual check-in ${decision}`,html})
}

export async function sendAllowanceDecision({recipient,firstName,decision,travelDate,totalAmount,acceptableAmount,nonAcceptableAmount,reviewerName,reviewNote,specialApproval=false}){
  const approved=decision==='approved'
  const dateLabel=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(travelDate))
  const amountLabel=Number(totalAmount||0).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2})
  const acceptableLabel=Number(acceptableAmount??totalAmount??0).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2})
  const nonAcceptableLabel=Number(nonAcceptableAmount||0).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2})
  const requestLabel=specialApproval?'special allowance request':'allowance claim'
  const html=modernMail({
    preview:`Your ${requestLabel} was ${decision}`,eyebrow:'Allowance update',title:`${specialApproval?'Special allowance':'Allowance claim'} ${decision}`,
    intro:`Hi ${escapeHtml(firstName)}, your ${escapeHtml(requestLabel)} for ${escapeHtml(dateLabel)} was ${escapeHtml(decision)} by ${escapeHtml(reviewerName)}.`,
    content:`<div style="margin-top:8px;padding:19px;border:1px solid ${approved?'#cfe7dd':'#efd5da'};border-radius:14px;background:${approved?'#f1f9f5':'#fff4f5'};color:${approved?'#27694e':'#934557'};font-size:13px;line-height:1.7"><strong>${approved?'Allowance approved':'Claim not approved'}</strong><br>${approved?'The approved values are now recorded in AT Connect.':'Open AT Connect to review the claim status and contact HR if clarification is required.'}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border:1px solid #e1e9e7;border-radius:12px;background:#fff"><tr><td style="padding:13px 15px;color:#71807d;font-size:11px">Total claimed</td><td align="right" style="padding:13px 15px;color:#263b37;font-size:13px;font-weight:700">${escapeHtml(amountLabel)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid #edf1f0;color:#237455;font-size:11px;font-weight:700">Acceptable amount</td><td align="right" style="padding:13px 15px;border-top:1px solid #edf1f0;color:#16805b;font-size:15px;font-weight:800">${escapeHtml(acceptableLabel)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid #edf1f0;color:#a54355;font-size:11px;font-weight:700">Not acceptable</td><td align="right" style="padding:13px 15px;border-top:1px solid #edf1f0;color:#b54156;font-size:13px;font-weight:750">${escapeHtml(nonAcceptableLabel)}</td></tr></table>${reviewNote?`<div style="margin-top:15px;padding:14px 16px;border-radius:10px;background:#f6f8f8;color:#56636a;font-size:12px;line-height:1.65"><strong>Reviewer note</strong><br>${escapeHtml(reviewNote)}</div>`:''}`,
    actionLabel:'View allowances',actionUrl:`${env.clientUrl.replace(/\/$/,'')}/allowances`,
    footer:'This decision is recorded in your allowance history.',
  })
  return sendGraphEmail({
    recipient,
    ccRecipients:['hr@ananttattva.com','krunal.goda@ananttattva.com'],
    subject:`${specialApproval?'Special allowance request':'Allowance claim'} ${decision}`,
    html,
  })
}

export async function sendBirthdayGreeting({recipient,firstName,companyName='Ananttattva Private Limited',logo}){
  const safeName=escapeHtml(firstName),safeCompany=escapeHtml(companyName)
  const logoBlock=logo?`<img src="${escapeHtml(logo)}" alt="${safeCompany}" width="150" style="display:block;max-width:150px;max-height:66px;margin:0 auto;object-fit:contain">`:`<div style="color:#f47b20;font-size:19px;font-weight:800;letter-spacing:2px">ANANTTATTVA</div>`
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Happy Birthday, ${safeName}!</title></head><body style="margin:0;padding:0;background:#fff8ed;font-family:Arial,Helvetica,sans-serif;color:#283044"><div style="display:none;max-height:0;overflow:hidden;opacity:0">A special birthday wish from everyone at ${safeCompany} 🎉</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff8ed"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #f4d8ae;border-radius:24px;overflow:hidden"><tr><td align="center" style="padding:25px 28px;background:#fff">${logoBlock}</td></tr><tr><td align="center" style="padding:42px 34px 36px;background:#fff2d6"><div style="font-size:38px;line-height:1">🎂 ✨ 🎉</div><div style="margin-top:22px;color:#c35b17;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Celebrating you today</div><h1 style="margin:13px 0 8px;color:#6f3514;font-size:38px;line-height:1.15;letter-spacing:-1.2px">Happy Birthday,<br>${safeName}!</h1><p style="max-width:470px;margin:18px auto 0;color:#765846;font-size:15px;line-height:1.8">May your special day bring you happiness, wonderful memories and a year filled with exciting opportunities and success.</p></td></tr><tr><td style="padding:28px 38px 34px"><div style="padding:20px 22px;border-left:4px solid #f47b20;border-radius:12px;background:#fff8ee;color:#685247;font-size:14px;line-height:1.75">Your dedication and contribution make our workplace better every day. We are delighted to celebrate this special occasion with you.</div><p style="margin:27px 0 0;color:#374151;font-size:14px;line-height:1.7">Warmest wishes,<br><strong style="color:#d66318">The ${safeCompany} Team</strong></p></td></tr><tr><td align="center" style="padding:18px 28px;background:#6f3514;color:#fce9cf;font-size:11px;line-height:1.6">Here’s to another amazing year ahead ✨<br>Sent with warm wishes through AT Connect</td></tr></table></td></tr></table></body></html>`
  return sendGraphEmail({recipient,subject:`🎉 Happy Birthday, ${firstName}! Warm wishes from ${companyName}`,html})
}

export async function sendManualAttendanceDecision({recipient,firstName,decision,action,attemptedAt,reviewerName,reviewNote}){
  const approved=decision==='approved'
  const actionLabel=action==='check_out'?'check-out':'check-in'
  const attemptLabel=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(attemptedAt))
  const html=modernMail({
    preview:`Your manual ${actionLabel} request was ${decision}`,eyebrow:'Attendance decision',title:`Manual ${actionLabel} ${decision}`,
    intro:`Hi ${escapeHtml(firstName)}, your manual ${actionLabel} request for ${escapeHtml(attemptLabel)} has been ${escapeHtml(decision)} by ${escapeHtml(reviewerName||'your reviewer')}.`,
    content:`<div style="margin-top:8px;padding:20px;border:1px solid ${approved?'#bfe4d5':'#efd5da'};border-radius:15px;background:${approved?'#effaf5':'#fff4f5'};color:${approved?'#176847':'#934557'};font-size:13px;line-height:1.75"><div style="margin-bottom:5px;font-size:18px;font-weight:750">${approved?'Approved successfully':'Request rejected'}</div>${approved?`Your attendance has been recorded using the original request time (${escapeHtml(attemptLabel)}).`:'Your attendance was not changed. Please contact HR if you need clarification.'}</div>${reviewNote?`<div style="margin-top:15px;padding:14px 16px;border-radius:10px;background:#f6f8f8;color:#56636a;font-size:12px;line-height:1.65"><strong>Reviewer note</strong><br>${escapeHtml(reviewNote)}</div>`:''}`,
    actionLabel:'View my attendance',actionUrl:`${env.clientUrl.replace(/\/$/,'')}/attendance`,
    footer:'This decision is saved in your attendance history and audit trail.',
  })
  return sendGraphEmail({recipient,subject:`Your manual ${actionLabel} has been ${decision}`,html})
}

function companyEmailTemplate({ greeting, summary, details = [], actionLabel, actionUrl, secondaryLabel, secondaryUrl, footer, variant = 'info', employeeName }) {
  let gradient, accent, headerAccent
  switch (variant) {
    case 'approval':
      gradient = 'linear-gradient(135deg,#0f766e 0%,#0ea5e9 60%,#22c55e 100%)'
      accent = '#0891b2'
      headerAccent = 'blue'
      break
    case 'warning':
      gradient = 'linear-gradient(135deg,#9a3412,#f59e0b)'
      accent = '#d97706'
      headerAccent = 'warm'
      break
    case 'danger':
      gradient = 'linear-gradient(135deg,#7f1d1d,#e11d48)'
      accent = '#dc2626'
      headerAccent = 'red'
      break
    case 'success':
      gradient = 'linear-gradient(135deg,#065f46,#10b981,#22c55e)'
      accent = '#059669'
      headerAccent = undefined
      break
    case 'info':
    default:
      gradient = 'linear-gradient(135deg,#4c1d95 0%,#6366f1 50%,#0ea5e9 100%)'
      accent = '#6366f1'
      headerAccent = 'violet'
      break
  }
  const initials = employeeName ? String(employeeName).split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() : null
  const detailCards = details.map(item => {
    const icon = item.icon || iconForLabel(item.label)
    const tone = item.tone || toneForLabel(item.label, item.value)
    return `
      <div style="display:flex;align-items:stretch;margin:0 0 13px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.04)">
        <div style="width:54px;min-width:54px;display:flex;align-items:center;justify-content:center;font-size:22px;background:linear-gradient(180deg,${tone.bg},#ffffff);border-right:1px solid #f1f5f9">
          ${icon}
        </div>
        <div style="flex:1;padding:14px 16px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <div style="font-size:10.5px;font-weight:750;letter-spacing:.9px;text-transform:uppercase;color:#64748b;margin-bottom:4px">${escapeHtml(item.label)}</div>
            <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.45;letter-spacing:-.2px">${escapeHtml(String(item.value))}</div>
          </div>
          <div style="padding:6px 12px;border-radius:999px;background:${tone.bg};color:${tone.fg};border:1px solid ${tone.border};font-size:11px;font-weight:750;white-space:nowrap">
            ${tone.fg === '#047857' ? '✓ ' : tone.fg === '#b91c1c' ? '✕ ' : tone.fg === '#b45309' ? '⏳ ' : ''}${String(item.value || '').split(' ').slice(0, 2).join(' ')}
          </div>
        </div>
      </div>`
  }).join('')
  const actions = []
  if (actionLabel && actionUrl) {
    actions.push(`<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:${accent};color:#fff;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:.1px;box-shadow:0 10px 24px rgba(0,0,0,.14)">${escapeHtml(actionLabel)}</a>`)
  }
  if (secondaryLabel && secondaryUrl) {
    actions.push(`<a href="${escapeHtml(secondaryUrl)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#fff;color:#0f172a;text-decoration:none;font-size:13px;font-weight:700;border:1px solid #cbd5e1;margin-left:10px">${escapeHtml(secondaryLabel)}</a>`)
  }
  const avatarRow = initials
    ? `
      <div style="display:flex;align-items:center;gap:14px;margin:0 0 18px;padding:16px 18px;border-radius:18px;background:linear-gradient(180deg,#f0f9ff,#ecfdf5);border:1px solid #cffafe">
        <div style="width:56px;height:56px;border-radius:999px;background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;letter-spacing:-.4px">${escapeHtml(initials)}</div>
        <div style="flex:1">
          <div style="font-size:10.5px;color:#64748b;letter-spacing:.8px;text-transform:uppercase;font-weight:800">Employee</div>
          <div style="font-size:19px;font-weight:800;color:#0f172a;letter-spacing:-.4px;margin-top:2px">${escapeHtml(employeeName)}</div>
        </div>
        <div style="padding:6px 11px;border-radius:999px;background:#fff;font-size:11px;color:#0f172a;font-weight:750;border:1px solid #e2e8f0;white-space:nowrap">🪪 ID verified</div>
      </div>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(greeting)}</title></head>
  <body style="margin:0;padding:0;background:linear-gradient(180deg,#f0f7f4 0%,#eef4fb 100%);font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(summary || greeting)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:38px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #e5eeea;border-radius:26px;overflow:hidden;box-shadow:0 22px 60px rgba(14,81,74,.12), 0 4px 12px rgba(15,23,42,.05)">
        <tr><td style="padding:26px 32px;background:${gradient};color:#fff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td align="left" style="vertical-align:middle">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:rgba(255,255,255,.9);opacity:.98">AT · CONNECT</div>
              <div style="margin-top:8px;font-size:22px;font-weight:900;letter-spacing:-.5px">${escapeHtml(greeting)}</div>
            </td>
            <td align="right" style="vertical-align:middle">
              <div style="text-align:right;padding:10px 14px;border-radius:16px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2)">
                <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.9);letter-spacing:1px;text-transform:uppercase;opacity:.95">Today</div>
                <div style="font-size:14px;font-weight:800;letter-spacing:-.2px;color:#fff;margin-top:2px">${new Date().toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', timeZone:'Asia/Kolkata' })}</div>
              </div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:34px 34px 16px">
          <div style="padding:12px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:14.5px;line-height:1.75;letter-spacing:-.1px">
            ${escapeHtml(summary)}
          </div>
        </td></tr>
        <tr><td style="padding:12px 34px 8px">
          ${avatarRow}
          ${detailCards}
        </td></tr>
        <tr><td style="padding:12px 34px 30px">
          ${actions.length ? `<div style="padding-top:10px">${actions.join('')}</div>` : ''}
        </td></tr>
        <tr><td style="padding:24px 34px;background:linear-gradient(180deg,#f8faf9,#f1f5f9);border-top:1px solid #e6eeeb">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td style="vertical-align:top;color:#5b6b67;font-size:11.5px;line-height:1.7">
              <div style="font-weight:800;color:#0f172a;font-size:12px;margin-bottom:2px">Ananttattva Private Limited</div>
              ${footer || '<div style="color:#64748b">HRMS Powered by AT Connect</div>'}
            </td>
            <td align="right" style="vertical-align:top;font-size:11px;color:#8899a0;line-height:1.85">
              <div style="color:#0891b2;font-weight:800;font-size:11.5px">Need help?</div>
              <div>📧 HR: <a href="mailto:hr@ananttattva.com" style="color:#087e70;text-decoration:none">hr@ananttattva.com</a></div>
              <div style="color:#94a3b8;margin-top:3px">Sent by ${escapeHtml(env.mailFromName || 'AT Connect')}</div>
            </td>
          </tr></table>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#94a3b8;font-size:10.5px;text-align:center;line-height:1.6">🔒 Secure automated message from AT Connect · Please do not share passwords or verification codes with anyone.</p>
    </td></tr></table>
  </body></html>`
}

export async function sendLeaveApprovalRequest({ recipient, reviewerName, employeeName, employeeCode, leaveType, startDate, endDate, days, reason, stepLabel, longLeave }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Employee', value: `${employeeName} (${employeeCode})`, icon: '👤' },
    { label: 'Leave type', value: leaveType, icon: '💼' },
    { label: 'Dates', value: `${startDate} – ${endDate}`, icon: '📅' },
    { label: 'Working days', value: `${days} day${days === 1 ? '' : 's'}`, icon: '⏱️' },
    ...(longLeave ? [{ label: 'Approval chain', value: stepLabel, icon: '🔗' }] : []),
    { label: 'Reason', value: reason, icon: '🗒️' },
  ]
  const html = companyEmailTemplate({
    greeting: `Leave request awaiting your review`,
    summary: `${escapeHtml(reviewerName || 'Reviewer')}, a new leave request requires your approval in AT Connect.`,
    details,
    actionLabel: '✅  Approve request',
    actionUrl: `${base}/leave`,
    secondaryLabel: '📋  View & comment',
    secondaryUrl: `${base}/leave`,
    variant: 'approval',
    employeeName,
    footer: `Approve only after verifying leave balance and handoff coverage with ${escapeHtml(employeeName)}.`,
  })
  return sendGraphEmail({ recipient, subject: `⚡ Leave approval: ${employeeName} (${days} day${days === 1 ? '' : 's'})`, html })
}

export async function sendLeaveDecision({ recipient, firstName, decision, leaveType, startDate, endDate, reviewerName, reviewNote, nextApprover = '' }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const lowerDecision = String(decision || '').toLowerCase()
  const variant = /approved|confirmed/.test(lowerDecision) ? 'success'
    : /rejected|cancelled|canceled|denied/.test(lowerDecision) ? 'danger'
    : nextApprover ? 'warning' : 'info'
  const details = [
    { label: 'Decision', value: decision, icon: '🎯' },
    { label: 'Leave type', value: leaveType, icon: '💼' },
    { label: 'Dates', value: `${startDate} – ${endDate}`, icon: '📅' },
    { label: 'Reviewed by', value: reviewerName || 'AT Connect reviewer', icon: '✅' },
    ...(nextApprover ? [{ label: 'Next approval', value: nextApprover, icon: '🔗' }] : []),
    ...(reviewNote ? [{ label: 'Review note', value: reviewNote, icon: '🗒️' }] : []),
  ]
  const html = companyEmailTemplate({
    greeting: `Your leave request was ${decision}`,
    summary: `${escapeHtml(firstName)}, here is an update on the leave application you submitted.`,
    details,
    actionLabel: '👁️  View leave details',
    actionUrl: `${base}/leave`,
    variant,
    employeeName: firstName,
    footer: nextApprover ? `Your request is still pending and has moved to ${escapeHtml(nextApprover)} for review.` : 'Reach out to your manager or HR if you have questions about this decision.',
  })
  const emoji = /approved/.test(lowerDecision) ? '✅ ' : /reject|cancel|denied/.test(lowerDecision) ? '⛔ ' : '⏳ '
  return sendGraphEmail({ recipient, subject: `${emoji}Leave ${decision} for ${startDate} to ${endDate}`, html })
}

export async function sendLeaveOverrideNotice({ recipient, recipientName, employeeName, employeeCode, leaveType, startDate, endDate, reviewerName, reviewNote }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Employee', value: `${employeeName} (${employeeCode})`, icon: '👤' },
    { label: 'Leave type', value: leaveType, icon: '💼' },
    { label: 'Dates', value: `${startDate} – ${endDate}`, icon: '📅' },
    { label: 'Final approval', value: `Approved directly by ${reviewerName || 'Super Admin'}`, icon: '✅' },
    ...(reviewNote ? [{ label: 'Review note', value: reviewNote, icon: '🗒️' }] : []),
  ]
  const html = companyEmailTemplate({
    greeting: '🏆  Leave request fully approved',
    summary: `${escapeHtml(recipientName || 'Reviewer')}, ${escapeHtml(employeeName)}'s leave has received final approval from Super Admin. No further Manager or HR action is required.`,
    details,
    actionLabel: 'View leave details',
    actionUrl: `${base}/requests`,
    variant: 'success',
    employeeName,
    footer: 'This is a final workflow decision. The remaining approval stages were bypassed by Super Admin authority.',
  })
  return sendGraphEmail({ recipient, subject: `🏆 Final leave approval: ${employeeName}`, html })
}

export async function sendProbationConfirmation({ recipient, firstName, employeeCode, confirmedAt, reviewNote }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Employee', value: `${firstName} (${employeeCode})`, icon: '👤' },
    { label: 'Confirmed on', value: confirmedAt, icon: '📅' },
    ...(reviewNote ? [{ label: 'Note from HR', value: reviewNote, icon: '🗒️' }] : []),
  ]
  const html = companyEmailTemplate({
    greeting: '🎉  Probation confirmed',
    summary: `${escapeHtml(firstName)}, HR has confirmed your probation. Paid leave eligibility is now active for the remainder of the financial year.`,
    details,
    actionLabel: 'Open My Space',
    actionUrl: `${base}/my-space`,
    variant: 'success',
    employeeName: firstName,
    footer: 'Paid leaves are prorated from the confirmation month through the end of the financial year.',
  })
  return sendGraphEmail({ recipient, subject: '🎉 Probation confirmed', html })
}

export async function sendCheckoutReminder({ recipient, firstName, date, shiftEnd = '18:30' }) {
  const html = companyEmailTemplate({
    greeting: '⏰  Checkout reminder',
    summary: `Hi ${escapeHtml(firstName)}, your attendance is still checked in. Please complete checkout for today before shift end.`,
    details: [
      { label: 'Date', value: date, icon: '📅' },
      { label: 'Shift end', value: shiftEnd, icon: '🖐️' },
      { label: 'Status', value: 'Checkout pending', icon: '⚠️' },
    ],
    actionLabel: '🖐️  Complete checkout',
    actionUrl: `${env.clientUrl.replace(/\/$/, '')}/attendance`,
    variant: 'warning',
    employeeName: firstName,
    footer: 'If checkout is missed, AT Connect will close attendance automatically according to the approved full-day or half-day policy.',
  })
  return sendGraphEmail({ recipient, subject: '⏰ Reminder: Complete your attendance checkout', html })
}

export async function sendAttendanceMissNotice({ recipient, firstName, date, missType }) {
  const label = missType === 'check_in' ? 'Missing check-in' : 'Missed manual checkout'
  const html = companyEmailTemplate({
    greeting: '🚨  Attendance action required',
    summary: `Hi ${escapeHtml(firstName)}, an attendance punch was missed on a scheduled working day. Correct it before the deadline.`,
    details: [
      { label: 'Date', value: date, icon: '📅' },
      { label: 'Exception', value: label, icon: '⚠️' },
    ],
    actionLabel: '✍️  Review & correct attendance',
    actionUrl: `${env.clientUrl.replace(/\/$/, '')}/attendance`,
    variant: 'danger',
    employeeName: firstName,
    footer: 'Please submit an attendance correction if the recorded information is inaccurate.',
  })
  return sendGraphEmail({ recipient, subject: `🚨 Attendance exception: ${label}`, html })
}

export async function sendAttendanceEscalation({ recipient, ccRecipients = [], employeeName, employeeCode, week, misses, allTagged = null, totalTrue = null }) {
  const trueCount = Number.isFinite(totalTrue) ? totalTrue : Array.isArray(misses) ? misses.length : 0
  const breakdownRows = Array.isArray(allTagged) && allTagged.length > 0 ? allTagged : null
  const html = companyEmailTemplate({
    greeting: '🔴  Weekly attendance escalation',
    summary: `${escapeHtml(employeeName)} has ${trueCount} TRUE MISSED check-in/check-out occurrence(s) in the current week and requires HR or Admin attention. Items tagged [LATE SAME-DAY CHECKOUT], [CORRECTION PENDING] or [CORRECTION APPROVED] are NOT counted as true misses.`,
    details: [
      { label: 'Employee', value: `${employeeName} (${employeeCode})`, icon: '👤' },
      { label: 'Week', value: week, icon: '📆' },
      { label: 'Exceptions (true miss count)', value: Array.isArray(misses) && misses.length > 0 ? misses.join(', ') : 'None', icon: '⚠️' },
      ...(breakdownRows ? [{
        label: 'Exception breakdown (tagged)',
        value: breakdownRows.join('\n'),
        icon: '📋'
      }] : [])
    ],
    actionLabel: 'Open attendance',
    actionUrl: `${env.clientUrl.replace(/\/$/, '')}/attendance`,
    variant: 'danger',
    employeeName,
    footer: 'HR and Admin should review the exceptions and request corrections where required. Items with [CORRECTION PENDING] tag are awaiting your approve/reject decision — please action before end of week.',
  })
  return sendGraphEmail({ recipient, ccRecipients, subject: `🔴 Escalation: ${employeeName} (${trueCount} true misses)`, html })
}

export async function sendWeeklyHoursShortfall({ recipient, ccRecipients = [], firstName, employeeName, employeeCode, period, scheduledDays, expectedHours, recordedHours, shortfallHours }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const html = companyEmailTemplate({
    greeting: '📊  Weekly working-hours summary',
    summary: `Hi ${escapeHtml(firstName)}, your recorded working hours for ${escapeHtml(period)} are below the scheduled weekly target. Regularize before the week closes.`,
    details: [
      { label: 'Employee', value: `${employeeName} (${employeeCode})`, icon: '👤' },
      { label: 'Attendance period', value: period, icon: '📆' },
      { label: 'Scheduled working days', value: String(scheduledDays), icon: '⏱️' },
      { label: 'Required working hours', value: expectedHours, icon: '⏳' },
      { label: 'Recorded working hours', value: recordedHours, icon: '⏳' },
      { label: 'Hours to regularize', value: shortfallHours, icon: '⚠️' },
    ],
    actionLabel: '📋  Review attendance',
    actionUrl: `${base}/attendance`,
    variant: 'warning',
    employeeName,
    footer: 'HR, Admin and Super Admin have been copied for visibility. Please submit an attendance correction if any punch or approved leave is missing.',
  })
  return sendGraphEmail({ recipient, ccRecipients, subject: `📊 Weekly shortfall: ${period}`, html })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[character])
}
