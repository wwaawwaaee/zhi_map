# 知树 Web Client

Vite TypeScript renders and interacts with snapshots from the Python FastAPI service. It contains view types only: no persistence, credentials, or domain transitions. `npm run dev:web` proxies API traffic to `http://127.0.0.1:8000`.

## Frontend Architecture

`apps/web` is a Vite TypeScript client. `main.ts` wires the page and interaction flows, `controller.ts` maintains the in-memory snapshot and revision, `api.ts` performs same-origin HTTP requests, `selection.ts` maps exact text selections, and `render.ts` renders the workspace. The static `index.html` provides the application shell.

## Development Entry

Run `npm run dev:web` from the repository root and open `http://127.0.0.1:5173`. Vite proxies `/api`, `/healthz`, and `/readyz` to the FastAPI server at `http://127.0.0.1:8000`; start it with `py -m uvicorn app.main:app --app-dir backend --reload --port 8000`. Build with `npm run build`.

## User Interaction

The client lets a learner create and organize topics, send prompts, expand an exact message selection into a branch, add or remove reference snapshots, choose history references when prompted, manage titles and tags, restore a recent deletion, and export or import a workspace. Settings can configure or clear the current session's model provider.

## Data and API Dependency

The client owns only its rendered, in-memory workspace snapshot and active request state. It does not persist learning data, session credentials, or authoritative revisions in browser storage. Every workspace mutation, import/export operation, model setting, and model request depends on FastAPI. Python Pydantic models validate HTTP payloads and `backend/app/domain` defines state semantics.
