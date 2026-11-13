# Purpose

Pure domain layer defining canonical types, constants, and Plex naming/path formatters with zero I/O dependencies.

## Ownership

Domain Layer Maintainers.

## Local Contracts

- All union types must derive from `as const` tuples in [constants.ts](constants.ts) with `valibot` schema parity and branded IDs in [types.ts](types.ts).
- All relative imports must use `.ts` extensions for Node.js 26+ native TypeScript execution.
- All generated output paths must pass `resolveContainedOutputPath` containment checks.

## Key Files

- [constants.ts](constants.ts): Typed constants, extension sets, language maps, and Plex thresholds.
- [types.ts](types.ts): Branded IDs, Valibot schemas, and domain DTO interfaces.
- [plexFormatter.ts](plexFormatter.ts): Deterministic Plex tag extraction, sanitization, and movie/TV path formatting.
- [libraryVerifier.ts](libraryVerifier.ts): Pure Plex library compliance verifier and bottom-up rename step planner.

## Work Guidance

- Keep this directory strictly pure (no `node:fs`, `node:http`, or browser DOM imports).

## Verification

- Run `npm run test:coverage` and `npm run auditor:oxlint` after changes.
