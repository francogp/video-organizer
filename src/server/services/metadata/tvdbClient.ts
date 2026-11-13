import {
  DEFAULT_PREFERRED_LANGUAGES,
  TVDB_MIN_INTERVAL_MS,
  TVMAZE_MAX_REQUESTS,
  TVMAZE_WINDOW_MS
} from '../../../domain/constants.ts';
import {
  asTvdbId,
  type EpisodeOrderMode,
  type MetadataCandidate,
  type MetadataLanguageCode,
  type MetadataLookupOptions,
  type TvdbId
} from '../../../domain/types.ts';
import {
  BaseMetadataProvider,
  hasAnimationMetadata,
  MetadataProviderError,
  runProviderChain
} from './baseMetadataProvider.ts';

const MAX_SERIES_RESULTS = 8;
const TVDB_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const YEAR_PREFIX_LEN = 4;

function resolvePreferredLanguages(
  preferredLanguages?: readonly MetadataLanguageCode[]
): readonly MetadataLanguageCode[] {
  return preferredLanguages && preferredLanguages.length > 0
    ? preferredLanguages
    : DEFAULT_PREFERRED_LANGUAGES;
}

/** TVDB v4 API client and parser. */
class TvdbProvider extends BaseMetadataProvider {
  #cachedToken: { readonly token: string; readonly expiresAt: number } | undefined;

  public constructor() {
    super({
      providerId: 'tvdb',
      displayName: 'TVDB v4',
      parserFile: 'src/server/services/metadata/tvdbClient.ts',
      rateLimit: { kind: 'interval', minIntervalMs: TVDB_MIN_INTERVAL_MS }
    });
  }

  public async search(
    cleanQuery: string,
    tvdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog'],
    preferredLanguages?: readonly MetadataLanguageCode[]
  ): Promise<readonly MetadataCandidate[]> {
    const langs = resolvePreferredLanguages(preferredLanguages);
    return this.#withAuthRetry(tvdbApiKey, fetchImpl, onLog, async (token) =>
      this.fetchAndParse(
        `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(cleanQuery)}&type=series`,
        { headers: { Authorization: `Bearer ${token}` } },
        (raw) => this.#parseSearch(raw, langs),
        fetchImpl,
        { onLog }
      )
    );
  }

  public async lookupById(
    tvdbId: TvdbId,
    tvdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog'],
    preferredLanguages?: readonly MetadataLanguageCode[]
  ): Promise<MetadataCandidate | undefined> {
    const langs = resolvePreferredLanguages(preferredLanguages);
    return this.#withAuthRetry(tvdbApiKey, fetchImpl, onLog, async (token) =>
      this.fetchAndParse(
        `https://api4.thetvdb.com/v4/series/${encodeURIComponent(tvdbId)}/extended?meta=translations`,
        { headers: { Authorization: `Bearer ${token}` } },
        (raw) => this.#parseSeries(raw, tvdbId, langs),
        fetchImpl,
        { onNotFound: () => undefined, onLog }
      )
    );
  }

  public async fetchEpisodes(
    tvdbId: TvdbId,
    order: EpisodeOrderMode,
    tvdbApiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog'],
    preferredLanguages?: readonly MetadataLanguageCode[]
  ): Promise<ReadonlyMap<string, string>> {
    const tvdbOrder = order === 'aired' ? 'default' : order;
    const langs = resolvePreferredLanguages(preferredLanguages);
    return this.#withAuthRetry(tvdbApiKey, fetchImpl, onLog, async (token) => {
      const merged = new Map<string, string>();
      for (const lang of langs) {
        const suffix = lang === 'native' ? '' : `/${encodeURIComponent(lang)}`;
        const page = await this.fetchAndParse(
          `https://api4.thetvdb.com/v4/series/${encodeURIComponent(tvdbId)}/episodes/${tvdbOrder}${suffix}?page=0`,
          { headers: { Authorization: `Bearer ${token}` } },
          (raw) => this.#parseEpisodes(raw),
          fetchImpl,
          {
            onNotFound: () => ({
              episodes: new Map<string, string>(),
              hasMissingTitles: false,
              totalCount: 0
            }),
            onLog
          }
        );
        for (const [key, title] of page.episodes) {
          if (!merged.has(key)) {
            merged.set(key, title);
          }
        }
        if (page.totalCount > 0 && !page.hasMissingTitles) {
          break;
        }
      }
      return merged;
    });
  }

  async #getBearerToken(
    apiKey: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<string> {
    const nowMs = Temporal.Now.instant().epochMilliseconds;
    if (this.#cachedToken && nowMs < this.#cachedToken.expiresAt) {
      return this.#cachedToken.token;
    }
    const token = await this.fetchAndParse(
      'https://api4.thetvdb.com/v4/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey })
      },
      (raw) => {
        const root = this.assertRecord(raw, 'TVDB login root');
        const data = this.assertRecord(root.data, 'TVDB login "data"');
        if (typeof data.token !== 'string' || !data.token) {
          throw this.schemaError('missing "data.token" in TVDB login response');
        }
        return data.token;
      },
      fetchImpl,
      { onLog }
    );
    this.#cachedToken = {
      token,
      expiresAt: Temporal.Now.instant().epochMilliseconds + TVDB_TOKEN_TTL_MS
    };
    return token;
  }

  async #withAuthRetry<T>(
    apiKey: string,
    fetchImpl: typeof fetch,
    onLog: MetadataLookupOptions['onLog'] | undefined,
    fn: (token: string) => Promise<T>
  ): Promise<T> {
    const token = await this.#getBearerToken(apiKey, fetchImpl, onLog);
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof MetadataProviderError && err.kind === 'auth_failed') {
        this.#cachedToken = undefined;
        const freshToken = await this.#getBearerToken(apiKey, fetchImpl, onLog);
        return fn(freshToken);
      }
      throw err;
    }
  }

  #parseSearch(
    raw: unknown,
    preferredLanguages: readonly MetadataLanguageCode[]
  ): MetadataCandidate[] {
    const root = this.assertRecord(raw, 'TVDB search root');
    const items = this.assertArray(root.data, 'TVDB search "data"');
    const out: MetadataCandidate[] = [];

    for (const rawItem of items) {
      const item = this.assertRecord(rawItem, 'TVDB search item');
      const rawTvdbId = typeof item.tvdb_id === 'string' ? item.tvdb_id : undefined;
      const rawName = typeof item.name === 'string' ? item.name : undefined;
      if (!rawTvdbId || !rawName) {
        continue;
      }
      const translations =
        item.translations &&
        typeof item.translations === 'object' &&
        !Array.isArray(item.translations)
          ? item.translations
          : undefined;
      let resolvedName = rawName;
      for (const lang of preferredLanguages) {
        if (lang === 'native') {
          resolvedName = rawName;
          break;
        }
        const translated = translations ? Reflect.get(translations, lang) : undefined;
        if (typeof translated === 'string' && translated.trim()) {
          resolvedName = translated.trim();
          break;
        }
      }
      const rawYear = typeof item.year === 'string' ? item.year : undefined;
      const parsedYear = rawYear ? Number.parseInt(rawYear, 10) : undefined;
      const isAnimated = hasAnimationMetadata(item.genres, item.type) || undefined;
      out.push({
        title: resolvedName,
        year: Number.isInteger(parsedYear) ? parsedYear : undefined,
        tvdbId: asTvdbId(rawTvdbId),
        overview: typeof item.overview === 'string' ? item.overview : undefined,
        isAnimated,
        source: 'tvdb'
      });
      if (out.length >= MAX_SERIES_RESULTS) {
        break;
      }
    }
    return out;
  }

  #pickTranslationTitle(
    translationsNode: unknown,
    nativeTitle: string,
    preferredLanguages: readonly MetadataLanguageCode[]
  ): string {
    const translationsObj =
      translationsNode && typeof translationsNode === 'object' && !Array.isArray(translationsNode)
        ? translationsNode
        : undefined;
    const rawList = translationsObj ? Reflect.get(translationsObj, 'nameTranslations') : undefined;
    const list = Array.isArray(rawList) ? rawList : [];

    for (const lang of preferredLanguages) {
      if (lang === 'native') {
        return nativeTitle;
      }
      let fallbackForLang: string | undefined;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }
        const entryLang = Reflect.get(entry, 'language');
        const entryName = Reflect.get(entry, 'name');
        if (entryLang === lang && typeof entryName === 'string' && entryName.trim()) {
          if (Reflect.get(entry, 'isPrimary') === true) {
            return entryName.trim();
          }
          fallbackForLang ??= entryName.trim();
        }
      }
      if (fallbackForLang) {
        return fallbackForLang;
      }
    }
    return nativeTitle;
  }

  #parseSeries(
    raw: unknown,
    tvdbId: TvdbId,
    preferredLanguages: readonly MetadataLanguageCode[]
  ): MetadataCandidate | undefined {
    const root = this.assertRecord(raw, 'TVDB series root');
    const data = this.assertRecord(root.data, 'TVDB series "data"');
    if (typeof data.name !== 'string' || !data.name) {
      throw this.schemaError('missing "data.name" in TVDB series response');
    }
    const rawYear =
      typeof data.year === 'string' || typeof data.year === 'number'
        ? data.year
        : typeof data.firstAired === 'string'
          ? data.firstAired.slice(0, 4)
          : undefined;
    const parsedYear = rawYear !== undefined ? Number.parseInt(String(rawYear), 10) : Number.NaN;
    const title = this.#pickTranslationTitle(data.translations, data.name, preferredLanguages);
    const isAnimated = hasAnimationMetadata(data.genres) || undefined;
    return {
      title,
      year: Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : undefined,
      tvdbId,
      overview: typeof data.overview === 'string' ? data.overview : undefined,
      isAnimated,
      source: 'tvdb'
    };
  }

  #parseEpisodes(raw: unknown): {
    readonly episodes: Map<string, string>;
    readonly hasMissingTitles: boolean;
    readonly totalCount: number;
  } {
    const root = this.assertRecord(raw, 'TVDB episodes root');
    const data = this.assertRecord(root.data, 'TVDB episodes "data"');
    const episodes = this.assertArray(data.episodes, 'TVDB episodes "data.episodes"');
    const map = new Map<string, string>();
    let hasMissingTitles = false;

    for (const rawEp of episodes) {
      const ep = this.assertRecord(rawEp, 'TVDB episode item');
      if (typeof ep.seasonNumber === 'number' && typeof ep.number === 'number') {
        if (typeof ep.name === 'string' && ep.name.trim()) {
          map.set(`${String(ep.seasonNumber)}:${String(ep.number)}`, ep.name.trim());
        } else {
          hasMissingTitles = true;
        }
      }
    }
    return { episodes: map, hasMissingTitles, totalCount: episodes.length };
  }
}

/** TVmaze public API client and parser. */
class TvmazeProvider extends BaseMetadataProvider {
  public constructor() {
    super({
      providerId: 'tvmaze',
      displayName: 'TVmaze',
      parserFile: 'src/server/services/metadata/tvdbClient.ts',
      rateLimit: {
        kind: 'slidingWindow',
        maxRequests: TVMAZE_MAX_REQUESTS,
        windowMs: TVMAZE_WINDOW_MS
      }
    });
  }

  public async search(
    cleanQuery: string,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<readonly MetadataCandidate[]> {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(cleanQuery)}`;
    return this.fetchAndParse(url, undefined, (raw) => this.#parseSearch(raw), fetchImpl, {
      onLog
    });
  }

  public async lookupById(
    tvdbId: TvdbId,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<MetadataCandidate | undefined> {
    const url = `https://api.tvmaze.com/lookup/shows?thetvdb=${encodeURIComponent(tvdbId)}`;
    return this.fetchAndParse(
      url,
      undefined,
      (raw) => this.#parseLookupShow(raw, tvdbId),
      fetchImpl,
      { onNotFound: () => undefined, onLog }
    );
  }

  public async lookupByTvmazeId(
    tvmazeId: number,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<MetadataCandidate | undefined> {
    const url = `https://api.tvmaze.com/shows/${String(tvmazeId)}`;
    return this.fetchAndParse(url, undefined, (raw) => this.#parseLookupShow(raw), fetchImpl, {
      onNotFound: () => undefined,
      onLog
    });
  }

  public async fetchEpisodes(
    tvdbId: TvdbId,
    fetchImpl: typeof fetch,
    onLog?: MetadataLookupOptions['onLog']
  ): Promise<ReadonlyMap<string, string>> {
    const lookupUrl = `https://api.tvmaze.com/lookup/shows?thetvdb=${encodeURIComponent(tvdbId)}`;
    const showId = await this.fetchAndParse<number | undefined>(
      lookupUrl,
      undefined,
      (raw) => {
        const show = this.assertRecord(raw, 'TVmaze show lookup');
        if (typeof show.id !== 'number') {
          throw this.schemaError('missing numeric "id" in TVmaze lookup response');
        }
        return show.id;
      },
      fetchImpl,
      { onNotFound: () => undefined, onLog }
    );

    if (showId === undefined) {
      return new Map();
    }

    const epsUrl = `https://api.tvmaze.com/shows/${String(showId)}/episodes?specials=1`;
    return this.fetchAndParse(epsUrl, undefined, (raw) => this.#parseEpisodes(raw), fetchImpl, {
      onNotFound: () => new Map(),
      onLog
    });
  }

  #toShowCandidate(show: Record<string, unknown>, tvdbId?: TvdbId): MetadataCandidate | undefined {
    if (typeof show.name !== 'string' || !show.name) {
      return undefined;
    }
    const premiered = typeof show.premiered === 'string' ? show.premiered : undefined;
    const yr = premiered ? Number(premiered.slice(0, YEAR_PREFIX_LEN)) : undefined;
    const externals =
      show.externals && typeof show.externals === 'object' && !Array.isArray(show.externals)
        ? show.externals
        : undefined;
    const rawTvdbValue = externals ? Reflect.get(externals, 'thetvdb') : undefined;
    const resolvedTvdbId =
      tvdbId ?? (typeof rawTvdbValue === 'number' ? asTvdbId(String(rawTvdbValue)) : undefined);
    const isAnimated = hasAnimationMetadata(show.genres, show.type) || undefined;
    return {
      title: show.name,
      year: yr && Number.isInteger(yr) ? yr : undefined,
      tvdbId: resolvedTvdbId,
      isAnimated,
      source: 'tvmaze'
    };
  }

  #parseSearch(raw: unknown): MetadataCandidate[] {
    const items = this.assertArray(raw, 'TVmaze search results');
    const results: MetadataCandidate[] = [];

    for (const rawItem of items) {
      const item = this.assertRecord(rawItem, 'TVmaze search item');
      const show = this.assertRecord(item.show, 'TVmaze search item "show"');
      const candidate = this.#toShowCandidate(show);
      if (!candidate) {
        continue;
      }
      results.push(candidate);
      if (results.length >= MAX_SERIES_RESULTS) {
        break;
      }
    }
    return results;
  }

  #parseLookupShow(raw: unknown, tvdbId?: TvdbId): MetadataCandidate | undefined {
    const show = this.assertRecord(raw, 'TVmaze lookup show');
    const candidate = this.#toShowCandidate(show, tvdbId);
    if (!candidate) {
      throw this.schemaError('missing "name" in TVmaze lookup response');
    }
    return candidate;
  }

  #parseEpisodes(raw: unknown): Map<string, string> {
    const items = this.assertArray(raw, 'TVmaze episodes list');
    const map = new Map<string, string>();
    for (const rawEp of items) {
      const ep = this.assertRecord(rawEp, 'TVmaze episode item');
      if (
        typeof ep.season === 'number' &&
        typeof ep.number === 'number' &&
        typeof ep.name === 'string' &&
        ep.name
      ) {
        map.set(`${String(ep.season)}:${String(ep.number)}`, ep.name);
      }
    }
    return map;
  }
}

const tvdbProvider = new TvdbProvider();
const tvmazeProvider = new TvmazeProvider();

class TvCacheHelper extends BaseMetadataProvider {
  public constructor() {
    super({
      providerId: 'tvmaze',
      displayName: 'TVmaze',
      parserFile: 'src/server/services/metadata/tvdbClient.ts',
      rateLimit: {
        kind: 'slidingWindow',
        maxRequests: TVMAZE_MAX_REQUESTS,
        windowMs: TVMAZE_WINDOW_MS
      }
    });
  }

  public cacheSearch(
    cacheKey: string,
    fetchImpl: typeof fetch,
    loader: () => Promise<readonly MetadataCandidate[]>
  ): Promise<readonly MetadataCandidate[]> {
    return this.withCache(
      'tvSearch',
      cacheKey,
      fetchImpl,
      (v) => v,
      (v) => v,
      loader
    );
  }

  public cacheSeriesById(
    cacheKey: string,
    fetchImpl: typeof fetch,
    loader: () => Promise<MetadataCandidate>
  ): Promise<MetadataCandidate> {
    return this.withCache(
      'seriesById',
      cacheKey,
      fetchImpl,
      (v) => v,
      (v) => v,
      loader
    );
  }

  public cacheEpisodeMap(
    cacheKey: string,
    fetchImpl: typeof fetch,
    loader: () => Promise<ReadonlyMap<string, string>>
  ): Promise<ReadonlyMap<string, string>> {
    return this.withCache(
      'episodeMaps',
      cacheKey,
      fetchImpl,
      (map) => [...map.entries()],
      (entries) => new Map(entries),
      loader
    );
  }
}

const tvCache = new TvCacheHelper();

/** Searches TV shows via TVDB v4 (when keyed) or TVmaze (when unkeyed). */
export async function searchTvShows(
  query: string,
  tvdbApiKey?: string,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<readonly MetadataCandidate[]> {
  const clean = query.trim();
  if (!clean) {
    return [];
  }
  const langs = resolvePreferredLanguages(options?.preferredLanguages);
  const cacheKey = `${clean.toLowerCase()}:${tvdbApiKey ? `tvdb:${langs.join(',')}` : 'tvmaze'}`;
  return tvCache.cacheSearch(cacheKey, fetchImpl, () =>
    runProviderChain(
      [
        ...(tvdbApiKey
          ? [
              {
                run: () => tvdbProvider.search(clean, tvdbApiKey, fetchImpl, options?.onLog, langs),
                hasResult: (list: readonly MetadataCandidate[]) => list.length > 0
              }
            ]
          : []),
        {
          run: () => tvmazeProvider.search(clean, fetchImpl, options?.onLog),
          hasResult: (list: readonly MetadataCandidate[]) => list.length > 0
        }
      ],
      [],
      options
    )
  );
}

/** Looks up a TV series directly by its TVDB ID via TVDB v4 or TVmaze fallback. */
export async function lookupSeriesByTvdbId(
  tvdbId: TvdbId,
  tvdbApiKey?: string,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<MetadataCandidate | undefined> {
  const langs = resolvePreferredLanguages(options?.preferredLanguages);
  const cacheKey = `${tvdbId}:${tvdbApiKey ? `tvdb:${langs.join(',')}` : 'tvmaze'}`;
  try {
    return await tvCache.cacheSeriesById(cacheKey, fetchImpl, async () => {
      const found = await runProviderChain<MetadataCandidate | undefined>(
        [
          ...(tvdbApiKey
            ? [
                {
                  run: () =>
                    tvdbProvider.lookupById(tvdbId, tvdbApiKey, fetchImpl, options?.onLog, langs),
                  hasResult: (v: MetadataCandidate | undefined) => v !== undefined
                }
              ]
            : []),
          {
            run: () => tvmazeProvider.lookupById(tvdbId, fetchImpl, options?.onLog),
            hasResult: (v: MetadataCandidate | undefined) => v !== undefined
          }
        ],
        undefined,
        options
      );
      if (!found) {
        throw new Error('SERIES_NOT_FOUND');
      }
      return found;
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'SERIES_NOT_FOUND') {
      return undefined;
    }
    throw err;
  }
}

/** Looks up a TV series directly by its TVmaze numeric show ID (e.g. from `tvmaze.com/shows/<id>`). */
export async function lookupSeriesByTvmazeId(
  tvmazeId: number,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<MetadataCandidate | undefined> {
  return runProviderChain<MetadataCandidate | undefined>(
    [
      {
        run: () => tvmazeProvider.lookupByTvmazeId(tvmazeId, fetchImpl, options?.onLog),
        hasResult: (v: MetadataCandidate | undefined) => v !== undefined
      }
    ],
    undefined,
    options
  );
}

/** Fetches episode title map (`"S:E" -> "Title"`) for a TVDB show ID. */
export async function fetchEpisodeTitleMap(
  tvdbId: TvdbId,
  order: EpisodeOrderMode = 'aired',
  tvdbApiKey?: string,
  fetchImpl: typeof fetch = fetch,
  options?: MetadataLookupOptions
): Promise<ReadonlyMap<string, string>> {
  const langs = resolvePreferredLanguages(options?.preferredLanguages);
  const cacheKey = `${tvdbId}:${order}:${tvdbApiKey ? langs.join(',') : 'tvmaze'}`;
  return tvCache.cacheEpisodeMap(cacheKey, fetchImpl, () =>
    runProviderChain<ReadonlyMap<string, string>>(
      [
        ...(tvdbApiKey
          ? [
              {
                run: () =>
                  tvdbProvider.fetchEpisodes(
                    tvdbId,
                    order,
                    tvdbApiKey,
                    fetchImpl,
                    options?.onLog,
                    langs
                  ),
                hasResult: () => true
              }
            ]
          : []),
        {
          run: () => tvmazeProvider.fetchEpisodes(tvdbId, fetchImpl, options?.onLog),
          hasResult: (map: ReadonlyMap<string, string>) => map.size > 0
        }
      ],
      new Map(),
      options
    )
  );
}
