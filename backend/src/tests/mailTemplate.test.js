import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVerificationCodeEmail } from '../services/mailService.js'

test('verification email renders the reference-style secure code card',()=>{
  const html=buildVerificationCodeEmail({recipient:'person+test@example.com',code:'975694',expiresMinutes:10,context:'signing in to AT Connect'})
  assert.match(html,/Your verification code/)
  assert.match(html,/975694/)
  assert.match(html,/person\+test@example\.com/)
  assert.match(html,/background:#eaf8f2/)
  assert.match(html,/border:2px dashed #72c9aa/)
  assert.match(html,/color:#135c46/)
  assert.match(html,/@media only screen and \(max-width:480px\)/)
  assert.match(html,/expires in <strong>10 minutes/)
  assert.match(html,/never share it with anyone/)
})

test('verification email escapes recipient and context content',()=>{
  const html=buildVerificationCodeEmail({recipient:'person@example.com&quot',code:'123456',expiresMinutes:5,context:'resetting <password>'})
  assert.doesNotMatch(html,/resetting <password>/)
  assert.match(html,/resetting &lt;password&gt;/)
  assert.match(html,/person@example\.com&amp;quot/)
})
