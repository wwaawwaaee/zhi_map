# Zhishu

Zhishu is a self-hosted learning workspace for branching a discussion from an exact selection, preserving reference snapshots, and keeping each workspace on the server rather than in browser storage.

[中文文档](README.zh-CN.md)

## Quick Start

Requires Node.js 22.9+ and npm. SQLite is embedded; Docker and an external database are not required.

```sh
npm install
```

Create the local environment file:

```cmd
copy .env.example .env
```

```sh
cp .env.example .env
```

Then initialize the database and start both development servers:

```sh
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on port `3000` and the Vite server proxies its API requests to it.

For a self-hosted production process:

```sh
npm run build
npm start
```

Set `NODE_ENV=production`, a persistent `DATABASE_URL`, and a strong `SESSION_SECRET` before exposing the service. Set `APP_ORIGIN` when the web client is hosted on another origin.

## Configure a Model

Set `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and optionally `AI_TIMEOUT_MS` in `.env` for the server fallback, or configure an OpenAI-compatible provider in the Settings UI for the current anonymous session. Session keys are submitted only to the same-origin API and are not returned by read APIs, browser storage, URLs, logs, or exports.

For production session credentials, set `DATA_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Generate one with `npm run keys:generate`. In development, an unset key causes the API to generate an ephemeral process key; saved session credentials deliberately cannot be read after a restart. `AI_ALLOWED_HOSTS` optionally restricts user-configured provider hostnames.

## Test

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

The browser smoke test uses `CHROME_PATH` or the standard Windows Chrome location and writes `test-results/browser-smoke.png`.

## Documentation

- [Architecture](docs/architecture.md)
- [API service](apps/api/README.md)
- [Web client](apps/web/README.md)
- [Domain model](packages/domain/README.md)
- [HTTP contracts](packages/contracts/README.md)
- [Test suite](tests/README.md)
