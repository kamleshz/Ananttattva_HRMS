import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  ScanFace,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  attendanceApi,
  biometricApi,
  SERVER_FACE_ENABLED,
  workArrangementApi,
} from "./services/api.js";
import {
  challengeCopy,
  createIdentityTemplate,
  detectFace,
  evaluateChallenge,
  evaluateNeutralCapture,
  loadFaceIdentityModel,
  loadFaceLandmarker,
} from "./services/biometrics.js";

function collectBestLocation(onSuccess, onError) {
  let watchId = null,
    timer = null,
    best = null,
    finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timer) clearTimeout(timer);
    if (best) onSuccess(best);
    else onError({ code: 2 });
  };
  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      const candidate = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      };
      if (!best || candidate.accuracyMeters < best.accuracyMeters)
        best = candidate;
      if (candidate.accuracyMeters <= 20) finish();
    },
    (error) => {
      if (!best) {
        finished = true;
        if (timer) clearTimeout(timer);
        onError(error);
      }
    },
    { timeout: 12000, enableHighAccuracy: true, maximumAge: 0 },
  );
  timer = setTimeout(finish, 8000);
  return () => {
    finished = true;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timer) clearTimeout(timer);
  };
}

export default function AttendanceVerificationDrawer({
  mode,
  attendanceMode = "office",
  close,
  recorded,
  manualFallback,
}) {
  const videoRef = useRef(null),
    canvasRef = useRef(null);
  const [stream, setStream] = useState(null),
    [model, setModel] = useState(null),
    [identityModel, setIdentityModel] = useState(null),
    [challenge, setChallenge] = useState(null);
  const [photo, setPhoto] = useState(""),
    [identityPhotos, setIdentityPhotos] = useState([]),
    [faceTemplate, setFaceTemplate] = useState(null),
    [livenessScore, setLivenessScore] = useState(0);
  const [challengeComplete, setChallengeComplete] = useState(false);
  const [coordinates, setCoordinates] = useState(null);
  const [cameraError, setCameraError] = useState(
    navigator.mediaDevices?.getUserMedia
      ? ""
      : "Camera is not supported by this browser.",
  );
  const [livenessStatus, setLivenessStatus] = useState(
      "Loading secure face detection…",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [mismatch, setMismatch] = useState(null),
    [faceAttempts, setFaceAttempts] = useState(0),
    [fallbackFailure, setFallbackFailure] = useState(null),
    [cameraErrorCode, setCameraErrorCode] = useState(
      navigator.mediaDevices?.getUserMedia ? "" : "CAMERA_NOT_AVAILABLE",
    );

  async function openCamera() {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    setStream(mediaStream);
  }
  async function requestChallenge() {
    setChallenge(await biometricApi.challenge(mode,attendanceMode));
  }

  useEffect(() => {
    let active = true,
      stopLocation = () => {};
    const eligibility =
      attendanceMode === "office"
        ? Promise.resolve([{}])
        : workArrangementApi.today().then((result) => {
            if (!result.modes.includes(attendanceMode))
              throw new Error(
                `An approved ${attendanceMode.replaceAll("_", " ")} request is required for today.`,
              );
            return [{}];
          });
    eligibility
      .then(() => {
        if (!active) return;
        if (navigator.geolocation)
          stopLocation = collectBestLocation(
            (location) => {
              if (active) setCoordinates(location);
            },
            () => {},
          );
        if (navigator.mediaDevices?.getUserMedia)
          navigator.mediaDevices
            .getUserMedia({
              video: {
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 },
              },
              audio: false,
            })
            .then(setStream)
            .catch((mediaError) => {
              const denied=mediaError?.name==='NotAllowedError';
              setCameraErrorCode(denied?'CAMERA_PERMISSION_DENIED':'CAMERA_NOT_AVAILABLE');
              setCameraError(denied?'Camera permission was denied.':'Camera could not be started on this device.');
            });
        biometricApi
          .challenge(mode,attendanceMode)
          .then(setChallenge)
          .catch((requestError) => setError(requestError.message));
        loadFaceLandmarker()
          .then(setModel)
          .catch(() =>
            setCameraError("Secure face detection could not be loaded."),
          );
        if (!SERVER_FACE_ENABLED) loadFaceIdentityModel()
          .then(setIdentityModel)
          .catch(() => setCameraError("Secure identity recognition could not be loaded."));
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
        }
      });
    return () => {
      active = false;
      stopLocation();
    };
  }, [mode, attendanceMode]);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);
  useEffect(() => {
    if (!model || !stream || !challenge || photo) return;
    let frame,
      active = true,
      lastProcessed = 0,
      neutralFrames = 0,
      passedFrames = 0,
      awaitingNeutralCapture = false,
      stableNeutralFrames = 0,
      neutralPhotos = [];
    const process = (time) => {
      if (!active) return;
      if (time - lastProcessed > 90 && videoRef.current?.readyState >= 2) {
        lastProcessed = time;
        try {
          const result = detectFace(model, videoRef.current),
            evaluation = evaluateChallenge(result, challenge.challenge);
          if (awaitingNeutralCapture) {
            const neutralCapture = evaluateNeutralCapture(result);
            if (neutralCapture.ready) {
              stableNeutralFrames += 1;
              setLivenessStatus(
                stableNeutralFrames < 6
                  ? "Neutral face detected. Hold still…"
                  : "Capturing neutral identity photo…",
              );
              if (stableNeutralFrames >= 6) {
                const canvas = canvasRef.current,
                  video = videoRef.current;
                canvas.width = 640;
                canvas.height = 480;
                canvas.getContext("2d").drawImage(video, 0, 0, 640, 480);
                neutralPhotos.push(canvas.toDataURL("image/jpeg", 0.86));
                if (SERVER_FACE_ENABLED) {
                  setPhoto(neutralPhotos[0]);
                  setLivenessStatus("Live face captured and ready for secure server verification");
                  stream.getTracks().forEach((track) => track.stop());
                  return;
                }
                if (neutralPhotos.length < 3) {
                  setLivenessStatus(
                    `Capturing stable identity frames (${neutralPhotos.length}/3)…`,
                  );
                  frame = requestAnimationFrame(process);
                  return;
                }
                setFaceTemplate(null);
                setIdentityPhotos([...neutralPhotos]);
                setPhoto(canvas.toDataURL("image/jpeg", 0.86));
                setLivenessStatus(
                  "Neutral identity photo captured. Preparing secure match…",
                );
                stream.getTracks().forEach((track) => track.stop());
                return;
              }
            } else {
              stableNeutralFrames = 0;
              setLivenessStatus(`Liveness passed. ${neutralCapture.message}`);
            }
          } else if (evaluation.faceCount === 0)
            setLivenessStatus("Position one face inside the frame.");
          else if (evaluation.faceCount > 1)
            setLivenessStatus(
              "Multiple faces detected. Only the employee should be visible.",
            );
          else if (evaluation.neutral) {
            neutralFrames += 1;
            setLivenessStatus(
              "Neutral face detected. Now complete the challenge.",
            );
          } else if (neutralFrames < 3)
            setLivenessStatus("Look straight with a neutral expression first…");
          else {
            setLivenessStatus(challengeCopy[challenge.challenge].instruction);
            if (evaluation.passed) passedFrames += 1;
            else if (challenge.challenge !== "blink") passedFrames = 0;
            if (passedFrames >= (challenge.challenge === "blink" ? 1 : 2)) {
              awaitingNeutralCapture = true;
              stableNeutralFrames = 0;
              setChallengeComplete(true);
              setLivenessScore(
                Math.max(0.66, Math.min(1, 0.68 + evaluation.score * 0.32)),
              );
              setLivenessStatus(
                "Liveness passed. Return to a neutral face and look straight at the camera.",
              );
            }
          }
        } catch {
          setLivenessStatus("Keep your face steady inside the frame.");
        }
      }
      frame = requestAnimationFrame(process);
    };
    frame = requestAnimationFrame(process);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [model, stream, challenge, photo]);

  useEffect(() => {
    if (SERVER_FACE_ENABLED) return;
    if (!photo || identityPhotos.length !== 3 || !identityModel || faceTemplate)
      return;
    let active = true;
    Promise.all(
      identityPhotos.map((item) => createIdentityTemplate(item, identityModel)),
    )
      .then((templates) => {
        const averaged = templates[0].map((_, index) =>
          Number(
            (
              templates.reduce((sum, template) => sum + template[index], 0) /
              templates.length
            ).toFixed(6),
          ),
        );
        if (active) {
          setFaceTemplate(averaged);
          setLivenessStatus(
            "Three-frame live face captured and ready for identity matching",
          );
        }
      })
      .catch((identityError) => {
        if (active) {
          setError(identityError.message);
          setLivenessStatus(
            "Identity capture failed. Please repeat verification.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [photo, identityPhotos, identityModel, faceTemplate]);

  async function submit() {
    if (!photo || !challenge || (!SERVER_FACE_ENABLED && !faceTemplate)) return;
    setBusy(true);
    setError("");
    try {
      const verification = await biometricApi.verify({
        ...(SERVER_FACE_ENABLED?{
          challengeId:challenge.challengeId,
          completedSteps:challenge.steps,
          proofImage:photo,
          ...(coordinates&&{location:coordinates}),
        }:{challengeToken: challenge.challengeToken,challenge: challenge.challenge,photo,faceTemplate,livenessScore,faceCount: 1}),
      });
      if (verification.matched === false || verification.verified === false) {
        const attempts=faceAttempts+1;
        setFaceAttempts(attempts);
        setMismatch(verification);
        setError(
          attempts >= 2
            ? "Face matching failed twice. You may send a controlled manual attendance request for review."
            : "Face matching was unsuccessful. Please repeat verification once.",
        );
        return;
      }
      const payload = {
        photo,
        attendanceMode,
        biometricToken: verification.verificationToken,
      };
      await (mode === "check-out"
        ? attendanceApi.checkOut(payload)
        : attendanceApi.checkIn(payload));
      await recorded();
      close();
    } catch (requestError) {
      setError(requestError.message);
      if (SERVER_FACE_ENABLED) {
        const code=requestError.code||'UNKNOWN_ERROR';
        const reasonByCode={FACE_ENGINE_UNAVAILABLE:'BIOMETRIC_SERVICE_UNAVAILABLE',FACE_MODEL_NOT_LOADED:'BIOMETRIC_SERVICE_UNAVAILABLE',BIOMETRIC_NOT_ENROLLED:'BIOMETRIC_SERVICE_UNAVAILABLE',BIOMETRIC_REENROLLMENT_REQUIRED:'BIOMETRIC_SERVICE_UNAVAILABLE',IMAGE_QUALITY_LOW:'POOR_IMAGE_QUALITY',FACE_EMBEDDING_FAILED:'POOR_IMAGE_QUALITY',ANTI_SPOOF_FAILED:'LIVENESS_FAILED',CHALLENGE_EXPIRED:'LIVENESS_FAILED',CHALLENGE_ALREADY_USED:'LIVENESS_FAILED'};
        const reasonCode=reasonByCode[code]||code;
        const technical=['BIOMETRIC_SERVICE_UNAVAILABLE','NETWORK_FAILED','LOCATION_FAILED'].includes(reasonCode);
        const attempts=technical?faceAttempts:faceAttempts+1;
        setFaceAttempts(attempts);
        setFallbackFailure({reasonCode,technical,attempts});
      }
    } finally {
      setBusy(false);
    }
  }
  async function retake() {
    stream?.getTracks().forEach((track) => track.stop());
    setPhoto("");
    setFaceTemplate(null);
    setChallenge(null);
    setChallengeComplete(false);
    setLivenessScore(0);
    setMismatch(null);
    setFallbackFailure(null);
    setError("");
    setCameraError("");
    setLivenessStatus("Preparing a new challenge…");
    try {
      await Promise.all([openCamera(), requestChallenge()]);
    } catch {
      setCameraError("Unable to restart biometric verification.");
    }
  }
  const identityReady=SERVER_FACE_ENABLED?Boolean(photo):Boolean(faceTemplate),
    ready = Boolean(
      photo &&
      identityReady &&
      livenessScore >= 0.65,
    ),
    challengeText = challengeCopy[challenge?.challenge];
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={close} />
      <aside className="attendance-drawer">
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">Secure attendance verification</p>
            <h2>{mode === "check-out" ? "Check Out" : "Check In"}</h2>
            <p>
              Capture a live photo and submit your attendance.
            </p>
          </div>
          <button onClick={close}>
            <X size={20} />
          </button>
        </div>
        <ol
          className="verification-progress"
          aria-label="Attendance verification progress"
        >
          <li className={stream || photo ? "done" : "active"}>
            Starting camera
          </li>
          <li className={challengeComplete ? "done" : stream ? "active" : ""}>
            Completing liveness challenge
          </li>
          <li className={identityReady ? "done" : challengeComplete ? "active" : ""}>
            Matching enrolled identity
          </li>
          <li className={busy ? "active" : ""}>Recording attendance</li>
        </ol>
        <div className="verification-section">
          <p className="verification-label">
            Live photo and identity check
          </p>
          {challengeText && (
            <div
              className={`liveness-challenge ${challengeComplete ? "completed" : ""}`}
            >
              <span>
                {challengeComplete ? (
                  <CheckCircle2 size={21} />
                ) : (
                  <ScanFace size={21} />
                )}
              </span>
              <div>
                <small>
                  {challengeComplete ? "Identity capture" : "Random challenge"}
                </small>
                <strong>
                  {challengeComplete
                    ? "Return to neutral"
                    : challengeText.title}
                </strong>
                <p>
                  {challengeComplete
                    ? "Look straight, relax your expression and hold still."
                    : challengeText.instruction}
                </p>
              </div>
            </div>
          )}
          <div
            className={`camera-frame ${identityReady ? "liveness-passed" : ""}`}
          >
            {photo ? (
              <img src={photo} alt="Attendance identity capture" />
            ) : (
              <video ref={videoRef} muted playsInline />
            )}
            {!photo && !stream && !cameraError && (
              <div className="camera-placeholder">
                <UserRound size={30} />
                <span>Opening secure camera…</span>
              </div>
            )}
            {cameraError && (
              <div className="camera-placeholder error">
                <UserRound size={30} />
                <span>{cameraError}</span>
              </div>
            )}
            <div className="face-guide" />
            {photo && (
              <div className="liveness-overlay">
                <ShieldCheck size={25} />
                <strong>
                  {identityReady ? "Identity ready" : "Analyzing identity…"}
                </strong>
                <span>
                  {identityReady
                    ? "UniFace server match is required before attendance"
                    : "Creating secure face embedding"}
                </span>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} hidden />
          <div className={`liveness-status ${identityReady ? "passed" : ""}`}>
            {identityReady ? <CheckCircle2 size={16} /> : <ScanFace size={16} />}
            <span>{livenessStatus}</span>
          </div>
          {photo && (
            <button className="secondary-button camera-action" onClick={retake}>
              Repeat verification
            </button>
          )}
        </div>
        {error && <p className="attendance-error drawer-error">{error}</p>}
        {mismatch && faceAttempts >= 2 && (
          <section className="manual-checkin-request">
            <div>
              <ShieldCheck size={18} />
              <p>
                <strong>Use controlled manual fallback</strong>
                <span>
                  Your evidence, location, and a new server request time will be sent to an authorized reviewer.
                </span>
              </p>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={()=>manualFallback?.({reasonCode:'FACE_MISMATCH',photo,mismatchToken:mismatch.mismatchToken,faceMatchScore:mismatch.faceMatchScore,attempts:faceAttempts,cameraStatus:'working',livenessStatus:'passed',faceMatchStatus:'failed',location:coordinates})}
            >
              Continue to manual request
              <ChevronRight size={15} />
            </button>
          </section>
        )}
        {cameraError && <section className="manual-checkin-request"><div><ShieldCheck size={18}/><p><strong>Biometric verification is unavailable</strong><span>You can submit a manual request immediately for this technical failure.</span></p></div><button className="primary-button" onClick={()=>manualFallback?.({reasonCode:cameraErrorCode||'CAMERA_NOT_AVAILABLE',technicalErrorCode:cameraErrorCode||'CAMERA_NOT_AVAILABLE',attempts:0,cameraStatus:'failed',location:coordinates})}>Use manual fallback <ChevronRight size={15}/></button></section>}
        {fallbackFailure && !mismatch && (fallbackFailure.technical || fallbackFailure.attempts >= 2) && <section className="manual-checkin-request"><div><ShieldCheck size={18}/><p><strong>Use controlled manual fallback</strong><span>The server could not complete biometric verification. Your available attendance evidence will be sent for approval.</span></p></div><button className="primary-button" onClick={()=>manualFallback?.({reasonCode:fallbackFailure.reasonCode,technicalErrorCode:fallbackFailure.technical?fallbackFailure.reasonCode:undefined,photo,attempts:fallbackFailure.attempts,cameraStatus:photo?'working':'failed',livenessStatus:challengeComplete?'passed':'failed',faceMatchStatus:'unknown',location:coordinates})}>Continue to manual request <ChevronRight size={15}/></button></section>}
        <div className="attendance-drawer-footer">
          <div>
            <Clock3 size={16} />
            <span>
              Your live photo must match your enrolled identity. Location is
              recorded only when available and never blocks attendance.
            </span>
          </div>
          <button
            className="primary-button"
            disabled={!ready || busy || Boolean(mismatch)}
            onClick={submit}
          >
            {busy
              ? "Verifying photo and recording…"
              : mode === "check-out"
                ? "Submit check out"
                : "Submit check in"}{" "}
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}
