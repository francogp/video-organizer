import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { loadConfig, type AppConfig } from '../../src/server/config.ts';
import {
  applyVerifierRenames,
  scanLibrariesForCompliance
} from '../../src/server/services/libraryVerifierService.ts';
import {
  MOCK_VERIFIER_METADATA_DEPS,
  seedVerifierFixtureLibraries
} from '../fixtures/verifierFixtures.ts';

const tempDirs: string[] = [];

async function makeTempConfig(): Promise<AppConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-verifier-matrix-'));
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

describe('libraryVerifier fix matrix fixtures', () => {
  it('detects and fixes all Plex naming combinations across all 4 libraries in strict bottom-up order', async () => {
    const config = await makeTempConfig();
    const seed = await seedVerifierFixtureLibraries(config);

    const scan = await scanLibrariesForCompliance(config, undefined, MOCK_VERIFIER_METADATA_DEPS);
    expect(scan.summary.librariesScanned).toBe(4);
    expect(scan.summary.compliantRoots).toBe(seed.compliantRootsCount);
    expect(scan.summary.issueCount).toBe(seed.nonCompliantRootsCount);

    const byName = new Map(scan.entries.map((entry) => [entry.currentRootName, entry]));

    // Verify bottom-up ordering (`file` -> `season-dir` -> `root-dir`) on Fallout
    const fallout = byName.get('Fallout {tvdb-416744}');
    expect(fallout?.issues).toEqual(
      expect.arrayContaining(['MISSING_YEAR', 'NON_STANDARD_SEASON_DIR', 'NON_STANDARD_FILENAME'])
    );
    const falloutKinds = fallout?.steps.map((s) => s.kind) ?? [];
    expect(falloutKinds.slice(0, -2).every((k) => k === 'file')).toBe(true);
    expect(falloutKinds.slice(-2)).toEqual(['season-dir', 'root-dir']);

    // Verify unresolved & collision entries are present
    expect(byName.get('Unknown Mystery Film')?.issues).toContain('UNRESOLVED_METADATA');
    expect(byName.get('Alien {imdb-tt0078748}')).toBeDefined();

    // Apply fixes to all 6 fixable entries (excluding Unknown Mystery Film & colliding Alien)
    const fixableEntries = scan.entries.filter(
      (e) =>
        e.currentRootName !== 'Unknown Mystery Film' &&
        e.currentRootName !== 'Alien {imdb-tt0078748}'
    );
    expect(fixableEntries).toHaveLength(seed.expectedFixableIdsCount);

    const fixResult = await applyVerifierRenames(config, fixableEntries);
    expect(fixResult.fixedEntries).toBe(seed.expectedFixableIdsCount);
    expect(fixResult.failures).toEqual([]);

    // Verify renamed files exist at exact Plex paths
    await expect(
      fs.access(
        path.join(
          config.outputTvShowsDir,
          'Fallout (2024) {tvdb-416744}',
          'Season 01',
          'Fallout (2024) - s01e01 - The End.es.srt'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputTvShowsDir,
          'Fallout (2024) {tvdb-416744}',
          'Season 01',
          'Fallout (2024) - s01e02-e03 - The Target.mkv'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputTvShowsDir,
          'Dark (2017) {tvdb-332331}',
          'Season 02',
          'Dark (2017) - s02e01 - Beginnings and Endings.mkv'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputTvShowsDir,
          'Dark (2017) {tvdb-332331}',
          'Season 00',
          'Dark (2017) - s00e01 - Behind the Scenes.mkv'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputAnimatedSeriesDir,
          'Steins Gate (2011) {tvdb-244061}',
          'Season 01',
          'Steins Gate (2011) - s01e01 - Turning Point.mkv'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputMoviesDir,
          'Heat (1995) {imdb-tt0113277} [1080p]',
          'Heat (1995) {imdb-tt0113277} [1080p].es.forced.srt'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputMoviesDir,
          'Free Solo (2018) {imdb-tt7775622} [1080p]',
          'Free Solo (2018) {imdb-tt7775622} [1080p].mkv'
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.outputAnimatedMoviesDir,
          'Akira (1988) {imdb-tt0094625} {edition-Remastered}',
          'Akira (1988) {imdb-tt0094625} {edition-Remastered} - pt1.mkv'
        )
      )
    ).resolves.toBeUndefined();

    // Re-scan: only Unknown Mystery Film and colliding Alien should remain non-compliant
    const rescan = await scanLibrariesForCompliance(config, undefined, MOCK_VERIFIER_METADATA_DEPS);
    expect(rescan.summary.compliantRoots).toBe(
      seed.compliantRootsCount + seed.expectedFixableIdsCount
    );
    expect(rescan.entries.map((e) => e.currentRootName).sort()).toEqual([
      'Alien {imdb-tt0078748}',
      'Unknown Mystery Film'
    ]);
  });
});
