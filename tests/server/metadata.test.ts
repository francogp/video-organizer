import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

import { asTvdbId, type MetadataDiagnostic } from '../../src/domain/types.ts';
import {
  BaseMetadataProvider,
  MetadataProviderError
} from '../../src/server/services/metadata/baseMetadataProvider.ts';
import {
  lookupMovieByImdbId,
  searchMovies
} from '../../src/server/services/metadata/imdbClient.ts';
import {
  configureMetadataCache,
  getCachedMetadata,
  setCachedMetadata
} from '../../src/server/services/metadata/metadataCache.ts';
import {
  fetchEpisodeTitleMap,
  lookupSeriesByTvmazeId,
  lookupSeriesByTvdbId,
  searchTvShows
} from '../../src/server/services/metadata/tvdbClient.ts';

function getFetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

describe('metadata clients', () => {
  it('searches movies via IMDb suggestions and OMDb fallback', async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('media-imdb.com')) {
        return new Response(
          JSON.stringify({
            d: [
              { id: 'tt0816692', l: 'Interstellar', y: 2014, qid: 'movie' },
              { id: 'nm0000001', l: 'Ignored Person', qid: 'name' }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes('omdbapi.com') && url.includes('i=tt0816692')) {
        return new Response(
          JSON.stringify({
            Response: 'True',
            Title: 'Interstellar',
            Year: '2014',
            imdbID: 'tt0816692'
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const results = await searchMovies('Interstellar', 2014, undefined, mockFetch);
    expect(results).toHaveLength(1);
    expect(results[0]?.imdbId).toBe('tt0816692');

    const direct = await lookupMovieByImdbId('0816692', 'test-key', mockFetch);
    expect(direct?.title).toBe('Interstellar');
    expect(direct?.source).toBe('omdb');
  });

  it('searches TV shows via TVmaze (no key) and resolves TVDB episode titles', async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('api.tvmaze.com/search/shows')) {
        return new Response(
          JSON.stringify([
            {
              show: {
                id: 99,
                name: 'Fallout',
                premiered: '2024-04-10',
                externals: { thetvdb: 416744 }
              }
            }
          ]),
          { status: 200 }
        );
      }
      if (url.includes('api.tvmaze.com/lookup/shows')) {
        return new Response(JSON.stringify({ id: 99 }), { status: 200 });
      }
      if (url.includes('api.tvmaze.com/shows/99/episodes')) {
        return new Response(JSON.stringify([{ season: 1, number: 1, name: 'The End' }]), {
          status: 200
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const shows = await searchTvShows('Fallout', undefined, mockFetch);
    expect(shows).toHaveLength(1);
    expect(shows[0]?.tvdbId).toBe('416744');
    expect(shows[0]?.source).toBe('tvmaze');

    const episodes = await fetchEpisodeTitleMap(asTvdbId('416744'), 'aired', undefined, mockFetch);
    expect(episodes.get('1:1')).toBe('The End');
  });

  it('handles empty queries, OMDb search fallback, and TVDB v4 keyed search/episodes', async () => {
    await expect(searchMovies('   ')).resolves.toEqual([]);
    await expect(searchTvShows('   ')).resolves.toEqual([]);

    const mockFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('media-imdb.com')) {
        throw new Error('network down');
      }
      if (url.includes('omdbapi.com') && url.includes('&s=')) {
        return new Response(
          JSON.stringify({
            Response: 'True',
            Search: [{ Title: 'Dune', Year: '2021', imdbID: 'tt1160419', Type: 'movie' }]
          }),
          { status: 200 }
        );
      }
      if (url.includes('omdbapi.com') && url.includes('i=tt9999999')) {
        return new Response(JSON.stringify({ Response: 'False' }), { status: 200 });
      }
      if (url.includes('thetvdb.com/v4/login')) {
        return new Response(JSON.stringify({ data: { token: 'tvdb-jwt' } }), { status: 200 });
      }
      if (url.includes('thetvdb.com/v4/search')) {
        return new Response(
          JSON.stringify({
            data: [{ tvdb_id: '73255', name: 'House', year: '2004', overview: 'Medical drama' }]
          }),
          { status: 200 }
        );
      }
      if (url.includes('thetvdb.com/v4/series/73255/episodes/dvd')) {
        return new Response(
          JSON.stringify({
            data: {
              episodes: [{ seasonNumber: 1, number: 2, name: 'Paternity' }]
            }
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 500 });
    }) as typeof fetch;

    const omdbMovies = await searchMovies('Dune', 2021, 'omdb-key', mockFetch);
    expect(omdbMovies).toHaveLength(1);
    expect(omdbMovies[0]?.source).toBe('omdb');
    const manualFallback = await lookupMovieByImdbId('tt9999999', 'omdb-key', mockFetch);
    expect(manualFallback?.source).toBe('manual');

    const tvdbShows = await searchTvShows('House', 'tvdb-key', mockFetch);
    expect(tvdbShows).toHaveLength(1);
    expect(tvdbShows[0]?.source).toBe('tvdb');
    expect(tvdbShows[0]?.tvdbId).toBe('73255');

    const dvdEpisodes = await fetchEpisodeTitleMap(asTvdbId('73255'), 'dvd', 'tvdb-key', mockFetch);
    expect(dvdEpisodes.get('1:2')).toBe('Paternity');
    // Cached hit
    const cachedEpisodes = await fetchEpisodeTitleMap(
      asTvdbId('73255'),
      'dvd',
      'tvdb-key',
      mockFetch
    );
    expect(cachedEpisodes.get('1:2')).toBe('Paternity');

    // Fallbacks when TVDB fails and TVmaze returns non-ok or error
    const failFetch = (async () => new Response('fail', { status: 503 })) as typeof fetch;
    await expect(searchTvShows('UnknownShow', 'bad-key', failFetch)).resolves.toEqual([]);
    expect(
      (await fetchEpisodeTitleMap(asTvdbId('999999'), 'absolute', 'bad-key', failFetch)).size
    ).toBe(0);

    const dupMovieFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('media-imdb.com')) {
        return new Response(
          JSON.stringify({
            d: [
              { id: 'tt0000001', l: 'Test Movie', qid: 'movie' },
              { id: 'tt0000001', l: 'Test Movie', qid: 'movie' },
              { id: 'tt0000002', qid: 'movie' }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const deduped = await searchMovies('Test Movie', undefined, undefined, dupMovieFetch);
    expect(deduped).toHaveLength(1);

    // TVDB returns empty data -> falls back to TVmaze; TVmaze returns non-ok -> []
    const tvdbEmptyFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('thetvdb.com/v4/search')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('api.tvmaze.com')) {
        return new Response('[]', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await expect(searchTvShows('EmptyShow', 'tvdb-key', tvdbEmptyFetch)).resolves.toEqual([]);
    expect(
      (await fetchEpisodeTitleMap(asTvdbId('12345'), 'aired', undefined, tvdbEmptyFetch)).size
    ).toBe(0);

    // MAX_CANDIDATES cap & lookupMovieByImdbId fallback when IMDb fails
    const manyMoviesFetch = (async () =>
      new Response(
        JSON.stringify({
          d: Array.from({ length: 12 }, (_, idx) => ({
            id: `tt00000${String(idx).padStart(2, '0')}`,
            l: `Movie ${String(idx)}`,
            qid: 'movie'
          }))
        }),
        { status: 200 }
      )) as typeof fetch;
    const capped = await searchMovies('Movie', undefined, undefined, manyMoviesFetch);
    expect(capped).toHaveLength(8);
  });

  it('looks up series directly by TVDB ID via TVDB v4 and TVmaze fallback', async () => {
    const tvdbFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('thetvdb.com/v4/login')) {
        return new Response(JSON.stringify({ data: { token: 'jwt' } }), { status: 200 });
      }
      if (url.includes('thetvdb.com/v4/series/371028')) {
        return new Response(
          JSON.stringify({ data: { name: 'Arcane', year: '2021', overview: 'Piltover' } }),
          { status: 200 }
        );
      }
      if (url.includes('api.tvmaze.com/lookup/shows?thetvdb=371028')) {
        return new Response(JSON.stringify({ name: 'Arcane', premiered: '2021-11-06' }), {
          status: 200
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const directTvdb = await lookupSeriesByTvdbId(asTvdbId('371028'), 'tvdb-key', tvdbFetch);
    expect(directTvdb?.title).toBe('Arcane');
    expect(directTvdb?.source).toBe('tvdb');

    const fallbackTvmaze = await lookupSeriesByTvdbId(asTvdbId('371028'), undefined, tvdbFetch);
    expect(fallbackTvmaze?.title).toBe('Arcane');
    expect(fallbackTvmaze?.source).toBe('tvmaze');
  });

  it('caches repeated global fetch searches to avoid rate-limit bursts', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('media-imdb.com')) {
        return new Response(
          JSON.stringify({ d: [{ id: 'tt0133093', l: 'The Matrix', y: 1999, qid: 'movie' }] }),
          { status: 200 }
        );
      }
      if (url.includes('api.tvmaze.com/search/shows')) {
        return new Response(
          JSON.stringify([{ show: { name: 'Andor', premiered: '2022-09-21', externals: {} } }]),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchSpy);
    try {
      const m1 = await searchMovies('The Matrix', 1999);
      const m2 = await searchMovies('The Matrix', 1999);
      expect(m1).toHaveLength(1);
      expect(m2).toEqual(m1);

      const t1 = await searchTvShows('Andor');
      const t2 = await searchTvShows('Andor');
      expect(t1).toHaveLength(1);
      expect(t2).toEqual(t1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serializes concurrent rate-limit slots without race bursts on interval and slidingWindow', async () => {
    let clockMs = 1000;
    const sleepCalls: number[] = [];
    const requestTimes: number[] = [];

    class ProbeProvider extends BaseMetadataProvider {
      public constructor(
        strategy:
          | { readonly kind: 'interval'; readonly minIntervalMs: number }
          | {
              readonly kind: 'slidingWindow';
              readonly maxRequests: number;
              readonly windowMs: number;
            }
      ) {
        super({
          providerId: 'imdb',
          displayName: 'Probe',
          parserFile: 'probe.ts',
          rateLimit: strategy,
          now: () => clockMs,
          delayFn: async (ms) => {
            sleepCalls.push(ms);
            clockMs += ms;
          },
          throttleCustomFetch: true
        });
      }

      public async hit(fetchImpl: typeof fetch): Promise<unknown> {
        return this.fetchAndParse('https://example.test/api', undefined, (raw) => raw, fetchImpl);
      }
    }

    const mockOkFetch = (async () => {
      requestTimes.push(clockMs);
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const intervalProvider = new ProbeProvider({ kind: 'interval', minIntervalMs: 300 });
    await Promise.all([
      intervalProvider.hit(mockOkFetch),
      intervalProvider.hit(mockOkFetch),
      intervalProvider.hit(mockOkFetch),
      intervalProvider.hit(mockOkFetch)
    ]);

    expect(sleepCalls).toEqual([300, 300, 300]);
    expect(clockMs).toBe(1900);

    clockMs = 10_000;
    sleepCalls.length = 0;
    requestTimes.length = 0;
    const windowProvider = new ProbeProvider({
      kind: 'slidingWindow',
      maxRequests: 2,
      windowMs: 1000
    });
    await Promise.all([
      windowProvider.hit(mockOkFetch),
      windowProvider.hit(mockOkFetch),
      windowProvider.hit(mockOkFetch)
    ]);
    expect(sleepCalls).toEqual([1000]);
    expect(clockMs).toBe(11_000);
  });

  it('retries HTTP 429 with Retry-After and surfaces provider_down, auth_failed, and schema_incompatible errors', async () => {
    let retryAttempts = 0;
    const retry429Fetch = (async () => {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        return new Response('rate limit', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return new Response(
        JSON.stringify({ d: [{ id: 'tt0133093', l: 'The Matrix', y: 1999, qid: 'movie' }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const retryLogs: string[] = [];
    const recovered = await searchMovies('Matrix', 1999, undefined, retry429Fetch, {
      throwOnFailure: true,
      onLog: (lvl, msg) => retryLogs.push(`${lvl}:${msg}`)
    });
    expect(retryAttempts).toBe(2);
    expect(recovered).toHaveLength(1);
    expect(retryLogs.some((l) => l.startsWith('warn:') && l.includes('retrying'))).toBe(true);
    expect(retryLogs.some((l) => l.startsWith('info:') && l.includes('retry succeeded'))).toBe(
      true
    );

    const diagnostics: MetadataDiagnostic[] = [];
    const htmlFetch = (async () =>
      new Response('<!DOCTYPE html><html><body>Just a moment...</body></html>', {
        status: 200
      })) as typeof fetch;

    await expect(
      searchMovies('Inception', 2010, undefined, htmlFetch, {
        throwOnFailure: true,
        onDiagnostic: (d) => diagnostics.push(d)
      })
    ).rejects.toThrowError(MetadataProviderError);

    expect(diagnostics[0]?.kind).toBe('schema_incompatible');
    expect(diagnostics[0]?.message).toContain('Source code update required');

    const changedJsonFetch = (async () =>
      new Response(JSON.stringify({ results: [{ code: 'tt123', name: 'Changed' }] }), {
        status: 200
      })) as typeof fetch;

    await expect(
      searchMovies('Inception', 2010, undefined, changedJsonFetch, { throwOnFailure: true })
    ).rejects.toThrowError(/Source code update required/);

    const tvDiagnostics: MetadataDiagnostic[] = [];
    const authFailFetch = (async () =>
      new Response('unauthorized', { status: 401 })) as typeof fetch;
    await expect(
      searchTvShows('Andor', 'bad-key', authFailFetch, {
        throwOnFailure: true,
        onDiagnostic: (d) => tvDiagnostics.push(d)
      })
    ).rejects.toMatchObject({
      kind: 'auth_failed'
    });
    expect(tvDiagnostics.some((d) => d.provider === 'tvdb' && d.kind === 'auth_failed')).toBe(true);
  });

  it('persists successful metadata lookups to metadata-cache.json without caching failures', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-meta-cache-'));
    try {
      await configureMetadataCache(tmpDir);
      const fetchSpy = vi.fn(async (input: string | URL | Request) => {
        const url = getFetchUrl(input);
        if (url.includes('media-imdb.com') && url.includes('Arrival')) {
          return new Response(
            JSON.stringify({ d: [{ id: 'tt2543164', l: 'Arrival', y: 2016, qid: 'movie' }] }),
            { status: 200 }
          );
        }
        return new Response('down', { status: 503 });
      });

      vi.stubGlobal('fetch', fetchSpy);
      try {
        const first = await searchMovies('Arrival', 2016);
        expect(first).toHaveLength(1);

        // Re-configuring flushes pending writes, clears memory, and reloads from disk
        await configureMetadataCache(tmpDir);

        const second = await searchMovies('Arrival', 2016);
        expect(second).toEqual(first);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('covers TVDB token refresh on 401, OMDb/TVmaze schema validation, and expired cache eviction', async () => {
    let tvdbSearchCalls = 0;
    let tvdbLoginCalls = 0;
    const tvdbRefreshFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('thetvdb.com/v4/login')) {
        tvdbLoginCalls += 1;
        return new Response(JSON.stringify({ data: { token: `jwt-${String(tvdbLoginCalls)}` } }), {
          status: 200
        });
      }
      if (url.includes('thetvdb.com/v4/search')) {
        tvdbSearchCalls += 1;
        if (tvdbSearchCalls === 1) {
          return new Response('expired', { status: 401 });
        }
        return new Response(
          JSON.stringify({ data: [{ tvdb_id: '81189', name: 'Breaking Bad', year: '2008' }] }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const shows = await searchTvShows('Breaking Bad', 'tvdb-key', tvdbRefreshFetch);
    expect(shows).toHaveLength(1);
    expect(shows[0]?.tvdbId).toBe('81189');
    expect(tvdbLoginCalls).toBeGreaterThanOrEqual(1);

    const badOmdbFetch = (async () =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 })) as typeof fetch;
    await expect(
      lookupMovieByImdbId('tt0133093', 'omdb-key', badOmdbFetch, { throwOnFailure: true })
    ).rejects.toMatchObject({ kind: 'schema_incompatible', provider: 'imdb' });

    const badTvmazeFetch = (async () =>
      new Response(JSON.stringify({ notAnArray: true }), { status: 200 })) as typeof fetch;
    await expect(
      searchTvShows('Lost', undefined, badTvmazeFetch, { throwOnFailure: true })
    ).rejects.toMatchObject({ kind: 'schema_incompatible', provider: 'tvmaze' });

    const badTvdbSeriesFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('thetvdb.com/v4/login')) {
        return new Response(JSON.stringify({ data: { token: 'jwt-ok' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as typeof fetch;
    const badTvdbDiagnostics: MetadataDiagnostic[] = [];
    await expect(
      lookupSeriesByTvdbId(asTvdbId('999'), 'tvdb-key', badTvdbSeriesFetch, {
        throwOnFailure: true,
        onDiagnostic: (d) => badTvdbDiagnostics.push(d)
      })
    ).rejects.toMatchObject({ kind: 'schema_incompatible' });
    expect(
      badTvdbDiagnostics.some((d) => d.provider === 'tvdb' && d.kind === 'schema_incompatible')
    ).toBe(true);

    setCachedMetadata('movieSearch', 'expired:test', [], -10);
    expect(getCachedMetadata('movieSearch', 'expired:test')).toBeUndefined();

    await expect(lookupMovieByImdbId('invalid-id')).resolves.toBeUndefined();
    const omdbDownImdbFallbackFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('omdbapi.com')) {
        return new Response('down', { status: 503 });
      }
      if (url.includes('media-imdb.com')) {
        return new Response(
          JSON.stringify({ d: [{ id: 'tt0816692', l: 'Interstellar', y: 2014, qid: 'movie' }] }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const fallbackMovie = await lookupMovieByImdbId(
      '0816692',
      'omdb-key',
      omdbDownImdbFallbackFetch
    );
    expect(fallbackMovie?.source).toBe('imdb');

    // HTTP 404 on TVmaze ID lookup must not trigger a false provider_down diagnostic
    const notFoundDiagnostics: MetadataDiagnostic[] = [];
    const tvmaze404Fetch = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
    await expect(
      lookupSeriesByTvdbId(asTvdbId('777777'), undefined, tvmaze404Fetch, {
        onDiagnostic: (d) => notFoundDiagnostics.push(d)
      })
    ).resolves.toBeUndefined();
    expect(
      (
        await fetchEpisodeTitleMap(asTvdbId('777777'), 'aired', undefined, tvmaze404Fetch, {
          onDiagnostic: (d) => notFoundDiagnostics.push(d)
        })
      ).size
    ).toBe(0);
    expect(notFoundDiagnostics).toHaveLength(0);
  });

  it('looks up series directly by TVmaze numeric ID and returns undefined on 404', async () => {
    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          id: 1234,
          name: 'Fallout',
          premiered: '2024-04-10',
          externals: { thetvdb: 416744 }
        }),
        { status: 200 }
      )) as typeof fetch;

    const found = await lookupSeriesByTvmazeId(1234, okFetch);
    expect(found).toEqual({
      title: 'Fallout',
      year: 2024,
      tvdbId: asTvdbId('416744'),
      source: 'tvmaze'
    });

    const missingFetch = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
    await expect(lookupSeriesByTvmazeId(999999, missingFetch)).resolves.toBeUndefined();
  });

  it('resolves TVDB series and episode titles according to preferredLanguages order', async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('thetvdb.com/v4/login')) {
        return new Response(JSON.stringify({ data: { token: 'tvdb-jwt-lang' } }), { status: 200 });
      }
      if (url.includes('thetvdb.com/v4/series/295068/extended')) {
        return new Response(
          JSON.stringify({
            data: {
              id: 295068,
              name: 'ドラゴンボール超[スーパー]',
              firstAired: '2015-07-05',
              translations: {
                nameTranslations: [
                  { language: 'jpn', name: 'ドラゴンボール超[スーパー]', isPrimary: true },
                  { language: 'eng', name: 'Dragon Ball Super' },
                  { language: 'spa', name: 'Dragon Ball Super (ES)' }
                ]
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes('thetvdb.com/v4/series/295068/episodes/default/spa')) {
        return new Response(
          JSON.stringify({
            data: {
              episodes: [
                { seasonNumber: 1, number: 1, name: 'El premio de la paz' },
                { seasonNumber: 1, number: 2, name: '' }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes('thetvdb.com/v4/series/295068/episodes/default/eng')) {
        return new Response(
          JSON.stringify({
            data: {
              episodes: [
                { seasonNumber: 1, number: 1, name: 'The Peace Prize' },
                { seasonNumber: 1, number: 2, name: 'To the Promised Resort!' }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes('thetvdb.com/v4/search')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                tvdb_id: '295068',
                name: 'ドラゴンボール超[スーパー]',
                year: '2015',
                translations: {
                  eng: 'Dragon Ball Super',
                  spa: 'Dragon Ball Super (ES)'
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const spaFirst = await lookupSeriesByTvdbId(asTvdbId('295068'), 'tvdb-key', mockFetch, {
      preferredLanguages: ['spa', 'eng', 'native']
    });
    expect(spaFirst?.title).toBe('Dragon Ball Super (ES)');
    expect(spaFirst?.year).toBe(2015);

    const engFirst = await lookupSeriesByTvdbId(asTvdbId('295068'), 'tvdb-key', mockFetch, {
      preferredLanguages: ['eng', 'spa', 'native']
    });
    expect(engFirst?.title).toBe('Dragon Ball Super');

    const nativeFirst = await lookupSeriesByTvdbId(asTvdbId('295068'), 'tvdb-key', mockFetch, {
      preferredLanguages: ['native', 'eng']
    });
    expect(nativeFirst?.title).toBe('ドラゴンボール超[スーパー]');

    const episodes = await fetchEpisodeTitleMap(
      asTvdbId('295068'),
      'aired',
      'tvdb-key',
      mockFetch,
      {
        preferredLanguages: ['spa', 'eng', 'native']
      }
    );
    expect(episodes.get('1:1')).toBe('El premio de la paz');
    expect(episodes.get('1:2')).toBe('To the Promised Resort!');

    const searchResults = await searchTvShows('Dragon Ball Super', 'tvdb-key', mockFetch, {
      preferredLanguages: ['eng', 'native']
    });
    expect(searchResults[0]?.title).toBe('Dragon Ball Super');
  });

  it('detects animation metadata from TVmaze, TVDB, and OMDb responses', async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = getFetchUrl(input);
      if (url.includes('api.tvmaze.com/search/shows')) {
        return new Response(
          JSON.stringify([
            {
              show: {
                id: 99,
                name: 'There Is Also a Hole in the Student Organization!',
                type: 'Animation',
                genres: ['Anime', 'Comedy'],
                premiered: '2026-04-01',
                externals: { thetvdb: 463051 }
              }
            }
          ]),
          { status: 200 }
        );
      }
      if (url.includes('media-imdb.com')) {
        return new Response(
          JSON.stringify({ d: [{ id: 'tt0245429', l: 'Spirited Away', y: 2001, qid: 'movie' }] }),
          { status: 200 }
        );
      }
      if (url.includes('omdbapi.com') && url.includes('i=tt0245429')) {
        return new Response(
          JSON.stringify({
            Response: 'True',
            Title: 'Spirited Away',
            Year: '2001',
            Genre: 'Animation, Adventure, Family'
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ Response: 'False' }), { status: 200 });
    }) as typeof fetch;

    const tvResults = await searchTvShows('Student Organization', '', mockFetch);
    expect(tvResults[0]?.isAnimated).toBe(true);

    const movieResults = await searchMovies('Spirited Away', 2001, 'omdb-key', mockFetch);
    expect(movieResults[0]?.isAnimated).toBe(true);
  });

  it('falls back to os.tmpdir() once when metadata cache directory throws EACCES', async () => {
    const fsPromises = (await import('node:fs')).promises;
    const osMod = await import('node:os');
    const pathMod = await import('node:path');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const origWriteFile = fsPromises.writeFile.bind(fsPromises);
    const origAccess = fsPromises.access.bind(fsPromises);
    const writeSpy = vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (p, d, o) => {
      if (typeof p === 'string' && p.includes('readonly-config-dir')) {
        throw eacces;
      }
      return origWriteFile(p, d, o);
    });
    const accessSpy = vi.spyOn(fsPromises, 'access').mockImplementation(async (p, mode) => {
      if (typeof p === 'string' && p.includes('readonly-config-dir')) {
        throw eacces;
      }
      return origAccess(p, mode);
    });

    try {
      await configureMetadataCache(pathMod.join(osMod.tmpdir(), 'readonly-config-dir'));
      setCachedMetadata('movieSearch', 'test-eacces-1', []);
      setCachedMetadata('movieSearch', 'test-eacces-2', []);
      await new Promise((r) => setTimeout(r, 320));
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Re-configuring with unwritable configDir rehydrates fallback cache without duplicate warnings
      await configureMetadataCache(pathMod.join(osMod.tmpdir(), 'readonly-config-dir'));
      expect(getCachedMetadata('movieSearch', 'test-eacces-1')).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      setCachedMetadata('movieSearch', 'test-eacces-3', []);
      await new Promise((r) => setTimeout(r, 320));
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      accessSpy.mockRestore();
      writeSpy.mockRestore();
      warnSpy.mockRestore();
      await fsPromises.rm(
        pathMod.join(osMod.tmpdir(), 'plex-video-organizer-metadata-cache.json'),
        {
          force: true
        }
      );
    }
  });
});
