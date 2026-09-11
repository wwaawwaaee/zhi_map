# Zhishu Tests

## Layers

- `packages/domain/test` checks deterministic state transitions and snapshot invariants.
- `apps/api/test` checks Fastify routes, persistence behavior, session isolation, model credential protection, and provider gateway safeguards.
- `tests/browser-smoke.ts` runs the built application through Chrome for critical learner workflows.

## Commands

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

`npm test` runs the domain and API suites. The browser smoke test requires `CHROME_PATH` or the standard Windows Chrome executable and writes `test-results/browser-smoke.png`. Run it after a build when validating the production-served client/API path.
