# AT Connect

AT Connect is the HRMS for Ananttattva Private Limited. The current React/Vite + Express/MongoDB application remains runnable while its backend is migrated module-by-module to FastAPI, PyMongo Async, Redis, and Celery.

## Structure

- `frontend/` — employee dashboard, login and attendance client
- `backend/` — REST API, JWT authentication, MongoDB models and business logic

## Local setup

The staged FastAPI service, migration boundary, audit findings, and module cutover sequence are documented in [docs/FASTAPI_MIGRATION.md](docs/FASTAPI_MIGRATION.md). The backend uses port `7000`; the legacy Express API remains authoritative until each migrated module reaches contract parity.

The server-side UniFace rollout, safe existing-data workflow, rollback procedure, and validation checklist are documented in [docs/UNIFACE_MIGRATION.md](docs/UNIFACE_MIGRATION.md) and [docs/BIOMETRIC_REAL_WORLD_TEST_CHECKLIST.md](docs/BIOMETRIC_REAL_WORLD_TEST_CHECKLIST.md).

1. Start MongoDB locally, or run `docker compose up -d`.
2. Copy `backend/.env.example` to `backend/.env` and change `JWT_SECRET`.
3. Optionally copy `frontend/.env.example` to `frontend/.env`.
4. Install dependencies with `npm run install:all`.
5. Start the API with `npm run dev:backend`.
6. In another terminal, start the UI with `npm run dev:frontend`.

The frontend runs at `http://127.0.0.1:7173` and the API runs at `http://127.0.0.1:7000`.

The development seed creates `admin@peoplepulse.local` with password `ChangeMe123!`. Change these values in `backend/.env` for any shared environment.

## Deploying

### Backend on Render

This repository includes a root `render.yaml` that points Render at `backend/`.

Set these environment variables in Render:

- `MONGODB_URI` = your production MongoDB connection string
- `JWT_SECRET` = a long random secret
- `CLIENT_URLS` = your Vercel frontend URL, for example `https://your-app.vercel.app`
- `SEED_ADMIN_EMAIL` = optional production admin email
- `SEED_ADMIN_PASSWORD` = optional production admin password

Render uses:

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/api/health`

### Frontend on Vercel

This repository includes a root `vercel.json` that builds `frontend/` and serves the Vite output.

Set this environment variable in Vercel:

- `VITE_API_URL` = your Render backend URL with `/api`, for example `https://your-api.onrender.com/api`

Then redeploy the frontend after the backend URL is ready.

### Recommended order

1. Deploy the backend to Render.
2. Copy the Render public URL.
3. Set `VITE_API_URL` in Vercel using that Render URL plus `/api`.
4. Set `CLIENT_URLS` in Render to your Vercel production URL.
5. Redeploy both once after the env vars are saved.

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
