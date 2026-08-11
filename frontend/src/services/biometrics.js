import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let landmarkerPromise
let identityModelPromise

export function loadFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks('/mediapipe/wasm').then(vision =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath:'/models/face_landmarker.task', delegate:'GPU' },
        runningMode:'VIDEO',
        numFaces:2,
        minFaceDetectionConfidence:.65,
        minFacePresenceConfidence:.65,
        minTrackingConfidence:.6,
        outputFaceBlendshapes:true,
        outputFacialTransformationMatrixes:true,
      }).catch(() => FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath:'/models/face_landmarker.task', delegate:'CPU' },
        runningMode:'VIDEO', numFaces:2, minFaceDetectionConfidence:.65,
        minFacePresenceConfidence:.65, minTrackingConfidence:.6,
        outputFaceBlendshapes:true,
      }))
    )
  }
  return landmarkerPromise
}

export function detectFace(landmarker, video) {
  if (!video || video.readyState < 2) return null
  return landmarker.detectForVideo(video, performance.now())
}

export function loadFaceIdentityModel() {
  if (!identityModelPromise) {
    identityModelPromise = import('@vladmandic/human').then(async ({ Human }) => {
      const human = new Human({
        backend: 'webgl',
        modelBasePath: '/models/human/',
        cacheSensitivity: 0,
        filter: { enabled:true, equalization:true },
        face: {
          enabled:true,
          detector:{ modelPath:'blazeface.json', maxDetected:2, minConfidence:.65, rotation:true, return:true },
          mesh:{ enabled:false },
          iris:{ enabled:false },
          description:{ enabled:true, modelPath:'faceres.json' },
          emotion:{ enabled:false },
          antispoof:{ enabled:false },
          liveness:{ enabled:false },
        },
        body:{ enabled:false }, hand:{ enabled:false }, object:{ enabled:false }, gesture:{ enabled:false }, segmentation:{ enabled:false },
      })
      await human.load()
      await human.warmup()
      return human
    })
  }
  return identityModelPromise
}

async function imageFromDataUrl(source) {
  if (typeof source !== 'string') return source
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The captured face image could not be processed.'))
    image.src = source
  })
}

export async function createIdentityTemplate(source, identityModel) {
  const input = await imageFromDataUrl(source)
  const result = await identityModel.detect(input)
  if (!result?.face?.length) throw new Error('No recognizable face was found. Please retake the photo in clear lighting.')
  if (result.face.length !== 1) throw new Error('Only one employee should be visible during face verification.')
  const embedding = result.face[0].embedding
  if (!embedding || embedding.length < 128) throw new Error('A secure identity template could not be created. Please retake the photo.')
  return embedding.map(value => Number(value.toFixed(6)))
}

function blendshapeMap(result) {
  return Object.fromEntries((result?.faceBlendshapes?.[0]?.categories || []).map(item => [item.categoryName, item.score]))
}

export function evaluateNeutralCapture(result) {
  const faceCount = result?.faceLandmarks?.length || 0
  if (faceCount !== 1) return { ready:false, message:faceCount > 1 ? 'Only one employee should be visible.' : 'Center your face inside the frame.' }
  const shapes = blendshapeMap(result)
  const blink = ((shapes.eyeBlinkLeft || 0) + (shapes.eyeBlinkRight || 0)) / 2
  const smile = ((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2
  const landmarks = result.faceLandmarks[0]
  const left = landmarks[234], right = landmarks[454], nose = landmarks[1]
  const turnRatio = (nose.x-left.x) / Math.max(.001,right.x-left.x)
  const faceCenter = (left.x+right.x)/2
  if (Math.abs(faceCenter-.5) > .14) return { ready:false, message:'Move your face to the center of the oval.' }
  if (Math.abs(turnRatio-.5) > .055) return { ready:false, message:'Look straight at the camera.' }
  if (blink > .2) return { ready:false, message:'Keep both eyes naturally open.' }
  if (smile > .2) return { ready:false, message:'Relax your expression for the identity photo.' }
  return { ready:true, message:'Neutral face detected. Hold still…' }
}

export function evaluateEnrollmentPose(result, target = 'front') {
  const faceCount = result?.faceLandmarks?.length || 0
  if (faceCount !== 1) return { ready:false, message:faceCount > 1 ? 'Only one employee should be visible.' : 'Center your face inside the frame.' }
  const shapes = blendshapeMap(result)
  const blink = ((shapes.eyeBlinkLeft || 0) + (shapes.eyeBlinkRight || 0)) / 2
  const landmarks = result.faceLandmarks[0]
  const left = landmarks[234], right = landmarks[454], nose = landmarks[1]
  const faceWidth = Math.abs(right.x-left.x)
  const faceCenter = (left.x+right.x)/2
  const turnRatio = (nose.x-left.x) / Math.max(.001,faceWidth)
  const movement = turnRatio-.5
  const detectedPose = movement < 0 ? 'left' : 'right'
  if (Math.abs(faceCenter-.5) > .16) return { ready:false, message:'Move your face to the center of the oval.' }
  if (faceWidth < .2) return { ready:false, message:'Move a little closer to the camera.' }
  if (faceWidth > .62) return { ready:false, message:'Move a little farther from the camera.' }
  if (blink > .25) return { ready:false, message:'Keep both eyes naturally open.' }
  if (target === 'front') {
    if (Math.abs(movement) > .06) return { ready:false, message:'Look straight at the camera.' }
    return { ready:true, pose:'front', message:'Straight pose detected. Hold still.' }
  }
  if (Math.abs(movement) < .09) return { ready:false, message:target === 'side' ? 'Turn your head slightly to either side.' : 'Turn your head to the opposite side.' }
  if (Math.abs(movement) > .25) return { ready:false, message:'Reduce the turn slightly so both eyes remain visible.' }
  if (target !== 'side' && detectedPose !== target) return { ready:false, message:'Turn your head to the opposite side.' }
  return { ready:true, pose:detectedPose, message:'Side pose detected. Hold still.' }
}

export function evaluateChallenge(result, challenge) {
  const faceCount = result?.faceLandmarks?.length || 0
  if (faceCount !== 1) return { faceCount, neutral:false, passed:false, score:0 }
  const shapes = blendshapeMap(result)
  if (challenge === 'blink') {
    const score = ((shapes.eyeBlinkLeft || 0) + (shapes.eyeBlinkRight || 0)) / 2
    return { faceCount, neutral:score < .18, passed:score > .52, score }
  }
  if (challenge === 'smile') {
    const score = ((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2
    return { faceCount, neutral:score < .18, passed:score > .42, score }
  }
  const landmarks = result.faceLandmarks[0]
  const left = landmarks[234], right = landmarks[454], nose = landmarks[1]
  const ratio = (nose.x-left.x) / Math.max(.001,right.x-left.x)
  const signedMovement = ratio-.5, movement=Math.abs(signedMovement)
  const directionPassed=challenge==='turn_left'?signedMovement<-.09:challenge==='turn_right'?signedMovement>.09:movement>.09
  return { faceCount, neutral:movement < .045, passed:directionPassed, score:Math.min(1,movement*7) }
}

export const challengeCopy = {
  blink:{ title:'Blink both eyes', instruction:'Look straight and blink naturally once.' },
  smile:{ title:'Smile now', instruction:'Start with a neutral face, then give a clear smile.' },
  turn:{ title:'Turn your head', instruction:'Look straight first, then turn to either side.' },
  turn_left:{ title:'Turn left', instruction:'Look straight first, then turn your head slightly left.' },
  turn_right:{ title:'Turn right', instruction:'Look straight first, then turn your head slightly right.' },
}
