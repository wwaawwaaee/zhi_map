# 知树 Python Backend

Python 3.12+ FastAPI application. The domain transitions, validation, persistence, AI gateway, encryption, and session authentication run here; TypeScript is presentation-only.

```cmd
py -m venv .venv
.venv\Scripts\python -m pip install -e .[test]
copy .env.example .env
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
.venv\Scripts\python -m pytest
```

`DATA_ENCRYPTION_KEY` is required in production. Development generates an ephemeral AES-GCM key when it is unset, so saved provider keys cannot survive a restart.

## Protocols and HTTP contract

`app/providers` independently maps OpenAI chat-completions (Bearer), Anthropic Messages (`x-api-key`, version header, top-level system prompt), and Gemini `streamGenerateContent` (`x-goog-api-key`, `systemInstruction`, model roles). Metadata and reranking consume the same streaming gateway and validate structured output. No tools, images, audio, OpenAI Responses API or Gemini non-streaming endpoint are implemented. Real accounts have not been tested.

- `POST /api/ai/config`: adds `provider`, `maxTokens` (1–65536), `temperature` (null or 0–1).
- `POST /api/ai/chat/stream`: `{branchId, revision, response?: "compact"}` → SSE events `started/delta/usage/completed/failed/cancelled`, each with `runId` and increasing `seq`. `completed.result` contains revision, active/affected branch IDs and new entry IDs. HTTP disconnect closes upstream transport; completed context is checked before a single commit. Explicit `response: "snapshot"` is legacy-only and subject to the compatibility budget.
- `POST /api/ai/chat/cancel`: `{branchId, runId}`; scoped to authenticated owner.
- `GET /api/workspace/view`: revision/active only. `GET /api/branches/{id}`: owner-scoped branch metadata, no entries. `GET /api/topics?limit=40&cursor=-1&search=...`: paged metadata without drafts. `GET /api/branches/{id}/entries?limit=40&cursor=-1&anchor=...&before=...`: `{items,nextCursor,cursor}`; anchor locates a source page, before bounds a context prefix, maximum limit 100. Positional cursors must be restarted after edits.
- `POST /api/workspace/actions?response=compact` is the default: revision and affected IDs, no state. Expand accepts `contextScope: {mode: "all"|"none", excludedIds: [...]}` (200 exclusions max). Reference selection is capped at 100 IDs. `POST /api/workspace/undo` takes `{token, revision}`; branch deletion returns a single-use, owner-scoped token with a 10-minute TTL. One tombstone per owner, at most 8 MiB source data; oversize undoable deletion is rejected before mutation. Session-mainline deletion preserves child branches and is not undoable.
- `GET /api/export/ndjson`, `POST /api/import/ndjson?revision=N`: manifest, session, branch, entry and end records. Upload is incrementally parsed, committed to temporary SQLite every 100 records, then copied atomically into the owner's tables. Failed/cancelled staging leaves live history intact. Final copy takes one write transaction and can hold the writer lock for a large file.
- `/docs` and `/openapi.json` expose the typed HTTP models. NDJSON record schema and SSE event types are described here; they are not expanded as OpenAPI Pydantic schemas yet.

## Migration and storage

Startup and the CLI use Alembic. `0002_provider_options` adds protocol settings without changing ciphertext, nonce, authentication tag or encryption version. `0003_normalized_history` creates owner-scoped head/session/branch/entry tables; the first access migrates that owner's validated JSON in one transaction. `workspaces.state` is retained unchanged, but is **not** a current backup after subsequent edits. Export NDJSON for current history; preserve the full DB and encryption key for credentials. Do not run old binaries against an upgraded database.

`0004_delete_tombstones` adds disk-backed undo tokens plus entry-anchor/topic-cursor indexes. Legacy JSON auto-migration is limited to 8 MiB. Expired tokens cannot be used; deletion also removes expired tombstones and replaces the owner's prior token.

SQLite connections enable WAL, NORMAL synchronous mode, foreign keys and a 5-second busy timeout. Send/answer/draft/retry use only metadata and the final entry with incremental SQL writes. Fork/expand validate the anchor and iterate selected source rows on the server; references load at most 100 selected source entries and validate duplicates in SQL. AI input includes the selection anchor and latest question, plus recent history within the 100-entry / 64,000-character budget. Truncation is reported in the UI and to the model; oversized required input blocks generation. Model transport does not hold database transactions. SSE budgets: 256 KiB per line, 512 KiB per event, 8 MiB decoded response bytes and 100,000 UTF-8 output bytes. JSON requests are capped at 8 MiB; NDJSON at 1 MiB per record and 2 GiB total.

Remaining full-materialization paths: explicit legacy snapshot/JSON export and response=snapshot (8 MiB stored-data budget); bounded legacy JSON import/restore; first-owner legacy JSON migration; single-branch undo tombstone serialization/restore (8 MiB). Create/metadata/switch/session-delete still load all branch/session **metadata**, without history entries. Fork and final NDJSON import can hold a long write transaction even though entry iteration is bounded. These are not TB-scale or constant-latency guarantees.

Run `py -m pytest tests -q -s` for the 100-topic/10,000-entry disk-streamed roundtrip and Python heap measurement. This is not an RSS measurement. Tests use disposable databases.
