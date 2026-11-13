import fs from 'node:fs/promises';
import path from 'node:path';

import { asImdbId, asTvdbId } from '../../src/domain/types.ts';
import type { AppConfig } from '../../src/server/config.ts';
import type { VerifierMetadataDeps } from '../../src/server/services/libraryVerifierService.ts';

export interface VerifierFixtureSeed {
  readonly compliantRootsCount: number;
  readonly nonCompliantRootsCount: number;
  readonly expectedFixableIdsCount: number;
}

/**
 * Seeds a comprehensive 5-library fixture tree covering every Plex compliance issue and fix pattern:
 * - Compliant TV show & movie (excluded from issues list, counted in compliantRoots)
 * - Missing year + lowercase season + episode/subtitle mismatch + multi-episode + split-part
 * - Missing provider ID + Spanish `Temporada 2` + `Specials`
 * - Case-only rename on Windows/SMB
 * - Documentary with `[1080p]` bracket tags
 * - Animated movie with `{edition-...}` and `- pt1` / `- pt2` split parts
 * - Unresolved metadata entry
 * - Destination collision guard entry
 */
export async function seedVerifierFixtureLibraries(
  config: AppConfig
): Promise<VerifierFixtureSeed> {
  // 1. Compliant TV show (should NOT appear in entries)
  const compliantTv = path.join(
    config.outputTvShowsDir,
    'Carl Sagan Cosmos (1980) {tvdb-74995}',
    'Season 01'
  );
  await fs.mkdir(compliantTv, { recursive: true });
  await fs.writeFile(
    path.join(compliantTv, 'Carl Sagan Cosmos (1980) - s01e01 - The Shores.mkv'),
    'video'
  );

  // 2. Compliant Movie (should NOT appear in entries)
  const compliantMovie = path.join(config.outputMoviesDir, 'Dune (2021) {imdb-tt1160419}');
  await fs.mkdir(compliantMovie, { recursive: true });
  await fs.writeFile(path.join(compliantMovie, 'Dune (2021) {imdb-tt1160419}.mkv'), 'video');
  await fs.writeFile(path.join(compliantMovie, 'Dune (2021) {imdb-tt1160419}.en.srt'), 'sub');

  // 3. TV show: missing year + lowercase season + episode/sub mismatch + multi-ep + split-part
  const falloutSeason = path.join(config.outputTvShowsDir, 'Fallout {tvdb-416744}', 'season 1');
  await fs.mkdir(falloutSeason, { recursive: true });
  await fs.writeFile(path.join(falloutSeason, 'Fallout.S01E01.mkv'), 'video');
  await fs.writeFile(path.join(falloutSeason, 'Fallout.S01E01.es.srt'), 'sub');
  await fs.writeFile(path.join(falloutSeason, 'Fallout.S01E02-E03.mkv'), 'video');
  await fs.writeFile(path.join(falloutSeason, 'Fallout.S01E04-pt1.mkv'), 'video');

  // 4. TV show: missing year & provider ID + Spanish Temporada 2 + Specials
  const darkSeason2 = path.join(config.outputTvShowsDir, 'Dark', 'Temporada 2');
  const darkSpecials = path.join(config.outputTvShowsDir, 'Dark', 'Specials');
  await fs.mkdir(darkSeason2, { recursive: true });
  await fs.mkdir(darkSpecials, { recursive: true });
  await fs.writeFile(path.join(darkSeason2, 'Dark.S02E01.mkv'), 'video');
  await fs.writeFile(path.join(darkSpecials, 'Dark.S00E01.mkv'), 'video');

  // 5. Animated Series: case-only rename
  const caseShow = path.join(
    config.outputAnimatedSeriesDir,
    'steins gate (2011) {tvdb-244061}',
    'season 01'
  );
  await fs.mkdir(caseShow, { recursive: true });
  await fs.writeFile(path.join(caseShow, 'steins.gate.s01e01.mkv'), 'video');

  // 6. Movie: missing provider ID + non-standard movie filename + multiple companion subtitles
  const heatDir = path.join(config.outputMoviesDir, 'Heat (1995)');
  await fs.mkdir(heatDir, { recursive: true });
  await fs.writeFile(path.join(heatDir, 'heat.1080p.mkv'), 'video');
  await fs.writeFile(path.join(heatDir, 'heat.1080p.en.srt'), 'sub');
  await fs.writeFile(path.join(heatDir, 'heat.1080p.es.forced.srt'), 'sub');

  // 7. Movie with preserved [1080p] bracket tags and missing year
  const freeSoloDir = path.join(config.outputMoviesDir, 'Free Solo {imdb-tt7775622} [1080p]');
  await fs.mkdir(freeSoloDir, { recursive: true });
  await fs.writeFile(path.join(freeSoloDir, 'free.solo.mkv'), 'video');

  // 8. Animated Movie: missing year + {edition-Remastered} + split parts pt1/pt2
  const akiraDir = path.join(
    config.outputAnimatedMoviesDir,
    'Akira {imdb-tt0094625} {edition-Remastered}'
  );
  await fs.mkdir(akiraDir, { recursive: true });
  await fs.writeFile(path.join(akiraDir, 'akira-pt1.mkv'), 'video');
  await fs.writeFile(path.join(akiraDir, 'akira-pt2.mkv'), 'video');

  // 9. Unresolved metadata movie (cannot auto-resolve, stays reported)
  const unknownMovie = path.join(config.outputMoviesDir, 'Unknown Mystery Film');
  await fs.mkdir(unknownMovie, { recursive: true });
  await fs.writeFile(path.join(unknownMovie, 'mystery.mkv'), 'video');

  // 10. Destination collision movie (target folder already exists)
  const alienOld = path.join(config.outputMoviesDir, 'Alien {imdb-tt0078748}');
  const alienExisting = path.join(config.outputMoviesDir, 'Alien (1979) {imdb-tt0078748}');
  await fs.mkdir(alienOld, { recursive: true });
  await fs.mkdir(alienExisting, { recursive: true });
  await fs.writeFile(path.join(alienOld, 'Alien (1979) {imdb-tt0078748}.mkv'), 'video');
  await fs.writeFile(path.join(alienExisting, 'Alien (1979) {imdb-tt0078748}.mkv'), 'video');

  return {
    compliantRootsCount: 3, // Carl Sagan Cosmos, Dune, and existing Alien (1979)
    nonCompliantRootsCount: 8,
    expectedFixableIdsCount: 6
  };
}

export const MOCK_VERIFIER_METADATA_DEPS: VerifierMetadataDeps = {
  lookupSeriesByTvdbId: async (tvdbId) => {
    if (tvdbId === asTvdbId('416744')) {
      return { title: 'Fallout', year: 2024, tvdbId, source: 'tvdb' };
    }
    if (tvdbId === asTvdbId('74995')) {
      return { title: 'Carl Sagan Cosmos', year: 1980, tvdbId, source: 'tvdb' };
    }
    if (tvdbId === asTvdbId('244061')) {
      return { title: 'Steins Gate', year: 2011, tvdbId, source: 'tvdb' };
    }
    return undefined;
  },
  searchTvShows: async (query) => {
    if (query.toLowerCase() === 'dark') {
      return [{ title: 'Dark', year: 2017, tvdbId: asTvdbId('332331'), source: 'tvdb' }];
    }
    return [];
  },
  fetchEpisodeTitleMap: async (tvdbId) => {
    if (tvdbId === asTvdbId('416744')) {
      return new Map([
        ['1:1', 'The End'],
        ['1:2', 'The Target'],
        ['1:4', 'The Ghouls']
      ]);
    }
    if (tvdbId === asTvdbId('332331')) {
      return new Map([
        ['2:1', 'Beginnings and Endings'],
        ['0:1', 'Behind the Scenes']
      ]);
    }
    if (tvdbId === asTvdbId('244061')) {
      return new Map([['1:1', 'Turning Point']]);
    }
    return new Map([['1:1', 'The Shores']]);
  },
  lookupMovieByImdbId: async (imdbId) => {
    const cleanId = asImdbId(imdbId);
    if (cleanId === asImdbId('tt1160419')) {
      return { title: 'Dune', year: 2021, imdbId: cleanId, source: 'imdb' };
    }
    if (cleanId === asImdbId('tt7775622')) {
      return { title: 'Free Solo', year: 2018, imdbId: cleanId, source: 'imdb' };
    }
    if (cleanId === asImdbId('tt0094625')) {
      return { title: 'Akira', year: 1988, imdbId: cleanId, source: 'imdb' };
    }
    if (cleanId === asImdbId('tt0078748')) {
      return { title: 'Alien', year: 1979, imdbId: cleanId, source: 'imdb' };
    }
    return undefined;
  },
  searchMovies: async (query) => {
    if (query.toLowerCase() === 'heat') {
      return [{ title: 'Heat', year: 1995, imdbId: asImdbId('tt0113277'), source: 'imdb' }];
    }
    return [];
  }
};
