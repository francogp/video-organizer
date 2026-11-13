import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { asIso639_2Code, asItemId, type ScannedItem } from '../../src/domain/types.ts';
import {
  analyzeAudioVolume,
  buildFfmpegRemuxArgs,
  measureLoudnormPass1,
  normalizeSubtitleToUtf8,
  probeMedia,
  runFfmpegRemux
} from '../../src/server/services/media/ffmpegRunner.ts';

describe('ffmpegRunner', () => {
  it('builds lossless V/A copy args with audio default, mov_text->srt conversion, and forced/sdh dispositions', () => {
    const item: ScannedItem = {
      id: asItemId('i1'),
      sourcePath: '/input/Movie.mp4',
      relativePath: 'Movie.mp4',
      fileName: 'Movie.mp4',
      mediaKind: 'movie',
      category: 'movies',
      include: true,
      parsedTitle: 'Movie',
      tags: [],
      probe: {
        formatName: 'mp4',
        durationSeconds: 120,
        sizeBytes: 1000,
        bitrateBps: 5000,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
        audioStreams: [
          {
            index: 1,
            streamOrder: 0,
            codecName: 'aac',
            language: asIso639_2Code('eng'),
            channels: 2,
            isDefault: false
          },
          {
            index: 2,
            streamOrder: 1,
            codecName: 'aac',
            language: asIso639_2Code('spa'),
            channels: 2,
            isDefault: true
          }
        ],
        subtitleStreams: [
          {
            index: 3,
            streamOrder: 0,
            codecName: 'mov_text',
            language: asIso639_2Code('eng'),
            isForced: false,
            isHearingImpaired: true
          }
        ]
      },
      externalSubtitles: [
        {
          path: '/input/Movie.es.forced.srt',
          relativePath: 'Movie.es.forced.srt',
          extension: '.srt',
          language: asIso639_2Code('spa'),
          isForced: true,
          isHearingImpaired: false,
          isLanguageAmbiguous: false
        }
      ],
      candidates: [],
      episodeOrder: 'aired',
      trackSelection: {
        audioTracks: [
          { streamOrder: 0, include: true, language: asIso639_2Code('eng'), isDefault: false },
          { streamOrder: 1, include: true, language: asIso639_2Code('spa'), isDefault: true }
        ],
        subtitleMergeMode: 'keep-and-add',
        includedInternalSubtitles: [0],
        externalSubtitleOrder: ['/input/Movie.es.forced.srt'],
        needsUserPrompt: false
      },
      warnings: []
    };

    const args = buildFfmpegRemuxArgs(item, '/input/Movie.organizing.j1.i1.tmp.mkv', [
      { sub: item.externalSubtitles[0]!, inputPath: '/input/Movie.es.forced.srt' }
    ]);

    expect(args).toContain('-c:v');
    expect(args).toContain('copy');
    expect(args).toContain('-c:a');
    expect(args).toContain('0:V:0');
    expect(args).toContain('-disposition:a:1');
    expect(args).toContain('default');
    expect(args).toContain('-c:s:0');
    expect(args).toContain('srt');
    expect(args).toContain('hearing_impaired');
    expect(args).toContain('-c:s:1');
    expect(args).toContain('forced');
    expect(args).toContain('ORIGINAL_FILENAME=Movie.mp4');
    expect(args).not.toContain('ORIGINAL_PATH=Movie.mp4');

    // Also verify 'replace' and 'selected-only' modes with default audio fallback
    const replaceArgs = buildFfmpegRemuxArgs(
      {
        ...item,
        relativePath: 'Releases/Movie.mp4',
        trackSelection: {
          ...item.trackSelection,
          audioTracks: [
            { streamOrder: 0, include: true, language: asIso639_2Code('eng'), isDefault: false }
          ],
          subtitleMergeMode: 'replace'
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(replaceArgs).toContain('ORIGINAL_FILENAME=Movie.mp4');
    expect(replaceArgs).toContain('ORIGINAL_PATH=Releases/Movie.mp4');
    expect(replaceArgs).toContain('-disposition:a:0');
    expect(replaceArgs).not.toContain('-c:s:0');

    const selectedArgs = buildFfmpegRemuxArgs(
      {
        ...item,
        trackSelection: {
          ...item.trackSelection,
          subtitleMergeMode: 'selected-only',
          includedInternalSubtitles: [0]
        }
      },
      '/input/out2.tmp.mkv',
      []
    );
    expect(selectedArgs).toContain('-c:s:0');
  });

  it('analyzes volumedetect/loudnorm via ffmpeg and builds peak/loudnorm/lossless/2.0 args', async () => {
    function mockFfmpegStderr(stderrText: string, exitCode = 0): void {
      spawnMock.mockImplementationOnce(() => {
        const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
        proc.stderr = new EventEmitter();
        queueMicrotask(() => {
          proc.stderr.emit('data', Buffer.from(stderrText, 'utf8'));
          proc.emit('close', exitCode);
        });
        return proc;
      });
    }

    mockFfmpegStderr(
      '[Parsed_volumedetect_0] mean_volume: -16.0 dB\n[Parsed_volumedetect_0] max_volume: -5.0 dB\n'
    );
    const peakAnalysis = await analyzeAudioVolume('/input/Movie.mkv', 0);
    expect(peakAnalysis).toEqual({
      streamOrder: 0,
      meanVolumeDb: -16,
      maxVolumeDb: -5,
      suggestion: 'peak-gain',
      recommendedGainDb: 4
    });

    mockFfmpegStderr(
      '[Parsed_volumedetect_0] mean_volume: -25.0 dB\n[Parsed_volumedetect_0] max_volume: -4.0 dB\n'
    );
    const quietAnalysis = await analyzeAudioVolume('/input/Movie.mkv', 0);
    expect(quietAnalysis?.suggestion).toBe('loudnorm');

    mockFfmpegStderr(
      '[Parsed_volumedetect_0] mean_volume: -14.0 dB\n[Parsed_volumedetect_0] max_volume: -0.5 dB\n'
    );
    const okAnalysis = await analyzeAudioVolume('/input/Movie.mkv', 0);
    expect(okAnalysis?.suggestion).toBe('ok');

    mockFfmpegStderr('no metrics');
    await expect(analyzeAudioVolume('/input/Movie.mkv', 0)).resolves.toBeNull();

    mockFfmpegStderr(
      '[Parsed_volumedetect_0] mean_volume: -14.0 dB\n[Parsed_volumedetect_0] max_volume: -0.5 dB\n'
    );
    const volProgressUpdates: number[] = [];
    const withProgress = await analyzeAudioVolume('/input/Movie.mkv', 0, 10, (u) =>
      volProgressUpdates.push(u.percent)
    );
    expect(withProgress?.suggestion).toBe('ok');
    expect(volProgressUpdates).toContain(100);

    mockFfmpegStderr(
      'noise\n{\n"input_i": "-24.50",\n"input_tp": "-4.20",\n"input_lra": "8.10",\n"input_thresh": "-35.00",\n"target_offset": "0.50"\n}\n'
    );
    const loudnormJson = await measureLoudnormPass1('/input/Movie.mkv', 0, true);
    expect(loudnormJson.inputI).toBe('-24.50');

    mockFfmpegStderr('invalid');
    await expect(measureLoudnormPass1('/input/Movie.mkv', 0, false)).rejects.toThrow(
      'Failed to parse loudnorm pass 1'
    );

    mockFfmpegStderr('encoder error', 1);
    await expect(analyzeAudioVolume('/input/Movie.mkv', 0)).rejects.toThrow(
      /ffmpeg exited with code 1/
    );

    const peakItem: ScannedItem = {
      id: asItemId('i-peak'),
      sourcePath: '/input/Movie.mkv',
      relativePath: 'Movie.mkv',
      fileName: 'Movie.mkv',
      mediaKind: 'movie',
      category: 'movies',
      include: true,
      parsedTitle: 'Movie',
      tags: [],
      probe: {
        formatName: 'matroska',
        durationSeconds: 120,
        sizeBytes: 1000,
        bitrateBps: 5000,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
        audioStreams: [
          {
            index: 1,
            streamOrder: 0,
            codecName: 'eac3',
            language: asIso639_2Code('eng'),
            channels: 6,
            isDefault: true
          }
        ],
        subtitleStreams: [],
        audioAnalysis: [
          {
            streamOrder: 0,
            meanVolumeDb: -18,
            maxVolumeDb: -5,
            suggestion: 'peak-gain',
            recommendedGainDb: 4
          }
        ]
      },
      externalSubtitles: [],
      candidates: [],
      episodeOrder: 'aired',
      trackSelection: {
        audioTracks: [
          { streamOrder: 0, include: true, language: asIso639_2Code('eng'), isDefault: true }
        ],
        subtitleMergeMode: 'keep-and-add',
        includedInternalSubtitles: [],
        externalSubtitleOrder: [],
        needsUserPrompt: false,
        audioNormalization: { mode: 'peak', codec: 'auto', downmixStereo: true }
      },
      warnings: []
    };

    const peakArgs = buildFfmpegRemuxArgs(peakItem, '/input/out.tmp.mkv', []);
    expect(peakArgs.slice(0, 3)).toEqual(['-y', '-threads', '0']);
    expect(peakArgs).toContain('-c:v');
    expect(peakArgs).toContain('copy');
    expect(peakArgs).toContain('-filter:a:0');
    expect(peakArgs).toContain('volume=4dB');
    expect(peakArgs).toContain('-c:a:0');
    expect(peakArgs).toContain('eac3');
    expect(peakArgs).toContain('-ac:a:0');
    expect(peakArgs).toContain('2');

    const loudnormArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'loudnorm', codec: 'flac', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      [],
      new Map([[0, loudnormJson]])
    );
    expect(loudnormArgs.join(' ')).toContain('measured_I=-24.50');
    expect(loudnormArgs).toContain('flac');

    const zeroGainPeakArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        probe: {
          ...peakItem.probe,
          audioStreams: [
            {
              index: 1,
              streamOrder: 0,
              codecName: 'opus',
              language: asIso639_2Code('eng'),
              channels: 2,
              isDefault: true
            }
          ],
          audioAnalysis: [
            {
              streamOrder: 0,
              meanVolumeDb: -15,
              maxVolumeDb: -1,
              suggestion: 'ok',
              recommendedGainDb: 0
            }
          ]
        },
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'peak', codec: 'auto', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(zeroGainPeakArgs).toContain('-c:a:0');
    expect(zeroGainPeakArgs).toContain('copy');

    const singlePassLoudnormArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        probe: {
          ...peakItem.probe,
          audioStreams: [
            {
              index: 1,
              streamOrder: 0,
              codecName: 'opus',
              language: asIso639_2Code('eng'),
              channels: 2,
              isDefault: true
            }
          ]
        },
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'loudnorm', codec: 'auto', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(singlePassLoudnormArgs).toContain('libopus');
    expect(singlePassLoudnormArgs.join(' ')).toContain('loudnorm=I=');

    const dtsFallbackArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        probe: {
          ...peakItem.probe,
          audioStreams: [
            {
              index: 1,
              streamOrder: 0,
              codecName: 'dts',
              language: asIso639_2Code('eng'),
              channels: 6,
              isDefault: true
            }
          ]
        },
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'loudnorm', codec: 'auto', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(dtsFallbackArgs).toContain('ac3');

    const aacSurroundArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'loudnorm', codec: 'aac', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(aacSurroundArgs).toContain('aac');
    expect(aacSurroundArgs).toContain('384k');

    const mp3AutoArgs = buildFfmpegRemuxArgs(
      {
        ...peakItem,
        probe: {
          ...peakItem.probe,
          audioStreams: [
            {
              index: 1,
              streamOrder: 0,
              codecName: 'mp3',
              language: asIso639_2Code('eng'),
              channels: 2,
              isDefault: true
            }
          ]
        },
        trackSelection: {
          ...peakItem.trackSelection,
          audioNormalization: { mode: 'loudnorm', codec: 'auto', downmixStereo: false }
        }
      },
      '/input/out.tmp.mkv',
      []
    );
    expect(mp3AutoArgs).toContain('libmp3lame');
  });

  it('normalizes Windows-1252 and UTF-16LE subtitle files to UTF-8', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-sub-'));
    try {
      const win1252Path = path.join(tmpDir, 'latino.es.srt');
      await fs.writeFile(
        win1252Path,
        Buffer.from([0x31, 0x0a, 0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xf1])
      );
      const res1 = await normalizeSubtitleToUtf8(
        {
          path: win1252Path,
          relativePath: 'latino.es.srt',
          extension: '.srt',
          language: asIso639_2Code('spa'),
          isForced: false,
          isHearingImpaired: false,
          isLanguageAmbiguous: false
        },
        tmpDir
      );
      expect(res1.tempCreated).toBeDefined();
      await expect(fs.readFile(res1.inputPath, 'utf8')).resolves.toBe('1\náéíóúñ');

      const utf16Path = path.join(tmpDir, 'u16.en.srt');
      const u16Body = Buffer.from('Hello', 'utf16le');
      await fs.writeFile(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), u16Body]));
      const res2 = await normalizeSubtitleToUtf8(
        {
          path: utf16Path,
          relativePath: 'u16.en.srt',
          extension: '.srt',
          language: asIso639_2Code('eng'),
          isForced: false,
          isHearingImpaired: false,
          isLanguageAmbiguous: false
        },
        tmpDir
      );
      expect(res2.tempCreated).toBeDefined();
      await expect(fs.readFile(res2.inputPath, 'utf8')).resolves.toBe('Hello');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('probes media via ffprobe and streams ffmpeg remux progress and errors', async () => {
    const makeFakeChild = (stdoutData: string, stderrData: string, exitCode: number) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter()
      });
      queueMicrotask(() => {
        if (stdoutData) {
          child.stdout.emit('data', Buffer.from(stdoutData, 'utf8'));
        }
        if (stderrData) {
          child.stderr.emit('data', Buffer.from(stderrData, 'utf8'));
        }
        child.emit('close', exitCode);
      });
      return child;
    };

    spawnMock.mockImplementationOnce(() =>
      makeFakeChild(
        JSON.stringify({
          format: { format_name: 'matroska', duration: '120', size: '1000', bit_rate: '50000' },
          streams: [
            { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
            {
              index: 1,
              codec_type: 'audio',
              codec_name: 'aac',
              channels: 2,
              tags: { language: 'eng' },
              disposition: { default: 1 }
            },
            {
              index: 2,
              codec_type: 'subtitle',
              codec_name: 'subrip',
              tags: { language: 'spa' },
              disposition: { forced: 1 }
            }
          ]
        }),
        '',
        0
      )
    );

    const probed = await probeMedia('/input/Movie.mkv');
    expect(probed.formatName).toBe('matroska');
    expect(probed.videoStreams).toHaveLength(1);
    expect(probed.audioStreams[0]?.language).toBe('eng');
    expect(probed.subtitleStreams[0]?.isForced).toBe(true);

    // Remux progress + completion
    spawnMock.mockImplementationOnce(() =>
      makeFakeChild('out_time_us=50000000\nout_time_us=100000000\n', '', 0)
    );
    const percents: number[] = [];
    await runFfmpegRemux(['-i', 'in.mkv', 'out.mkv'], 100, (p) => percents.push(p));
    expect(percents).toContain(50);
    expect(percents.at(-1)).toBe(100);

    // Loudnorm pass 1 progress + ETA
    spawnMock.mockImplementationOnce(() =>
      makeFakeChild(
        'speed=2.0x\nout_time_us=50000000\n',
        '{\n"input_i": "-20.00",\n"input_tp": "-2.00",\n"input_lra": "6.00",\n"input_thresh": "-30.00",\n"target_offset": "0.10"\n}\n',
        0
      )
    );
    const pass1Updates: { readonly percent: number; readonly etaSeconds?: number }[] = [];
    const pass1Measured = await measureLoudnormPass1('/input/Movie.mkv', 0, false, 100, (u) => {
      pass1Updates.push(u);
    });
    expect(pass1Measured.inputI).toBe('-20.00');
    expect(pass1Updates[0]?.percent).toBe(50);
    expect(pass1Updates[0]?.etaSeconds).toBe(25);
    expect(pass1Updates.at(-1)?.percent).toBe(100);

    // Fallback ETA from elapsed time when speed= is absent
    spawnMock.mockImplementationOnce(() =>
      makeFakeChild(
        'speed=N/A\nout_time_us=bad\nout_time_us=50000000\n',
        '{\n"input_i": "-21.00",\n"input_tp": "-2.00",\n"input_lra": "6.00",\n"input_thresh": "-30.00",\n"target_offset": "0.10"\n}\n',
        0
      )
    );
    const fallbackUpdates: { readonly percent: number; readonly etaSeconds?: number }[] = [];
    await measureLoudnormPass1('/input/Movie.mkv', 0, false, 100, (u) => fallbackUpdates.push(u));
    expect(fallbackUpdates[0]?.percent).toBe(50);
    expect(fallbackUpdates[0]?.etaSeconds).toBeTypeOf('number');

    // Non-zero exit rejects with stderr message
    spawnMock.mockImplementationOnce(() => makeFakeChild('', 'Invalid stream', 1));
    await expect(runFfmpegRemux(['-i', 'bad.mkv'], 10, () => {})).rejects.toThrow(
      'ffmpeg exited with code 1'
    );

    // probeMedia non-zero exit rejects
    spawnMock.mockImplementationOnce(() => makeFakeChild('', 'probe failed', 1));
    await expect(probeMedia('/input/bad.mkv')).rejects.toThrow('ffprobe exited with code 1');

    // probeMedia handles empty format/streams, attached_pic, bitDepth, and language aliases
    spawnMock.mockImplementationOnce(() =>
      makeFakeChild(
        JSON.stringify({
          streams: [
            { codec_type: 'video', bits_per_raw_sample: '10', disposition: { attached_pic: 0 } },
            { codec_type: 'video', disposition: { attached_pic: 1 } },
            { codec_type: 'audio', tags: { language: 'es' } },
            { codec_type: 'subtitle', tags: { language: 'zz' } }
          ]
        }),
        '',
        0
      )
    );
    const sparseProbe = await probeMedia('/input/sparse.mkv');
    expect(sparseProbe.formatName).toBe('unknown');
    expect(sparseProbe.videoStreams).toHaveLength(1);
    expect(sparseProbe.videoStreams[0]?.bitDepth).toBe(10);
    expect(sparseProbe.audioStreams[0]?.language).toBe('spa');
    expect(sparseProbe.subtitleStreams[0]?.language).toBe('und');

    // VobSub .sub + .idx passes .idx directly without temp copy
    const idxRes = await normalizeSubtitleToUtf8(
      {
        path: '/in/movie.en.sub',
        relativePath: 'movie.en.sub',
        extension: '.sub',
        language: asIso639_2Code('eng'),
        isForced: false,
        isHearingImpaired: false,
        isLanguageAmbiguous: false,
        idxPairPath: '/in/movie.en.idx'
      },
      '/in'
    );
    expect(idxRes.inputPath).toBe('/in/movie.en.idx');

    // UTF-8 subtitle needs no temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-utf8-'));
    try {
      const utf8Sub = path.join(tmpDir, 'ok.en.srt');
      await fs.writeFile(utf8Sub, '1\n00:00:01,000 --> 00:00:02,000\nHi\n', 'utf8');
      const res = await normalizeSubtitleToUtf8(
        {
          path: utf8Sub,
          relativePath: 'ok.en.srt',
          extension: '.srt',
          language: asIso639_2Code('eng'),
          isForced: false,
          isHearingImpaired: false,
          isLanguageAmbiguous: false
        },
        tmpDir
      );
      expect(res.tempCreated).toBeUndefined();
      expect(res.inputPath).toBe(utf8Sub);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
