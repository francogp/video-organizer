import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  asClientId,
  asIso639_2Code,
  asTvdbId,
  type MediaProbeSummary
} from '../../src/domain/types.ts';
import { loadConfig } from '../../src/server/config.ts';

const MOCK_PROBE: MediaProbeSummary = {
  formatName: 'matroska',
  durationSeconds: 120,
  sizeBytes: 1_000_000,
  bitrateBps: 2_000_000,
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

vi.mock('../../src/server/services/media/ffmpegRunner.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/server/services/media/ffmpegRunner.ts')>();
  return {
    ...actual,
    probeMedia: vi.fn(async () => MOCK_PROBE),
    analyzeAudioVolume: vi.fn(async () => ({
      streamOrder: 0,
      meanVolumeDb: -24,
      maxVolumeDb: -5,
      suggestion: 'loudnorm',
      recommendedGainDb: 4
    })),
    measureLoudnormPass1: vi.fn(
      async (
        _path: string,
        _stream: number,
        _downmix: boolean,
        _dur?: number,
        onProgress?: (update: { readonly percent: number; readonly etaSeconds?: number }) => void
      ) => {
        onProgress?.({ percent: 50, etaSeconds: 10 });
        return {
          inputI: '-24.0',
          inputTp: '-5.0',
          inputLra: '8.0',
          inputThresh: '-34.0',
          targetOffset: '0.5'
        };
      }
    ),
    runFfmpegRemux: vi.fn(
      async (
        args: readonly string[],
        _dur: number,
        onProgress: (percent: number, etaSeconds?: number) => void
      ) => {
        const outPath = args.at(-1)!;
        await fs.writeFile(outPath, 'remuxed-mkv');
        onProgress(50, 5);
        onProgress(100, 0);
      }
    )
  };
});

vi.mock('../../src/server/services/metadata/imdbClient.ts', () => ({
  searchMovies: vi.fn(async () => [
    { title: 'Arrival', year: 2016, imdbId: 'tt2543164', source: 'imdb' }
  ]),
  lookupMovieByImdbId: vi.fn(async () => ({
    title: 'Arrival',
    year: 2016,
    imdbId: 'tt2543164',
    source: 'omdb'
  }))
}));

vi.mock('../../src/server/services/metadata/tvdbClient.ts', () => ({
  searchTvShows: vi.fn(async () => [
    { title: 'Dark', year: 2017, tvdbId: '334824', source: 'tvdb' }
  ]),
  fetchEpisodeTitleMap: vi.fn(async () => new Map([['1:1', 'Secrets']]))
}));

import { JobRunner } from '../../src/server/services/jobRunner.ts';

describe('JobRunner execution pipeline', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scans movie + TV show, patches metadata, searches, runs preflight, and completes remux+move job', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-exec-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputMovies = path.join(tmpDir, 'movies');
    const outputTv = path.join(tmpDir, 'tv');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(path.join(inputDir, 'Arrival (2016)'), { recursive: true });
    await fs.mkdir(path.join(inputDir, 'Dune (2021)'), { recursive: true });
    await fs.mkdir(path.join(inputDir, 'Dark', 'Season 01'), { recursive: true });
    await fs.mkdir(outputMovies, { recursive: true });
    await fs.mkdir(outputTv, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    await fs.writeFile(path.join(inputDir, 'Arrival (2016)', 'Arrival.2016.mkv'), 'movie-bytes');
    await fs.writeFile(path.join(inputDir, 'Dune (2021)', 'Dune.2021.mkv'), 'dune-bytes');
    await fs.writeFile(
      path.join(inputDir, 'Arrival (2016)', 'Arrival.2016.es.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nHola\n'
    );
    await fs.writeFile(path.join(inputDir, 'Dark', 'Season 01', 'Dark.S01E01.mkv'), 'tv-bytes');

    const cfg = loadConfig({
      CONFIG_DIR: configDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: outputMovies,
      OUTPUT_DOCUMENTARIES_DIR: outputMovies,
      OUTPUT_ANIMATED_MOVIES_DIR: outputMovies,
      OUTPUT_TV_SHOWS_DIR: outputTv,
      OUTPUT_ANIMATED_SERIES_DIR: outputTv
    });

    const runner = new JobRunner(cfg);
    await runner.init();

    const events: string[] = [];
    const unsub = runner.subscribe({
      send(evt) {
        events.push(evt);
      }
    });

    const clientId = asClientId('exec:1');
    runner.startScan(clientId);

    // Wait for async #executeScan to settle to READY
    for (let i = 0; i < 40 && runner.getState().phase !== 'READY'; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(runner.getState().phase).toBe('READY');
    expect(runner.getState().items).toHaveLength(3);

    const tvItem = runner.getState().items.find((i) => i.mediaKind === 'tv')!;
    const ignoredItem = runner.getState().items.find((i) => i.fileName.includes('Dune'))!;
    expect(tvItem.episode?.episodeTitle).toBe('Secrets');

    // Search metadata branches
    await expect(
      runner.searchMetadata(clientId, {
        query: 'tt2543164',
        kind: 'movie',
        imdbId: 'tt2543164'
      })
    ).resolves.toHaveLength(1);
    await expect(
      runner.searchMetadata(clientId, { query: 'Arrival', kind: 'movie' })
    ).resolves.toHaveLength(1);
    await expect(
      runner.searchMetadata(clientId, { query: 'Dark', kind: 'tv' })
    ).resolves.toHaveLength(1);

    // Patch TV item order + audio normalization, and exclude ignoredItem (include: false)
    let patched = await runner.patchItem(clientId, runner.getState().revision, ignoredItem.id, {
      include: false
    });
    patched = await runner.patchItem(clientId, patched.revision, tvItem.id, {
      episodeOrder: 'dvd',
      selectedMetadata: tvItem.selectedMetadata,
      audioNormalization: { mode: 'loudnorm', codec: 'auto', downmixStereo: false }
    });

    // Preflight & startJob
    const report = await runner.preflight(clientId, patched.revision);
    expect(report.ok).toBe(true);

    await runner.startJob(clientId, report.revision, {});
    for (let i = 0; i < 50 && runner.getState().phase !== 'IDLE'; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(runner.getState().phase).toBe('IDLE');
    expect(runner.getState().items.map((i) => i.id)).toEqual([ignoredItem.id]);
    expect(events).toContain('progress');
    expect(events).toContain('log');

    unsub();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('handles PREFLIGHT_BLOCKED conflicts, unresolved conflict error, overwrite, and remux failure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-exec-err-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputMovies = path.join(tmpDir, 'movies');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(path.join(inputDir, 'sub1'), { recursive: true });
    await fs.mkdir(path.join(inputDir, 'sub2'), { recursive: true });
    await fs.mkdir(outputMovies, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    await fs.writeFile(path.join(inputDir, 'sub1', 'Arrival (2016).mkv'), 'movie-bytes-1');
    await fs.writeFile(path.join(inputDir, 'sub2', 'Arrival (2016).mkv'), 'movie-bytes-2');

    const cfg = loadConfig({
      CONFIG_DIR: configDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: outputMovies,
      OUTPUT_DOCUMENTARIES_DIR: outputMovies,
      OUTPUT_ANIMATED_MOVIES_DIR: outputMovies,
      OUTPUT_TV_SHOWS_DIR: outputMovies,
      OUTPUT_ANIMATED_SERIES_DIR: outputMovies
    });

    const runner = new JobRunner(cfg);
    await runner.init();
    const clientId = asClientId('exec2:1');
    runner.startScan(clientId);
    for (let i = 0; i < 40 && runner.getState().phase !== 'READY'; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }

    const report = await runner.preflight(clientId, runner.getState().revision);
    expect(report.ok).toBe(false);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(runner.getState().phase).toBe('PREFLIGHT_BLOCKED');

    // Unresolved conflict throws
    await expect(runner.startJob(clientId, report.revision, {})).rejects.toThrow(
      'Unresolved conflict'
    );

    // Make ffmpeg fail on next run to exercise ERROR catch path
    const ffmpegMod = await import('../../src/server/services/media/ffmpegRunner.ts');
    vi.mocked(ffmpegMod.runFfmpegRemux).mockRejectedValueOnce(new Error('ffmpeg crashed'));

    const resolutions: Record<string, 'overwrite' | 'ignore'> = {};
    for (const c of report.conflicts) {
      resolutions[c.itemId] = Object.keys(resolutions).length === 0 ? 'overwrite' : 'ignore';
    }
    await runner.startJob(clientId, report.revision, resolutions);
    for (let i = 0; i < 40 && runner.getState().phase !== 'ERROR'; i += 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(runner.getState().phase).toBe('ERROR');

    await runner.unlock(clientId, false);
    expect(runner.getState().phase).toBe('IDLE');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('populates queue with completed items when scan is cancelled via unlock', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-cancel-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, 'Movie.One.2020.mkv'), 'a');
    await fs.writeFile(path.join(inputDir, 'Movie.Two.2021.mkv'), 'b');

    const ffmpegMod = await import('../../src/server/services/media/ffmpegRunner.ts');
    let releaseSecond!: () => void;
    const secondWait = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let callCount = 0;
    vi.mocked(ffmpegMod.analyzeAudioVolume).mockImplementation(async () => {
      callCount += 1;
      if (callCount > 1) {
        await secondWait;
      }
      return {
        streamOrder: 0,
        meanVolumeDb: -20,
        maxVolumeDb: -2,
        suggestion: 'ok',
        recommendedGainDb: 0
      };
    });

    const { JobRunner } = await import('../../src/server/services/jobRunner.ts');
    const runner = new JobRunner(
      loadConfig({
        CONFIG_DIR: configDir,
        INPUT_DIR: inputDir,
        OUTPUT_MOVIES_DIR: outputDir,
        OUTPUT_DOCUMENTARIES_DIR: outputDir,
        OUTPUT_ANIMATED_MOVIES_DIR: outputDir,
        OUTPUT_TV_SHOWS_DIR: outputDir,
        OUTPUT_ANIMATED_SERIES_DIR: outputDir
      })
    );
    await runner.init();

    const clientId = asClientId('c1:t1');
    runner.startScan(clientId);
    for (let i = 0; i < 40 && (runner.getState().activeJob?.completedItems ?? 0) < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const unlockPromise = runner.unlock(clientId, false);
    releaseSecond();
    const state = await unlockPromise;

    expect(state.phase).toBe('READY');
    expect(state.items.length).toBeGreaterThanOrEqual(1);
    expect(state.activeJob).toBeNull();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps unprocessed items and removes completed items when processing job is cancelled via unlock', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-job-cancel-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, 'Arrival.2016.mkv'), 'a');
    await fs.writeFile(path.join(inputDir, 'Dark.S01E01.mkv'), 'b');

    const ffmpegMod = await import('../../src/server/services/media/ffmpegRunner.ts');
    vi.mocked(ffmpegMod.analyzeAudioVolume).mockResolvedValue({
      streamOrder: 0,
      meanVolumeDb: -20,
      maxVolumeDb: -2,
      suggestion: 'ok',
      recommendedGainDb: 0
    });

    let releaseSecondRemux!: () => void;
    const secondRemuxWait = new Promise<void>((resolve) => {
      releaseSecondRemux = resolve;
    });
    let remuxCount = 0;
    vi.mocked(ffmpegMod.runFfmpegRemux).mockImplementation(async (args, _dur, onProgress) => {
      remuxCount += 1;
      const outPath = args.at(-1)!;
      if (remuxCount > 1) {
        await secondRemuxWait;
      }
      await fs.writeFile(outPath, 'remuxed');
      onProgress(100, 0);
    });

    const { JobRunner } = await import('../../src/server/services/jobRunner.ts');
    const runner = new JobRunner(
      loadConfig({
        CONFIG_DIR: configDir,
        INPUT_DIR: inputDir,
        OUTPUT_MOVIES_DIR: outputDir,
        OUTPUT_DOCUMENTARIES_DIR: outputDir,
        OUTPUT_ANIMATED_MOVIES_DIR: outputDir,
        OUTPUT_TV_SHOWS_DIR: outputDir,
        OUTPUT_ANIMATED_SERIES_DIR: outputDir
      })
    );
    await runner.init();

    const clientId = asClientId('c1:t1');
    runner.startScan(clientId);
    for (let i = 0; i < 40 && runner.getState().phase !== 'READY'; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(runner.getState().items).toHaveLength(2);

    const preflight = await runner.preflight(clientId, runner.getState().revision);
    await runner.startJob(clientId, preflight.revision, {});

    for (let i = 0; i < 40 && (runner.getState().activeJob?.completedItems ?? 0) < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const unlockPromise = runner.unlock(clientId, false);
    releaseSecondRemux();
    const state = await unlockPromise;

    expect(state.phase).toBe('READY');
    expect(state.items).toHaveLength(1);
    expect(state.activeJob).toBeNull();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('auto-classifies animated metadata to animated libraries and reclassifies when normal metadata is selected', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-animated-cat-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, 'Anime.Show.S01E01.mkv'), 'a');

    const tvdbMod = await import('../../src/server/services/metadata/tvdbClient.ts');
    vi.mocked(tvdbMod.searchTvShows).mockResolvedValueOnce([
      {
        title: 'Anime Show',
        year: 2026,
        tvdbId: asTvdbId('463051'),
        isAnimated: true,
        source: 'tvmaze'
      }
    ]);

    const { JobRunner } = await import('../../src/server/services/jobRunner.ts');
    const runner = new JobRunner(
      loadConfig({
        CONFIG_DIR: configDir,
        INPUT_DIR: inputDir,
        OUTPUT_MOVIES_DIR: outputDir,
        OUTPUT_DOCUMENTARIES_DIR: outputDir,
        OUTPUT_ANIMATED_MOVIES_DIR: outputDir,
        OUTPUT_TV_SHOWS_DIR: outputDir,
        OUTPUT_ANIMATED_SERIES_DIR: outputDir
      })
    );
    await runner.init();

    const clientId = asClientId('c1:t1');
    runner.startScan(clientId);
    for (let i = 0; i < 40 && runner.getState().phase !== 'READY'; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const scannedItem = runner.getState().items[0]!;
    expect(scannedItem.category).toBe('animated-series');

    const patchedNormal = await runner.patchItem(
      clientId,
      runner.getState().revision,
      scannedItem.id,
      {
        selectedMetadata: {
          title: 'Live Action Show',
          year: 2026,
          tvdbId: asTvdbId('999'),
          source: 'tvmaze'
        }
      }
    );
    expect(patchedNormal.items[0]?.category).toBe('tv-shows');

    const patchedAnimatedMovie = await runner.patchItem(
      clientId,
      patchedNormal.revision,
      scannedItem.id,
      {
        mediaKind: 'movie',
        selectedMetadata: {
          title: 'Animated Film',
          year: 2025,
          isAnimated: true,
          source: 'omdb'
        }
      }
    );
    expect(patchedAnimatedMovie.items[0]?.category).toBe('animated-movies');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
