# Zhishu

Zhishu is a self-hosted learning workspace for branching a discussion from an exact selection, preserving reference snapshots, and keeping each workspace on the server rather than in browser storage.

[中文文档](README.zh-CN.md)

## Quick Start

Requires Node.js 22.9+, npm, and Python 3.13+. SQLite is embedded; Docker and an external database are not required.

```sh
npm install
py -m pip install -e "backend[test]"
```

Create the local environment file:

```cmd
copy .env.example .env
```

```sh
cp .env.example .env
```

Then initialize the database, start FastAPI in one terminal, and start Vite in another:

```sh
py -m alembic -c backend/alembic.ini upgrade head
py -m uvicorn app.main:app --app-dir backend --reload --port 8000
npm run dev:web
```

Open `http://127.0.0.1:5173`. FastAPI listens on port `8000`; Vite proxies API requests to it.

For a self-hosted production process, build the web client, migrate, then serve FastAPI:

```sh
npm run build
py -m alembic -c backend/alembic.ini upgrade head
py -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Set `APP_ENV=production`, a persistent `DATABASE_URL`, and `DATA_ENCRYPTION_KEY` before exposing the service.

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

The browser smoke test builds the client, starts FastAPI with a temporary SQLite database, and uses Chrome through the installed `playwright-core`. Install Chrome, or set `CHROME_PATH` to a Chrome/Chromium executable. It writes `test-results/browser-smoke.png`.

## Documentation

- [Architecture](docs/architecture.md)
- [Python backend](backend/README.md)
- [Web client](apps/web/README.md)
- [Windows desktop host](desktop/README.md)
