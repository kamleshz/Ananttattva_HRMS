import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ChevronRight, Clock3, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { attendanceApi } from './services/api.js';

const constraints={video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false};
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function deviceDetails(){
  const agent=navigator.userAgent||'';
  return {browser:agent.slice(0,80),os:navigator.platform?.slice(0,80)||'Unknown',deviceType:/iPad|Tablet/i.test(agent)?'tablet':/Mobi|Android|iPhone/i.test(agent)?'mobile':'desktop'};
}

function AnimatedCheck(){return <div className="manual-success-icon" aria-hidden="true"><span/><svg viewBox="0 0 48 48"><path d="M13 25.2 20.3 32 35 16.8"/></svg></div>}

export default function ManualAttendanceDrawer({action,attendanceMode='office',close,submitted}){
  const videoRef=useRef(null),streamRef=useRef(null),closeTimer=useRef(null);
  const [state,setState]=useState('permission'),[photo,setPhoto]=useState(null),[preview,setPreview]=useState(''),[flash,setFlash]=useState(false),[closing,setClosing]=useState(false),[error,setError]=useState('');
  const requestId=useMemo(()=>crypto.randomUUID(),[]);
  const stopCamera=useCallback(()=>{streamRef.current?.getTracks()?.forEach(track=>track.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null},[]);
  const requestClose=useCallback(()=>{if(closing)return;stopCamera();setClosing(true);closeTimer.current=setTimeout(close,220)},[close,closing,stopCamera]);

  useEffect(()=>()=>{clearTimeout(closeTimer.current);stopCamera()},[stopCamera]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  useEffect(()=>{const onKey=event=>event.key==='Escape'&&requestClose();document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[requestClose]);

  async function startCamera(){
    stopCamera();setError('');setState('requesting');
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera is not supported by this browser.');
      const stream=await navigator.mediaDevices.getUserMedia(constraints);streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}
      setState('live');
    }catch(cameraError){setError(cameraError.name==='NotAllowedError'?'Enable camera permission in your browser to continue.':cameraError.message||'The camera could not be started.');setState('error')}
  }

  async function capture(){
    const video=videoRef.current;if(!video?.videoWidth)return;
    const canvas=document.createElement('canvas'),width=Math.min(video.videoWidth,1280),height=Math.round(width*video.videoHeight/video.videoWidth);
    canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(video,0,0,width,height);
    setFlash(true);setTimeout(()=>setFlash(false),220);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));if(!blob){setError('We could not capture the photo. Please try again.');return}
    setPhoto(new File([blob],`manual-${action}-${Date.now()}.jpg`,{type:'image/jpeg'}));setPreview(URL.createObjectURL(blob));setState('captured');stopCamera();
  }

  async function retake(){setState('transitioning');setPhoto(null);setPreview('');await wait(180);startCamera()}
  function confirm(){setState('confirmed')}
  async function submit(){
    if(state!=='confirmed'||!photo)return;setState('submitting');setError('');
    let location;
    if(navigator.geolocation)await new Promise(resolve=>navigator.geolocation.getCurrentPosition(({coords})=>{location={latitude:coords.latitude,longitude:coords.longitude,accuracyMeters:Math.max(1,coords.accuracy)};resolve()},resolve,{enableHighAccuracy:true,timeout:7000,maximumAge:0}));
    try{
      await attendanceApi.createManualRequest({photo,action,attendanceMode,reasonCode:'LIVE_CAMERA_VERIFICATION',remarks:'',location,clientRequestId:requestId,deviceDetails:deviceDetails(),biometricAttempt:{attempts:1,cameraStatus:'working',livenessStatus:'unknown',faceMatchStatus:'not_attempted'}});
      stopCamera();setState('success');await submitted?.();
    }catch(requestError){setError(requestError.message||'We couldn’t submit your request. Please try again.');setState('confirmed')}
  }

  const review=['captured','confirmed','submitting','transitioning'].includes(state);
  return <div className={`manual-drawer-layer ${closing?'is-closing':''}`} role="presentation">
    <button className="manual-drawer-backdrop" aria-label="Close manual check-out" onClick={requestClose}/>
    <aside className="manual-attendance-drawer" role="dialog" aria-modal="true" aria-labelledby="manual-checkout-title">
      {state==='success'?<section className="manual-success-screen">
        <AnimatedCheck/><h2>{action==='check_out'?'Check-Out':'Check-In'} Request Submitted</h2><p>Your live verification has been sent for approval.</p><span className="pending-pill"><i/>Pending Approval</span><small>You will be marked as {action==='check_out'?'checked out':'checked in'} after an authorized reviewer approves the request.</small><button className="manual-primary" onClick={requestClose}>Done</button>
      </section>:<>
        <header className="manual-drawer-header manual-stagger"><div><p>Manual verification</p><h2 id="manual-checkout-title">Manual {action==='check_out'?'Check-Out':'Check-In'}</h2><span>Verify your presence with a live photo to request {action==='check_out'?'check-out':'check-in'} approval.</span></div><button className="manual-close" onClick={requestClose} aria-label="Close"><X size={20}/></button></header>
        <main className="manual-drawer-body">
          <section className="manual-policy-note manual-stagger"><span><ShieldCheck size={20}/></span><div><strong>Biometric attendance remains the primary method.</strong><p>Manual {action==='check_out'?'check-out':'check-in'} requires live photo verification and approval from an authorized reviewer.</p></div></section>
          <section className="live-verification manual-stagger"><div className="manual-section-heading"><h3>{review?'Review Your Photo':'Live Photo Verification'}</h3><p>{review?'Make sure your face is clear before continuing.':'Take a clear live photo to confirm your presence.'}</p></div>
            <div className={`manual-camera ${state}`}>
              <video ref={videoRef} muted playsInline aria-label="Live front camera"/>
              {review&&preview&&<img src={preview} alt="Captured live verification"/>}
              {state==='permission'&&<div className="camera-state"><div className="camera-breathe"><Camera size={25}/><i/></div><h4>Camera access required</h4><p>Allow camera access to capture your live verification photo.</p><button onClick={startCamera}>Enable Camera</button></div>}
              {state==='requesting'&&<div className="camera-state camera-loading"><LoaderCircle size={24}/><h4>Starting camera…</h4><p>Connecting securely to your front camera.</p></div>}
              {state==='error'&&<div className="camera-state camera-denied"><CameraOff size={27}/><h4>Camera access is blocked</h4><p>{error}</p><button onClick={startCamera}>Try Again</button></div>}
              {state==='live'&&<><div className="camera-vignette"/><div className="camera-live-badge"><i/>Camera live</div><div className="face-oval"/><div className="corner-guide top-left"/><div className="corner-guide top-right"/><div className="corner-guide bottom-left"/><div className="corner-guide bottom-right"/><div className="camera-scan"/><div className="capture-wrap"><button className="shutter" aria-label="Capture photo" onClick={capture}><span/></button><small>Capture Photo</small></div></>}
              {flash&&<div className="camera-flash"/>}
              {['captured','confirmed','submitting'].includes(state)&&<div className="photo-captured"><Check size={14}/> Photo captured</div>}
              {state==='submitting'&&<div className="photo-progress"><LoaderCircle size={15}/> Securing verification…</div>}
            </div>
            {state==='captured'&&<div className="photo-actions"><button className="manual-secondary" onClick={retake}><RotateCcw size={15}/>Retake</button><button className="manual-primary" onClick={confirm}>Use This Photo <ChevronRight size={16}/></button></div>}
          </section>
          {['confirmed','submitting'].includes(state)&&<section className="verification-summary"><div><h3>Ready to submit</h3><span className="pending-pill"><i/>Pending Approval</span></div><ul><li><i><Check size={12}/></i>Live photo captured</li><li><i><Check size={12}/></i>Request time recorded by server</li><li><i><Check size={12}/></i>Manual approval required</li></ul></section>}
          {error&&state==='confirmed'&&<div className="manual-api-error" role="alert">We couldn’t submit your request. Please try again.<small>{error}</small></div>}
        </main>
        <footer className="manual-submit-footer manual-stagger"><div><Clock3 size={17}/><span>The server records the request time; your device clock is not used.</span></div><button className="manual-primary" disabled={state!=='confirmed'} onClick={submit}>{state==='submitting'?<><LoaderCircle className="button-spinner" size={17}/>Submitting Request…</>:<>Submit {action==='check_out'?'Check-Out':'Check-In'} Request <ChevronRight size={17}/></>}</button></footer>
      </>}
    </aside>
  </div>
}
