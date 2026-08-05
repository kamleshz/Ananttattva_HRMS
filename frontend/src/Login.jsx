import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { authApi, session } from './services/api.js'
import './login-modern.css'

const PRODUCT_NAME = 'AT Connect'

function VerificationCodeInput({ value, onChange, label, autoFocus = false }) {
  const inputRefs = useRef([])
  const digits = Array.from({ length:6 }, (_, index) => value[index] || '')

  function focus(index) {
    inputRefs.current[Math.max(0, Math.min(5, index))]?.focus()
  }

  function applyCode(rawCode) {
    const code = rawCode.replace(/\D/g, '').slice(0, 6)
    onChange(code)
    focus(code.length >= 6 ? 5 : code.length)
  }

  function changeDigit(index, rawValue) {
    const numeric = rawValue.replace(/\D/g, '')
    if (numeric.length > 1) return applyCode(numeric)
    const next = [...digits]
    next[index] = numeric
    onChange(next.join(''))
    if (numeric && index < 5) focus(index + 1)
  }

  function handleKeyDown(event, index) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const next = [...digits]
      if (next[index]) next[index] = ''
      else if (index > 0) { next[index - 1] = ''; focus(index - 1) }
      onChange(next.join(''))
    } else if (event.key === 'ArrowLeft') focus(index - 1)
    else if (event.key === 'ArrowRight') focus(index + 1)
  }

  return <div
    className="otp-code-shell"
    role="group"
    aria-label={label}
    onPaste={event => { event.preventDefault(); applyCode(event.clipboardData.getData('text')) }}
  >
    <span className="otp-code-icon"><KeyRound size={20}/></span>
    <div className="otp-code-boxes">
      {digits.map((digit, index) => <input
        key={index}
        ref={element => { inputRefs.current[index] = element }}
        aria-label={`${label} digit ${index + 1}`}
        type="text"
        inputMode="numeric"
        autoComplete={index === 0 ? 'one-time-code' : 'off'}
        maxLength={1}
        value={digit}
        onChange={event => changeDigit(index, event.target.value)}
        onKeyDown={event => handleKeyDown(event, index)}
        onFocus={event => event.target.select()}
        autoFocus={autoFocus && index === 0}
        required
      />)}
    </div>
  </div>
}

export default function Login({ onAuthenticated }) {
  const [form,setForm]=useState({email:'',password:'',loginType:'user'})
  const [showPassword,setShowPassword]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[loading,setLoading]=useState(false)
  const [challenge,setChallenge]=useState(null),[otp,setOtp]=useState(''),[view,setView]=useState('login')
  const [forgotEmail,setForgotEmail]=useState(''),[resetChallenge,setResetChallenge]=useState(null),[resetCode,setResetCode]=useState('')
  const [newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[showNewPassword,setShowNewPassword]=useState(false)

  async function submit(event) {
    event.preventDefault();setError('');setSuccess('');setLoading(true)
    try { const data=await authApi.login(form);setChallenge(data);setOtp(data.developmentOtp||'') }
    catch(requestError){setError(requestError.message)}finally{setLoading(false)}
  }

  async function verifyOtp(event) {
    event.preventDefault();setError('');setLoading(true)
    try { const data=await authApi.verifyOtp({challengeId:challenge.challengeId,code:otp});session.setToken(data.token);onAuthenticated(data.user) }
    catch(requestError){setError(requestError.message)}finally{setLoading(false)}
  }

  async function requestReset(event) {
    event.preventDefault();setError('');setSuccess('');setLoading(true)
    try { const data=await authApi.forgotPassword(forgotEmail);setResetChallenge(data);setResetCode(data.developmentOtp||'');setView('reset') }
    catch(requestError){setError(requestError.message)}finally{setLoading(false)}
  }

  async function completeReset(event) {
    event.preventDefault();setError('')
    if(newPassword!==confirmPassword){setError('New password and confirmation do not match.');return}
    setLoading(true)
    try {
      const data=await authApi.resetPassword({challengeId:resetChallenge.challengeId,code:resetCode,newPassword})
      setForm(current=>({...current,email:forgotEmail,password:''}));setView('login');setResetChallenge(null);setResetCode('');setNewPassword('');setConfirmPassword('');setSuccess(data.message)
    } catch(requestError){setError(requestError.message)}finally{setLoading(false)}
  }

  function backToLogin(){setChallenge(null);setOtp('');setView('login');setError('');setSuccess('')}
  function openForgot(){setForgotEmail(form.email);setView('forgot');setChallenge(null);setError('');setSuccess('')}
  function selectLoginType(loginType){setForm(current=>({...current,loginType}));setError('')}
  const loginLabel=form.loginType==='admin'?'Admin':'User'

  let content
  if (view === 'forgot') content = <>
    <button type="button" className="login-back" onClick={backToLogin}><ArrowLeft size={16}/> Back to sign in</button>
    <div className="reset-hero"><span><KeyRound size={23}/></span><div><small>Account recovery</small><strong>Secure password reset</strong></div></div>
    <div className="form-heading"><h2>Forgot your password?</h2><p>Enter your AT Connect work email. We will send a secure six-digit reset code to your registered inbox.</p></div>
    <form onSubmit={requestReset}>
      <label>Work email<div className="input-wrap"><Mail size={18}/><input type="email" value={forgotEmail} onChange={event=>setForgotEmail(event.target.value)} placeholder="you@ananttattva.com" autoComplete="email" required autoFocus/></div></label>
      <div className="reset-security"><ShieldCheck size={17}/><span>For privacy, reset instructions are available only through the registered work email.</span></div>
      {error&&<p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={loading}><span>{loading?'Sending reset code…':'Email reset code'}</span><ArrowRight size={18}/></button>
    </form>
  </>
  else if (view === 'reset') content = <>
    <button type="button" className="login-back" onClick={()=>{setView('forgot');setError('')}}><ArrowLeft size={16}/> Request another code</button>
    <div className="otp-hero"><span className="otp-icon"><KeyRound size={24}/><i><Check size={11}/></i></span><div className="otp-sent-badge"><span/> Reset code sent</div></div>
    <div className="form-heading otp-heading"><div className="login-type-badge"><ShieldCheck size={15}/>Password recovery</div><h2>Create a new password</h2><p>Enter the code sent to <strong>{resetChallenge?.email}</strong>, then choose a new password.</p></div>
    <form onSubmit={completeReset}>
      <label>Reset code<VerificationCodeInput value={resetCode} onChange={setResetCode} label="Reset code" autoFocus/></label>
      <label>New password<div className="input-wrap"><LockKeyhole size={18}/><input type={showNewPassword?'text':'password'} minLength={8} maxLength={128} value={newPassword} onChange={event=>setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Minimum 8 characters" required/><button type="button" aria-label={showNewPassword?'Hide password':'Show password'} onClick={()=>setShowNewPassword(!showNewPassword)}>{showNewPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      <label>Confirm new password<div className="input-wrap"><LockKeyhole size={18}/><input type={showNewPassword?'text':'password'} minLength={8} maxLength={128} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Enter the password again" required/></div></label>
      <div className="otp-expiry"><ShieldCheck size={15}/><span>The reset code expires in <strong>{Math.round((resetChallenge?.expiresIn||0)/60)} minutes</strong>.</span></div>
      {resetChallenge?.developmentOtp&&<p className="otp-demo"><span>Development code</span><strong>{resetChallenge.developmentOtp}</strong></p>}{error&&<p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={loading||resetCode.length!==6||newPassword.length<8||confirmPassword.length<8}><span>{loading?'Changing password…':'Change password securely'}</span><ArrowRight size={18}/></button>
    </form>
  </>
  else if (challenge) content = <>
    <button type="button" className="login-back" onClick={backToLogin}><ArrowLeft size={16}/> Change email</button>
    <div className="otp-hero"><span className="otp-icon"><Mail size={24}/><i><Check size={11}/></i></span><div className="otp-sent-badge"><span/> Code sent</div></div>
    <div className="form-heading otp-heading"><div className="login-type-badge"><ShieldCheck size={15}/>OTP verification</div><h2>Check your inbox</h2><p>Enter the 6-digit code sent to <strong>{challenge.email}</strong></p></div>
    <form onSubmit={verifyOtp}>
      <label>Verification code<VerificationCodeInput value={otp} onChange={setOtp} label="Verification code" autoFocus/></label>
      <div className="otp-expiry"><ShieldCheck size={15}/><span>For your security, this code expires in <strong>{Math.round(challenge.expiresIn/60)} minutes</strong>.</span></div>
      {challenge.developmentOtp&&<p className="otp-demo"><span>Development code</span><strong>{challenge.developmentOtp}</strong></p>}{error&&<p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={loading||otp.length!==6}><span>{loading?'Verifying code…':'Verify & sign in'}</span><ArrowRight size={18}/></button>
    </form>
    <p className="login-help">Didn&apos;t receive the email? <button type="button" onClick={backToLogin}>Try again</button></p>
  </>
  else content = <>
    <div className="login-type-badge"><ShieldCheck size={15}/>{loginLabel} login</div>
    <div className="form-heading"><h2>Sign in to {PRODUCT_NAME}</h2><p>Use {loginLabel} Login for {form.loginType==='admin'?'administrative accounts':'non-admin team accounts'}. We will send a secure one-time code for this session.</p></div>
    <form onSubmit={submit}>
      <fieldset className="login-type-field"><legend>Login type</legend><div className="login-type-options"><button type="button" className={form.loginType==='admin'?'active':''} onClick={()=>selectLoginType('admin')}><strong>Admin Login</strong><span>All administrative accounts</span></button><button type="button" className={form.loginType==='user'?'active':''} onClick={()=>selectLoginType('user')}><strong>User Login</strong><span>All non-admin team users</span></button></div></fieldset>
      <label>Work email<div className="input-wrap"><Mail size={18}/><input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})} placeholder="you@ananttattva.com" autoComplete="email" required/></div></label>
      <label>Password<div className="input-wrap"><LockKeyhole size={18}/><input type={showPassword?'text':'password'} value={form.password} onChange={event=>setForm({...form,password:event.target.value})} placeholder="Enter your password" autoComplete="current-password" required minLength={8}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      <div className="login-form-meta"><span className="login-security-note"><ShieldCheck size={15}/>Secure password is protected during OTP verification.</span><button type="button" onClick={openForgot}>Forgot password?</button></div>
      {success&&<p className="login-success" role="status"><CheckCircle2 size={16}/>{success}</p>}{error&&<p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={loading}><span>{loading?'Sending secure code…':`Send ${loginLabel} OTP`}</span><ArrowRight size={18}/></button>
    </form>
  </>

  return <main className="login-page"><section className="login-panel"><div className={`login-form-wrap ${challenge||view==='reset'?'otp-step':''}`}>{content}</div><p className="login-legal"><ShieldCheck size={13}/> {PRODUCT_NAME} · Secure authentication</p></section></main>
}
