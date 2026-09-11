# Zhishu Web Client

## Frontend Architecture

`apps/web` is a Vite TypeScript client. `main.ts` wires the page and interaction flows, `controller.ts` maintains the in-memory snapshot and revision, `api.ts` performs same-origin HTTP requests, `selection.ts` maps exact text selections, and `render.ts` renders the workspace. The static `index.html` provides the application shell.

## Development Entry

Run `npm run dev:web` from the repository root and open `http://127.0.0.1:5173`. Vite proxies `/api`, `/healthz`, and `/readyz` to `http://127.0.0.1:3000`; start the API separately with `npm run dev:api` or use `npm run dev` for both. Build with `npm run build`.

## User Interaction

The client lets a learner create and organize topics, send prompts, expand an exact message selection into a branch, add or remove reference snapshots, choose history references when prompted, manage titles and tags, restore a recent deletion, and export or import a workspace. Settings can configure or clear the current session's model provider.

## Data and API Dependency

The client owns only its rendered, in-memory workspace snapshot and active request state. It does not persist learning data, session credentials, or authoritative revisions in browser storage. Every workspace mutation, import/export operation, model setting, and model request depends on the API's same-origin endpoints. HTTP payload rules are defined by [contracts](../../packages/contracts/README.md), and state semantics are defined by [domain](../../packages/domain/README.md).
