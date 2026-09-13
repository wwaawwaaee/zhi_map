# Zhishu Architecture

## Module Boundaries

The React web client renders server-paged views and sends commands. It does not decide durable state transitions, store learning data, or retain model credentials. See the [web client](../apps/web/README.md) for component responsibilities.

`backend/app/domain` owns deterministic state transitions, validation, and JavaScript-compatible UTF-16 offsets. It has no HTTP, database, or browser dependency.

FastAPI Pydantic models own the HTTP boundary. The Python API authenticates the local anonymous session, validates requests, invokes domain transitions, persists snapshots, and is the only component that talks to SQLite and model providers. See the [backend](../backend/README.md).

## Data Flow

1. A first request creates an anonymous user and an HttpOnly, `SameSite=Lax` session cookie.
2. The client reads revision/active metadata, then cursor pages of topics and entries. Commands include the revision and return compact affected IDs.
3. The repository uses incremental SQL for common message/draft operations, iterates source prefixes for branching and fetches only selected reference entries. A stale workspace revision is rejected as a conflict. Undo is a bounded server-side single-use token, not a client snapshot.
4. AI reads at most 100 entries / 64,000 text characters from the run's branch, resolves session model configuration before the environment fallback, calls the provider server-side, then persists the answer incrementally. SSE completion returns compact metadata and never replaces the UI's other branch or dirty drafts.
5. Small backups retain `{ schemaVersion: 2, state }`. Large backups use NDJSON with disk staging, bounded records and atomic final copy; model configuration is excluded.

Branches copy inherited context and references are stored as snapshots. Deleting an original source therefore does not invalidate an existing branch or reference.

## Deployment Assumptions

Zhishu is a single-process, single-instance service. SQLite requires durable local storage and is not a shared filesystem or horizontally scaled solution. Startup runs Alembic; `alembic upgrade head` is also supported. Back up the database and encryption key, and use HTTPS with `APP_ENV=production`. Legacy workspace JSON is migrated on first owner access and retained as a historical backup. New writes use normalized tables. Downgrading to old binaries does not preserve current history.

The AI gateway is server-side. Session keys are AES-256-GCM encrypted when `DATA_ENCRYPTION_KEY` is configured; production refuses to save session keys without it. Provider URLs are validated, re-resolved before use, and never followed through redirects. These controls complement, rather than replace, outbound network controls.

Operational coverage is intentionally limited: there is no high availability, multi-node coordination, replication, managed backup service, or active OIDC adapter. Run `py -m pytest backend/tests -q` and `npm run test:browser` for backend and browser coverage.

## Current scaling boundaries

React message/topic DOM windows are limited to 40 rows. The SSE overlay is separate from persisted state and only committed once after successful completion; context signatures and owner/run identity prevent late answers from attaching to changed questions. Provider adapters independently map three text protocols. No real provider accounts were exercised.

The controller caches at most 8 entry pages (3 per branch), while topic/source/context/reference lists are server-paged at 40. Reference IDs are capped at 100; all-background selection uses scope/exclusions, with server cursor iteration. Normal UI calls no full snapshot endpoint. Compatibility snapshot/export and legacy JSON migration/import remain bounded at 8 MiB; undo serializes at most one 8 MiB branch server-side. Some metadata commands still load all branch/session metadata. Final staged import and branch copying use potentially long write transactions. Count-bounded client caching is not an arbitrary-record byte/RSS or TB-scale guarantee. See [backend limits](../backend/README.md) and [frontend boundaries](../apps/web/README.md).

## Architecture references

Independent Python/TypeScript implementation informed by the user-specified Cherry Studio research revision `fc96ba8953aa89d3ca4216906ea32766d97bc911` (AGPLv3); no Cherry source or assets copied:

- [Chat runtime separation](https://github.com/CherryHQ/cherry-studio/blob/fc96ba8953aa89d3ca4216906ea32766d97bc911/src/renderer/pages/home/useChatRuntimeState.ts)
- [Provider family registry](https://github.com/CherryHQ/cherry-studio/blob/fc96ba8953aa89d3ca4216906ea32766d97bc911/src/main/ai/provider/factory.ts)
- [Stream lifecycle](https://github.com/CherryHQ/cherry-studio/blob/fc96ba8953aa89d3ca4216906ea32766d97bc911/src/shared/ai/transport/stream.ts)
- [SQLite service](https://github.com/CherryHQ/cherry-studio/blob/fc96ba8953aa89d3ca4216906ea32766d97bc911/src/main/data/db/DbService.ts)
