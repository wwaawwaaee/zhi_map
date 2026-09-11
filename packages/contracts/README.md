# Zhishu HTTP Contracts

`packages/contracts` defines Zod schemas for HTTP payloads shared by the API boundary. It covers revisioned workspace actions and restore/import requests, model chat and configuration requests, and metadata and reranking requests. Schemas impose identifier, size, count, and field constraints before API handlers invoke domain behavior.

## Change Strategy

Treat exported schemas as the HTTP compatibility boundary. When adding a field, prefer an optional field with a documented server default. Do not tighten accepted existing input, remove an action type, or change import/state versions without coordinating the web client, API, domain validation, and tests. Keep transport validation here; put state invariants in [domain](../domain/README.md) and route behavior in the [API service](../../apps/api/README.md).
