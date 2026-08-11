# UniFace biometric migration

## Deployment state

The new identity path runs face detection and matching in FastAPI with UniFace. Browser MediaPipe remains responsible only for guided active-liveness gestures. In UniFace mode, the browser sends capture images to the authenticated API and never calculates the authoritative identity score.

The transition is feature-gated. Set `VITE_FACE_ENGINE=uniface` and point `VITE_BIOMETRIC_API_URL` to the FastAPI `/api` origin only after that service is deployed. Keep the normal frontend on port `7173` and the public backend on port `7000`. The legacy browser matcher remains packaged temporarily as a rollback path but is not loaded by the UniFace workflow.

## Model contract

- Package: `uniface[cpu]==3.7.1`
- Runtime: `onnxruntime==1.28.0`
- Detector: SCRFD 10G with keypoints
- Recognizer: ArcFace MobileFaceNet
- Embedding: normalized 512-dimensional vector
- Default comparison: cosine similarity
- Stored template: Fernet-encrypted embedding; response schemas never expose it

Models are loaded once during application startup. A load failure degrades `/api/health` and biometric endpoints return a controlled 503 so employees can use the approved manual fallback. It does not crash unrelated HRMS modules.

`FACE_MATCH_THRESHOLD=0.45` is a rollout starting point, not a universal security boundary. Calibrate it from consented, representative company captures before production activation and review false-accept/false-reject tradeoffs.

Export only labeled genuine/impostor cosine scores to CSV and run `python -m app.scripts.calibrate_face_threshold scores.csv`. The script reports an equal-error candidate and does not update configuration.

## Environment

Generate `FACE_EMBEDDING_KEY` once and store it as a protected Render secret:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Do not rotate this value without a template re-encryption plan. Also provision Redis; challenges are short-lived and single-use.

During the staged FastAPI-biometric/Express-attendance rollout, configure the exact same `JWT_SECRET` in both Render services. Express validates and consumes the short-lived UniFace result token; mismatched secrets will make every verified punch fail safely.

The Render FastAPI blueprint declares the UniFace and manual-fallback variables. The frontend deployment needs:

```text
VITE_API_URL=https://your-api.example/api
VITE_BIOMETRIC_API_URL=https://your-api.example/api
VITE_FACE_ENGINE=uniface
```

## Existing-data audit (read-only, 2026-08-11)

The pre-migration audit found 17 enrolled employees using legacy 1024-dimensional browser descriptors:

- 15 have three retained enrollment photos and can be explicitly migrated.
- 2 do not have trusted retained photos and require supervised live re-enrollment.

No employee record was changed during the audit. UniFace cannot convert a legacy descriptor mathematically; it must recompute a 512-dimensional embedding from a trusted source image.

## Controlled migration

1. Deploy FastAPI and verify `/api/health` reports `services.faceEngine.healthy=true`.
2. Back up the employee collection and confirm the embedding key is recoverable from the secret manager.
3. As HR/Admin, inspect `GET /api/employees/{employeeId}/biometrics/status`.
4. Use `POST /api/admin/biometrics/migrate-batch` with `{"dryRun":true}`. A dry run never writes.
5. Migrate a small consented pilot using `POST /api/admin/biometrics/migrate/{employeeId}` or the employee security page.
6. Validate check-in and check-out, then expand the batch. A batch is capped at 100 employees per request.
7. Schedule supervised re-enrollment for records marked `re_enrollment_required`.

Migration adds `faceBiometric`; it does not delete `biometricTemplate` or legacy photos. Reset also preserves legacy data and only disables the UniFace identity until re-enrollment.

## Rollback

1. Set frontend `VITE_FACE_ENGINE` to a value other than `uniface` and redeploy.
2. Route `/api` back to the existing Express service on port `7000`.
3. Do not delete `faceBiometric`; retain it for investigation or a later retry.
4. Re-enable UniFace only after the health and incident cause are resolved.

Rollback is possible because the migration does not overwrite or remove legacy biometric fields.

## Security and audit behavior

- Enrollment requires an HR/Admin role and an employee-bound, single-use challenge.
- Verification validates face count, capture quality, liveness completion, server geofence, encrypted templates, and match threshold.
- Attendance receives a short-lived signed token bound to user, employee, action, challenge, proof hash, location, engine, and model version.
- Express stores each token `jti` with a unique index, preventing replay.
- Enrollment, migration, reset, success, failure, mismatch, and re-enrollment requests create audit events without raw embeddings.
- Manual fallback remains approval-based and includes new UniFace error codes.
