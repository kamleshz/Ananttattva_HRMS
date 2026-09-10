# OpenCV SFace biometric deployment and migration

## Architecture

The browser calls the public Express API only. Express proxies biometric routes to a private FastAPI service and adds `BIOMETRIC_SERVICE_KEY`. FastAPI loads YuNet, SFace, and MiniFASNetV2 once at startup, stores only encrypted 128-dimensional aggregate templates in MongoDB, and issues an employee/action/photo-bound short-lived token. Express consumes that token once and then applies the existing attendance, location, duplicate-punch, and work-arrangement rules.

Models are pinned and SHA-256 verified by `python -m app.scripts.download_face_models`. Docker runs this during build. YuNet and SFace come from OpenCV Zoo; MiniFASNetV2 comes from the yakhyo face-anti-spoofing release.

## Required environment

FastAPI:

```text
APP_ENV=production
MONGODB_URI=...
MONGODB_DATABASE=peoplepulse_hr
REDIS_URL=...
JWT_SECRET=<same secret as Express>
FACE_EMBEDDING_KEY=<Fernet key>
BIOMETRIC_SERVICE_KEY=<random 32+ character shared secret>
CLIENT_URLS=https://your-frontend.vercel.app
FACE_ENGINE=opencv_sface
FACE_DETECTOR=yunet
FACE_RECOGNIZER=sface
FACE_MODEL_VERSION=opencv-yunet-2023mar-sface-2021dec-minifasnetv2-v1
FACE_MATCH_THRESHOLD=0.363
FACE_LOW_CONFIDENCE_MARGIN=0.04
FACE_ANTI_SPOOF_ENABLED=true
FACE_ANTI_SPOOF_THRESHOLD=0.80
```

Express:

```text
BIOMETRIC_SERVICE_URL=https://private-biometric-service.example
BIOMETRIC_SERVICE_KEY=<same shared secret>
BIOMETRIC_SERVICE_TIMEOUT_MS=15000
JWT_SECRET=<same secret as FastAPI>
```

Vercel frontend:

```text
VITE_API_URL=https://public-express-api.example/api
VITE_BIOMETRIC_API_URL=https://public-express-api.example/api
VITE_FACE_ENGINE=opencv_sface
```

No service key or embedding key belongs in Vercel/frontend variables.

## Safe migration

1. Back up the `employees` and `auditLogs` collections and securely back up `FACE_EMBEDDING_KEY`.
2. Deploy FastAPI and confirm `/api/health` reports database, YuNet, SFace, and liveness loaded.
3. Run `POST /api/admin/biometrics/migrate-batch` with `{"dryRun":true}` as HR/Admin.
4. Pilot a few employees. Migration recomputes SFace embeddings only from retained trusted photos; it never converts or mixes legacy vectors.
5. Employees without three trusted photos receive `BIOMETRIC_REENROLLMENT_REQUIRED` and must be enrolled in person.
6. Re-enroll with front, left, and right captures. Quality-filtered embeddings are normalized and averaged into one encrypted template.
7. Expand migration and monitor the 30-day biometric health report.

Old `biometricTemplate`, `biometricSamples`, profile photos, and replaced `faceBiometric` records remain preserved. Replaced/reset server templates are archived in `faceBiometricLegacyHistory` as inactive.

## Testing

- Enrollment: HR opens People, selects an employee, opens face re-enrollment, captures front/left/right, and saves. Verify engine `opencv_sface`, dimension `128`, and active status.
- Check-in: employee grants camera/location access, completes the random gesture, passes MiniFASNetV2 and SFace, then receives a successful punch.
- Check-out: repeat using the same attendance mode; checkout without check-in and mode mismatch must fail.
- Replay: reuse a verification token; Express must return a conflict.
- Spoof: test a printed photo and a face on another screen; both must return `LIVENESS_FAILED` rather than attendance success.

Calibrate face and liveness thresholds on consented company samples before rollout. Do not reduce thresholds to accommodate failures. MiniFASNetV2 is a lightweight PAD control, not a certified ISO/IEC 30107-3 liveness system.

## Linux/Docker

```bash
docker build -t at-connect-biometric ./backend
docker run --env-file backend/.env -p 7000:7000 at-connect-biometric
```

For a non-Docker Linux install, install `backend/requirements.txt`, run the model downloader from `backend`, then start `uvicorn app.main:app --host 0.0.0.0 --port 7000`. Use HTTPS at the reverse proxy and keep the FastAPI origin private where possible.
