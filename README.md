# Zhishu

Zhishu is a self-hosted learning workspace for branching a discussion from an exact selection, preserving reference snapshots, and keeping each workspace on the server rather than in browser storage.

[中文文档](README.zh-CN.md)

## Quick Start

Requires Node.js 22.12+ (or 24 LTS), npm, and Python 3.12+. SQLite is embedded; Docker and an external database are not required.

```sh
npm install
py -m pip install -e "backend[test]"
```

Create the local environment file.

Windows CMD:

```cmd
copy .env.example .env
```

macOS, Linux, or another POSIX shell:

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

Set `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER` (`openai`, `anthropic`, or `gemini`), and optionally `AI_TIMEOUT_MS` in `.env`, or configure the protocol, output token limit and temperature in the Settings & Data panel. All three text protocols support incremental SSE. DeepSeek, Qwen and OpenRouter are OpenAI-compatible URL presets, not separately verified integrations. Tests use protocol-specific local fixtures; no real provider account has been verified. Session keys are submitted only to the same-origin API and excluded from read APIs and exports.

Settings also offers disk-staged NDJSON history import and streaming download (1 MiB per record, 2 GiB file limit). Compatibility JSON requests are limited to 8 MiB. Startup applies Alembic upgrades automatically; old workspace JSON is retained as a migration-time backup. Read [architecture and current scaling limits](docs/architecture.md) before migrating a large workspace. Private model hosts require the explicit server setting `AI_ALLOW_PRIVATE_HOSTS=true`; production still requires HTTPS.

For production session credentials, set `DATA_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Generate one with `npm run keys:generate`. In development, an unset key causes the API to generate an ephemeral process key; saved session credentials deliberately cannot be read after a restart. `AI_ALLOWED_HOSTS` optionally restricts user-configured provider hostnames.

## Windows Desktop

On Windows, running `desktop\build.ps1` produces two distributable forms, both in `desktop\dist\`:

- **`Zhishu-Setup-windows-x64.exe`** (recommended) — users double-click to install; the WebView2 Runtime and shortcuts are handled automatically, and it installs per user without administrator rights
- **`Zhishu-windows-x64.zip`** — portable; unzip and run `Zhishu\Zhishu.exe`, keeping the whole `_internal` folder alongside it

Both bundle Python and every dependency, so users need not install Python or Node.js, or start a server themselves. Data always lives in `%LOCALAPPDATA%\Zhishu`, and uninstalling does not remove it. Both require x64 Windows 10/11; the installer installs the Microsoft Edge WebView2 Runtime automatically when it is missing (if the runtime was not bundled at build time, the installer prompts the user to install it manually instead). Build details and known limitations (not yet code-signed, wizard language) are in the [desktop host documentation](desktop/README.md).

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
