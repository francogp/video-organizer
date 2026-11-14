# Purpose

Backend orchestration services for scanning, pre-flight validation, atomic file moving, and job execution.

## Ownership

Backend Maintainers.

## Local Contracts

- All file moves must preserve unselected source items and enforce TOCTOU destination guards.
- After job completion (`jobRunner.ts`), remove only `movedItems` from `this.#items`—never reset `this.#items = []`, so excluded (`include: false`) and conflict-ignored items remain in the queue.
- Only set `needsUserPrompt` (`Resolve Subs`) when an external subtitle has an ambiguous language/missing `.idx`, collides with another external subtitle, or shares `(language, isForced, isHearingImpaired)` with an existing embedded subtitle—adding a new language is never a conflict.
- `libraryVerifierService.ts` falls back to content-level directory moves on `EACCES`/`EPERM`/`EBUSY` without invoking `chown`/`chmod`, while keeping file-level `EACCES` errors loud with `PUID`/`PGID` guidance.
- Cooperative job cancellation (`Cancel Job`): `scanInputDirectory` and `enrichItemsWithAudioAnalysis` accept `shouldCancel` and `registerChild`, return only completed items, persist partial audio cache, and `jobRunner.ts` `unlock()` awaits `#activeRunPromise` and transitions to `READY` when processed items exist.
- Automatic animation library reclassification: `jobRunner.ts` (`resolveCategoryFromMetadata`) updates `category` between standard (`Movies`/`Series`) and animated (`Animated Movies`/`Animated Series`) both during `#executeScan` and when applying manual metadata selection/search patches (`#applyPatchToItem`).
- `libraryVerifierService.ts` classifies recursively empty folders as `Empty directory` whose remediation is direct deletion rather than migration or rename.
- `JobRunner` must update `activeJob` and emit SSE `progress` events through a single synchronized helper (`#updateProgress`) keeping `stageLabel` (step/count) separate from `currentFile`, so parallel `Verifier` state broadcasts never cause UI progress flickering.
- Disk caches in `CONFIG_DIR` (`metadata-cache.json`, `audio-cache.json`) are best-effort: on `EACCES`/`EPERM`, services must log a single diagnostic warning and fall back to `os.tmpdir()` instead of aborting scans or spamming `STDERR`; Docker entrypoint permission adjustments (`su-exec`) must target `CONFIG_DIR` exclusively and never mutate permissions under `/data/*`.

## Key Files

- [scanner.ts](scanner.ts): Plex-compliant recursive scanner, `.plexignore`/`.plexmatch` parser, and subtitle matcher.
- [preflight.ts](preflight.ts): Pre-flight destination collision and disk space checks.
- [fileMover.ts](fileMover.ts): `EXDEV`-safe file move and deferred end-of-job cleanup.
- [jobRunner.ts](jobRunner.ts): In-memory LAN lock, queue state machine, and sequential job execution.
- [libraryVerifierService.ts](libraryVerifierService.ts): Parallel Plex library compliance scanner and bottom-up rename executor.

## Work Guidance

- Keep media probing/remuxing in [media/AGENTS.md](media/AGENTS.md) and external API lookups in [metadata/AGENTS.md](metadata/AGENTS.md).

## Verification

- Run `npm run test:coverage` after modifying any service.

## Child DOX Index

- [media/AGENTS.md](media/AGENTS.md): `ffprobe` / `ffmpeg` spawn wrappers and subtitle normalization.
- [metadata/AGENTS.md](metadata/AGENTS.md): IMDb, OMDb, TVDB v4, and TVmaze API clients.
