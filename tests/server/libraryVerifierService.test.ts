import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { asImdbId, asTvdbId } from '../../src/domain/types.ts';
import { loadConfig, type AppConfig } from '../../src/server/config.ts';
import {
  applyVerifierRenames,
  scanLibrariesForCompliance,
  type VerifierMetadataDeps
} from '../../src/server/services/libraryVerifierService.ts';

const tempDirs: string[] = [];

async function makeTempConfig(): Promise<AppConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-verifier-test-'));
  tempDirs.push(root);
  const dirs = {
    CONFIG_DIR: path.join(root, 'config'),
    INPUT_DIR: path.join(root, 'input'),
    BACKUP_DIR: path.join(root, 'backup'),
    OUTPUT_MOVIES_DIR: path.join(root, 'movies'),
    OUTPUT_DOCUMENTARIES_DIR: path.join(root, 'documentaries'),
    OUTPUT_ANIMATED_MOVIES_DIR: path.join(root, 'animated-movies'),
    OUTPUT_TV_SHOWS_DIR: path.join(root, 'tv-shows'),
    OUTPUT_ANIMATED_SERIES_DIR: path.join(root, 'animated-series')
  };
  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
  return loadConfig(dirs);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('libraryVerifierService', () => {
  it('scans all libraries, reports only non-compliant entries, and applies bottom-up renames', async () => {
    const config = await makeTempConfig();

    // 1. Compliant TV show
    const compliantShowSeason = path.join(
      config.outputTvShowsDir,
      'Carl Sagan Cosmos (1980) {tvdb-74995}',
      'Season 01'
    );
    await fs.mkdir(compliantShowSeason, { recursive: true });
    await fs.writeFile(
      path.join(compliantShowSeason, 'Carl Sagan Cosmos (1980) - s01e01 - The Shores.mkv'),
      'video'
    );

    // 2. Non-compliant TV show (missing year, lowercase season dir, non-standard filenames)
    const badShowSeason = path.join(config.outputTvShowsDir, 'Fallout {tvdb-416744}', 'season 1');
    await fs.mkdir(badShowSeason, { recursive: true });
    await fs.writeFile(path.join(badShowSeason, 'Fallout.S01E01.mkv'), 'video');
    await fs.writeFile(path.join(badShowSeason, 'Fallout.S01E01.es.srt'), 'sub');

    // 3. Non-compliant Movie (missing year, wrong video filename)
    const badMovie = path.join(config.outputMoviesDir, 'Dune {imdb-tt1160419}');
    await fs.mkdir(badMovie, { recursive: true });
    await fs.writeFile(path.join(badMovie, 'dune.mkv'), 'video');

    const deps: VerifierMetadataDeps = {
      lookupSeriesByTvdbId: async (tvdbId) => {
        if (tvdbId === asTvdbId('416744')) {
          return { title: 'Fallout', year: 2024, tvdbId, source: 'tvdb' };
        }
        return { title: 'Carl Sagan Cosmos', year: 1980, tvdbId, source: 'tvdb' };
      },
      fetchEpisodeTitleMap: async (tvdbId) => {
        if (tvdbId === asTvdbId('416744')) {
          return new Map([['1:1', 'The End']]);
        }
        return new Map([['1:1', 'The Shores']]);
      },
      searchTvShows: async () => [],
      lookupMovieByImdbId: async (imdbId) => ({
        title: 'Dune',
        year: 2021,
        imdbId: asImdbId(imdbId),
        source: 'imdb'
      }),
      searchMovies: async () => []
    };

    const scan = await scanLibrariesForCompliance(config, undefined, deps);
    expect(scan.summary.librariesScanned).toBe(4);
    expect(scan.summary.totalRootsAnalyzed).toBe(3);
    expect(scan.summary.compliantRoots).toBe(1);
    expect(scan.summary.issueCount).toBe(2);
    expect(scan.summary.totalSeasonDirsAnalyzed).toBe(2);
    expect(scan.summary.totalFilesAnalyzed).toBe(4);
    expect(scan.entries).toHaveLength(2);

    const fixResult = await applyVerifierRenames(config, scan.entries);
    expect(fixResult.fixedEntries).toBe(2);
    expect(fixResult.failures).toEqual([]);
    expect(fixResult.renamedSteps).toBe(6);

    const expectedTvFile = path.join(
      config.outputTvShowsDir,
      'Fallout (2024) {tvdb-416744}',
      'Season 01',
      'Fallout (2024) - s01e01 - The End.mkv'
    );
    const expectedTvSub = path.join(
      config.outputTvShowsDir,
      'Fallout (2024) {tvdb-416744}',
      'Season 01',
      'Fallout (2024) - s01e01 - The End.es.srt'
    );
    const expectedMovieFile = path.join(
      config.outputMoviesDir,
      'Dune (2021) {imdb-tt1160419}',
      'Dune (2021) {imdb-tt1160419}.mkv'
    );

    await expect(fs.access(expectedTvFile)).resolves.toBeUndefined();
    await expect(fs.access(expectedTvSub)).resolves.toBeUndefined();
    await expect(fs.access(expectedMovieFile)).resolves.toBeUndefined();

    const rescan = await scanLibrariesForCompliance(config, undefined, deps);
    expect(rescan.summary.issueCount).toBe(0);
    expect(rescan.entries).toEqual([]);
  });

  it('records failure when a target rename path already exists', async () => {
    const config = await makeTempConfig();
    const badMovie = path.join(config.outputMoviesDir, 'Alien {imdb-tt0078748}');
    const existingTarget = path.join(config.outputMoviesDir, 'Alien (1979) {imdb-tt0078748}');
    await fs.mkdir(badMovie, { recursive: true });
    await fs.mkdir(existingTarget, { recursive: true });
    await fs.writeFile(path.join(badMovie, 'Alien (1979) {imdb-tt0078748}.mkv'), 'video');

    const deps: VerifierMetadataDeps = {
      lookupMovieByImdbId: async (imdbId) => ({
        title: 'Alien',
        year: 1979,
        imdbId: asImdbId(imdbId),
        source: 'imdb'
      })
    };

    const scan = await scanLibrariesForCompliance(config, undefined, deps);
    const alienEntry = scan.entries.find((e) => e.currentRootName === 'Alien {imdb-tt0078748}');
    expect(alienEntry).toBeDefined();

    const fixResult = await applyVerifierRenames(config, alienEntry ? [alienEntry] : []);
    expect(fixResult.fixedEntries).toBe(0);
    expect(fixResult.failures).toHaveLength(1);
    expect(fixResult.failures[0]?.error).toContain('Destination already exists');
  });

  it('handles search fallback, unresolved metadata, inaccessible library, and case-only renames', async () => {
    const config = await makeTempConfig();
    await fs.rm(config.outputAnimatedSeriesDir, { recursive: true, force: true });

    const noIdShow = path.join(config.outputTvShowsDir, 'Dark', 'Season 01');
    await fs.mkdir(noIdShow, { recursive: true });
    await fs.writeFile(path.join(noIdShow, 'Dark.S01E01.mkv'), 'video');

    const unknownMovie = path.join(config.outputMoviesDir, 'Unknown Mystery Film');
    await fs.mkdir(unknownMovie, { recursive: true });
    await fs.writeFile(path.join(unknownMovie, 'mystery.mkv'), 'video');

    const caseMovie = path.join(config.outputAnimatedMoviesDir, 'akira (1988) {imdb-tt0094625}');
    await fs.mkdir(caseMovie, { recursive: true });
    await fs.writeFile(path.join(caseMovie, 'Akira (1988) {imdb-tt0094625}.mkv'), 'video');

    const logs: string[] = [];
    const deps: VerifierMetadataDeps = {
      searchTvShows: async (q) =>
        q === 'Dark'
          ? [{ title: 'Dark', year: 2017, tvdbId: asTvdbId('332331'), source: 'tvdb' }]
          : [],
      fetchEpisodeTitleMap: async () => new Map([['1:1', 'Secrets']]),
      lookupSeriesByTvdbId: async () => undefined,
      lookupMovieByImdbId: async () => undefined,
      searchMovies: async (q) =>
        q.toLowerCase() === 'akira'
          ? [{ title: 'Akira', year: 1988, imdbId: asImdbId('tt0094625'), source: 'imdb' }]
          : []
    };

    const scan = await scanLibrariesForCompliance(config, (_lvl, msg) => logs.push(msg), deps);
    expect(scan.summary.librariesScanned).toBe(3);
    expect(logs.some((m) => m.includes('Skipping inaccessible library'))).toBe(true);

    const darkEntry = scan.entries.find((e) => e.currentRootName === 'Dark');
    const unknownEntry = scan.entries.find((e) => e.currentRootName === 'Unknown Mystery Film');
    const caseEntry = scan.entries.find(
      (e) => e.currentRootName === 'akira (1988) {imdb-tt0094625}'
    );
    expect(darkEntry?.expectedRootName).toBe('Dark (2017) {tvdb-332331}');
    expect(unknownEntry?.issues).toContain('UNRESOLVED_METADATA');
    expect(caseEntry).toBeDefined();

    const fixRes = await applyVerifierRenames(
      config,
      [darkEntry, caseEntry].filter((e): e is NonNullable<typeof e> => Boolean(e))
    );
    expect(fixRes.fixedEntries).toBe(2);
    expect(fixRes.failures).toEqual([]);
  });

  it('handles episode-title fetch errors, preferredYear candidate matching, and unresolved lookups', async () => {
    const config = await makeTempConfig();
    const showDir = path.join(config.outputTvShowsDir, 'Lost {tvdb-73739}', 'Season 01');
    await fs.mkdir(showDir, { recursive: true });
    await fs.writeFile(path.join(showDir, 'Lost.S01E01.mkv'), 'video');

    const movieWithYear = path.join(config.outputMoviesDir, 'Heat (1995)');
    await fs.mkdir(movieWithYear, { recursive: true });
    await fs.writeFile(path.join(movieWithYear, 'heat.mkv'), 'video');

    const unfoundTv = path.join(config.outputAnimatedSeriesDir, 'NoMatchShow', 'Season 01');
    await fs.mkdir(unfoundTv, { recursive: true });
    await fs.writeFile(path.join(unfoundTv, 'NoMatchShow.S01E01.mkv'), 'video');

    const logs: string[] = [];
    const deps: VerifierMetadataDeps = {
      lookupSeriesByTvdbId: async () => undefined,
      fetchEpisodeTitleMap: async () => {
        throw new Error('tvdb timeout');
      },
      searchTvShows: async () => [],
      searchMovies: async () => [
        { title: 'Heat', year: 2013, imdbId: asImdbId('tt2404463'), source: 'imdb' },
        { title: 'Heat', year: 1995, imdbId: asImdbId('tt0113277'), source: 'imdb' }
      ],
      lookupMovieByImdbId: async () => undefined
    };

    const scan = await scanLibrariesForCompliance(config, (_lvl, msg) => logs.push(msg), deps);
    expect(logs.some((m) => m.includes('Failed to fetch episode titles'))).toBe(true);
    const lost = scan.entries.find((e) => e.currentRootName === 'Lost {tvdb-73739}');
    const heat = scan.entries.find((e) => e.currentRootName === 'Heat (1995)');
    const noMatch = scan.entries.find((e) => e.currentRootName === 'NoMatchShow');
    expect(lost?.issues).toContain('UNRESOLVED_METADATA');
    expect(heat?.expectedRootName).toBe('Heat (1995) {imdb-tt0113277}');
    expect(noMatch?.issues).toContain('UNRESOLVED_METADATA');
  });

  it('falls back to content move on directory EACCES and surfaces actionable permission error on file EACCES without chown/chmod', async () => {
    const config = await makeTempConfig();
    const movieDir = path.join(config.outputMoviesDir, 'Dune {imdb-tt1160419}');
    await fs.mkdir(movieDir, { recursive: true });
    await fs.writeFile(path.join(movieDir, 'Dune (2021) {imdb-tt1160419}.mkv'), 'video');

    const deps: VerifierMetadataDeps = {
      lookupMovieByImdbId: async () => ({
        title: 'Dune',
        year: 2021,
        imdbId: asImdbId('tt1160419'),
        source: 'imdb'
      })
    };
    const scan = await scanLibrariesForCompliance(config, undefined, deps);
    const entry = scan.entries[0];
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }

    const originalRename = fs.rename.bind(fs);
    const chownSpy = vi.spyOn(fs, 'chown');
    const chmodSpy = vi.spyOn(fs, 'chmod');
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      )
      .mockImplementation(originalRename);

    try {
      const dirRes = await applyVerifierRenames(config, [entry]);
      expect(dirRes.fixedEntries).toBe(1);
      expect(dirRes.failures).toHaveLength(0);
      expect(chownSpy).not.toHaveBeenCalled();
      expect(chmodSpy).not.toHaveBeenCalled();

      const expectedFile = path.join(
        config.outputMoviesDir,
        'Dune (2021) {imdb-tt1160419}',
        'Dune (2021) {imdb-tt1160419}.mkv'
      );
      await expect(fs.stat(expectedFile)).resolves.toBeDefined();

      // Now test non-compliant filename (file-level EACCES and ENOENT)
      const fileDir = path.join(config.outputMoviesDir, 'Arrival (2016) {imdb-tt2543164}');
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(path.join(fileDir, 'Arrival.mkv'), 'video');
      const fileScan = await scanLibrariesForCompliance(config, undefined, {
        lookupMovieByImdbId: async () => ({
          title: 'Arrival',
          year: 2016,
          imdbId: asImdbId('tt2543164'),
          source: 'imdb'
        })
      });
      const fileEntry = fileScan.entries.find((e) => e.id.includes('tt2543164'));
      expect(fileEntry).toBeDefined();
      if (!fileEntry) {
        return;
      }

      renameSpy.mockReset();
      renameSpy
        .mockRejectedValueOnce(
          Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
        )
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' }));

      const fileEaccesRes = await applyVerifierRenames(config, [fileEntry]);
      expect(fileEaccesRes.fixedEntries).toBe(0);
      expect(fileEaccesRes.failures[0]?.error).toContain('PUID/PGID');
      expect(chownSpy).not.toHaveBeenCalled();
      expect(chmodSpy).not.toHaveBeenCalled();

      const enoentRes = await applyVerifierRenames(config, [fileEntry]);
      expect(enoentRes.failures[0]?.error).toContain('ENOENT');
    } finally {
      renameSpy.mockRestore();
      chownSpy.mockRestore();
      chmodSpy.mockRestore();
    }
  });

  it('falls back to title search when TVDB/IMDb ID lookup returns undefined so {tvdb-...} folders still resolve year', async () => {
    const config = await makeTempConfig();
    const showDir = path.join(
      config.outputAnimatedSeriesDir,
      'Cyber City Oedo 808 {tvdb-81931}',
      'Season 01'
    );
    await fs.mkdir(showDir, { recursive: true });
    await fs.writeFile(
      path.join(showDir, 'Cyber City Oedo 808 (1990) - s01e01 - Virtual Death.mkv'),
      'video'
    );

    const scan = await scanLibrariesForCompliance(config, undefined, {
      lookupSeriesByTvdbId: async () => undefined,
      searchTvShows: async (query) =>
        query === 'Cyber City Oedo 808'
          ? [{ title: 'Cyber City Oedo 808', year: 1990, source: 'tvmaze' }]
          : [],
      fetchEpisodeTitleMap: async () => new Map()
    });

    const entry = scan.entries.find(
      (e) => e.currentRootName === 'Cyber City Oedo 808 {tvdb-81931}'
    );
    expect(entry).toBeDefined();
    expect(entry?.issues).not.toContain('UNRESOLVED_METADATA');
    expect(entry?.expectedRootName).toBe('Cyber City Oedo 808 (1990) {tvdb-81931}');
    expect(entry?.resolvedYear).toBe(1990);
  });

  it('rejects dissimilar title fallback candidates when ID lookup returns undefined', async () => {
    const config = await makeTempConfig();
    const showDir = path.join(config.outputTvShowsDir, 'Cha Cha Cha {tvdb-83962}', 'Season 01');
    await fs.mkdir(showDir, { recursive: true });
    await fs.writeFile(path.join(showDir, 'Cha Cha Cha - s01e01.mkv'), 'video');

    const scan = await scanLibrariesForCompliance(config, undefined, {
      lookupSeriesByTvdbId: async () => undefined,
      searchTvShows: async () => [{ title: 'Hometown Cha-Cha-Cha', year: 2021, source: 'tvmaze' }],
      fetchEpisodeTitleMap: async () => new Map()
    });

    const entry = scan.entries.find((e) => e.currentRootName === 'Cha Cha Cha {tvdb-83962}');
    expect(entry?.issues).toContain('UNRESOLVED_METADATA');
    expect(entry?.expectedRootName).toBe('Cha Cha Cha {tvdb-83962}');
  });

  it('removes recursively empty source directories instead of failing with Destination already exists', async () => {
    const config = await makeTempConfig();
    const emptyRoot = path.join(config.outputAnimatedSeriesDir, 'Dragon Ball DAIMA {tvdb-440820}');
    await fs.mkdir(path.join(emptyRoot, 'Season 1'), { recursive: true });

    const existingTarget = path.join(
      config.outputAnimatedSeriesDir,
      'Dragon Ball DAIMA (2024) {tvdb-440820}',
      'Season 01'
    );
    await fs.mkdir(existingTarget, { recursive: true });
    await fs.writeFile(
      path.join(existingTarget, 'Dragon Ball DAIMA (2024) - s01e01 - Conspiracy.mkv'),
      'video'
    );

    const scan = await scanLibrariesForCompliance(config, undefined, {
      lookupSeriesByTvdbId: async () => ({
        title: 'Dragon Ball DAIMA',
        year: 2024,
        tvdbId: asTvdbId('440820'),
        source: 'tvdb'
      }),
      searchTvShows: async () => [],
      fetchEpisodeTitleMap: async () => new Map()
    });
    const entry = scan.entries.find((e) => e.currentRootName === 'Dragon Ball DAIMA {tvdb-440820}');
    expect(entry).toBeDefined();
    expect(entry?.issues).toEqual(['EMPTY_DIRECTORY']);
    expect(entry?.expectedRootName).toBe('Delete empty directory');
    expect(entry?.steps[0]?.kind).toBe('delete-dir');

    const fixResult = await applyVerifierRenames(config, entry ? [entry] : []);
    expect(fixResult.failures).toEqual([]);
    expect(fixResult.fixedEntries).toBe(1);
    await expect(fs.access(emptyRoot)).rejects.toThrow(/ENOENT/);
  });

  it('ignores hidden, NAS system (.@__thumb, @eaDir, .DS_Store, Thumbs.db), and temporary files in compliance scans and empty-directory cleanup while protecting .!qB downloads', async () => {
    const config = await makeTempConfig();

    const ghostRoot = path.join(config.outputMoviesDir, 'Ghost Folder (2021)');
    await fs.mkdir(path.join(ghostRoot, '.@__thumb'), { recursive: true });
    await fs.mkdir(path.join(ghostRoot, '@eaDir'), { recursive: true });
    await fs.writeFile(path.join(ghostRoot, '.DS_Store'), 'junk');
    await fs.writeFile(path.join(ghostRoot, 'Thumbs.db'), 'junk');
    await fs.writeFile(path.join(ghostRoot, '.@__thumb', 's100Godzilla.mkv'), 'thumb');
    await fs.writeFile(path.join(ghostRoot, '@eaDir', 'SynologyThumb.mkv'), 'thumb');

    const compliantRoot = path.join(
      config.outputMoviesDir,
      'Compliant Movie (2020) {imdb-tt1234567}'
    );
    await fs.mkdir(compliantRoot, { recursive: true });
    await fs.writeFile(
      path.join(compliantRoot, 'Compliant Movie (2020) {imdb-tt1234567}.mkv'),
      'video'
    );
    await fs.writeFile(path.join(compliantRoot, '.DS_Store'), 'junk');
    await fs.writeFile(path.join(compliantRoot, '._Compliant Movie.mkv'), 'appledouble');
    await fs.writeFile(path.join(compliantRoot, 'Thumbs.db'), 'junk');
    await fs.writeFile(path.join(compliantRoot, 'Extra.mkv.!qB'), 'partial');

    const activeRoot = path.join(config.outputMoviesDir, 'Active Download (2025) {imdb-tt7654321}');
    await fs.mkdir(activeRoot, { recursive: true });
    await fs.writeFile(path.join(activeRoot, 'Active Download (2025).mkv.!qB'), 'downloading');

    const scan = await scanLibrariesForCompliance(config, undefined, {
      lookupMovieByImdbId: async () => undefined,
      searchMovies: async () => []
    });

    expect(scan.summary.totalFilesAnalyzed).toBe(1);
    expect(
      scan.entries.find((e) => e.currentRootName === 'Compliant Movie (2020) {imdb-tt1234567}')
    ).toBeUndefined();

    const activeEntry = scan.entries.find(
      (e) => e.currentRootName === 'Active Download (2025) {imdb-tt7654321}'
    );
    expect(activeEntry?.issues ?? []).not.toContain('EMPTY_DIRECTORY');

    const ghostEntry = scan.entries.find((e) => e.currentRootName === 'Ghost Folder (2021)');
    expect(ghostEntry?.issues).toEqual(['EMPTY_DIRECTORY']);

    const fixResult = await applyVerifierRenames(config, ghostEntry ? [ghostEntry] : []);
    expect(fixResult.failures).toEqual([]);
    await expect(fs.access(ghostRoot)).rejects.toThrow(/ENOENT/);
  });
});
