# Zhishu API Service

## Responsibility

`apps/api` is the Fastify service. It creates and isolates anonymous sessions, validates HTTP requests, coordinates domain transitions, persists workspace snapshots in SQLite, serves the production web build, and performs server-side model requests. It is the only service that owns database access or provider credentials.

## Run and Interfaces

Start the development API with `npm run dev:api`; its default listener is `http://127.0.0.1:3000`. `npm start` runs the production API after the root build has produced `apps/web/dist`.

Runtime interfaces are:

- `GET /healthz` and `GET /readyz` for liveness and SQLite readiness.
- `GET /api/status` and `/api/ai/config` routes for model status and session configuration.
- `/api/workspace`, `/api/workspace/actions`, and `/api/workspace/restore` for revisioned workspace reads and writes.
- `/api/export` and `/api/import` for workspace transfer.
- `/api/ai/chat`, `/api/ai/metadata`, and `/api/ai/rerank` for provider-backed operations.

The API serves the built client at `/` in production. It does not provide a public multi-user account or identity-provider interface.

## Configuration and Security

Configuration is loaded from environment variables. `DATABASE_URL`, `HOST`, `PORT`, `SESSION_SECRET`, `APP_ORIGIN`, and `LOG_LEVEL` govern service operation. `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and `AI_TIMEOUT_MS` provide the server model fallback.

`DATA_ENCRYPTION_KEY` must be a base64-encoded 32-byte key to save per-session model credentials in production. In development, when it is absent, a generated process-local key permits saves only until restart. Provider URLs reject credentials, private and loopback addresses outside development/test, and redirects; production also requires HTTPS. `AI_ALLOWED_HOSTS` is an optional exact-host allowlist. API reads never return a session API key.

## Database and Migrations

Run `npm run db:migrate` from the repository root before starting a deployment. The current migration entry point opens the configured SQLite database and confirms its schema migration record; database initialization creates the required tables. Keep `DATABASE_URL` on persistent local storage and back it up before upgrades.

## Service Boundary

The service consumes schemas from [contracts](../../packages/contracts/README.md) and transitions from [domain](../../packages/domain/README.md). The [web client](../web/README.md) depends on its same-origin HTTP API, but the API must not depend on browser storage or client-side state.
