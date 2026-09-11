# 知径

知径是面向学习讨论的单实例、自托管工作台。选区可精确展开为独立分支，背景默认截断到选区末尾；引用以快照保存，来源删除后仍可阅读。工作区由 API 和 SQLite 持久化，不以浏览器 `localStorage` 为数据源。

## Requirements

Node.js 22.9+ and npm. SQLite is embedded through `better-sqlite3`; no Docker, Redis, or external database is required.

## Run

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:5173` in development. Build and run the self-hosted single process with:

```sh
npm run build
npm start
```

Production serves `apps/web/dist` from Fastify at `HOST:PORT`. Set `NODE_ENV=production`, `APP_ORIGIN` when applicable, a persistent `DATABASE_URL`, and a real `SESSION_SECRET` before exposing it beyond localhost.

## Configuration

`DATABASE_URL` defaults to `./data/zhijing.db`. Environment `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and `AI_TIMEOUT_MS` are the server-wide fallback. Each anonymous session can instead configure an OpenAI-compatible base URL, model, API key, and optional timeout in Settings. The browser submits the key only through the same-origin API; it is never returned by GET APIs, put in browser storage, URLs, logs, or exports.

Set `DATA_ENCRYPTION_KEY` in production before saving session model credentials. It must be a base64-encoded 32-byte key. Generate one with `npm run keys:generate`; on Windows PowerShell, use `$env:DATA_ENCRYPTION_KEY = npm run keys:generate --silent`, then persist the resulting value in the deployment secret store. Development generates one ephemeral process key and warns at startup, so saved credentials intentionally do not survive a restart. Clearing a session configuration requires confirmation and returns AI to the environment fallback (or offline mode). `AI_ALLOWED_HOSTS` can be a comma-separated exact hostname allowlist.

User URLs must be absolute HTTP(S), cannot include URL credentials, are re-resolved before use, do not follow redirects, and reject localhost/private/link-local addresses. Production additionally requires HTTPS. Development and tests permit loopback only for local mock providers. This validation reduces SSRF risk but does not replace outbound firewall/egress controls against DNS rebinding in a hostile network.

Anonymous users are created automatically and isolated through a server-side session. Export/import uses `{ schemaVersion: 2, state }`, validates size/schema, and replaces only the current user's workspace in a transaction; model configuration is never included. Legacy browser `localStorage` is intentionally not auto-migrated; a one-time JSON import can be added without changing the server model.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

The browser smoke test needs Chrome at `CHROME_PATH` or the standard Windows Chrome path. It writes `test-results/browser-smoke.png`.

## Operational Scope

This is a SQLite single-instance baseline. It has request IDs, structured Fastify logs, `/healthz`, `/readyz`, security headers, bounded request bodies, configurable CORS, secure production cookies, rate-limited AI routes, graceful signal shutdown, and sanitized upstream errors. It is not an HA SaaS deployment: it has no OIDC adapter yet, multi-node coordination, background job queue, replication, or managed backup service. See [architecture](docs/architecture.md) for boundaries and deployment assumptions.
