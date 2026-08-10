# AT Connect FastAPI migration

## Repository audit

The existing application is a working React/Vite + Express/Mongoose system. Its useful screens and business behavior remain in place during migration. The main architectural gaps against the target specification are:

- the frontend is JSX with a single large page module, hand-written fetch state, and global CSS rather than TypeScript, TanStack Query, React Hook Form/Zod, and Tailwind;
- Express route modules frequently combine validation, authorization, persistence, and workflow logic;
- OTP and biometric challenges are MongoDB documents rather than short-lived Redis state;
- access JWTs are long-lived and there is no rotating refresh session;
- employee documents contain biometric images/templates and several modules store base64 files in MongoDB;
- scheduled jobs run as in-process timers rather than idempotent Celery Beat tasks;
- authorization is primarily role-list based and does not yet have a consistent permission/ownership/manager-scope layer;
- audit logging, private object storage, structured logging, and production dependency validation are incomplete.

## Migration boundary

The FastAPI implementation lives in `backend/app`. The legacy service remains in `backend/src` temporarily so the current application stays deployable until each module has equivalent FastAPI routes, services, repositories, tests, and frontend integration. Never run both implementations as authoritative writers for the same module.

The first completed slice provides:

- FastAPI lifespan-managed PyMongo Async and Redis clients;
- production configuration and secret validation;
- structured redacting logs, request IDs, security headers, strict CORS, and standard response errors;
- Argon2 passwords with transparent migration of existing bcrypt hashes;
- Redis-backed, expiring, attempt-limited, single-use OTP challenges and cooldowns;
- Microsoft Graph OTP email delivery using application `Mail.Send` permission;
- 15-minute JWT access tokens and rotating opaque refresh tokens in an HttpOnly/Secure/SameSite cookie;
- refresh-token reuse detection, family revocation, and password-reset session invalidation;
- role, permission, ownership, and manager-scope authorization primitives;
- immutable authentication audit events;
- Redis/Celery foundation, Docker image, Compose services, health check, and automated unit tests.

## Running the staged FastAPI service

From the repository root:

```powershell
docker compose --profile fastapi-migration up --build
```

The backend is configured for port `7000`. During module migration, run only the authoritative backend implementation for the routes under test. The FastAPI health endpoint is `http://127.0.0.1:7000/api/health`.

For a local Python process:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 7000
```

## Module cutover sequence

1. Authentication and user sessions: validate against a copy of production-shaped data, add frontend refresh bootstrap, then route `/api/auth` exclusively to FastAPI.
2. Employees, organization, and user administration: migrate schemas and workflows; add manager-scope and ownership integration tests.
3. Attendance and biometrics: move proof images/templates to private storage, introduce encrypted biometric profiles, server-side geofencing, Redis challenges, ONNX embeddings, and Celery missing-checkout work.
4. Leave, holidays, arrangements, and allowances: port policy services and approval workflows with transaction/idempotency tests.
5. Recruitment, interviews, offers, public acceptance, and onboarding: port document/PDF storage and approval state machines.
6. Notifications, reports, audit UI, background jobs, frontend TypeScript/query migration, and final deployment cutover.

For each module: document the existing API contract, port route → schema → service → repository, run parity tests, update the frontend client, direct all traffic to FastAPI, and only then remove the corresponding Express implementation.
