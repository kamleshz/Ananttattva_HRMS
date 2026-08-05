import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, Clock3, ScanFace, ShieldCheck, UserRound, X } from 'lucide-react'
import { attendanceApi, biometricApi, organizationApi } from './services/api.js'
import { challengeCopy, createIdentityTemplate, detectFace, evaluateChallenge, evaluateNeutralCapture, loadFaceIdentityModel, loadFaceLandmarker } from './services/biometrics.js'

export default function AttendanceVerificationDrawer({ mode, close, recorded }) {
  const videoRef=useRef(null),canvasRef=useRef(null)
  const [stream,setStream]=useState(null),[model,setModel]=useState(null),[identityModel,setIdentityModel]=useState(null),[challenge,setChallenge]=useState(null)
  const [photo,setPhoto]=useState(''),[faceTemplate,setFaceTemplate]=useState(null),[livenessScore,setLivenessScore]=useState(0)
  const [challengeComplete,setChallengeComplete]=useState(false)
  const [coordinates,setCoordinates]=useState(null),[locationError,setLocationError]=useState(navigator.geolocation?'':'Location is not supported by this browser.')
  const [officeConfigured,setOfficeConfigured]=useState(null)
  const [cameraError,setCameraError]=useState(navigator.mediaDevices?.getUserMedia?'':'Camera is not supported by this browser.')
  const [livenessStatus,setLivenessStatus]=useState('Loading secure face detection…'),[busy,setBusy]=useState(false),[error,setError]=useState('')

  async function openCamera(){const mediaStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});setStream(mediaStream)}
  async function requestChallenge(){setChallenge(await biometricApi.challenge(mode))}

  useEffect(()=>{
    let active=true
    organizationApi.officeLocations().then(locations=>{
      if(!active)return
      if(!locations.length){setOfficeConfigured(false);setLocationError('Office attendance boundary is not configured. Ask a Super Admin to add it under Settings → Office Locations.');setCameraError('Face verification will be available after the office boundary is configured.');return}
      setOfficeConfigured(true)
      if(navigator.geolocation)navigator.geolocation.getCurrentPosition(({coords})=>setCoordinates({latitude:coords.latitude,longitude:coords.longitude,accuracyMeters:coords.accuracy}),positionError=>setLocationError(positionError.code===1?'Location permission was denied. Please allow it and try again.':'Unable to determine your current location.'),{timeout:12000,enableHighAccuracy:true,maximumAge:0})
      if(navigator.mediaDevices?.getUserMedia)navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false}).then(setStream).catch(()=>setCameraError('Camera permission is required to record attendance.'))
      biometricApi.challenge(mode).then(setChallenge).catch(requestError=>setError(requestError.message))
      loadFaceLandmarker().then(setModel).catch(()=>setCameraError('Secure face detection could not be loaded.'))
      loadFaceIdentityModel().then(setIdentityModel).catch(()=>setCameraError('Secure identity recognition could not be loaded.'))
    }).catch(requestError=>{if(active){setOfficeConfigured(false);setLocationError(requestError.message)}})
    return()=>{active=false}
  },[mode])
  useEffect(()=>{if(videoRef.current&&stream){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{})}return()=>stream?.getTracks().forEach(track=>track.stop())},[stream])
  useEffect(()=>{
    if(!model||!stream||!challenge||photo)return
    let frame,active=true,lastProcessed=0,neutralFrames=0,passedFrames=0,awaitingNeutralCapture=false,stableNeutralFrames=0
    const process=(time)=>{
      if(!active)return
      if(time-lastProcessed>90&&videoRef.current?.readyState>=2){
        lastProcessed=time
        try{
          const result=detectFace(model,videoRef.current),evaluation=evaluateChallenge(result,challenge.challenge)
          if(awaitingNeutralCapture){
            const neutralCapture=evaluateNeutralCapture(result)
            if(neutralCapture.ready){
              stableNeutralFrames+=1
              setLivenessStatus(stableNeutralFrames<6?'Neutral face detected. Hold still…':'Capturing neutral identity photo…')
              if(stableNeutralFrames>=6){
                const canvas=canvasRef.current,video=videoRef.current
                canvas.width=640;canvas.height=480;canvas.getContext('2d').drawImage(video,0,0,640,480)
                setPhoto(canvas.toDataURL('image/jpeg',.86));setLivenessStatus('Neutral identity photo captured. Preparing secure match…');stream.getTracks().forEach(track=>track.stop());return
              }
            }else{stableNeutralFrames=0;setLivenessStatus(`Liveness passed. ${neutralCapture.message}`)}
          }
          else if(evaluation.faceCount===0)setLivenessStatus('Position one face inside the frame.')
          else if(evaluation.faceCount>1)setLivenessStatus('Multiple faces detected. Only the employee should be visible.')
          else if(evaluation.neutral){neutralFrames+=1;setLivenessStatus('Neutral face detected. Now complete the challenge.')}
          else if(neutralFrames<3)setLivenessStatus('Look straight with a neutral expression first…')
          else {
            setLivenessStatus(challengeCopy[challenge.challenge].instruction)
            if(evaluation.passed)passedFrames+=1;else if(challenge.challenge!=='blink')passedFrames=0
            if(passedFrames>=(challenge.challenge==='blink'?1:2)){
              awaitingNeutralCapture=true;stableNeutralFrames=0;setChallengeComplete(true);setLivenessScore(Math.max(.66,Math.min(1,.68+evaluation.score*.32)));setLivenessStatus('Liveness passed. Return to a neutral face and look straight at the camera.')
            }
          }
        }catch{setLivenessStatus('Keep your face steady inside the frame.')}
      }
      frame=requestAnimationFrame(process)
    }
    frame=requestAnimationFrame(process)
    return()=>{active=false;cancelAnimationFrame(frame)}
  },[model,stream,challenge,photo])

  useEffect(()=>{
    if(!photo||!identityModel||faceTemplate)return
    let active=true
    createIdentityTemplate(photo,identityModel).then(template=>{if(active){setFaceTemplate(template);setLivenessStatus('Live face captured and ready for identity matching')}}).catch(identityError=>{if(active){setError(identityError.message);setLivenessStatus('Identity capture failed. Please repeat verification.')}})
    return()=>{active=false}
  },[photo,identityModel,faceTemplate])

  async function submit(){if(!photo||!coordinates||!faceTemplate||!challenge)return;setBusy(true);setError('');try{const verification=await biometricApi.verify({challengeToken:challenge.challengeToken,challenge:challenge.challenge,photo,faceTemplate,livenessScore,faceCount:1});const payload={photo,attendanceMode:'office',location:coordinates,biometricToken:verification.verificationToken};await (mode==='check-out'?attendanceApi.checkOut(payload):attendanceApi.checkIn(payload));await recorded();close()}catch(requestError){setError(requestError.message)}finally{setBusy(false)}}
  async function retake(){stream?.getTracks().forEach(track=>track.stop());setPhoto('');setFaceTemplate(null);setChallenge(null);setChallengeComplete(false);setLivenessScore(0);setError('');setCameraError('');setLivenessStatus('Preparing a new challenge…');try{await Promise.all([openCamera(),requestChallenge()])}catch{setCameraError('Unable to restart biometric verification.')}}
  const ready=Boolean(officeConfigured&&photo&&coordinates&&faceTemplate?.length>=128&&livenessScore>=.65),challengeText=challengeCopy[challenge?.challenge]
  return <div className="drawer-layer"><button className="drawer-backdrop" onClick={close}/><aside className="attendance-drawer"><div className="drawer-heading"><div><p className="eyebrow">Secure attendance verification</p><h2>{mode==='check-out'?'Check Out':'Check In'}</h2><p>Complete location and face verification to record your attendance.</p></div><button onClick={close}><X size={20}/></button></div><ol className="verification-progress" aria-label="Attendance verification progress"><li className={coordinates?'done':'active'}>Detecting current location</li><li className={coordinates?'active':''}>Verifying office geofence</li><li className={stream||photo?'done':'active'}>Starting camera</li><li className={challengeComplete?'done':stream?'active':''}>Completing liveness challenge</li><li className={faceTemplate?'done':challengeComplete?'active':''}>Matching enrolled identity</li><li className={busy?'active':''}>Recording attendance</li></ol><div className="verification-section"><p className="verification-label">1 · Current location</p>{coordinates?<div className="verification-success"><CheckCircle2 size={18}/><div><strong>Location captured</strong><span>{coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)} · Accuracy {Math.round(coordinates.accuracyMeters)}m</span></div></div>:locationError?<div className="verification-error">{locationError}</div>:<div className="verification-loading"><span/> Getting your precise location…</div>}</div><div className="verification-section"><p className="verification-label">2 · Active liveness and identity check</p>{challengeText&&<div className={`liveness-challenge ${challengeComplete?'completed':''}`}><span>{challengeComplete?<CheckCircle2 size={21}/>:<ScanFace size={21}/>}</span><div><small>{challengeComplete?'Identity capture':'Random challenge'}</small><strong>{challengeComplete?'Return to neutral':challengeText.title}</strong><p>{challengeComplete?'Look straight, relax your expression and hold still.':challengeText.instruction}</p></div></div>}<div className={`camera-frame ${faceTemplate?'liveness-passed':''}`}>{photo?<img src={photo} alt="Attendance identity capture"/>:<video ref={videoRef} muted playsInline/>}{!photo&&!stream&&!cameraError&&<div className="camera-placeholder"><UserRound size={30}/><span>Opening secure camera…</span></div>}{cameraError&&<div className="camera-placeholder error"><UserRound size={30}/><span>{cameraError}</span></div>}<div className="face-guide"/>{photo&&<div className="liveness-overlay"><ShieldCheck size={25}/><strong>{faceTemplate?'Identity ready':'Analyzing identity…'}</strong><span>{faceTemplate?'Server match is required before attendance':'Creating secure face embedding'}</span></div>}</div><canvas ref={canvasRef} hidden/><div className={`liveness-status ${faceTemplate?'passed':''}`}>{faceTemplate?<CheckCircle2 size={16}/>:<ScanFace size={16}/>}<span>{livenessStatus}</span></div>{photo&&<button className="secondary-button camera-action" onClick={retake}>Repeat verification</button>}</div>{error&&<p className="attendance-error drawer-error">{error}</p>}<div className="attendance-drawer-footer"><div><Clock3 size={16}/><span>Attendance is blocked unless this face matches the employee’s enrolled identity and office boundary.</span></div><button className="primary-button" disabled={!ready||busy} onClick={submit}>{busy?'Matching identity and recording…':mode==='check-out'?'Confirm verified check out':'Confirm verified check in'} <ChevronRight size={15}/></button></div></aside></div>
}
