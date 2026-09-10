# AT Connect

AT Connect is the HRMS for Ananttattva Private Limited. The React/Vite frontend uses one public backend URL. In production, one combined Render container runs the Express API, the private FastAPI biometric service, and ephemeral Redis for biometric challenges.

## Structure

- `frontend/` — employee dashboard, login and attendance client
- `backend/` — REST API, JWT authentication, MongoDB models and business logic

## Local setup

The staged FastAPI service, migration boundary, audit findings, and module cutover sequence are documented in [docs/FASTAPI_MIGRATION.md](docs/FASTAPI_MIGRATION.md). The backend uses port `7000`; the legacy Express API remains authoritative until each migrated module reaches contract parity.

The server-side YuNet/SFace/MiniFASNetV2 rollout, safe existing-data workflow, and deployment procedure are documented in [docs/SFACE_MIGRATION.md](docs/SFACE_MIGRATION.md) and [docs/BIOMETRIC_REAL_WORLD_TEST_CHECKLIST.md](docs/BIOMETRIC_REAL_WORLD_TEST_CHECKLIST.md).

1. Start MongoDB locally, or run `docker compose up -d`.
2. Copy `backend/.env.example` to `backend/.env` and change `JWT_SECRET`.
3. Optionally copy `frontend/.env.example` to `frontend/.env`.
4. Install dependencies with `npm run install:all`.
5. Start the API with `npm run dev:backend`.
6. In another terminal, start the UI with `npm run dev:frontend`.

The frontend runs at `http://127.0.0.1:7173` and the local Express API runs at `http://127.0.0.1:6000`. The combined production image exposes only the Express API; FastAPI listens inside the same container on `127.0.0.1:7001`.

The development seed creates `admin@peoplepulse.local` with password `ChangeMe123!`. Change these values in `backend/.env` for any shared environment.

## Deploying

### Single backend service on Render

The root `render.yaml` creates one Docker web service. Do not create a second FastAPI service. The image starts:

- Express/Node on Render's public `PORT`;
- FastAPI ML privately on `127.0.0.1:7001`;
- Redis privately on `127.0.0.1:6379` for short-lived biometric challenges.

Set these environment variables in Render:

- `MONGODB_URI` = your production MongoDB connection string
- `MONGODB_DATABASE` = the database used by the Node service (both processes must use the same database)
- `JWT_SECRET` = a long random secret
- `REFRESH_TOKEN_SECRET` = a different long random secret
- `BIOMETRIC_SERVICE_KEY` = a random secret of at least 32 characters
- `FACE_EMBEDDING_KEY` = a stable Fernet key; never change it after biometric enrollment
- `CLIENT_URLS` = your Vercel frontend URL, for example `https://your-app.vercel.app`
- `SEED_ADMIN_EMAIL` = optional production admin email
- `SEED_ADMIN_PASSWORD` = optional production admin password

Render uses:

- Runtime: Docker
- Dockerfile: `backend/Dockerfile`
- Health check: `/api/ready`

`BIOMETRIC_SERVICE_URL`, `REDIS_URL`, and the internal ports are already defined by `render.yaml`; they should not point to another Render service.

### Frontend on Vercel

This repository includes a root `vercel.json` that builds `frontend/` and serves the Vite output.

Set this environment variable in Vercel:

- `VITE_API_URL` = your Render backend URL with `/api`, for example `https://your-api.onrender.com/api`
- `VITE_BIOMETRIC_API_URL` = the same `/api` URL (or simply `/api` when using a Vercel rewrite/proxy)
- `VITE_FACE_ENGINE` = `opencv_sface`

Then redeploy the frontend after the backend URL is ready.

### Recommended order

1. Deploy the single combined backend to Render using `render.yaml`.
2. Copy the Render public URL.
3. Set `VITE_API_URL` in Vercel using that Render URL plus `/api`.
4. Set `CLIENT_URLS` in Render to your Vercel production URL.
5. Redeploy the Render service and Vercel frontend once after the env vars are saved.

## Biometric attendance

- New employees must complete live face enrollment during onboarding.
- Attendance uses a server-issued random blink, smile, or head-turn challenge.
- Face landmarks and liveness are processed locally with MediaPipe; raw verification video is not uploaded.
- The captured proof photo and normalized face template are verified by the API.
- The short-lived verification token is bound to the employee, attendance mode, challenge, and captured photo.
- Existing employees without a template are enrolled on their first successful supervised liveness verification.

This is an application-level active-liveness control, not an ISO/IEC 30107-3-certified Presentation Attack Detection system. Use a certified PAD provider for high-assurance or regulated deployments.

## API overview

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/dashboard/employee`
- `GET /api/dashboard/admin`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/attendance/today`
- `GET /api/attendance/me`
- `GET /api/employees`
- `POST /api/employees`
