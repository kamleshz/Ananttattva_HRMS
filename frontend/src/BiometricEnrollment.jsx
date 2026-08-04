import { useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, RotateCcw, ScanFace, UserRound } from 'lucide-react'
import { createIdentityTemplate, detectFace, evaluateEnrollmentPose, loadFaceIdentityModel, loadFaceLandmarker } from './services/biometrics.js'

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const poseLabel = { front:'Straight', left:'Left side', right:'Right side' }

function averageTemplates(templates) {
  return templates[0].map((_, index) => Number((templates.reduce((sum, template) => sum + template[index], 0) / templates.length).toFixed(6)))
}

export default function BiometricEnrollment({ value, onChange }) {
  const videoRef=useRef(null),canvasRef=useRef(null)
  const [stream,setStream]=useState(null),[model,setModel]=useState(null),[identityModel,setIdentityModel]=useState(null)
  const [error,setError]=useState(''),[loading,setLoading]=useState(false),[samples,setSamples]=useState(value?.biometricSamples || [])

  useEffect(()=>{
    if(videoRef.current&&stream){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{})}
    return()=>stream?.getTracks().forEach(track=>track.stop())
  },[stream])

  async function start(){
    setLoading(true);setError('')
    try{
      const [mediaStream,landmarker,identity]=await Promise.all([
        navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false}),
        loadFaceLandmarker(),loadFaceIdentityModel(),
      ])
      setModel(landmarker);setIdentityModel(identity);setStream(mediaStream)
    }catch{setError('Camera or secure face-recognition model is unavailable.')}
    finally{setLoading(false)}
  }

  const nextTarget = samples.length === 0 ? 'front' : samples.length === 1 ? 'side' : samples[1].pose === 'left' ? 'right' : 'left'
  const instruction = nextTarget === 'front' ? 'Look straight at the camera with a relaxed expression.' : nextTarget === 'side' ? 'Turn slightly to either side while keeping both eyes visible.' : 'Now turn slightly to the opposite side.'

  async function capture(){
    setLoading(true);setError('')
    try{
      const photos=[],templates=[]
      let capturedPose=nextTarget
      for(let frame=0;frame<3;frame+=1){
        const evaluation=evaluateEnrollmentPose(detectFace(model,videoRef.current),nextTarget)
        if(!evaluation.ready)throw new Error(evaluation.message)
        capturedPose=evaluation.pose
        const canvas=canvasRef.current
        canvas.width=640;canvas.height=480
        canvas.getContext('2d').drawImage(videoRef.current,0,0,640,480)
        const photo=canvas.toDataURL('image/jpeg',.84)
        photos.push(photo)
        templates.push(await createIdentityTemplate(photo,identityModel))
        if(frame<2)await wait(180)
      }
      const sample={pose:capturedPose,photo:photos[1],template:averageTemplates(templates)}
      const nextSamples=[...samples,sample]
      setSamples(nextSamples)
      if(nextSamples.length===3){
        const front=nextSamples.find(item=>item.pose==='front')
        onChange({profilePhoto:front.photo,biometricTemplate:front.template,biometricSamples:nextSamples})
        stream.getTracks().forEach(track=>track.stop());setStream(null)
      }
    }catch(captureError){setError(captureError.message)}
    finally{setLoading(false)}
  }

  function retake(){
    stream?.getTracks().forEach(track=>track.stop())
    setStream(null);setSamples([]);setError('')
    onChange({profilePhoto:'',biometricTemplate:[],biometricSamples:[]})
    start()
  }

  if(value?.biometricSamples?.length===3)return <div className="enrollment-review">
    <div className="enrollment-review-heading"><div><CheckCircle2 size={18}/><span><strong>Three-angle identity enrolled</strong><small>All captured photos are visible below for review.</small></span></div><button type="button" onClick={retake}><RotateCcw size={14}/> Retake all</button></div>
    <div className="enrollment-photo-grid">{value.biometricSamples.map(sample=><figure key={sample.pose}><img src={sample.photo} alt={`${poseLabel[sample.pose]} biometric enrollment`}/><figcaption>{poseLabel[sample.pose]}</figcaption></figure>)}</div>
  </div>

  return <div className="biometric-enrollment">
    <div className="enrollment-copy"><span><ScanFace size={21}/></span><div><h3>Three-angle biometric enrollment *</h3><p>Capture straight and both side angles. Three frames are combined for each pose to create a more reliable identity match.</p></div></div>
    {samples.length>0&&<div className="enrollment-progress-photos">{samples.map(sample=><figure key={sample.pose}><img src={sample.photo} alt={`${poseLabel[sample.pose]} captured`}/><figcaption><CheckCircle2 size={12}/>{poseLabel[sample.pose]}</figcaption></figure>)}</div>}
    {stream?<><div className="enrollment-pose-instruction"><strong>Photo {samples.length+1} of 3</strong><span>{instruction}</span></div><div className="enrollment-camera"><video ref={videoRef} muted playsInline/><div className="face-guide"/></div><canvas ref={canvasRef} hidden/><button type="button" className="primary-button enrollment-capture" disabled={loading} onClick={capture}><Camera size={16}/>{loading?'Capturing three stable frames…':samples.length===2?'Capture final angle':'Capture this angle'}</button></>:<button type="button" className="secondary-button enrollment-start" disabled={loading} onClick={start}><UserRound size={16}/>{loading?'Loading face recognition…':'Open camera for enrollment'}</button>}
    {error&&<p className="enrollment-error">{error}</p>}
  </div>
}
