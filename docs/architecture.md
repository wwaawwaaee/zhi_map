# Architecture

## Boundaries

`apps/web` is a Vite TypeScript client. It renders server snapshots and sends validated commands; it does not own durable learning data or model credentials. `packages/domain` contains the deterministic learning state transitions and snapshot rules. `packages/contracts` owns HTTP payload schemas. `apps/api` contains Fastify routes, services, repositories, and SQLite access.

## Components and Data

First use creates an anonymous user and an HttpOnly, `SameSite=Lax` session cookie. A workspace snapshot is stored per user in SQLite. Writes use an SQLite transaction and update the snapshot version and timestamp. Branches retain copied inherited context and reference snapshots, so a deleted source does not invalidate existing learning records.

The AI gateway is OpenAI-compatible and only exists server-side. Per-session configuration is stored in `user_ai_configs`; API keys are AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY`, using user ID and configuration version as authenticated associated data. Read APIs expose only configured state, base URL, model, timeout, timestamp, and source. AI calls resolve session configuration first, then environment fallback. The gateway does not follow redirects, revalidates configured hosts before calls, uses an abortable timeout, caps inputs through route schemas/body limits, and returns sanitized errors. An `AuthService` interface isolates the local anonymous implementation from a future OIDC adapter.

## Deployment Assumptions

This is a single-process, single-instance local or self-hosted deployment. SQLite WAL is appropriate for this baseline, not horizontally scaled application nodes or shared network filesystems. Run migrations before the API, persist `DATABASE_URL` storage, set `APP_ORIGIN` for cross-origin web hosting, and use HTTPS with `NODE_ENV=production` so cookies are secure. Back up the SQLite database. This architecture does not claim HA, multi-region replication, or distributed locking.
