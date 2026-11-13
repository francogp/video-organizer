import { IMDB_MIN_INTERVAL_MS } from '../../../domain/constants.ts';
import {
  asImdbId,
  type MetadataCandidate,
  type MetadataLookupOptions
} from '../../../domain/types.ts';
import {
  BaseMetadataProvider,
  hasAnimationMetadata,
  MetadataProviderError
} from './baseMetadataProvider.ts';

const MAX_CANDIDATES = 8;

/** IMDb public suggestion endpoint client and parser. */
class ImdbSuggestionProvider extends BaseMetadataProvider {
  public constructor() {
    super({
      providerId: 'imdb',
      displayName: 'IMDb Suggestions',
      parserFile: 'src/server/services/metadata/imdbClient.ts',
      rateLimit: { kind: 'interval', minIntervalMs: IMDB_MIN_INTERVAL_MS }
    });
  }

  public async search(
    query: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<readonly MetadataCandidate[]> {
    const normalized = query.toLowerCase().replaceAll(/[^a-z0-9]/g, '_');
    const firstChar = normalized[0] ?? 'a';
    const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(query)}.json`;
    return this.fetchAndParse(url, undefined, (raw) => this.#parseSearch(raw), fetchImpl, {
      onLog
    });
  }

  #parseSearch(raw: unknown): MetadataCandidate[] {
    const record = this.assertRecord(raw, 'IMDb suggestion root');
    if (record.d === undefined) {
      if (typeof record.v === 'number' || typeof record.q === 'string') {
        return [];
      }
      throw this.schemaError('missing "d" array and IMDb suggestion envelope fields');
    }

    const items = this.assertArray(record.d, 'IMDb suggestion "d"');
    const candidates: MetadataCandidate[] = [];
    const seenIds = new Set<string>();
    let recognizedShapeCount = 0;

    for (const rawItem of items) {
      const item = this.assertRecord(rawItem, 'IMDb suggestion item');
      if (typeof item.id === 'string' && typeof item.l === 'string') {
        recognizedShapeCount += 1;
      }
      const id = typeof item.id === 'string' ? item.id : undefined;
      const title = typeof item.l === 'string' ? item.l : undefined;
      const qid = typeof item.qid === 'string' ? item.qid : undefined;
      const year = typeof item.y === 'number' ? item.y : undefined;

      if (!id?.startsWith('tt') || !title) {
        continue;
      }
      if (qid && qid !== 'movie' && qid !== 'tvMovie') {
        continue;
      }
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      candidates.push({
        title,
        year,
        imdbId: asImdbId(id),
        source: 'imdb'
      });
      if (candidates.length >= MAX_CANDIDATES) {
        break;
      }
    }

    if (items.length > 0 && recognizedShapeCount === 0) {
      throw this.schemaError('IMDb suggestion items missing "id" and "l" fields');
    }
    return candidates;
  }
}

/** OMDb API client and parser for movie search and direct IMDb ID lookup. */
class OmdbProvider extends BaseMetadataProvider {
  public constructor() {
    super({
      providerId: 'omdb',
      displayName: 'OMDb API',
      parserFile: 'src/server/services/metadata/imdbClient.ts',
      rateLimit: { kind: 'interval', minIntervalMs: IMDB_MIN_INTERVAL_MS }
    });
  }

  public async search(
    query: string,
    year: number | undefined,
    omdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<readonly MetadataCandidate[]> {
    const yearParam = year ? `&y=${String(year)}` : '';
    const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbApiKey)}&s=${encodeURIComponent(query)}&type=movie${yearParam}`;
    return this.fetchAndParse(url, undefined, (raw) => this.#parseSearch(raw), fetchImpl, {
      onLog
    });
  }

  public async lookupById(
    imdbId: string,
    omdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<MetadataCandidate | undefined> {
    const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbApiKey)}&i=${encodeURIComponent(imdbId)}`;
    return this.fetchAndParse(url, undefined, (raw) => this.#parseById(raw, imdbId), fetchImpl, {
      onLog
    });
  }

  #parseSearch(raw: unknown): MetadataCandidate[] {
    const record = this.assertRecord(raw, 'OMDb search root');
    if (record.Response !== 'True' && record.Response !== 'False') {
      throw this.schemaError('missing OMDb "Response" field ("True" | "False")');
    }
    if (record.Response === 'False') {
      return [];
    }
    const items = this.assertArray(record.Search, 'OMDb "Search"');
    const out: MetadataCandidate[] = [];
    const seen = new Set<string>();

    for (const rawItem of items) {
      const item = this.assertRecord(rawItem, 'OMDb search item');
      const imdbId = typeof item.imdbID === 'string' ? item.imdbID : undefined;
      const title = typeof item.Title === 'string' ? item.Title : undefined;
      const rawYear = typeof item.Year === 'string' ? item.Year : undefined;
      if (!imdbId || !title || seen.has(imdbId)) {
        continue;
      }
      seen.add(imdbId);
      const parsedYear = rawYear ? Number.parseInt(rawYear, 10) : undefined;
      out.push({
        title,
        year: Number.isInteger(parsedYear) ? parsedYear : undefined,
        imdbId: asImdbId(imdbId),
        source: 'omdb'
      });
      if (out.length >= MAX_CANDIDATES) {
        break;
      }
    }
    return out;
  }

  #parseById(raw: unknown, cleanId: string): MetadataCandidate | undefined {
    const record = this.assertRecord(raw, 'OMDb lookup root');
    if (record.Response !== 'True' && record.Response !== 'False') {
      throw this.schemaError('missing OMDb "Response" field ("True" | "False")');
    }
    if (record.Response !== 'True') {
      return undefined;
    }
    if (typeof record.Title !== 'string' || !record.Title) {
      throw this.schemaError('missing OMDb "Title" field on positive lookup');
    }
    const rawYear = typeof record.Year === 'string' ? record.Year : undefined;
    const parsedYear = rawYear ? Number.parseInt(rawYear, 10) : undefined;
    const isAnimated = hasAnimationMetadata(record.Genre) || undefined;
    return {
      title: record.Title,
      year: Number.isInteger(parsedYear) ? parsedYear : undefined,
      imdbId: asImdbId(cleanId),
      isAnimated,
      source: 'omdb'
    };
  }
}

const imdbProvider = new ImdbSuggestionProvider();
const omdbProvider = new OmdbProvider();

class MovieSearchCoordinator extends BaseMetadataProvider {
  public constructor() {
    super({
      providerId: 'imdb',
      displayName: 'IMDb Suggestions',
      parserFile: 'src/server/services/metadata/imdbClient.ts',
      rateLimit: { kind: 'interval', minIntervalMs: IMDB_MIN_INTERVAL_MS }
    });
  }

  public async searchMovies(
    query: string,
    year: number | undefined,
    omdbApiKey: string | undefined,
    fetchImpl: typeof fetch,
    options?: MetadataLookupOptions
  ): Promise<readonly MetadataCandidate[]> {
    const clean = query.trim();
    if (!clean) {
      return [];
    }
    const cacheKey = `${clean.toLowerCase()}:${String(year ?? '')}:${omdbApiKey ? 'omdb' : 'imdb'}`;
    return this.withCache<'movieSearch', readonly MetadataCandidate[]>(
      'movieSearch',
      cacheKey,
      fetchImpl,
      (v) => v,
      (v) => v,
      async (): Promise<readonly MetadataCandidate[]> => {
        const candidates: MetadataCandidate[] = [];
        const seenIds = new Set<string>();
        let lastError: MetadataProviderError | undefined;
        let anySucceeded = false;

        try {
          const imdbHits = await imdbProvider.search(clean, fetchImpl, options?.onLog);
          anySucceeded = true;
          for (const hit of imdbHits) {
            if (!seenIds.has(hit.imdbId ?? '')) {
              if (hit.imdbId) {
                seenIds.add(hit.imdbId);
              }
              candidates.push(hit);
            }
          }
        } catch (err) {
          if (err instanceof MetadataProviderError) {
            lastError = err;
            options?.onDiagnostic?.(err.toDiagnostic());
          } else {
            throw err;
          }
        }

        if (omdbApiKey && candidates.length < MAX_CANDIDATES) {
          try {
            const omdbHits = await omdbProvider.search(
              clean,
              year,
              omdbApiKey,
              fetchImpl,
              options?.onLog
            );
            anySucceeded = true;
            for (const hit of omdbHits) {
              if (candidates.length >= MAX_CANDIDATES) {
                break;
              }
              if (hit.imdbId && seenIds.has(hit.imdbId)) {
                continue;
              }
              if (hit.imdbId) {
                seenIds.add(hit.imdbId);
              }
              candidates.push(hit);
            }
          } catch (err) {
            if (err instanceof MetadataProviderError) {
              lastError = err;
              options?.onDiagnostic?.(err.toDiagnostic());
            } else {
              throw err;
            }
          }
        }

        if (!anySucceeded && lastError && options?.throwOnFailure) {
          throw lastError;
        }
        if (omdbApiKey && candidates[0]?.imdbId && candidates[0].isAnimated === undefined) {
          try {
            const detailed = await this.lookupById(
              candidates[0].imdbId,
              omdbApiKey,
              fetchImpl,
              options?.onLog
            );
            if (detailed?.isAnimated) {
              candidates[0] = { ...candidates[0], isAnimated: true };
            }
          } catch {
            // Non-fatal: search results remain usable without genre enrichment.
          }
        }
        return candidates;
      }
    );
  }

  public async lookupById(
    cleanId: string,
    omdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<MetadataCandidate | undefined> {
    const cacheKey = `omdb:${cleanId}`;
    let found: MetadataCandidate | undefined;
    try {
      found = await this.withCache(
        'movieById',
        cacheKey,
        fetchImpl,
        (v) => v,
        (v) => v,
        async () => {
          const res = await omdbProvider.lookupById(cleanId, omdbApiKey, fetchImpl, onLog);
          if (!res) {
            throw new Error('OMDB_NOT_FOUND');
          }
          return res;
        }
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'OMDB_NOT_FOUND') {
        return undefined;
      }
      throw err;
    }
    return found;
  }
}

const movieCoordinator = new MovieSearchCoordinator();

/** Queries public IMDb suggestions (no key) and optionally enriches via OMDb. */
export async function searchMovies(
  query: string,
  year?: number,
  omdbApiKey?: string,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<readonly MetadataCandidate[]> {
  return movieCoordinator.searchMovies(query, year, omdbApiKey, fetchImpl, options);
}

/** Direct lookup by IMDb ID (`ttXXXXXXX`). */
export async function lookupMovieByImdbId(
  imdbIdRaw: string,
  omdbApiKey?: string,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<MetadataCandidate | undefined> {
  const cleanId = imdbIdRaw.trim().startsWith('tt') ? imdbIdRaw.trim() : `tt${imdbIdRaw.trim()}`;
  if (!/^tt\d+$/.test(cleanId)) {
    return undefined;
  }

  let omdbError: MetadataProviderError | undefined;
  if (omdbApiKey) {
    try {
      const found = await movieCoordinator.lookupById(
        cleanId,
        omdbApiKey,
        fetchImpl,
        options?.onLog
      );
      if (found) {
        return found;
      }
    } catch (err) {
      if (err instanceof MetadataProviderError) {
        omdbError = err;
        options?.onDiagnostic?.(err.toDiagnostic());
      } else {
        throw err;
      }
    }
  }

  const results = await searchMovies(cleanId, undefined, undefined, fetchImpl, options);
  const matched = results.find((c): boolean => c.imdbId === cleanId);
  if (matched) {
    return matched;
  }
  if (omdbError && options?.throwOnFailure) {
    throw omdbError;
  }
  return {
    title: cleanId,
    imdbId: asImdbId(cleanId),
    source: 'manual'
  };
}
