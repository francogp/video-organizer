# Purpose

Pinia reactive stores managing queue state, REST mutations, and SSE live updates.

## Ownership

Frontend Maintainers.

## Local Contracts

- All mutating requests must include the `X-Client-Id` header and current `revision`.
- Revision-mutating actions (`patchItem`, `patchItemsBulk`, `runPreflight`, `startJob`) must execute through a FIFO queue (`enqueueMutation`), and `requestRevisionMutation` must perform one transparent retry on `409 STALE_REVISION` by hydrating `data.state` without surfacing transient `errorMessage` banners.

## Key Files

- [organizerStore.ts](organizerStore.ts): Global state, REST actions, and SSE listener.

## Work Guidance

- Keep store actions thin and synchronize state from authoritative server payloads.

## Verification

- Run `npm run test:coverage` to verify `organizerStore.test.ts`.
