# Purpose

Automated unit tests for the pure Plex domain layer.

## Ownership

QA Engineering Agents.

## Local Contracts

- Keep domain tests free of disk or network I/O.

## Key Files

- [libraryVerifier.test.ts](libraryVerifier.test.ts): Library Plex compliance and folder naming verification tests.
- [plexFormatter.test.ts](plexFormatter.test.ts): Plex movie/TV naming, editions, tags, and path containment tests.

## Work Guidance

- Cover all Plex naming conventions and edge cases (editions, split-parts, multi-episode, air dates).

## Verification

- Run `npm run test:coverage` to verify domain coverage.
