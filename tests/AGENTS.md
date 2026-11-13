# Purpose

Automated test suites for the repository.

## Ownership

Project Maintainers and QA Engineering Agents.

## Local Contracts

- All tests must run deterministically via `npm run test:coverage` (`vp test --coverage`).

## Key Files

- [index.test.ts](index.test.ts): Initial baseline test suite.
- [domain/libraryVerifier.test.ts](domain/libraryVerifier.test.ts): Pure library Plex compliance, naming, and folder verification tests.
- [domain/plexFormatter.test.ts](domain/plexFormatter.test.ts): Pure Plex naming, edition, multi-version, and tag formatting tests.
- [server/config.test.ts](server/config.test.ts): Environment configuration and mount path validation tests.
- [server/scanner.test.ts](server/scanner.test.ts): Directory scanning, `.plexignore`, `.plexmatch`, subtitle, and VobSub tests.
- [server/metadata.test.ts](server/metadata.test.ts): IMDb, OMDb, TVDB v4, and TVmaze metadata client tests.
- [server/preflight.test.ts](server/preflight.test.ts): Pre-flight destination projection, conflict, and disk space checks.
- [server/fileMover.test.ts](server/fileMover.test.ts): Atomic move, `EXDEV` fallback, TOCTOU guard, and deferred cleanup tests.
- [server/ffmpegRunner.test.ts](server/ffmpegRunner.test.ts): `ffprobe` / `ffmpeg` spawn wrapper, remux args, progress/ETA, and subtitle UTF-8 normalization tests.
- [server/jobRunnerAndRoutes.test.ts](server/jobRunnerAndRoutes.test.ts): HTTP API routes, LAN lock, SSE stream, and static `dist/` serving tests.
- [server/jobRunnerExecution.test.ts](server/jobRunnerExecution.test.ts): End-to-end `JobRunner` scan, preflight conflict, cancellation, and remux execution tests.
- [server/libraryVerifierMatrix.test.ts](server/libraryVerifierMatrix.test.ts): Library verifier matrix compliance and rename plan tests.
- [server/libraryVerifierService.test.ts](server/libraryVerifierService.test.ts): Library verifier scan and fix execution tests.
- [client/QueueTable.test.ts](client/QueueTable.test.ts): `QueueTable.vue` component rendering tests.
- [client/VerifierView.test.ts](client/VerifierView.test.ts): `VerifierView.vue` component rendering and rename action tests.
- [client/tableColumns.test.ts](client/tableColumns.test.ts): Table column definitions and visibility preference tests.
- [client/tableQueryCore.test.ts](client/tableQueryCore.test.ts): Table filtering, sorting, and query core tests.
- [client/tableVirtualizer.test.ts](client/tableVirtualizer.test.ts): Virtualized table row measurement and windowing tests.
- [client/organizerStore.test.ts](client/organizerStore.test.ts): Pinia store state, API requests, and SSE handler tests.
- [client/Modals.test.ts](client/Modals.test.ts): `ConflictResolutionModal.vue`, `TrackInspectorModal.vue`, `App.vue`, and `useGsapMotion` tests.

## Work Guidance

- Place unit and integration tests mirroring the `src/` structure.

## Verification

- Execute `npm run test:coverage` to verify 100% pass and coverage thresholds.

## Child DOX Index

- [client/AGENTS.md](client/AGENTS.md): Frontend component, store, and modal tests.
- [domain/AGENTS.md](domain/AGENTS.md): Pure Plex domain formatter and verifier tests.
- [fixtures/AGENTS.md](fixtures/AGENTS.md): Shared verifier test fixtures.
- [server/AGENTS.md](server/AGENTS.md): Backend service and HTTP/SSE route tests.
