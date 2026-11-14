import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

import { asIso639_2Code, type MediaProbeSummary } from '../../src/domain/types.ts';
import {
  enrichItemsWithAudioAnalysis,
  scanInputDirectory
} from '../../src/server/services/scanner.ts';

const MOCK_PROBE: MediaProbeSummary = {
  formatName: 'matroska',
  durationSeconds: 3600,
  sizeBytes: 1_500_000_000,
  bitrateBps: 3_000_000,
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

describe('scanner', () => {
  it('classifies movies, TV shows, subtitles in Subs/, and enforces Plex exclusions', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-'));
    try {
      // Movie + Subs folder + .vtt + .forced.srt
      const movieDir = path.join(tmpDir, 'Inception (2010)');
      await fs.mkdir(path.join(movieDir, 'Subs'), { recursive: true });
      await fs.writeFile(path.join(movieDir, 'Inception.2010.1080p.mkv'), 'video');
      await fs.writeFile(path.join(movieDir, 'Subs', 'Inception.2010.1080p.es.forced.srt'), '1');
      await fs.writeFile(path.join(movieDir, 'Subs', 'Inception.2010.1080p.en.vtt'), 'WEBVTT');
      await fs.writeFile(path.join(movieDir, 'Inception.2010.1080p-trailer.mkv'), 'trailer');
      await fs.writeFile(path.join(movieDir, 'Inception.sample.mkv'), 'small sample');

      // TV show with Temporada + .plexmatch + Behind The Scenes extra
      const showDir = path.join(tmpDir, 'Fallout');
      await fs.mkdir(path.join(showDir, 'Temporada 1'), { recursive: true });
      await fs.mkdir(path.join(showDir, 'Behind The Scenes'), { recursive: true });
      await fs.writeFile(
        path.join(showDir, '.plexmatch'),
        'Title: Fallout\nYear: 2024\ntvdbid: 416744\n'
      );
      await fs.writeFile(path.join(showDir, 'Temporada 1', 'Fallout - 1x01.mp4'), 'ep1');
      await fs.writeFile(path.join(showDir, 'Behind The Scenes', 'making.mkv'), 'extra');

      // .plexignore and .iso exclusion
      await fs.writeFile(path.join(tmpDir, '.plexignore'), '*ignored*\n');
      await fs.writeFile(path.join(tmpDir, 'ignored-movie.mkv'), 'skip');
      await fs.writeFile(path.join(tmpDir, 'backup.iso'), 'iso');

      // Orphan temp file
      await fs.writeFile(path.join(tmpDir, 'Test.organizing.j1.i1.tmp.mkv'), 'tmp');

      const items = await scanInputDirectory(tmpDir, async () => MOCK_PROBE);
      expect(items).toHaveLength(2);

      const movie = items.find((i) => i.mediaKind === 'movie');
      expect(movie?.parsedTitle).toBe('Inception');
      expect(movie?.parsedYear).toBe(2010);
      expect(movie?.externalSubtitles).toHaveLength(2);
      expect(movie?.externalSubtitles.some((s) => s.isForced && s.language === 'spa')).toBe(true);
      expect(
        movie?.externalSubtitles.some((s) => s.extension === '.vtt' && s.language === 'eng')
      ).toBe(true);

      const tv = items.find((i) => i.mediaKind === 'tv');
      expect(tv?.parsedTitle).toBe('Fallout');
      expect(tv?.parsedYear).toBe(2024);
      expect(tv?.episode?.seasonNumber).toBe(1);
      expect(tv?.episode?.episodeStart).toBe(1);
      expect(tv?.selectedMetadata?.tvdbId).toBe('416744');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles date-based episodes, Specials, .idx+.sub VobSub pairs, and subtitle ambiguity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-edge-'));
    try {
      // Date-based TV show
      const dailyDir = path.join(tmpDir, 'Daily Show');
      await fs.mkdir(path.join(dailyDir, 'Specials'), { recursive: true });
      await fs.writeFile(path.join(dailyDir, 'Daily Show - 2024-03-15.mkv'), 'ymd');
      await fs.writeFile(path.join(dailyDir, 'Daily Show - 16-03-2024.mkv'), 'dmy');
      await fs.writeFile(path.join(dailyDir, 'Specials', 'Bonus.mkv'), 'special');

      // Movie with .idx+.sub pair AND binary .sub missing .idx AND duplicate language
      const movieDir = path.join(tmpDir, 'Matrix (1999)');
      await fs.mkdir(movieDir, { recursive: true });
      await fs.writeFile(path.join(movieDir, 'Matrix (1999).mkv'), 'video');
      await fs.writeFile(path.join(movieDir, 'Matrix (1999).en.sub'), Buffer.from([0x00, 0x01]));
      await fs.writeFile(path.join(movieDir, 'Matrix (1999).en.idx'), 'idx');
      await fs.writeFile(path.join(movieDir, 'Matrix (1999).fr.sub'), Buffer.from([0x00, 0x02]));

      const probeWithEngSub: MediaProbeSummary = {
        ...MOCK_PROBE,
        subtitleStreams: [
          {
            index: 2,
            streamOrder: 0,
            codecName: 'subrip',
            language: asIso639_2Code('eng'),
            isForced: false,
            isHearingImpaired: false
          }
        ]
      };

      const items = await scanInputDirectory(tmpDir, async () => probeWithEngSub);
      const ymdEp = items.find((i) => i.sourcePath.includes('2024-03-15'));
      expect(ymdEp?.mediaKind).toBe('tv');
      expect(ymdEp?.episode?.airDate).toBe('2024-03-15');

      const dmyEp = items.find((i) => i.sourcePath.includes('16-03-2024'));
      expect(dmyEp?.episode?.airDate).toBe('2024-03-16');

      const specialEp = items.find((i) => i.sourcePath.includes('Bonus.mkv'));
      expect(specialEp?.episode?.seasonNumber).toBe(0);

      const matrix = items.find((i) => i.sourcePath.includes('Matrix'));
      expect(matrix?.trackSelection.needsUserPrompt).toBe(true);
      const pairedSub = matrix?.externalSubtitles.find((s) => s.language === 'eng');
      expect(pairedSub?.idxPairPath).toContain('.idx');
      const orphanBinary = matrix?.externalSubtitles.find((s) => s.language === 'fra');
      expect(orphanBinary?.missingIdxWarning).toContain('missing its companion .idx');

      // MicroDVD text .sub + .plexignore negation + tags + splitPart
      await fs.writeFile(path.join(tmpDir, '.plexignore'), '# comment\n*.tmp.mkv\n!keep.mkv\n');
      const uhdDir = path.join(tmpDir, 'Blade Runner (1982)');
      await fs.mkdir(uhdDir, { recursive: true });
      await fs.writeFile(
        path.join(uhdDir, 'Blade Runner (1982) 2160p HDR Directors Cut - pt1.mkv'),
        'uhd'
      );
      await fs.writeFile(
        path.join(uhdDir, 'Blade Runner (1982) 2160p HDR Directors Cut - pt1.en.sub'),
        '{1}{100}Hello MicroDVD'
      );
      const uhdItems = await scanInputDirectory(uhdDir, async () => MOCK_PROBE);
      expect(uhdItems).toHaveLength(1);
      expect(uhdItems[0]?.splitPart).toBe('pt1');
      expect(uhdItems[0]?.externalSubtitles[0]?.missingIdxWarning).toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cascades .plexmatch hints, parses guid/pattern tokens, and applies episode overrides', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-plexmatch-'));
    try {
      const showDir = path.join(tmpDir, 'Arcane');
      const seasonDir = path.join(showDir, 'Season 02');
      await fs.mkdir(seasonDir, { recursive: true });
      await fs.writeFile(
        path.join(showDir, '.plexmatch'),
        ['title: Arcane', 'year: 2021', 'guid: tvdb://371028'].join('\n')
      );
      await fs.writeFile(
        path.join(seasonDir, '.plexmatch'),
        ['season: 2', 'pattern: {episode}', 'ep: S02E05: custom_file.mkv'].join('\n')
      );
      await fs.writeFile(path.join(seasonDir, 'custom_file.mkv'), 'ep');

      const items = await scanInputDirectory(tmpDir, async () => MOCK_PROBE);
      expect(items).toHaveLength(1);
      expect(items[0]?.parsedTitle).toBe('Arcane');
      expect(items[0]?.parsedYear).toBe(2021);
      expect(items[0]?.selectedMetadata?.tvdbId).toBe('371028');
      expect(items[0]?.episode?.seasonNumber).toBe(2);
      expect(items[0]?.episode?.episodeStart).toBe(5);

      const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-rel-'));
      try {
        await fs.writeFile(
          path.join(
            releaseDir,
            'Even.the.Student.Council.Has.Its.Holes.S01E01.1080p.UNCENSORED.OV.WEB-DL.ENG.AAC2.0.H.264.ESub-ToonsHub.mkv'
          ),
          'ep'
        );
        const relItems = await scanInputDirectory(releaseDir, async () => MOCK_PROBE);
        expect(relItems[0]?.parsedTitle).toBe('Even the Student Council Has Its Holes');
        expect(relItems[0]?.episode?.seasonNumber).toBe(1);
        expect(relItems[0]?.episode?.episodeStart).toBe(1);
      } finally {
        await fs.rm(releaseDir, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('analyzes audio tracks and reuses persistent audio-cache.json on unchanged files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-audiocache-'));
    try {
      const inputDir = path.join(tmpDir, 'input');
      const configDir = path.join(tmpDir, 'config');
      await fs.mkdir(inputDir, { recursive: true });
      await fs.writeFile(path.join(inputDir, 'Movie.2024.1080p.mkv'), 'video-bytes');

      const items = await scanInputDirectory(inputDir, async () => MOCK_PROBE);
      expect(items).toHaveLength(1);

      let analyzeCalls = 0;
      const firstPass = await enrichItemsWithAudioAnalysis(items, configDir, async () => {
        analyzeCalls += 1;
        return {
          streamOrder: 0,
          meanVolumeDb: -19,
          maxVolumeDb: -5,
          suggestion: 'peak-gain',
          recommendedGainDb: 4
        };
      });
      expect(analyzeCalls).toBe(1);
      expect(firstPass[0]?.probe.audioAnalysis?.[0]?.suggestion).toBe('peak-gain');

      const secondPass = await enrichItemsWithAudioAnalysis(items, configDir, async () => {
        analyzeCalls += 1;
        return null;
      });
      expect(analyzeCalls).toBe(1);
      expect(secondPass[0]?.probe.audioAnalysis?.[0]?.recommendedGainDb).toBe(4);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not prompt when adding a new external subtitle language, and prompts on same-language collision', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-subcollision-'));
    try {
      const probeWithEngSub: MediaProbeSummary = {
        ...MOCK_PROBE,
        subtitleStreams: [
          {
            index: 2,
            streamOrder: 0,
            codecName: 'subrip',
            language: asIso639_2Code('eng'),
            isForced: false,
            isHearingImpaired: false
          }
        ]
      };

      // Case 1: Embedded eng + external spa -> no conflict
      const newLangDir = path.join(tmpDir, 'Star Trek (1966)');
      await fs.mkdir(newLangDir, { recursive: true });
      await fs.writeFile(path.join(newLangDir, 'Star.Trek.S01E01.mkv'), 'video');
      await fs.writeFile(
        path.join(newLangDir, 'Star.Trek.S01E01.es.srt'),
        '1\n00:00:01,000 --> 00:00:02,000\nHola'
      );

      // Case 2: Embedded eng + external eng -> real collision
      const sameLangDir = path.join(tmpDir, 'Arrival (2016)');
      await fs.mkdir(sameLangDir, { recursive: true });
      await fs.writeFile(path.join(sameLangDir, 'Arrival (2016).mkv'), 'video');
      await fs.writeFile(
        path.join(sameLangDir, 'Arrival (2016).en.srt'),
        '1\n00:00:01,000 --> 00:00:02,000\nHi'
      );

      const items = await scanInputDirectory(tmpDir, async () => probeWithEngSub);
      const starTrek = items.find((i) => i.sourcePath.includes('Star.Trek'));
      const arrival = items.find((i) => i.sourcePath.includes('Arrival'));

      expect(starTrek?.trackSelection.needsUserPrompt).toBe(false);
      expect(starTrek?.trackSelection.promptReason).toBeUndefined();

      expect(arrival?.trackSelection.needsUserPrompt).toBe(true);
      expect(arrival?.trackSelection.promptReason).toContain('existing embedded subtitle');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports byte-weighted intra-file progress during audio analysis', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-eta-'));
    try {
      const f1 = path.join(tmpDir, 'Movie.A.2020.mkv');
      const f2 = path.join(tmpDir, 'Movie.B.2021.mkv');
      await fs.writeFile(f1, 'a');
      await fs.writeFile(f2, 'b');

      const items = await scanInputDirectory(tmpDir, async (filePath) => ({
        ...MOCK_PROBE,
        sizeBytes: filePath.includes('Movie.A') ? 100 : 300
      }));

      const fractions: number[] = [];
      await expect(enrichItemsWithAudioAnalysis([], tmpDir, async () => null)).resolves.toEqual([]);
      await enrichItemsWithAudioAnalysis(
        items,
        tmpDir,
        async (
          filePath: string,
          streamOrder: number,
          _duration?: number,
          onProgress?: (update: { readonly percent: number; readonly etaSeconds?: number }) => void
        ) => {
          onProgress?.({ percent: 50, etaSeconds: 5 });
          return {
            streamOrder,
            meanVolumeDb: filePath.includes('Movie.A') ? -18 : -16,
            maxVolumeDb: -1,
            recommendedGainDb: 0,
            suggestion: 'ok'
          };
        },
        (_completed, _total, _item, overallFraction) => {
          if (overallFraction !== undefined) {
            fractions.push(Number(overallFraction.toFixed(3)));
          }
        }
      );

      expect(fractions.length).toBeGreaterThanOrEqual(3);
      expect(fractions[fractions.length - 1]).toBe(1);

      let cancelled = false;
      const partial = await enrichItemsWithAudioAnalysis(
        [...items, items[0]!],
        path.join(tmpDir, 'cancel-cache'),
        async (_filePath, streamOrder, _dur, onProgress) => {
          onProgress?.({ percent: 50 });
          if (cancelled) {
            onProgress?.({ percent: 75 });
          }
          return {
            streamOrder,
            meanVolumeDb: -18,
            maxVolumeDb: -1,
            recommendedGainDb: 0,
            suggestion: 'ok'
          };
        },
        (completed) => {
          if (completed >= 1) {
            cancelled = true;
          }
        },
        () => cancelled
      );
      expect(partial).toHaveLength(1);

      const abortedScan = await scanInputDirectory(
        tmpDir,
        async () => MOCK_PROBE,
        () => true
      );
      expect(abortedScan).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves leading bracketed titles like [REC] when scanning input files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-rec-'));
    try {
      await fs.writeFile(path.join(tmpDir, '[REC] 2 (2009) [1080p].mkv'), 'video');
      const items = await scanInputDirectory(tmpDir, async () => MOCK_PROBE);
      expect(items).toHaveLength(1);
      expect(items[0]?.parsedTitle).toBe('[REC] 2');
      expect(items[0]?.parsedYear).toBe(2009);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('completes audio enrichment and falls back to tmpdir when audio-cache.json throws EACCES', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-scan-eacces-'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origWriteFile = fs.writeFile.bind(fs);
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (p, d, o) => {
      if (typeof p === 'string' && p.includes('readonly-cfg')) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }
      return origWriteFile(p, d, o);
    });

    try {
      await fs.writeFile(path.join(tmpDir, 'Movie.2020.mkv'), 'video');
      const items = await scanInputDirectory(tmpDir, async () => MOCK_PROBE);
      const enriched = await enrichItemsWithAudioAnalysis(
        items,
        path.join(tmpDir, 'readonly-cfg'),
        async (_filePath, streamOrder) => ({
          streamOrder,
          meanVolumeDb: -16,
          maxVolumeDb: -1,
          recommendedGainDb: 0,
          suggestion: 'ok'
        })
      );
      expect(enriched).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      writeSpy.mockRestore();
      warnSpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(path.join(os.tmpdir(), 'video-organizer-audio-cache.json'), { force: true });
    }
  });
});
