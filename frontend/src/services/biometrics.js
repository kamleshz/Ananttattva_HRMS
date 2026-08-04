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
  const movement = Math.abs(ratio-.5)
  return { faceCount, neutral:movement < .045, passed:movement > .09, score:Math.min(1,movement*7) }
}

export const challengeCopy = {
  blink:{ title:'Blink both eyes', instruction:'Look straight and blink naturally once.' },
  smile:{ title:'Smile now', instruction:'Start with a neutral face, then give a clear smile.' },
  turn:{ title:'Turn your head', instruction:'Look straight first, then turn to either side.' },
}
