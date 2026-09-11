# Zhishu Domain Model

## Invariants

`packages/domain` owns the deterministic learning workspace model. A `State` at version `2` contains unique sessions, branches assigned to existing sessions, and an active branch when one is selected. Entries preserve their source identity; inherited context and reference entries are snapshots. Selection ranges use exact UTF-16 offsets and must match the selected text. `validateState` is the final guard for imported and restored state.

Branch transitions preserve the learning rules: selection context ends exactly at the selected endpoint, a branch cannot receive an answer unless it is awaiting one, history-sensitive prompts require an explicit choice, references cannot duplicate a source, and deleting a source cannot rewrite existing snapshots.

## State and Actions

`State`, `Branch`, `Entry`, `Selection`, and related types describe the persisted workspace. `transition(state, action)` is the sole state mutation entry point. Supported action types include session and branch creation, drafting and sending, answering, selection expansion, history resolution, reference management, metadata, deletion, and restoration. `seedState`, preview helpers, and `branchOf` support deterministic behavior around those actions.

## Change Requirements

Add or alter an action only when its behavior is implemented in `transition`, represented in the HTTP schema where it crosses the API boundary, and covered by tests. Preserve state version and snapshot semantics unless a deliberate migration strategy is introduced. Keep this package free of Fastify, SQLite, browser, and provider concerns.

## Tests

Run the domain tests with:

```sh
npm test
```

Tests in `packages/domain/test` cover exact selection boundaries, explicit history choices, branch isolation, and snapshot survival after source deletion. See the [test suite](../../tests/README.md) for the full test layout.
