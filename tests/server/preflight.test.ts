import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

import {
  asImdbId,
  asIso639_2Code,
  asItemId,
  asTvdbId,
  type MediaProbeSummary,
  type MountPathsMap,
  type ScannedItem
} from '../../src/domain/types.ts';
import { runPreflightCheck } from '../../src/server/services/preflight.ts';

const PROBE: MediaProbeSummary = {
  formatName: 'matroska',
  durationSeconds: 1000,
  sizeBytes: 1024,
  bitrateBps: 500_000,
  videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
  audioStreams: [
    {
      index: 1,
      streamOrder: 0,
      codecName: 'aac',
      language: asIso639_2Code('eng'),
      channels: 2,
      isDefault: true
    }
  ],
  subtitleStreams: []
};

function makeItem(id: string, title: string, imdb: string): ScannedItem {
  return {
    id: asItemId(id),
    sourcePath: `/input/${id}.mkv`,
    relativePath: `${id}.mkv`,
    fileName: `${id}.mkv`,
    mediaKind: 'movie',
    category: 'movies',
    include: true,
    parsedTitle: title,
    parsedYear: 2019,
    tags: ['1080p'],
    probe: PROBE,
    externalSubtitles: [],
    candidates: [{ title, year: 2019, imdbId: asImdbId(imdb), source: 'imdb' }],
    selectedMetadata: { title, year: 2019, imdbId: asImdbId(imdb), source: 'imdb' },
    episodeOrder: 'aired',
    trackSelection: {
      audioTracks: [
        { streamOrder: 0, include: true, language: asIso639_2Code('eng'), isDefault: true }
      ],
      subtitleMergeMode: 'keep-and-add',
      includedInternalSubtitles: [],
      externalSubtitleOrder: [],
      needsUserPrompt: false
    },
    warnings: []
  };
}

describe('preflight', () => {
  it('detects existing-file and intra-batch collisions', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-pre-'));
    try {
      const moviesDir = path.join(tmpDir, 'movies');
      await fs.mkdir(moviesDir, { recursive: true });
      const mounts: MountPathsMap = {
        inputDir: tmpDir,
        movies: moviesDir,
        'animated-movies': tmpDir,
        'tv-shows': tmpDir,
        'animated-series': tmpDir
      };

      const itemA = makeItem('a', '1917', 'tt8579674');
      const existingFolder = path.join(moviesDir, '1917 (2019) {imdb-tt8579674} [1080p]');
      await fs.mkdir(existingFolder, { recursive: true });
      await fs.writeFile(
        path.join(existingFolder, '1917 (2019) {imdb-tt8579674} [1080p].mkv'),
        'existing'
      );

      const report1 = await runPreflightCheck([itemA], mounts, async () => PROBE);
      expect(report1.ok).toBe(false);
      expect(report1.conflicts).toHaveLength(1);
      expect(report1.conflicts[0]?.kind).toBe('existing-file');

      const itemB = makeItem('b', 'Unique', 'tt0000001');
      const itemC = makeItem('c', 'Unique', 'tt0000001');
      const report2 = await runPreflightCheck([itemB, itemC], mounts, async () => PROBE);
      expect(report2.ok).toBe(false);
      expect(report2.conflicts).toHaveLength(2);
      expect(report2.conflicts[0]?.kind).toBe('intra-batch');

      // Semantic TV episode collision when existing output episode has an older/untrimmed title
      const seasonDir = path.join(tmpDir, 'Show (2026) {tvdb-463051}', 'Season 01');
      await fs.mkdir(seasonDir, { recursive: true });
      const oldEpisodeFile = path.join(
        seasonDir,
        'Show (2026) - s01e01 - Legacy Untrimmed Episode Title.mkv'
      );
      await fs.writeFile(oldEpisodeFile, 'existing-tv');

      const tvItem: ScannedItem = {
        ...makeItem('tv-1', 'Show', 'tt0000002'),
        mediaKind: 'tv',
        category: 'animated-series',
        parsedYear: 2026,
        tags: [],
        selectedMetadata: { title: 'Show', year: 2026, tvdbId: asTvdbId('463051'), source: 'tvdb' },
        episode: { seasonNumber: 1, episodeStart: 1, episodeTitle: 'New Short Title' }
      };
      const reportTv = await runPreflightCheck([tvItem], mounts, async () => PROBE);
      expect(reportTv.ok).toBe(false);
      expect(reportTv.conflicts).toHaveLength(1);
      expect(reportTv.conflicts[0]?.kind).toBe('existing-file');
      expect(reportTv.conflicts[0]?.existingPath).toBe(oldEpisodeFile);
      expect(reportTv.conflicts[0]?.sourceFileName).toBe('tv-1.mkv');

      // Semantic movie collision inside same dedicated folder when filename differs
      const diffMovieDir = path.join(moviesDir, 'Dune (2021) {imdb-tt1160419} [1080p]');
      await fs.mkdir(diffMovieDir, { recursive: true });
      const oldMovieFile = path.join(diffMovieDir, 'Dune (2021) {imdb-tt1160419}.mkv');
      await fs.writeFile(oldMovieFile, 'old-movie');
      const movieDiff = makeItem('m-diff', 'Dune', 'tt1160419');
      const reportMovieDiff = await runPreflightCheck(
        [
          {
            ...movieDiff,
            parsedYear: 2021,
            selectedMetadata: {
              title: 'Dune',
              year: 2021,
              imdbId: asImdbId('tt1160419'),
              source: 'imdb'
            }
          }
        ],
        mounts,
        async () => PROBE
      );
      expect(reportMovieDiff.conflicts).toHaveLength(1);
      expect(reportMovieDiff.conflicts[0]?.existingPath).toBe(oldMovieFile);
      expect(reportMovieDiff.conflicts[0]?.displayPath).toBe(
        'movies/Dune (2021) {imdb-tt1160419} [1080p]/Dune (2021) {imdb-tt1160419}.mkv'
      );

      // Daily airDate TV item without collision
      const dailyItem: ScannedItem = {
        ...tvItem,
        id: asItemId('tv-daily'),
        episode: { seasonNumber: 0, episodeStart: 1, airDate: '2024-10-07' }
      };
      const reportDaily = await runPreflightCheck([dailyItem], mounts, async () => PROBE);
      expect(reportDaily.ok).toBe(true);

      // Multi-episode TV item colliding with existing multi-episode file
      const multiEpFile = path.join(seasonDir, 'Show (2026) - s02e01-e02 - Double Ep.mkv');
      await fs.mkdir(path.join(tmpDir, 'Show (2026) {tvdb-463051}', 'Season 02'), {
        recursive: true
      });
      await fs.writeFile(
        path.join(tmpDir, 'Show (2026) {tvdb-463051}', 'Season 02', path.basename(multiEpFile)),
        'existing-multi'
      );
      const multiItem: ScannedItem = {
        ...tvItem,
        id: asItemId('tv-multi'),
        episode: { seasonNumber: 2, episodeStart: 1, episodeEnd: 2 }
      };
      const reportMulti = await runPreflightCheck([multiItem], mounts, async () => PROBE);
      expect(reportMulti.ok).toBe(false);

      // Folder with only non-video files does not trigger a false movie collision
      const textOnlyDir = path.join(moviesDir, 'Clean (2025) {imdb-tt9999999}');
      await fs.mkdir(textOnlyDir, { recursive: true });
      await fs.writeFile(path.join(textOnlyDir, 'readme.txt'), 'not a video');
      const cleanMovie = makeItem('m-clean', 'Clean', 'tt9999999');
      const reportClean = await runPreflightCheck(
        [
          {
            ...cleanMovie,
            parsedYear: 2025,
            tags: [],
            selectedMetadata: {
              title: 'Clean',
              year: 2025,
              imdbId: asImdbId('tt9999999'),
              source: 'imdb'
            }
          },
          { ...cleanMovie, id: asItemId('m-excluded'), include: false },
          {
            ...tvItem,
            id: asItemId('tv-ep3'),
            episode: { seasonNumber: 1, episodeStart: 3, episodeTitle: 'Ep Three' }
          },
          {
            ...tvItem,
            id: asItemId('tv-default-ep'),
            episode: undefined,
            selectedMetadata: {
              title: 'FreshShow',
              year: 2026,
              tvdbId: asTvdbId('999999'),
              source: 'tvdb'
            }
          }
        ],
        mounts,
        async () => PROBE
      );
      expect(reportClean.ok).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
