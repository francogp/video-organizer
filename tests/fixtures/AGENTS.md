# Purpose

Shared synthetic filesystem and metadata fixtures for automated test suites.

## Ownership

QA Engineering Agents.

## Local Contracts

- Fixtures must seed into isolated temporary directories (`os.tmpdir()`) and never touch host media mounts.

## Key Files

- [verifierFixtures.ts](verifierFixtures.ts): Comprehensive 5-library Plex verifier fixture tree (`seedVerifierFixtureLibraries`) covering compliant roots, missing years/provider IDs, case-only renames, split-parts, multi-episodes, and collisions.

## Work Guidance

- Keep fixture helpers deterministic and reusable across unit and integration suites.

## Verification

- Run `npm run test:coverage` after modifying fixtures.
