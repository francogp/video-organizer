# Purpose

Browser storage helpers for client session IDs and theme persistence.

## Ownership

Frontend Maintainers.

## Local Contracts

- Wrap all `localStorage` and `sessionStorage` calls in `try/catch` for restricted browser contexts.

## Key Files

- [formatters.ts](formatters.ts): Shared UI byte/size, Buenos Aires timestamp, ETA (`formatEta`), and Plex filename preview helpers.
- [storage.ts](storage.ts): Safe client ID (`browserId:tabId`) and theme mode persistence.

## Work Guidance

- Never expose raw storage keys outside [storage.ts](storage.ts).

## Verification

- Run `npm run test:coverage` after changes.
