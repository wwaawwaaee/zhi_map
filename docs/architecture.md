# Zhishu Architecture

## Module Boundaries

The web client renders workspace snapshots and sends commands. It does not decide durable state transitions, store learning data, or retain model credentials. See the [web client](../apps/web/README.md).

`backend/app/domain` owns deterministic state transitions, validation, and JavaScript-compatible UTF-16 offsets. It has no HTTP, database, or browser dependency.

FastAPI Pydantic models own the HTTP boundary. The Python API authenticates the local anonymous session, validates requests, invokes domain transitions, persists snapshots, and is the only component that talks to SQLite and model providers. See the [backend](../backend/README.md).

## Data Flow

1. A first request creates an anonymous user and an HttpOnly, `SameSite=Lax` session cookie.
2. The client reads a workspace snapshot and revision, then sends commands with that revision.
3. The API validates the HTTP payload, applies the domain transition, and atomically replaces the user's SQLite snapshot. A stale revision is rejected as a conflict.
4. An AI request reads the current branch, resolves the session model configuration before the environment fallback, calls the provider server-side, then persists the resulting domain action.
5. Export/import transfers `{ schemaVersion: 2, state }` for only the current user's workspace; model configuration is excluded.

Branches copy inherited context and references are stored as snapshots. Deleting an original source therefore does not invalidate an existing branch or reference.

## Deployment Assumptions

Zhishu is a single-process, single-instance service. SQLite requires durable local storage and is not a shared filesystem or horizontally scaled solution. Run `alembic upgrade head` before starting the API, back up `DATABASE_URL`, and use HTTPS with `APP_ENV=production` for secure cookies.

The AI gateway is server-side. Session keys are AES-256-GCM encrypted when `DATA_ENCRYPTION_KEY` is configured; production refuses to save session keys without it. Provider URLs are validated, re-resolved before use, and never followed through redirects. These controls complement, rather than replace, outbound network controls.

Operational coverage is intentionally limited: there is no high availability, multi-node coordination, replication, managed backup service, or active OIDC adapter. Run `py -m pytest backend/tests -q` and `npm run test:browser` for backend and browser coverage.
