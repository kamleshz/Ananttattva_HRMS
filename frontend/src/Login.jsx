import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { authApi, session } from './services/api.js'
import './login-modern.css'

const PRODUCT_NAME = 'AT Connect'

export default function Login({ onAuthenticated }) {
  const [form, setForm] = useState({ email: '', password: '', loginType: 'user' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [challenge, setChallenge] = useState(null)
  const [otp, setOtp] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(form)
      setChallenge(data)
      setOtp(data.developmentOtp || '')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.verifyOtp({ challengeId: challenge.challengeId, code: otp })
      session.setToken(data.token)
      onAuthenticated(data.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  function backToLogin() {
    setChallenge(null)
    setOtp('')
    setError('')
  }

  function selectLoginType(loginType) {
    setForm(current => ({ ...current, loginType }))
    setError('')
  }

  const loginLabel = form.loginType === 'admin' ? 'Admin' : 'User'

  return <main className="login-page">
    <section className="login-panel">
      <div className={`login-form-wrap ${challenge ? 'otp-step' : ''}`}>
        {!challenge ? <>
          <div className="login-type-badge"><ShieldCheck size={15}/>{loginLabel} login</div>
          <div className="form-heading">
            <h2>Sign in to {PRODUCT_NAME}</h2>
            <p>Use {loginLabel} Login for {form.loginType === 'admin' ? 'Admin and Super Admin accounts' : 'non-admin team accounts'}. We will send a secure one-time code for this session.</p>
          </div>
          <form onSubmit={submit}>
            <fieldset className="login-type-field">
              <legend>Login type</legend>
              <div className="login-type-options">
                <button type="button" className={form.loginType === 'admin' ? 'active' : ''} onClick={() => selectLoginType('admin')}>
                  <strong>Admin Login</strong><span>Admin and Super Admin only</span>
                </button>
                <button type="button" className={form.loginType === 'user' ? 'active' : ''} onClick={() => selectLoginType('user')}>
                  <strong>User Login</strong><span>All non-admin team users</span>
                </button>
              </div>
            </fieldset>
            <label>Work email
              <div className="input-wrap"><Mail size={18}/><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@ananttattva.com" autoComplete="email" required/></div>
            </label>
            <label>Password
              <div className="input-wrap"><LockKeyhole size={18}/><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" autoComplete="current-password" required minLength={8}/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
            </label>
            <div className="login-form-meta">
              <span className="login-security-note"><ShieldCheck size={15}/>Secure password is protected during OTP verification.</span>
              <button type="button" onClick={() => setError('Please contact your HR administrator to reset your password.')}>Forgot password?</button>
            </div>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" disabled={loading}><span>{loading ? 'Sending secure code…' : `Send ${loginLabel} OTP`}</span><ArrowRight size={18}/></button>
          </form>
        </> : <>
          <button type="button" className="login-back" onClick={backToLogin}><ArrowLeft size={16}/> Change email</button>
          <div className="otp-hero"><span className="otp-icon"><Mail size={24}/><i><Check size={11}/></i></span><div className="otp-sent-badge"><span/> Code sent</div></div>
          <div className="form-heading otp-heading"><div className="login-type-badge"><ShieldCheck size={15}/>OTP verification</div><h2>Check your inbox</h2><p>Enter the 6-digit code sent to <strong>{challenge.email}</strong></p></div>
          <form onSubmit={verifyOtp}>
            <label>Verification code
              <div className="input-wrap otp-input"><KeyRound size={19}/><input aria-label="6-digit verification code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" autoFocus required/></div>
            </label>
            <div className="otp-expiry"><ShieldCheck size={15}/><span>For your security, this code expires in <strong>{Math.round(challenge.expiresIn / 60)} minutes</strong>.</span></div>
            {challenge.developmentOtp && <p className="otp-demo"><span>Development code</span><strong>{challenge.developmentOtp}</strong></p>}
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" disabled={loading || otp.length !== 6}><span>{loading ? 'Verifying code…' : 'Verify & sign in'}</span><ArrowRight size={18}/></button>
          </form>
          <p className="login-help">Didn&apos;t receive the email? <button type="button" onClick={backToLogin}>Try again</button></p>
        </>}
      </div>
      <p className="login-legal"><ShieldCheck size={13}/> {PRODUCT_NAME} · Secure authentication</p>
    </section>
  </main>
}
