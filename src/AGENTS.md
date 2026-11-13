# Purpose

Root DOX index for application source layers (`domain`, `server`, `client`).

## Ownership

Project Maintainers.

## Local Contracts

- Strictly enforce decoupled layering: `domain` has zero I/O, `server` uses Node.js 26+ native modules, `client` uses Vue 3 + Pinia + SCSS.

## Key Files

- [index.ts](index.ts): Package version entrypoint.
- [env.d.ts](env.d.ts): Ambient TypeScript declarations for Node.js, Vite client assets, and Vue SFCs.

## Work Guidance

- Maintain `.ts` relative import extensions across `domain` and `server` for Node.js 26+ native TypeScript execution.

## Verification

- Run `npm run test:coverage` and `npm run auditor:lint` after changes.

## Child DOX Index

- [domain/AGENTS.md](domain/AGENTS.md): Pure domain types, constants, and Plex path formatters.
- [server/AGENTS.md](server/AGENTS.md): Node.js 26+ backend services, REST/SSE routes, and `ffmpeg` integration.
- [client/AGENTS.md](client/AGENTS.md): Vue 3 + Pinia + SCSS + GSAP frontend console.
