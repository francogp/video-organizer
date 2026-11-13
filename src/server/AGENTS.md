# Purpose

Node.js 26+ native TypeScript backend serving REST/SSE APIs, Plex scanning, metadata lookup, preflight checks, and `ffmpeg` lossless remuxing.

## Ownership

Backend Maintainers.

## Local Contracts

- All relative imports use `.ts` extensions for native Node.js 26 type-stripping execution.
- All `ffmpeg`/`ffprobe` invocations use `node:child_process.spawn` with argument arrays (no shell).
- Directory traversal uses Node.js 26 native `fs.readdir(..., { recursive: true })`.

## Key Files

- [config.ts](config.ts): Valibot `.env` validation and container mount path mapping.
- [routes.ts](routes.ts): Native `node:http` router for `/api/*`, SSE `/api/events`, and static `dist/`.
- [index.ts](index.ts): Server entrypoint.

## Work Guidance

- Delegate business orchestration to [services/AGENTS.md](services/AGENTS.md) rather than embedding logic in HTTP handlers.

## Verification

- Run `npm run test:coverage` and `npm run auditor:lint` after changes.

## Child DOX Index

- [services/AGENTS.md](services/AGENTS.md): Backend scanner, preflight, file mover, job runner, media, and metadata services.
