import { env } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'

function assertMailConfiguration() {
  if (!env.msClientId || !env.msTenantId || !env.msClientSecret || !env.otpSenderEmail) {
    throw new HttpError(503, 'OTP email is not configured. Contact your administrator.')
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[character])
}
