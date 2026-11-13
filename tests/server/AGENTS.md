# Purpose

Automated unit and integration tests for Node.js 26+ backend services and HTTP/SSE routes.

## Ownership

QA Engineering Agents.

## Local Contracts

- Use isolated `os.tmpdir()` directories and clean up in `finally` blocks.

## Key Files

- [config.test.ts](config.test.ts): Environment configuration and mount validation tests.
- [scanner.test.ts](scanner.test.ts): Recursive Plex scanner, `.plexignore`, `.plexmatch`, and subtitle tests.
- [metadata.test.ts](metadata.test.ts): IMDb, OMDb, TVDB v4, and TVmaze client tests.
- [preflight.test.ts](preflight.test.ts): Destination collision and disk space check tests.
- [fileMover.test.ts](fileMover.test.ts): Atomic move, `EXDEV` fallback, TOCTOU guard, and deferred cleanup tests.
- [ffmpegRunner.test.ts](ffmpegRunner.test.ts): `ffprobe`/`ffmpeg` spawn wrapper and subtitle UTF-8 normalization tests.
- [jobRunnerAndRoutes.test.ts](jobRunnerAndRoutes.test.ts): HTTP API, LAN lock, SSE stream, and static `dist/` serving tests.
- [jobRunnerExecution.test.ts](jobRunnerExecution.test.ts): End-to-end `JobRunner` scan, preflight conflict, cancellation, and remux pipeline tests.
- [libraryVerifierMatrix.test.ts](libraryVerifierMatrix.test.ts): Library verifier matrix compliance and rename plan tests.
- [libraryVerifierService.test.ts](libraryVerifierService.test.ts): Library verifier scan and fix execution tests.

## Work Guidance

- Mock external network calls and `ffprobe`/`ffmpeg` child processes for deterministic CI execution.

## Verification

- Run `npm run test:coverage` to verify server coverage.
