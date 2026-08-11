# Biometric real-world test checklist

Run this checklist with consented test employees before production rollout. Record the model version, device, browser, lighting, similarity outcome, latency, and whether manual fallback was offered.

## Enrollment

- [ ] Front, left, and right captures each contain exactly one face.
- [ ] A second person in frame is rejected.
- [ ] No face is rejected with a useful instruction.
- [ ] Low resolution, blur, very dark light, strong backlight, and excessive distance are rejected.
- [ ] Three captures from different people cannot form one enrollment.
- [ ] Stored employee data contains encrypted 512-dimensional templates and no API returns embeddings.

## Verification accuracy

- [ ] Same employee passes on at least two supported desktop browsers and two representative phones.
- [ ] Different employee is rejected.
- [ ] Printed photo and phone-screen replay are tested; do not claim PAD certification when the optional anti-spoof model is disabled.
- [ ] Glasses, facial hair, modest pose, indoor/outdoor light, and common camera quality are represented.
- [ ] Measure genuine/impostor distributions and approve a calibrated threshold; do not accept the default without evidence.

## Challenge, token, and location security

- [ ] Expired challenge fails.
- [ ] Reused challenge fails.
- [ ] Challenge issued to another user or employee fails.
- [ ] Wrong check-in/check-out action fails.
- [ ] Verification token expires and cannot be replayed.
- [ ] Office boundary, poor GPS accuracy, approved WFH, client location, and field visit behave as configured.

## Failure and recovery

- [ ] Redis unavailable returns a controlled error.
- [ ] Model-load failure leaves non-biometric HRMS routes operational and health degraded.
- [ ] Camera denial, no camera, network loss, face mismatch after retry limit, no face, multiple faces, low quality, and liveness failure reach the correct manual-fallback path.
- [ ] Employees cannot approve their own manual attendance request.
- [ ] Migration dry run makes no data changes.
- [ ] Reset requires explicit confirmation and preserves legacy data.
- [ ] Rollback switch restores the prior attendance path.

## Acceptance evidence

- [ ] Backend unit/integration tests pass.
- [ ] Node manual-attendance tests pass.
- [ ] Frontend lint and production build pass.
- [ ] Cold model-load time and warmed verification latency are measured on the deployed Render instance.
- [ ] At least one pilot week is reviewed for false rejects, false accepts, manual fallback rate, and device/browser patterns.
