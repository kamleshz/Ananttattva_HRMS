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

export async function sendGraphEmail({ recipient, subject, html, attachments = [] }) {
  assertMailConfiguration()
  const accessToken = await getGraphAccessToken()
  let response
  try {
    response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.otpSenderEmail)}/sendMail`, {
      method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ message:{ subject, body:{ contentType:'HTML', content:html }, toRecipients:[{emailAddress:{address:recipient}}], attachments:attachments.map(file => ({ '@odata.type':'#microsoft.graph.fileAttachment', name:file.name, contentType:file.contentType || 'application/octet-stream', contentBytes:Buffer.from(file.content).toString('base64') })), ...(env.mailReplyTo ? {replyTo:[{emailAddress:{address:env.mailReplyTo}}]} : {}) }, saveToSentItems:true }),
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

export async function sendLoginOtp({ recipient, firstName, code, expiresMinutes }) {
  assertMailConfiguration()
  const accessToken = await getGraphAccessToken()
  const safeName = escapeHtml(firstName)
  const safeSender = escapeHtml(env.mailFromName)
  const emailHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your AT Connect sign-in code</title></head>
<body style="margin:0;padding:0;background:#f3f7f6;font-family:Arial,Helvetica,sans-serif;color:#182230">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f7f6"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e9e7;border-radius:20px;overflow:hidden;box-shadow:0 16px 40px rgba(18,62,58,.08)">
      <tr><td style="background:#123f3b;padding:28px 34px">
        <table role="presentation" width="100%"><tr><td style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:-.3px"><span style="display:inline-block;background:#ffffff;color:#17766d;border-radius:10px;padding:7px 9px;margin-right:10px">✦</span>AT Connect</td><td align="right" style="color:#a9cbc6;font-size:12px">Secure sign-in</td></tr></table>
      </td></tr>
      <tr><td style="padding:42px 40px 18px;text-align:center">
        <div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:16px;background:#e8f4f1;color:#17766d;font-size:25px">✉</div>
        <h1 style="margin:24px 0 10px;font-size:27px;line-height:1.25;color:#17213a;letter-spacing:-.6px">Your sign-in code</h1>
        <p style="margin:0;color:#667085;font-size:14px;line-height:1.7">Hi ${safeName}, use the verification code below to securely finish signing in to your workspace.</p>
      </td></tr>
      <tr><td style="padding:18px 40px">
        <div style="background:#f3f9f7;border:1px solid #d9ebe7;border-radius:16px;padding:25px 16px;text-align:center">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#68847f;margin-bottom:12px">One-time verification code</div>
          <div style="font-family:'Courier New',monospace;font-size:38px;line-height:1;font-weight:700;letter-spacing:10px;color:#126c63;padding-left:10px">${code}</div>
        </div>
      </td></tr>
      <tr><td style="padding:10px 40px 36px">
        <table role="presentation" width="100%" style="background:#fffbeb;border:1px solid #f6e8ba;border-radius:12px"><tr><td style="padding:14px 16px;color:#765b18;font-size:12px;line-height:1.55"><strong>⏱ Expires in ${expiresMinutes} minutes.</strong> For your security, never share this code with anyone.</td></tr></table>
        <p style="margin:24px 0 0;color:#7b8494;font-size:12px;line-height:1.65;text-align:center">If you didn’t request this code, you can safely ignore this email. Your account remains secure.</p>
      </td></tr>
      <tr><td style="padding:22px 34px;background:#f8faf9;border-top:1px solid #e8eeec;text-align:center;color:#98a2b3;font-size:11px;line-height:1.6">Sent securely by ${safeSender}<br>People operations that feel human.</td></tr>
    </table>
    <p style="margin:18px 0 0;color:#98a2b3;font-size:10px">This is an automated security message. Please do not forward it.</p>
  </td></tr></table>
</body></html>`
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.otpSenderEmail)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: 'Your AT Connect sign-in code',
        body: { contentType: 'HTML', content: emailHtml },
        toRecipients: [{ emailAddress: { address: recipient } }],
        ...(env.mailReplyTo ? { replyTo: [{ emailAddress: { address: env.mailReplyTo } }] } : {}),
      },
      saveToSentItems: false,
    }),
  })
  if (!response.ok) throw new HttpError(502, 'The sign-in code could not be emailed. Please try again.')
}

function modernMail({ preview, eyebrow, title, intro, content, actionLabel, actionUrl, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(preview)}</title></head>
  <body style="margin:0;padding:0;background:#f2f7f5;font-family:Arial,Helvetica,sans-serif;color:#17213a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:38px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #dfe9e6;border-radius:22px;overflow:hidden;box-shadow:0 18px 48px rgba(22,74,66,.09)">
        <tr><td style="padding:28px 34px;background:linear-gradient(135deg,#0e514a,#087e70);color:#fff"><table role="presentation" width="100%"><tr><td style="font-size:20px;font-weight:750">AT Connect</td><td align="right" style="font-size:11px;color:#bfe1db">Ananttattva Private Limited</td></tr></table></td></tr>
        <tr><td style="padding:38px 38px 16px"><div style="color:#168174;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${escapeHtml(eyebrow)}</div><h1 style="margin:13px 0 12px;font-size:29px;line-height:1.25;letter-spacing:-.7px;color:#152039">${escapeHtml(title)}</h1><p style="margin:0;color:#667085;font-size:14px;line-height:1.75">${intro}</p></td></tr>
        <tr><td style="padding:12px 38px 28px">${content}${actionLabel&&actionUrl?`<div style="padding-top:24px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:11px;background:#087e70;color:#fff;text-decoration:none;font-size:13px;font-weight:700">${escapeHtml(actionLabel)}</a></div>`:''}</td></tr>
        <tr><td style="padding:22px 34px;background:#f8faf9;border-top:1px solid #e6eeeb;text-align:center;color:#87958f;font-size:11px;line-height:1.65">${footer}<br>Sent by ${escapeHtml(env.mailFromName)}</td></tr>
      </table>
      <p style="margin:17px 0 0;color:#9aa6a2;font-size:10px">Automated message from AT Connect. Please do not share passwords or verification codes.</p>
    </td></tr></table>
  </body></html>`
}

export async function sendPasswordResetOtp({recipient,firstName,code,expiresMinutes}){
  const html=modernMail({
    preview:'Your AT Connect password reset code',eyebrow:'Account security',title:'Reset your password',
    intro:`Hi ${escapeHtml(firstName)}, we received a request to reset your AT Connect password. Enter the secure code below to continue.`,
    content:`<div style="margin-top:8px;padding:25px;border:1px solid #d8ebe6;border-radius:15px;background:#f2f9f7;text-align:center"><div style="margin-bottom:10px;color:#63827b;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase">Password reset code</div><div style="padding-left:8px;color:#086c61;font-family:'Courier New',monospace;font-size:36px;font-weight:750;letter-spacing:8px">${code}</div></div><div style="margin-top:16px;padding:13px 15px;border:1px solid #f0dfae;border-radius:11px;background:#fffaf0;color:#775f25;font-size:12px;line-height:1.6"><strong>This code expires in ${expiresMinutes} minutes.</strong> If you did not request a reset, ignore this email and your password will remain unchanged.</div>`,
    footer:'Protecting your account is our priority.',
  })
  return sendGraphEmail({recipient,subject:'Reset your AT Connect password',html})
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

function companyEmailTemplate({ greeting, summary, details = [], actionLabel, actionUrl, footer }) {
  const rows = details.map(({ label, value }) => `<tr><td style="font-size:13px;color:#64748b;padding:6px 10px 6px 0;vertical-align:top;width:170px">${escapeHtml(label)}</td><td style="font-size:14px;color:#0f172a;padding:6px 0;vertical-align:top">${escapeHtml(String(value))}</td></tr>`).join('')
  const button = actionUrl ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;letter-spacing:-0.01em">${escapeHtml(actionLabel)}</a>` : ''
  return `
    <div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(90deg,#0f766e,#0ea5e9);padding:22px 24px;color:#fff">
          <div style="font-size:12px;letter-spacing:0.14em;opacity:0.9;text-transform:uppercase;margin-bottom:6px">AT Connect</div>
          <h1 style="font-size:18px;margin:0;font-weight:600">${escapeHtml(greeting)}</h1>
        </div>
        <div style="padding:22px 24px 8px">
          <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(summary)}</p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:8px 0 20px">${rows}</table>
          <div style="margin:16px 0 4px">${button}</div>
        </div>
        <div style="padding:12px 24px 22px;font-size:12px;color:#64748b;line-height:1.55">${escapeHtml(footer)}</div>
      </div>
    </div>`
}

export async function sendLeaveApprovalRequest({ recipient, reviewerName, employeeName, employeeCode, leaveType, startDate, endDate, days, reason, stepLabel, longLeave }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Employee', value: `${employeeName} (${employeeCode})` },
    { label: 'Leave type', value: leaveType },
    { label: 'Dates', value: `${startDate} – ${endDate}` },
    { label: 'Working days', value: `${days} day${days === 1 ? '' : 's'}` },
    ...(longLeave ? [{ label: 'Approval chain', value: stepLabel }] : []),
    { label: 'Reason', value: reason },
  ]
  const html = companyEmailTemplate({
    greeting: `Leave request awaiting your review`,
    summary: `${escapeHtml(reviewerName || 'Reviewer')}, a new leave request requires your approval in AT Connect.`,
    details,
    actionLabel: 'Review request',
    actionUrl: `${base}/leave`,
    footer: 'Approve only after verifying leave balance and handoff coverage with the employee.',
  })
  return sendGraphEmail({ recipient, subject: `Leave approval: ${employeeName} (${days}d)`, html })
}

export async function sendLeaveDecision({ recipient, firstName, decision, leaveType, startDate, endDate, reviewerName, reviewNote }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Decision', value: decision },
    { label: 'Leave type', value: leaveType },
    { label: 'Dates', value: `${startDate} – ${endDate}` },
    { label: 'Reviewed by', value: reviewerName || 'AT Connect reviewer' },
    ...(reviewNote ? [{ label: 'Review note', value: reviewNote }] : []),
  ]
  const html = companyEmailTemplate({
    greeting: `Your leave request was ${decision}`,
    summary: `${escapeHtml(firstName)}, here is an update on the leave application you submitted.`,
    details,
    actionLabel: 'View leave details',
    actionUrl: `${base}/leave`,
    footer: 'Reach out to your manager or HR if you have questions about this decision.',
  })
  return sendGraphEmail({ recipient, subject: `Leave ${decision} for ${startDate} to ${endDate}`, html })
}

export async function sendProbationConfirmation({ recipient, firstName, employeeCode, confirmedAt, reviewNote }) {
  const base = env.clientUrl.replace(/\/$/, '')
  const details = [
    { label: 'Employee', value: `${firstName} (${employeeCode})` },
    { label: 'Confirmed on', value: confirmedAt },
    ...(reviewNote ? [{ label: 'Note from HR', value: reviewNote }] : []),
  ]
  const html = companyEmailTemplate({
    greeting: 'Your probation has been confirmed',
    summary: `${escapeHtml(firstName)}, HR has confirmed your probation. Paid leave eligibility is now active for the remainder of the financial year.`,
    details,
    actionLabel: 'Open My Space',
    actionUrl: `${base}/my-space`,
    footer: 'Paid leaves are prorated from the confirmation month through the end of the financial year.',
  })
  return sendGraphEmail({ recipient, subject: 'Probation confirmed', html })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[character])
}
