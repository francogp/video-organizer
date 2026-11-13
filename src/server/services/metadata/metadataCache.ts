import { promises as fs } from 'node:fs';
import path from 'node:path';

import { METADATA_CACHE_TTL_MS } from '../../../domain/constants.ts';
import type { MetadataCandidate } from '../../../domain/types.ts';

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

let configuredCachePath: string | undefined;
let persistChain: Promise<void> = Promise.resolve();

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

function schedulePersist(): void {
  const targetPath = configuredCachePath;
  if (!targetPath) {
    return;
  }
  persistChain = persistChain.then(async () => {
    try {
      const nowMs = Temporal.Now.instant().epochMilliseconds;
      const payload: SerializedMetadataCache = {
        version: CACHE_VERSION,
        movieSearch: serializeBucket(memoryCache.movieSearch, nowMs),
        movieById: serializeBucket(memoryCache.movieById, nowMs),
        tvSearch: serializeBucket(memoryCache.tvSearch, nowMs),
        seriesById: serializeBucket(memoryCache.seriesById, nowMs),
        episodeMaps: serializeBucket(memoryCache.episodeMaps, nowMs)
      };
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const tmpPath = `${targetPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      console.warn('Metadata cache persistence failed:', err);
    }
  });
}

/** Configures persistent disk caching in `configDir` and loads valid cached entries. */
export async function configureMetadataCache(configDir: string): Promise<void> {
  await persistChain;
  configuredCachePath = path.join(configDir, CACHE_FILENAME);
  clearAllBuckets();
  try {
    const raw = await fs.readFile(configuredCachePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SerializedMetadataCache>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION) {
      return;
    }
    const nowMs = Temporal.Now.instant().epochMilliseconds;
    hydrateBucket(memoryCache.movieSearch, parsed.movieSearch, nowMs);
    hydrateBucket(memoryCache.movieById, parsed.movieById, nowMs);
    hydrateBucket(memoryCache.tvSearch, parsed.tvSearch, nowMs);
    hydrateBucket(memoryCache.seriesById, parsed.seriesById, nowMs);
    hydrateBucket(memoryCache.episodeMaps, parsed.episodeMaps, nowMs);
  } catch {
    // Missing or corrupt cache file starts clean
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
