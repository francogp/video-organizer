# Purpose

Automated unit and component tests for the Vue 3 + Pinia frontend.

## Ownership

QA Engineering Agents.

## Local Contracts

- Frontend DOM tests must declare `// @vitest-environment happy-dom`.

## Key Files

- [QueueTable.test.ts](QueueTable.test.ts): Queue table rendering tests.
- [VerifierView.test.ts](VerifierView.test.ts): Verifier tab rendering and rename execution tests.
- [tableColumns.test.ts](tableColumns.test.ts): Table column definitions and visibility preference tests.
- [tableQueryCore.test.ts](tableQueryCore.test.ts): Table filtering, sorting, and query core tests.
- [tableVirtualizer.test.ts](tableVirtualizer.test.ts): Virtualized table row measurement and windowing tests.
- [organizerStore.test.ts](organizerStore.test.ts): Pinia store action and SSE event tests.
- [Modals.test.ts](Modals.test.ts): Modal components, `App.vue`, and `useGsapMotion` tests.

## Work Guidance

- Mock `fetch` and `EventSource` deterministically without live backend calls.

## Verification

- Run `npm run test:coverage` to verify all frontend tests pass.
