# Purpose

External metadata lookup clients for movies (IMDb/OMDb) and TV series/episodes (TVDB v4/TVmaze).

## Ownership

Backend Maintainers.

## Local Contracts

- Must operate cleanly without API keys via public IMDb Suggestions and TVmaze fallbacks.
- `metadataCache.ts` enforces `CACHE_VERSION = 2` so legacy cached entries missing `isAnimated` are cleanly invalidated.
- Metadata providers (`baseMetadataProvider.ts` `hasAnimationMetadata`, `tvdbClient.ts`, `imdbClient.ts`) propagate `isAnimated` onto `MetadataCandidate` for automatic animated library classification.

## Key Files

- [baseMetadataProvider.ts](baseMetadataProvider.ts): Single base class (`BaseMetadataProvider`) with serialized rate limiting, HTTP retries (`429`/`5xx`/network), JSON/HTML schema validation, and `runProviderChain` fallback orchestration.
- [metadataCache.ts](metadataCache.ts): Persistent `metadata-cache.json` store with TTL and atomic writes.
- [imdbClient.ts](imdbClient.ts): IMDb Suggestions and OMDb movie parsers (`ImdbSuggestionProvider`, `OmdbProvider`).
- [tvdbClient.ts](tvdbClient.ts): TVDB v4 and TVmaze series/episode parsers (`TvdbProvider`, `TvmazeProvider`).

## Work Guidance

- Respect TVmaze rate-limit windows and cache episode title maps in memory.

## Verification

- Run `npm run test:coverage` to verify `metadata.test.ts`.
