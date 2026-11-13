import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_PREFERRED_LANGUAGES,
  METADATA_LANGUAGE_CODES,
  ORGANIZING_TEMP_MARKER,
  ORGANIZING_TEMP_SUFFIX
} from '../../domain/constants.ts';
import { parseProviderReference } from '../../domain/plexFormatter.ts';
import {
  asJobId,
  asTvdbId,
  type ActiveJobProgress,
  type ClientId,
  type ConflictDecision,
  type EpisodeOrderMode,
  type ItemId,
  type ItemPatch,
  type JobId,
  type JobPhase,
  type LockErrorCode,
  type LogLevel,
  type MediaKind,
  type MetadataCandidate,
  type MetadataDiagnostic,
  type MetadataLanguageCode,
  type MetadataLookupOptions,
  type OrganizerStatePayload,
  type OutputCategory,
  type ScannedItem,
  type SseLogEvent,
  type SseProgressEvent,
  type TvdbId,
  type VerifierEntry,
  type VerifierEntryId,
  type VerifierState
} from '../../domain/types.ts';
import { buildMountPathsMap, type AppConfig } from '../config.ts';
import {
  backupAndCleanupAfterJob,
  cleanupOrphanTempFiles,
  moveTempOutputFile,
  purgeExpiredBackups
} from './fileMover.ts';
import { applyVerifierRenames, scanLibrariesForCompliance } from './libraryVerifierService.ts';
import {
  analyzeAudioVolume,
  buildFfmpegRemuxArgs,
  measureLoudnormPass1,
  normalizeSubtitleToUtf8,
  probeMedia,
  runFfmpegRemux,
  type LoudnormMeasurements
} from './media/ffmpegRunner.ts';
import { lookupMovieByImdbId, searchMovies } from './metadata/imdbClient.ts';
import { configureMetadataCache } from './metadata/metadataCache.ts';
import {
  fetchEpisodeTitleMap,
  lookupSeriesByTvmazeId,
  lookupSeriesByTvdbId,
  searchTvShows
} from './metadata/tvdbClient.ts';
import { runPreflightCheck, type PreflightReport } from './preflight.ts';
import { enrichItemsWithAudioAnalysis, scanInputDirectory } from './scanner.ts';

const MAX_RECENT_LOGS = 100;
const PERCENT_MAX = 100;

function resolveCategoryFromMetadata(
  mediaKind: MediaKind,
  selectedMetadata: MetadataCandidate | undefined,
  currentCategory: OutputCategory
): OutputCategory {
  if (selectedMetadata?.isAnimated) {
    return mediaKind === 'tv' ? 'animated-series' : 'animated-movies';
  }
  if (
    selectedMetadata &&
    (currentCategory === 'animated-series' || currentCategory === 'animated-movies')
  ) {
    return mediaKind === 'tv' ? 'tv-shows' : 'movies';
  }
  if (mediaKind === 'tv' && currentCategory === 'movies') {
    return 'tv-shows';
  }
  if (mediaKind === 'movie' && currentCategory === 'tv-shows') {
    return 'movies';
  }
  return currentCategory;
}

export class LockConflictError extends Error {
  public readonly code: LockErrorCode;

  public constructor(code: LockErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SseSubscriber {
  send(event: string, data: unknown): void;
}

export class JobRunner {
  readonly #config: AppConfig;
  #phase: JobPhase = 'IDLE';
  #revision = 0;
  #lockOwnerClientId: ClientId | null = null;
  #items: ScannedItem[] = [];
  #activeJob: ActiveJobProgress | null = null;
  #lastError: string | null = null;
  readonly #activeChildren = new Set<ChildProcess>();
  #cancelledByUnlock = false;
  #activeRunPromise: Promise<void> | null = null;
  readonly #recentLogs: SseLogEvent[] = [];
  readonly #subscribers = new Set<SseSubscriber>();
  #persistChain: Promise<void> = Promise.resolve();
  #verifier: VerifierState = {
    scanning: false,
    fixing: false,
    summary: null,
    entries: [],
    lastFixResult: null
  };
  #preferredLanguages: readonly MetadataLanguageCode[] = [...DEFAULT_PREFERRED_LANGUAGES];

  public constructor(config: AppConfig) {
    this.#config = config;
  }

  public async init(): Promise<void> {
    await cleanupOrphanTempFiles(this.#config.inputDir);
    await configureMetadataCache(this.#config.configDir);
    const queuePath = path.join(this.#config.configDir, 'queue.json');
    try {
      const raw = await fs.readFile(queuePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        readonly revision?: number;
        readonly items?: ScannedItem[];
      };
      if (typeof parsed.revision === 'number') {
        this.#revision = parsed.revision;
      }
      if (Array.isArray(parsed.items)) {
        this.#items = parsed.items;
      }
    } catch {
      // Fresh queue
    }
  }

  public subscribe(sub: SseSubscriber): () => void {
    this.#subscribers.add(sub);
    sub.send('state', this.getState());
    return (): void => {
      this.#subscribers.delete(sub);
    };
  }

  public getState(): OrganizerStatePayload {
    return {
      phase: this.#phase,
      revision: this.#revision,
      lockOwnerClientId: this.#lockOwnerClientId,
      mountPaths: buildMountPathsMap(this.#config),
      items: this.#items,
      activeJob: this.#activeJob,
      lastError: this.#lastError,
      logs: [...this.#recentLogs],
      verifier: this.#verifier,
      preferredLanguages: [...this.#preferredLanguages]
    };
  }

  public setPreferredLanguages(languages: readonly string[]): OrganizerStatePayload {
    const allowed = new Set<string>(METADATA_LANGUAGE_CODES);
    const normalized: MetadataLanguageCode[] = [];
    for (const raw of languages) {
      if (allowed.has(raw) && !normalized.includes(raw as MetadataLanguageCode)) {
        normalized.push(raw as MetadataLanguageCode);
      }
    }
    this.#preferredLanguages =
      normalized.length > 0 ? normalized : [...DEFAULT_PREFERRED_LANGUAGES];
    this.#emitState();
    return this.getState();
  }

  public clearLogs(): OrganizerStatePayload {
    this.#recentLogs.length = 0;
    this.#lastError = null;
    this.#emitState();
    return this.getState();
  }

  #emitState(): void {
    const state = this.getState();
    for (const sub of this.#subscribers) {
      sub.send('state', state);
    }
  }

  #emitProgress(evt: SseProgressEvent): void {
    for (const sub of this.#subscribers) {
      sub.send('progress', evt);
    }
  }

  #emitLog(level: LogLevel, message: string): void {
    const evt: SseLogEvent = { level, message, timestamp: Temporal.Now.instant().toString() };
    this.#recentLogs.push(evt);
    if (this.#recentLogs.length > MAX_RECENT_LOGS) {
      this.#recentLogs.shift();
    }
    for (const sub of this.#subscribers) {
      sub.send('log', evt);
    }
  }

  async #persistQueue(): Promise<void> {
    const writeTask = async (): Promise<void> => {
      await fs.mkdir(this.#config.configDir, { recursive: true });
      const queuePath = path.join(this.#config.configDir, 'queue.json');
      const tmpPath = `${queuePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(
        tmpPath,
        JSON.stringify({ revision: this.#revision, items: this.#items }, null, 2),
        'utf8'
      );
      await fs.rename(tmpPath, queuePath);
    };
    const next = this.#persistChain.then(writeTask, writeTask);
    this.#persistChain = next;
    return next;
  }

  #assertLockOwner(clientId: ClientId): void {
    if (this.#lockOwnerClientId !== null && this.#lockOwnerClientId !== clientId) {
      throw new LockConflictError(
        'LOCK_HELD',
        `Queue is locked by client ${this.#lockOwnerClientId}`
      );
    }
  }

  #assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.#revision) {
      throw new LockConflictError(
        'STALE_REVISION',
        `Stale revision ${String(expectedRevision)}; current is ${String(this.#revision)}`
      );
    }
  }

  #trackActiveRun(runPromise: Promise<void>): void {
    const tracked = runPromise.finally(() => {
      if (this.#activeRunPromise === tracked) {
        this.#activeRunPromise = null;
      }
    });
    this.#activeRunPromise = tracked;
  }

  #removeMovedItems(movedItems: readonly ScannedItem[]): void {
    if (movedItems.length === 0) {
      return;
    }
    const movedIds = new Set(movedItems.map((m) => m.id));
    this.#items = this.#items.filter((item): boolean => !movedIds.has(item.id));
  }

  public startScan(clientId: ClientId): number {
    this.#assertLockOwner(clientId);
    if (this.#phase === 'SCANNING' || this.#phase === 'PROCESSING') {
      throw new LockConflictError('LOCK_HELD', `Operation already in progress (${this.#phase})`);
    }
    this.#lockOwnerClientId = clientId;
    this.#cancelledByUnlock = false;
    this.#phase = 'SCANNING';
    this.#lastError = null;
    this.#activeJob = {
      jobId: asJobId('scan'),
      totalItems: 0,
      completedItems: 0,
      currentPercent: 0
    };
    this.#revision += 1;
    this.#emitState();

    this.#trackActiveRun(this.#executeScan());
    return this.#revision;
  }

  async #executeScan(): Promise<void> {
    const scanJobId = asJobId('scan');
    const lookupCache = new Map<string, readonly MetadataCandidate[]>();
    try {
      this.#emitLog('info', `Scanning ${this.#config.inputDir}...`);
      const rawScanned = await scanInputDirectory(
        this.#config.inputDir,
        probeMedia,
        () => this.#cancelledByUnlock
      );
      if (this.#cancelledByUnlock) {
        this.#items = [...rawScanned];
        return;
      }
      const scanStartedAtMs = performance.now();
      const scanned = await enrichItemsWithAudioAnalysis(
        rawScanned,
        this.#config.configDir,
        (filePath, streamOrder, durationSeconds, onProgress) =>
          analyzeAudioVolume(
            filePath,
            streamOrder,
            durationSeconds,
            onProgress,
            this.#createChildTracker()
          ),
        (completed, total, item, overallFraction): void => {
          if (this.#cancelledByUnlock) {
            return;
          }
          const effectiveFraction = overallFraction ?? (total > 0 ? completed / total : 1);
          const percent = Math.min(PERCENT_MAX, Math.round(effectiveFraction * PERCENT_MAX));
          const elapsedSec = (performance.now() - scanStartedAtMs) / 1000;
          const etaSeconds =
            effectiveFraction > 0.01 && completed < total && elapsedSec >= 1
              ? Math.max(0, Math.round((elapsedSec * (1 - effectiveFraction)) / effectiveFraction))
              : undefined;
          this.#activeJob = {
            jobId: scanJobId,
            totalItems: total,
            completedItems: completed,
            currentItemId: item.id,
            currentPercent: percent,
            stage: 'scanning',
            stageLabel: `Analyzing audio (${String(completed)}/${String(total)}): ${item.fileName}`,
            etaSeconds
          };
          this.#emitProgress({
            jobId: scanJobId,
            itemId: item.id,
            totalItems: total,
            completedItems: completed,
            percent,
            stage: 'scanning',
            stageLabel: `Analyzing audio (${String(completed)}/${String(total)})`,
            etaSeconds
          });
        },
        () => this.#cancelledByUnlock
      );
      if (this.#cancelledByUnlock) {
        this.#items = [...scanned];
        return;
      }
      const enriched: ScannedItem[] = [];
      const reportedDiagnostics = new Set<string>();
      this.#activeJob = {
        jobId: scanJobId,
        totalItems: scanned.length,
        completedItems: 0,
        currentPercent: 0
      };
      this.#emitState();

      for (const item of scanned) {
        if (this.#cancelledByUnlock) {
          break;
        }
        const startPercent =
          scanned.length > 0 ? Math.round((enriched.length / scanned.length) * PERCENT_MAX) : 0;
        this.#activeJob = {
          jobId: scanJobId,
          totalItems: scanned.length,
          completedItems: enriched.length,
          currentItemId: item.id,
          currentPercent: startPercent
        };
        this.#emitProgress({
          jobId: scanJobId,
          itemId: item.id,
          percent: startPercent
        });

        let candidates = [...item.candidates];
        let selectedMetadata = item.selectedMetadata;
        let episode = item.episode;
        const itemDiagnostics: MetadataDiagnostic[] = [];
        const lookupOptions: MetadataLookupOptions = {
          preferredLanguages: this.#preferredLanguages,
          onLog: (level, message) => this.#emitLog(level, message),
          onDiagnostic: (diagnostic) => {
            itemDiagnostics.push(diagnostic);
            const dedupKey = `${diagnostic.provider}:${diagnostic.kind}`;
            if (!reportedDiagnostics.has(dedupKey)) {
              reportedDiagnostics.add(dedupKey);
              this.#emitLog('error', diagnostic.message);
            }
          }
        };

        const lookupKey = `${item.mediaKind}:${item.parsedTitle.toLowerCase()}:${String(item.parsedYear ?? '')}`;
        let fetched = lookupCache.get(lookupKey);
        if (fetched === undefined) {
          fetched =
            item.mediaKind === 'movie'
              ? await searchMovies(
                  item.parsedTitle,
                  item.parsedYear,
                  this.#config.omdbApiKey,
                  fetch,
                  lookupOptions
                )
              : await searchTvShows(
                  item.parsedTitle,
                  this.#config.tvdbApiKey,
                  fetch,
                  lookupOptions
                );
          if (fetched.length > 0 || itemDiagnostics.length === 0) {
            lookupCache.set(lookupKey, fetched);
          }
        }

        candidates = [...candidates, ...fetched];
        selectedMetadata ??= candidates[0];
        if (item.mediaKind === 'tv' && selectedMetadata?.tvdbId && episode) {
          episode = await this.#enrichEpisodeTitle(
            selectedMetadata.tvdbId,
            item.episodeOrder,
            episode,
            lookupOptions
          );
        }

        const warnings = [...item.warnings];
        if (candidates.length === 0) {
          for (const diag of itemDiagnostics.filter((d) => !warnings.includes(d.message))) {
            warnings.push(diag.message);
          }
        }
        if (item.mediaKind === 'tv' && selectedMetadata && !selectedMetadata.tvdbId) {
          warnings.push(
            'TVmaze did not provide a TVDB ID; {tvdb-...} will be omitted unless entered manually.'
          );
        }

        if (this.#cancelledByUnlock) {
          break;
        }
        enriched.push({
          ...item,
          category: resolveCategoryFromMetadata(item.mediaKind, selectedMetadata, item.category),
          episode,
          candidates,
          selectedMetadata,
          warnings
        });

        const donePercent =
          scanned.length > 0
            ? Math.round((enriched.length / scanned.length) * PERCENT_MAX)
            : PERCENT_MAX;
        this.#activeJob = {
          jobId: scanJobId,
          totalItems: scanned.length,
          completedItems: enriched.length,
          currentItemId: item.id,
          currentPercent: donePercent
        };
        this.#emitProgress({
          jobId: scanJobId,
          itemId: item.id,
          percent: donePercent
        });
      }

      if (this.#cancelledByUnlock) {
        this.#items = [...enriched];
        return;
      }

      this.#activeJob = null;
      this.#lastError = null;
      this.#items = enriched;
      this.#phase = enriched.length > 0 ? 'READY' : 'IDLE';
      if (enriched.length === 0) {
        this.#lockOwnerClientId = null;
      }
      this.#revision += 1;
      await this.#persistQueue();
      this.#emitLog('info', `Scan completed: ${String(enriched.length)} media file(s) found.`);
      this.#emitState();
    } catch (err) {
      if (this.#cancelledByUnlock) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.#activeJob = null;
      this.#lastError = msg;
      this.#phase = 'ERROR';
      this.#revision += 1;
      this.#emitLog('error', `Scan failed: ${msg}`);
      this.#emitState();
    }
  }

  async #enrichEpisodeTitle(
    tvdbId: TvdbId,
    order: EpisodeOrderMode,
    episode: NonNullable<ScannedItem['episode']>,
    options?: MetadataLookupOptions
  ): Promise<NonNullable<ScannedItem['episode']>> {
    const epMap = await fetchEpisodeTitleMap(
      tvdbId,
      order,
      this.#config.tvdbApiKey,
      fetch,
      options
    );
    const title = epMap.get(`${String(episode.seasonNumber)}:${String(episode.episodeStart)}`);
    return title ? { ...episode, episodeTitle: title } : episode;
  }

  async #applyPatchToItem(
    current: ScannedItem,
    patch: ItemPatch,
    prefetchedEpisodeMap?: ReadonlyMap<string, string>
  ): Promise<ScannedItem> {
    let nextEpisode = current.episode;
    const nextMeta = patch.selectedMetadata ?? current.selectedMetadata;
    const nextOrder = patch.episodeOrder ?? current.episodeOrder;
    const nextKind = patch.mediaKind ?? current.mediaKind;

    if (
      nextKind === 'tv' &&
      nextMeta?.tvdbId &&
      nextEpisode &&
      (patch.selectedMetadata !== undefined || patch.episodeOrder !== undefined)
    ) {
      if (prefetchedEpisodeMap) {
        const title = prefetchedEpisodeMap.get(
          `${String(nextEpisode.seasonNumber)}:${String(nextEpisode.episodeStart)}`
        );
        nextEpisode = title ? { ...nextEpisode, episodeTitle: title } : nextEpisode;
      } else {
        nextEpisode = await this.#enrichEpisodeTitle(nextMeta.tvdbId, nextOrder, nextEpisode);
      }
    }

    let nextCandidates = current.candidates;
    if (patch.selectedMetadata) {
      const target = patch.selectedMetadata;
      const alreadyPresent = current.candidates.some(
        (c): boolean =>
          c.source === target.source &&
          c.title === target.title &&
          c.imdbId === target.imdbId &&
          c.tvdbId === target.tvdbId
      );
      if (!alreadyPresent) {
        nextCandidates = [target, ...current.candidates];
      }
    }

    const nextEdition =
      patch.edition !== undefined ? patch.edition.trim() || undefined : current.edition;

    const nextTrackSelection = patch.trackSelection ?? current.trackSelection;

    const nextCategory =
      patch.category ??
      (patch.selectedMetadata !== undefined || patch.mediaKind !== undefined
        ? resolveCategoryFromMetadata(nextKind, nextMeta, current.category)
        : current.category);

    return {
      ...current,
      mediaKind: nextKind,
      category: nextCategory,
      edition: nextEdition,
      include: patch.include ?? current.include,
      candidates: nextCandidates,
      selectedMetadata: nextMeta,
      episodeOrder: nextOrder,
      episode: nextEpisode,
      trackSelection: patch.audioNormalization
        ? { ...nextTrackSelection, audioNormalization: patch.audioNormalization }
        : nextTrackSelection
    };
  }

  public async patchItem(
    clientId: ClientId,
    revision: number,
    itemId: ItemId,
    patch: ItemPatch
  ): Promise<OrganizerStatePayload> {
    this.#assertLockOwner(clientId);
    this.#assertRevision(revision);

    const idx = this.#items.findIndex((i): boolean => i.id === itemId);
    if (idx < 0) {
      throw new Error(`Item not found: ${itemId}`);
    }

    this.#items[idx] = await this.#applyPatchToItem(this.#items[idx]!, patch);

    if (this.#phase === 'PREFLIGHT_BLOCKED') {
      this.#phase = 'READY';
    }
    this.#revision += 1;
    await this.#persistQueue();
    this.#emitState();
    return this.getState();
  }

  public async patchItemsBulk(
    clientId: ClientId,
    revision: number,
    itemIds: readonly ItemId[],
    patch: ItemPatch
  ): Promise<OrganizerStatePayload> {
    this.#assertLockOwner(clientId);
    this.#assertRevision(revision);

    const idSet = new Set(itemIds);
    if (idSet.size === 0) {
      throw new Error('Bulk patch requires at least one item ID.');
    }

    let prefetchedEpisodeMap: ReadonlyMap<string, string> | undefined;
    if (
      patch.selectedMetadata?.tvdbId &&
      this.#items.some(
        (i) => idSet.has(i.id) && (patch.mediaKind ?? i.mediaKind) === 'tv' && i.episode
      )
    ) {
      const order = patch.episodeOrder ?? 'aired';
      prefetchedEpisodeMap = await fetchEpisodeTitleMap(
        patch.selectedMetadata.tvdbId,
        order,
        this.#config.tvdbApiKey,
        fetch,
        { preferredLanguages: this.#preferredLanguages }
      );
    }

    let updatedCount = 0;
    const nextItems: ScannedItem[] = [];
    for (const current of this.#items) {
      if (!idSet.has(current.id)) {
        nextItems.push(current);
        continue;
      }
      nextItems.push(await this.#applyPatchToItem(current, patch, prefetchedEpisodeMap));
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      throw new Error('No matching queue items found for bulk patch.');
    }

    this.#items = nextItems;
    if (this.#phase === 'PREFLIGHT_BLOCKED') {
      this.#phase = 'READY';
    }
    this.#revision += 1;
    await this.#persistQueue();
    this.#emitLog('info', `Updated ${String(updatedCount)} queue item(s) in bulk.`);
    this.#emitState();
    return this.getState();
  }

  public async searchMetadata(
    clientId: ClientId,
    params: {
      readonly query: string;
      readonly year?: number;
      readonly kind: MediaKind;
      readonly imdbId?: string;
      readonly tvdbId?: string;
      readonly episodeOrder?: EpisodeOrderMode;
    }
  ): Promise<readonly MetadataCandidate[]> {
    this.#assertLockOwner(clientId);
    const lookupOptions: MetadataLookupOptions = {
      throwOnFailure: true,
      preferredLanguages: this.#preferredLanguages
    };
    const queryRef = parseProviderReference(params.query);
    const imdbRef = params.imdbId
      ? (parseProviderReference(params.imdbId).imdbId ?? params.imdbId)
      : queryRef.imdbId;
    const tvdbRef =
      (params.tvdbId
        ? (parseProviderReference(params.tvdbId).tvdbId ?? params.tvdbId.trim())
        : undefined) ?? queryRef.tvdbId;
    const tvmazeRef =
      (params.tvdbId ? parseProviderReference(params.tvdbId).tvmazeId : undefined) ??
      queryRef.tvmazeId;

    if (imdbRef) {
      const found = await lookupMovieByImdbId(
        imdbRef,
        this.#config.omdbApiKey,
        fetch,
        lookupOptions
      );
      return found ? [found] : [];
    }
    if (tvmazeRef) {
      const found = await lookupSeriesByTvmazeId(tvmazeRef, fetch, lookupOptions);
      return found ? [found] : [];
    }
    if (tvdbRef && /^\d+$/.test(tvdbRef)) {
      const found = await lookupSeriesByTvdbId(
        asTvdbId(tvdbRef),
        this.#config.tvdbApiKey,
        fetch,
        lookupOptions
      );
      return found ? [found] : [];
    }
    if (params.kind === 'movie') {
      return searchMovies(params.query, params.year, this.#config.omdbApiKey, fetch, lookupOptions);
    }
    return searchTvShows(params.query, this.#config.tvdbApiKey, fetch, lookupOptions);
  }

  public async preflight(
    clientId: ClientId,
    revision: number
  ): Promise<PreflightReport & { readonly revision: number }> {
    this.#assertLockOwner(clientId);
    this.#assertRevision(revision);

    const mountPaths = buildMountPathsMap(this.#config);
    const report = await runPreflightCheck(this.#items, mountPaths, probeMedia);

    this.#items = this.#items.map((item) => ({
      ...item,
      projectedDestination: report.projectedByItemId[item.id] ?? item.projectedDestination
    }));

    this.#phase = report.ok ? 'READY' : 'PREFLIGHT_BLOCKED';
    this.#revision += 1;
    await this.#persistQueue();
    this.#emitState();
    return { ...report, revision: this.#revision };
  }

  public async startJob(
    clientId: ClientId,
    revision: number,
    conflictResolutions: Readonly<Partial<Record<ItemId, ConflictDecision>>>
  ): Promise<{ readonly jobId: JobId; readonly revision: number }> {
    this.#assertLockOwner(clientId);
    this.#assertRevision(revision);

    for (const item of this.#items) {
      if (
        item.include &&
        (!item.selectedMetadata?.title.trim() || item.trackSelection.needsUserPrompt)
      ) {
        throw new Error(`Unresolved metadata or track prompt for ${item.fileName}`);
      }
    }

    const mountPaths = buildMountPathsMap(this.#config);
    const report = await runPreflightCheck(this.#items, mountPaths, probeMedia);
    const existingCollisionByItemId: Partial<Record<ItemId, string>> = {};
    for (const conflict of report.conflicts) {
      if (!Object.hasOwn(conflictResolutions, conflict.itemId)) {
        throw new Error(`Unresolved conflict for item ${conflict.itemId}`);
      }
      if (conflict.existingPath) {
        existingCollisionByItemId[conflict.itemId] = conflict.existingPath;
      }
    }

    const jobId = asJobId(crypto.randomUUID().slice(0, 8));
    this.#cancelledByUnlock = false;
    this.#phase = 'PROCESSING';
    this.#revision += 1;

    const toProcess = this.#items.filter(
      (item) => item.include && conflictResolutions[item.id] !== 'ignore'
    );
    this.#activeJob = {
      jobId,
      totalItems: toProcess.length,
      completedItems: 0,
      currentPercent: 0
    };
    this.#emitState();

    this.#trackActiveRun(
      this.#executeJob(
        jobId,
        toProcess,
        report.projectedByItemId,
        conflictResolutions,
        existingCollisionByItemId
      )
    );
    return { jobId, revision: this.#revision };
  }

  #createChildTracker(): (child: ChildProcess | null) => void {
    let tracked: ChildProcess | null = null;
    return (child): void => {
      if (tracked && tracked !== child) {
        this.#activeChildren.delete(tracked);
      }
      tracked = child;
      if (child) {
        this.#activeChildren.add(child);
      }
    };
  }

  async #measureLoudnormForItem(
    item: ScannedItem,
    downmixStereo: boolean,
    jobId: JobId,
    totalItems: number,
    completedItems: number
  ): Promise<ReadonlyMap<number, LoudnormMeasurements>> {
    this.#emitLog('info', `Measuring EBU R128 loudness (pass 1) for ${item.fileName}...`);
    const includedTracks = item.trackSelection.audioTracks.filter((t) => t.include);
    const measuredMap = new Map<number, LoudnormMeasurements>();
    if (includedTracks.length === 0) {
      return measuredMap;
    }

    const trackPercents = Array.from({ length: includedTracks.length }, (): number => 0);
    const trackEtas = Array.from<number | undefined>({ length: includedTracks.length });
    let completedTracks = 0;
    let nextTrackIdx = 0;

    const emitPass1Progress = (): void => {
      const sumPct = trackPercents.reduce((acc, p): number => acc + p, 0);
      const percent = Math.round(sumPct / includedTracks.length);
      const activeEtas = trackEtas.filter((eta): eta is number => eta !== undefined);
      const etaSeconds = activeEtas.length > 0 ? Math.max(...activeEtas) : undefined;
      const stageLabel = `Loudnorm Pass 1/2 (${String(completedTracks)}/${String(includedTracks.length)} tracks) · ${item.fileName}`;
      this.#activeJob = {
        jobId,
        totalItems,
        completedItems,
        currentItemId: item.id,
        currentPercent: percent,
        stage: 'remuxing',
        stageLabel,
        etaSeconds
      };
      this.#emitProgress({
        jobId,
        itemId: item.id,
        totalItems,
        completedItems,
        percent,
        stage: 'remuxing',
        stageLabel,
        etaSeconds
      });
    };

    const workerCount = Math.min(includedTracks.length, Math.max(1, os.cpus().length));
    const runWorker = async (): Promise<void> => {
      while (nextTrackIdx < includedTracks.length) {
        if (this.#cancelledByUnlock) {
          return;
        }
        const trackIdx = nextTrackIdx;
        nextTrackIdx += 1;
        const track = includedTracks[trackIdx]!;
        const measured = await measureLoudnormPass1(
          item.sourcePath,
          track.streamOrder,
          downmixStereo,
          item.probe.durationSeconds,
          (update): void => {
            trackPercents[trackIdx] = update.percent;
            trackEtas[trackIdx] = update.etaSeconds;
            emitPass1Progress();
          },
          this.#createChildTracker()
        );
        measuredMap.set(track.streamOrder, measured);
        completedTracks += 1;
        trackPercents[trackIdx] = PERCENT_MAX;
        trackEtas[trackIdx] = 0;
        emitPass1Progress();
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return measuredMap;
  }

  async #executeJob(
    jobId: JobId,
    toProcess: readonly ScannedItem[],
    projectedByItemId: Readonly<Partial<Record<ItemId, string>>>,
    conflictResolutions: Readonly<Partial<Record<ItemId, ConflictDecision>>>,
    existingCollisionByItemId: Readonly<Partial<Record<ItemId, string>>>
  ): Promise<void> {
    const movedItems: ScannedItem[] = [];
    const createdTempSubs: string[] = [];

    try {
      const purged = await purgeExpiredBackups(this.#config.backupDir);
      if (purged.removedFiles > 0) {
        this.#emitLog(
          'info',
          `Purged ${String(purged.removedFiles)} expired backup file(s) older than 7 days.`
        );
      }

      for (let idx = 0; idx < toProcess.length; idx += 1) {
        if (this.#cancelledByUnlock) {
          this.#removeMovedItems(movedItems);
          return;
        }
        const item = toProcess[idx]!;
        const destPath = projectedByItemId[item.id];
        if (!destPath) {
          throw new Error(`Missing projected destination for ${item.id}`);
        }

        const sourceDir = path.dirname(item.sourcePath);
        const baseNoExt = path.basename(item.sourcePath, path.extname(item.sourcePath));
        const tempMkvPath = path.join(
          sourceDir,
          `${baseNoExt}${ORGANIZING_TEMP_MARKER}${jobId}.${item.id}${ORGANIZING_TEMP_SUFFIX}`
        );

        const subInputs: {
          readonly sub: (typeof item.externalSubtitles)[number];
          readonly inputPath: string;
        }[] = [];
        for (const subPath of item.trackSelection.externalSubtitleOrder) {
          const subObj = item.externalSubtitles.find((s): boolean => s.path === subPath);
          if (!subObj) {
            continue;
          }
          const normalized = await normalizeSubtitleToUtf8(subObj, sourceDir);
          if (normalized.tempCreated) {
            createdTempSubs.push(normalized.tempCreated);
          }
          subInputs.push({ sub: subObj, inputPath: normalized.inputPath });
        }

        this.#activeJob = {
          jobId,
          totalItems: toProcess.length,
          completedItems: idx,
          currentItemId: item.id,
          currentPercent: 0,
          stage: 'remuxing',
          stageLabel: `Remuxing ${item.fileName}`
        };
        this.#emitState();
        this.#emitLog('info', `Remuxing ${item.fileName} -> ${path.basename(destPath)}`);

        const norm = item.trackSelection.audioNormalization;
        const loudnormByStreamOrder =
          norm?.mode === 'loudnorm'
            ? await this.#measureLoudnormForItem(
                item,
                norm.downmixStereo,
                jobId,
                toProcess.length,
                idx
              )
            : undefined;

        const remuxStageLabel =
          norm?.mode === 'loudnorm'
            ? `Loudnorm Pass 2/2 (Remuxing) · ${item.fileName}`
            : `Remuxing · ${item.fileName}`;
        const args = buildFfmpegRemuxArgs(item, tempMkvPath, subInputs, loudnormByStreamOrder);
        await runFfmpegRemux(
          args,
          item.probe.durationSeconds,
          (percent, etaSeconds): void => {
            this.#activeJob = {
              jobId,
              totalItems: toProcess.length,
              completedItems: idx,
              currentItemId: item.id,
              currentPercent: percent,
              stage: 'remuxing',
              stageLabel: remuxStageLabel,
              etaSeconds
            };
            this.#emitProgress({
              jobId,
              itemId: item.id,
              totalItems: toProcess.length,
              completedItems: idx,
              percent,
              stage: 'remuxing',
              stageLabel: remuxStageLabel,
              etaSeconds
            });
          },
          this.#createChildTracker()
        );

        if (this.#cancelledByUnlock) {
          this.#removeMovedItems(movedItems);
          return;
        }

        this.#activeJob = {
          jobId,
          totalItems: toProcess.length,
          completedItems: idx,
          currentItemId: item.id,
          currentPercent: 0,
          stage: 'verifying',
          stageLabel: `Verifying ${path.basename(destPath)}`
        };
        this.#emitProgress({
          jobId,
          itemId: item.id,
          totalItems: toProcess.length,
          completedItems: idx,
          percent: 0,
          stage: 'verifying',
          stageLabel: `Verifying ${path.basename(destPath)}`
        });
        await probeMedia(tempMkvPath);

        this.#activeJob = {
          jobId,
          totalItems: toProcess.length,
          completedItems: idx,
          currentItemId: item.id,
          currentPercent: 0,
          stage: 'moving',
          stageLabel: `Moving ${path.basename(destPath)}`
        };
        this.#emitProgress({
          jobId,
          itemId: item.id,
          totalItems: toProcess.length,
          completedItems: idx,
          percent: 0,
          stage: 'moving',
          stageLabel: `Moving ${path.basename(destPath)}`
        });
        this.#emitLog('info', `Moving ${path.basename(destPath)} to ${item.category}`);

        const allowOverwrite = conflictResolutions[item.id] === 'overwrite';
        await moveTempOutputFile(tempMkvPath, destPath, allowOverwrite, (movePercent): void => {
          this.#activeJob = {
            jobId,
            totalItems: toProcess.length,
            completedItems: idx,
            currentItemId: item.id,
            currentPercent: movePercent,
            stage: 'moving',
            stageLabel: `Moving ${path.basename(destPath)}`
          };
          this.#emitProgress({
            jobId,
            itemId: item.id,
            totalItems: toProcess.length,
            completedItems: idx,
            percent: movePercent,
            stage: 'moving',
            stageLabel: `Moving ${path.basename(destPath)}`
          });
        });

        const oldExistingPath = existingCollisionByItemId[item.id];
        if (allowOverwrite && oldExistingPath && oldExistingPath !== destPath) {
          await fs.rm(oldExistingPath, { force: true });
        }

        movedItems.push(item);
        this.#activeJob = {
          jobId,
          totalItems: toProcess.length,
          completedItems: idx + 1,
          currentItemId: item.id,
          currentPercent: PERCENT_MAX,
          stage: 'moving',
          stageLabel: `Moved ${path.basename(destPath)}`
        };
        this.#emitProgress({
          jobId,
          itemId: item.id,
          totalItems: toProcess.length,
          completedItems: idx + 1,
          percent: PERCENT_MAX,
          stage: 'moving',
          stageLabel: `Moved ${path.basename(destPath)}`
        });
      }

      if (this.#cancelledByUnlock) {
        this.#removeMovedItems(movedItems);
        return;
      }

      this.#emitLog(
        'info',
        `Backing up & cleaning up ${String(movedItems.length)} processed source item(s)...`
      );
      await backupAndCleanupAfterJob(
        movedItems,
        this.#config.inputDir,
        this.#config.backupDir,
        (cleaned, total, fileName): void => {
          const cleanPercent =
            total > 0 ? Math.round((cleaned / total) * PERCENT_MAX) : PERCENT_MAX;
          this.#activeJob = {
            jobId,
            totalItems: total,
            completedItems: cleaned,
            currentPercent: cleanPercent,
            stage: 'cleanup',
            stageLabel: `Cleaning up ${fileName}`
          };
          this.#emitProgress({
            jobId,
            totalItems: total,
            completedItems: cleaned,
            percent: cleanPercent,
            stage: 'cleanup',
            stageLabel: `Cleaning up ${fileName}`
          });
        }
      );
      this.#removeMovedItems(movedItems);
      this.#activeJob = null;
      this.#phase = 'IDLE';
      this.#lockOwnerClientId = null;
      this.#revision += 1;
      await this.#persistQueue();
      this.#emitLog(
        'info',
        `Job ${jobId} completed: ${String(movedItems.length)} file(s) organized.`
      );
      this.#emitState();
    } catch (err) {
      if (this.#cancelledByUnlock) {
        this.#removeMovedItems(movedItems);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.#phase = 'ERROR';
      this.#activeJob = null;
      this.#revision += 1;
      await cleanupOrphanTempFiles(this.#config.inputDir);
      this.#emitLog('error', `Job ${jobId} failed: ${msg}`);
      this.#emitState();
    } finally {
      for (const tempSub of createdTempSubs) {
        await fs.rm(tempSub, { force: true });
      }
    }
  }

  public async unlock(clientId: ClientId, force: boolean): Promise<OrganizerStatePayload> {
    if (!force) {
      this.#assertLockOwner(clientId);
    }
    const wasRunning = this.#phase === 'SCANNING' || this.#phase === 'PROCESSING';
    this.#cancelledByUnlock = true;
    for (const child of this.#activeChildren) {
      child.kill('SIGKILL');
    }
    this.#activeChildren.clear();
    if (this.#activeRunPromise) {
      await this.#activeRunPromise;
    }
    await cleanupOrphanTempFiles(this.#config.inputDir);
    this.#lockOwnerClientId = null;
    this.#activeJob = null;
    this.#phase = wasRunning && this.#items.length > 0 ? 'READY' : 'IDLE';
    this.#revision += 1;
    await this.#persistQueue();
    this.#emitLog('warn', `Session unlocked${force ? ' (forced)' : ''} by ${clientId}.`);
    this.#emitState();
    return this.getState();
  }

  public startVerifierScan(clientId: ClientId): number {
    this.#assertLockOwner(clientId);
    if (this.#verifier.scanning || this.#verifier.fixing) {
      throw new LockConflictError('LOCK_HELD', 'Library verifier is already running.');
    }
    this.#verifier = {
      ...this.#verifier,
      scanning: true,
      progress: {
        completed: 0,
        total: 0,
        percent: 0,
        stageLabel: 'Discovering libraries...'
      },
      lastFixResult: null
    };
    this.#revision += 1;
    this.#emitLog('info', 'Starting Plex naming compliance scan across all libraries...');
    this.#emitState();
    void this.#runVerifierScan();
    return this.#revision;
  }

  async #runVerifierScan(): Promise<void> {
    try {
      const result = await scanLibrariesForCompliance(
        this.#config,
        (level, message): void => {
          this.#emitLog(level, message);
        },
        undefined,
        (progress): void => {
          this.#verifier = {
            ...this.#verifier,
            progress
          };
          this.#emitState();
        },
        this.#preferredLanguages
      );
      this.#verifier = {
        scanning: false,
        fixing: false,
        progress: null,
        summary: result.summary,
        entries: result.entries,
        lastFixResult: null
      };
      this.#revision += 1;
      this.#emitLog(
        'info',
        `Verifier scan complete: ${String(result.summary.issueCount)} issue(s) across ${String(result.summary.totalRootsAnalyzed)} folder(s) and ${String(result.summary.totalFilesAnalyzed)} file(s).`
      );
      this.#emitState();
    } catch (err) {
      this.#failVerifierOperation('scan', err);
    }
  }

  public startVerifierFix(clientId: ClientId, entryIds: readonly VerifierEntryId[]): number {
    this.#assertLockOwner(clientId);
    if (this.#verifier.scanning || this.#verifier.fixing) {
      throw new LockConflictError('LOCK_HELD', 'Library verifier is already running.');
    }
    const idSet = new Set(entryIds);
    const selected = this.#verifier.entries.filter((entry): boolean => idSet.has(entry.id));
    if (selected.length === 0) {
      throw new Error('No matching verifier entries selected.');
    }
    this.#verifier = {
      ...this.#verifier,
      fixing: true,
      progress: {
        completed: 0,
        total: selected.length,
        percent: 0,
        stageLabel: 'Applying bottom-up renames...'
      },
      lastFixResult: null
    };
    this.#revision += 1;
    this.#emitLog(
      'info',
      `Applying bottom-up Plex renames for ${String(selected.length)} selected item(s)...`
    );
    this.#emitState();
    void this.#runVerifierFix(selected);
    return this.#revision;
  }

  async #runVerifierFix(selected: readonly VerifierEntry[]): Promise<void> {
    try {
      const fixResult = await applyVerifierRenames(
        this.#config,
        selected,
        (level, message): void => {
          this.#emitLog(level, message);
        },
        (progress): void => {
          this.#verifier = {
            ...this.#verifier,
            progress
          };
          this.#emitState();
        }
      );
      this.#emitLog(
        fixResult.failures.length > 0 ? 'warn' : 'info',
        `Verifier fix finished: ${String(fixResult.fixedEntries)}/${String(selected.length)} fixed (${String(fixResult.renamedSteps)} rename steps).`
      );
      const rescan = await scanLibrariesForCompliance(
        this.#config,
        (level, message): void => {
          this.#emitLog(level, message);
        },
        undefined,
        (progress): void => {
          this.#verifier = {
            ...this.#verifier,
            progress: {
              ...progress,
              stageLabel: `Re-verifying · ${progress.stageLabel}`
            }
          };
          this.#emitState();
        },
        this.#preferredLanguages
      );
      this.#verifier = {
        scanning: false,
        fixing: false,
        progress: null,
        summary: rescan.summary,
        entries: rescan.entries,
        lastFixResult: {
          renamedFiles: fixResult.renamedFiles,
          renamedDirs: fixResult.renamedDirs,
          errors: fixResult.failures.map((f): string => `${f.currentRootName}: ${f.error}`)
        }
      };
      this.#revision += 1;
      this.#emitState();
    } catch (err) {
      this.#failVerifierOperation('fix', err);
    }
  }

  #failVerifierOperation(operation: 'scan' | 'fix', err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.#verifier = {
      ...this.#verifier,
      scanning: false,
      fixing: false,
      progress: null,
      lastFixResult: { renamedFiles: 0, renamedDirs: 0, errors: [msg] }
    };
    this.#revision += 1;
    this.#emitLog('error', `Verifier ${operation} failed: ${msg}`);
    this.#emitState();
  }
}
