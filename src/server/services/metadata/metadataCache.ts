import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { METADATA_CACHE_TTL_MS, isPermissionOrReadOnlyError } from '../../../domain/constants.ts';
import type { MetadataCandidate } from '../../../domain/types.ts';
import { isDirUnwritable } from '../fileMover.ts';

export type MetadataCacheBucket =
  | 'movieSearch'
  | 'movieById'
  | 'tvSearch'
  | 'seriesById'
  | 'episodeMaps';

interface CacheEnvelope<T> {
  readonly value: T;
  readonly expiresAt: number;
}

type SerializedBucket<T> = readonly (readonly [string, CacheEnvelope<T>])[];

interface SerializedMetadataCache {
  readonly version: 2;
  readonly movieSearch: SerializedBucket<readonly MetadataCandidate[]>;
  readonly movieById: SerializedBucket<MetadataCandidate>;
  readonly tvSearch: SerializedBucket<readonly MetadataCandidate[]>;
  readonly seriesById: SerializedBucket<MetadataCandidate>;
  readonly episodeMaps: SerializedBucket<readonly (readonly [string, string])[]>;
}

interface BucketValueMap {
  readonly movieSearch: readonly MetadataCandidate[];
  readonly movieById: MetadataCandidate;
  readonly tvSearch: readonly MetadataCandidate[];
  readonly seriesById: MetadataCandidate;
  readonly episodeMaps: readonly (readonly [string, string])[];
}

const CACHE_FILENAME = 'metadata-cache.json';
const CACHE_VERSION = 2;
const PERSIST_DEBOUNCE_MS = 250;

let configuredCachePath: string | undefined;
let persistChain: Promise<void> = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let permissionWarned = false;

const memoryCache: {
  movieSearch: Map<string, CacheEnvelope<readonly MetadataCandidate[]>>;
  movieById: Map<string, CacheEnvelope<MetadataCandidate>>;
  tvSearch: Map<string, CacheEnvelope<readonly MetadataCandidate[]>>;
  seriesById: Map<string, CacheEnvelope<MetadataCandidate>>;
  episodeMaps: Map<string, CacheEnvelope<readonly (readonly [string, string])[]>>;
} = {
  movieSearch: new Map(),
  movieById: new Map(),
  tvSearch: new Map(),
  seriesById: new Map(),
  episodeMaps: new Map()
};

function clearAllBuckets(): void {
  memoryCache.movieSearch.clear();
  memoryCache.movieById.clear();
  memoryCache.tvSearch.clear();
  memoryCache.seriesById.clear();
  memoryCache.episodeMaps.clear();
}

function hydrateBucket<T>(
  target: Map<string, CacheEnvelope<T>>,
  raw: unknown,
  nowMs: number
): void {
  if (!Array.isArray(raw)) {
    return;
  }
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 2) {
      continue;
    }
    const key: unknown = item[0];
    const entry: unknown = item[1];
    if (typeof key !== 'string' || !entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Partial<CacheEnvelope<T>>;
    if (
      typeof candidate.expiresAt === 'number' &&
      candidate.expiresAt > nowMs &&
      candidate.value !== undefined
    ) {
      target.set(key, { value: candidate.value, expiresAt: candidate.expiresAt });
    }
  }
}

function serializeBucket<T>(
  source: ReadonlyMap<string, CacheEnvelope<T>>,
  nowMs: number
): SerializedBucket<T> {
  const out: [string, CacheEnvelope<T>][] = [];
  for (const [key, entry] of source.entries()) {
    if (entry.expiresAt > nowMs) {
      out.push([key, entry]);
    }
  }
  return out;
}

function getFallbackCachePath(): string {
  return path.join(os.tmpdir(), `plex-video-organizer-${CACHE_FILENAME}`);
}

function warnFallbackOnce(primaryPath: string, fallbackPath: string): void {
  if (permissionWarned) {
    return;
  }
  permissionWarned = true;
  const uid = process.getuid?.() ?? 'unknown';
  const gid = process.getgid?.() ?? 'unknown';
  console.warn(
    `Metadata cache directory is not writable (${path.dirname(primaryPath)} for uid=${String(uid)} gid=${String(gid)}). Falling back to ${fallbackPath}.`
  );
}

async function tryHydrateCacheFile(
  targetPath: string
): Promise<{ readonly ok: boolean; readonly permissionOrReadOnly: boolean }> {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SerializedMetadataCache>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION) {
      return { ok: true, permissionOrReadOnly: false };
    }
    const nowMs = Temporal.Now.instant().epochMilliseconds;
    hydrateBucket(memoryCache.movieSearch, parsed.movieSearch, nowMs);
    hydrateBucket(memoryCache.movieById, parsed.movieById, nowMs);
    hydrateBucket(memoryCache.tvSearch, parsed.tvSearch, nowMs);
    hydrateBucket(memoryCache.seriesById, parsed.seriesById, nowMs);
    hydrateBucket(memoryCache.episodeMaps, parsed.episodeMaps, nowMs);
    return { ok: true, permissionOrReadOnly: false };
  } catch (err) {
    return { ok: false, permissionOrReadOnly: isPermissionOrReadOnlyError(err) };
  }
}

async function writeCacheAtomically(targetPath: string, payloadJson: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, payloadJson, 'utf8');
  await fs.rename(tmpPath, targetPath);
}

async function flushPersist(): Promise<void> {
  const targetPath = configuredCachePath;
  if (!targetPath) {
    return;
  }
  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const payload: SerializedMetadataCache = {
    version: CACHE_VERSION,
    movieSearch: serializeBucket(memoryCache.movieSearch, nowMs),
    movieById: serializeBucket(memoryCache.movieById, nowMs),
    tvSearch: serializeBucket(memoryCache.tvSearch, nowMs),
    seriesById: serializeBucket(memoryCache.seriesById, nowMs),
    episodeMaps: serializeBucket(memoryCache.episodeMaps, nowMs)
  };
  const payloadJson = JSON.stringify(payload, null, 2);

  try {
    await writeCacheAtomically(targetPath, payloadJson);
  } catch (err) {
    const fallbackPath = getFallbackCachePath();
    if (isPermissionOrReadOnlyError(err) && targetPath !== fallbackPath) {
      warnFallbackOnce(targetPath, fallbackPath);
      configuredCachePath = fallbackPath;
      try {
        await writeCacheAtomically(fallbackPath, payloadJson);
      } catch (fallbackErr) {
        console.warn('Metadata cache fallback persistence failed:', fallbackErr);
      }
      return;
    }
    console.warn('Metadata cache persistence failed:', err);
  }
}

function schedulePersist(): void {
  if (!configuredCachePath) {
    return;
  }
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistChain = persistChain.then(() => flushPersist());
  }, PERSIST_DEBOUNCE_MS);
}

/** Configures persistent disk caching in `configDir` and loads valid cached entries. */
export async function configureMetadataCache(configDir: string): Promise<void> {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    persistChain = persistChain.then(() => flushPersist());
  }
  await persistChain;
  permissionWarned = false;
  const primaryPath = path.join(configDir, CACHE_FILENAME);
  const fallbackPath = getFallbackCachePath();
  configuredCachePath = primaryPath;
  clearAllBuckets();

  if ((await isDirUnwritable(configDir)) && primaryPath !== fallbackPath) {
    warnFallbackOnce(primaryPath, fallbackPath);
    configuredCachePath = fallbackPath;
    const loadedFallback = await tryHydrateCacheFile(fallbackPath);
    if (!loadedFallback.ok) {
      await tryHydrateCacheFile(primaryPath);
    }
    return;
  }

  const loadedPrimary = await tryHydrateCacheFile(primaryPath);
  if (!loadedPrimary.ok) {
    if (loadedPrimary.permissionOrReadOnly && primaryPath !== fallbackPath) {
      warnFallbackOnce(primaryPath, fallbackPath);
      configuredCachePath = fallbackPath;
    }
    await tryHydrateCacheFile(fallbackPath);
  }
}

/** Reads a non-expired cached entry from memory/disk store. */
export function getCachedMetadata<K extends MetadataCacheBucket>(
  bucket: K,
  key: string
): BucketValueMap[K] | undefined {
  const map = memoryCache[bucket] as Map<string, CacheEnvelope<BucketValueMap[K]>>;
  const entry = map.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Temporal.Now.instant().epochMilliseconds) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

/** Stores a metadata result with TTL and schedules atomic disk persistence if configured. */
export function setCachedMetadata<K extends MetadataCacheBucket>(
  bucket: K,
  key: string,
  value: BucketValueMap[K],
  ttlMs = METADATA_CACHE_TTL_MS
): void {
  const map = memoryCache[bucket] as Map<string, CacheEnvelope<BucketValueMap[K]>>;
  map.set(key, { value, expiresAt: Temporal.Now.instant().epochMilliseconds + ttlMs });
  schedulePersist();
}
