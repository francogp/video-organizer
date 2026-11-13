import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AUDIO_LOUDNORM_TARGET_I,
  AUDIO_LOUDNORM_TARGET_LRA,
  AUDIO_LOUDNORM_TARGET_TP,
  AUDIO_MEAN_QUIET_THRESHOLD_DB,
  AUDIO_PEAK_SUGGEST_THRESHOLD_DB,
  AUDIO_SAFE_PEAK_CEILING_DB,
  CONVERTIBLE_TEXT_SUBTITLE_CODEC_SET,
  LANGUAGE_CODE_MAP,
  type AudioOutputCodec,
  type AudioSuggestionKind,
  type ConvertibleTextSubtitleCodec,
  type LanguageAlias
} from '../../../domain/constants.ts';
import {
  asIso639_2Code,
  type AudioNormalizationConfig,
  type AudioStreamInfo,
  type AudioTrackAnalysis,
  type ExternalSubtitleFile,
  type Iso639_2Code,
  type MediaProbeSummary,
  type ScannedItem,
  type SubtitleStreamInfo,
  type VideoStreamInfo
} from '../../../domain/types.ts';

interface FfprobeRawStream {
  readonly index?: number;
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bits_per_raw_sample?: string;
  readonly color_transfer?: string;
  readonly channels?: number;
  readonly disposition?: {
    readonly default?: number;
    readonly forced?: number;
    readonly hearing_impaired?: number;
    readonly attached_pic?: number;
  };
  readonly tags?: {
    readonly language?: string;
    readonly title?: string;
  };
}

interface FfprobeRawOutput {
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
    readonly size?: string;
    readonly bit_rate?: string;
  };
  readonly streams?: readonly FfprobeRawStream[];
}

const PERCENT_MAX = 100;
const MICROSECONDS_PER_SECOND = 1_000_000;
const UTF8_BOM_FIRST = 0xef;
const UTF8_BOM_SECOND = 0xbb;
const UTF8_BOM_THIRD = 0xbf;
const UTF16LE_BOM_FIRST = 0xff;
const UTF16LE_BOM_SECOND = 0xfe;

function resolveIsoCode(rawLang?: string): Iso639_2Code {
  if (!rawLang) {
    return asIso639_2Code('und');
  }
  const lower = rawLang.trim().toLowerCase();
  if (Object.hasOwn(LANGUAGE_CODE_MAP, lower)) {
    return asIso639_2Code(LANGUAGE_CODE_MAP[lower as LanguageAlias]);
  }
  return /^[a-z]{3}$/.test(lower) ? asIso639_2Code(lower) : asIso639_2Code('und');
}

/** Runs `ffprobe` without a shell and maps streams to `MediaProbeSummary`. */
export async function probeMedia(filePath: string): Promise<MediaProbeSummary> {
  const stdout = await new Promise<string>((resolve, reject): void => {
    const ffprobeBin = process.env['FFPROBE_BIN'] ?? 'ffprobe';
    const child = spawn(
      ffprobeBin,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code): void => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(
          new Error(
            `ffprobe exited with code ${String(code)}: ${Buffer.concat(errChunks).toString('utf8')}`
          )
        );
      }
    });
  });

  const parsed = JSON.parse(stdout) as FfprobeRawOutput;
  const videoStreams: VideoStreamInfo[] = [];
  const audioStreams: AudioStreamInfo[] = [];
  const subtitleStreams: SubtitleStreamInfo[] = [];

  let audioOrder = 0;
  let subOrder = 0;

  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1) {
      const bitDepth = stream.bits_per_raw_sample ? Number(stream.bits_per_raw_sample) : undefined;
      videoStreams.push({
        index: stream.index ?? 0,
        codecName: stream.codec_name ?? 'unknown',
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        bitDepth: bitDepth && Number.isInteger(bitDepth) ? bitDepth : undefined,
        colorTransfer: stream.color_transfer
      });
    } else if (stream.codec_type === 'audio') {
      audioStreams.push({
        index: stream.index ?? 0,
        streamOrder: audioOrder,
        codecName: stream.codec_name ?? 'unknown',
        language: resolveIsoCode(stream.tags?.language),
        title: stream.tags?.title,
        channels: stream.channels ?? 2,
        isDefault: stream.disposition?.default === 1
      });
      audioOrder += 1;
    } else if (stream.codec_type === 'subtitle') {
      subtitleStreams.push({
        index: stream.index ?? 0,
        streamOrder: subOrder,
        codecName: stream.codec_name ?? 'unknown',
        language: resolveIsoCode(stream.tags?.language),
        title: stream.tags?.title,
        isForced: stream.disposition?.forced === 1,
        isHearingImpaired: stream.disposition?.hearing_impaired === 1
      });
      subOrder += 1;
    }
  }

  return {
    formatName: parsed.format?.format_name ?? 'unknown',
    durationSeconds: Number(parsed.format?.duration ?? '0') || 0,
    sizeBytes: Number(parsed.format?.size ?? '0') || 0,
    bitrateBps: Number(parsed.format?.bit_rate ?? '0') || 0,
    videoStreams,
    audioStreams,
    subtitleStreams
  };
}

/** Normalizes non-UTF-8 text subtitles to UTF-8 in a temporary file for safe `ffmpeg` muxing. */
export async function normalizeSubtitleToUtf8(
  sub: ExternalSubtitleFile,
  tempDir: string
): Promise<{ readonly inputPath: string; readonly tempCreated?: string }> {
  if (sub.extension === '.sub' && sub.idxPairPath) {
    return { inputPath: sub.idxPairPath };
  }
  const raw = await fs.readFile(sub.path);
  if (raw.length >= 2 && raw[0] === UTF16LE_BOM_FIRST && raw[1] === UTF16LE_BOM_SECOND) {
    const decoded = new TextDecoder('utf-16le').decode(raw.subarray(2));
    const outPath = path.join(tempDir, `${path.basename(sub.path)}.utf8${sub.extension}`);
    await fs.writeFile(outPath, decoded, 'utf8');
    return { inputPath: outPath, tempCreated: outPath };
  }
  const hasUtf8Bom =
    raw.length >= 3 &&
    raw[0] === UTF8_BOM_FIRST &&
    raw[1] === UTF8_BOM_SECOND &&
    raw[2] === UTF8_BOM_THIRD;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(hasUtf8Bom ? raw.subarray(3) : raw);
    return { inputPath: sub.path };
  } catch {
    const decoded = new TextDecoder('windows-1252').decode(raw);
    const outPath = path.join(tempDir, `${path.basename(sub.path)}.utf8${sub.extension}`);
    await fs.writeFile(outPath, decoded, 'utf8');
    return { inputPath: outPath, tempCreated: outPath };
  }
}

export interface LoudnormMeasurements {
  readonly inputI: string;
  readonly inputTp: string;
  readonly inputLra: string;
  readonly inputThresh: string;
  readonly targetOffset: string;
}

const DEFAULT_AUDIO_NORMALIZATION: AudioNormalizationConfig = {
  mode: 'copy',
  codec: 'auto',
  downmixStereo: false
};

interface AudioEncoderSpec {
  readonly encoder: string;
  readonly stereoBitrate?: string;
  readonly surroundBitrate?: string;
}

const SOURCE_AUDIO_ENCODER_MAP = new Map<string, AudioEncoderSpec>([
  ['aac', { encoder: 'aac', stereoBitrate: '256k', surroundBitrate: '384k' }],
  ['ac3', { encoder: 'ac3', stereoBitrate: '384k', surroundBitrate: '640k' }],
  ['eac3', { encoder: 'eac3', stereoBitrate: '384k', surroundBitrate: '640k' }],
  ['flac', { encoder: 'flac' }],
  ['opus', { encoder: 'libopus', stereoBitrate: '192k', surroundBitrate: '320k' }],
  ['mp3', { encoder: 'libmp3lame', stereoBitrate: '320k', surroundBitrate: '320k' }]
]);

function parseVolumedetectStderr(
  stderr: string
): { readonly meanVolumeDb: number; readonly maxVolumeDb: number } | null {
  const meanMatch = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(stderr);
  const maxMatch = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(stderr);
  if (!meanMatch?.[1] || !maxMatch?.[1]) {
    return null;
  }
  const meanVolumeDb = Number(meanMatch[1]);
  const maxVolumeDb = Number(maxMatch[1]);
  if (!Number.isFinite(meanVolumeDb) || !Number.isFinite(maxVolumeDb)) {
    return null;
  }
  return { meanVolumeDb, maxVolumeDb };
}

function classifyAudioSuggestion(
  meanVolumeDb: number,
  maxVolumeDb: number
): { readonly suggestion: AudioSuggestionKind; readonly recommendedGainDb: number } {
  const rawGain = AUDIO_SAFE_PEAK_CEILING_DB - maxVolumeDb;
  const recommendedGainDb = rawGain > 0 ? Math.round(rawGain * 10) / 10 : 0;

  if (meanVolumeDb <= AUDIO_MEAN_QUIET_THRESHOLD_DB) {
    return { suggestion: 'loudnorm', recommendedGainDb };
  }
  if (maxVolumeDb <= AUDIO_PEAK_SUGGEST_THRESHOLD_DB && recommendedGainDb > 0) {
    return { suggestion: 'peak-gain', recommendedGainDb };
  }
  return { suggestion: 'ok', recommendedGainDb: 0 };
}

function parseLoudnormJsonStderr(stderr: string): LoudnormMeasurements | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const raw = JSON.parse(stderr.slice(start, end + 1)) as Readonly<Record<string, unknown>>;
    const inputI = typeof raw['input_i'] === 'string' ? raw['input_i'] : null;
    const inputTp = typeof raw['input_tp'] === 'string' ? raw['input_tp'] : null;
    const inputLra = typeof raw['input_lra'] === 'string' ? raw['input_lra'] : null;
    const inputThresh = typeof raw['input_thresh'] === 'string' ? raw['input_thresh'] : null;
    const targetOffset = typeof raw['target_offset'] === 'string' ? raw['target_offset'] : null;
    if (!inputI || !inputTp || !inputLra || !inputThresh || !targetOffset) {
      return null;
    }
    return { inputI, inputTp, inputLra, inputThresh, targetOffset };
  } catch {
    return null;
  }
}

export interface FfmpegProgressUpdate {
  readonly percent: number;
  readonly etaSeconds?: number;
  readonly speed?: number;
}

const PROGRESS_THROTTLE_MS = 1000;
const MS_PER_SECOND = 1000;

function parseFfmpegSpeed(line: string): number | undefined {
  const rawSpeed = line.slice('speed='.length).trim();
  if (!rawSpeed.endsWith('x')) {
    return undefined;
  }
  const parsed = Number(rawSpeed.slice(0, -1));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function computeFfmpegEtaSeconds(
  durationSeconds: number,
  outTimeSec: number,
  percent: number,
  lastSpeed: number | undefined,
  elapsedSec: number
): number | undefined {
  const remainingMediaSec = Math.max(0, durationSeconds - outTimeSec);
  if (lastSpeed !== undefined && lastSpeed > 0) {
    return Math.max(0, Math.round(remainingMediaSec / lastSpeed));
  }
  if (percent > 0 && elapsedSec > 0) {
    return Math.max(0, Math.round((elapsedSec * (PERCENT_MAX - percent)) / percent));
  }
  return undefined;
}

function runFfmpegProcess(
  args: readonly string[],
  durationSeconds: number,
  onProgress?: (update: FfmpegProgressUpdate) => void,
  registerChild?: (child: ChildProcess | null) => void
): Promise<string> {
  return new Promise((resolve, reject): void => {
    const ffmpegBin = process.env['FFMPEG_BIN'] ?? 'ffmpeg';
    const child = spawn(ffmpegBin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    registerChild?.(child);
    const errChunks: Buffer[] = [];
    const startedAtMs = performance.now();
    let buffer = '';
    let lastSpeed: number | undefined;
    let lastPercent = -1;
    let lastEmitAtMs = 0;

    child.stdout?.on('data', (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('speed=')) {
          lastSpeed = parseFfmpegSpeed(line) ?? lastSpeed;
          continue;
        }
        if (!line.startsWith('out_time_us=') || durationSeconds <= 0 || !onProgress) {
          continue;
        }
        const us = Number(line.slice('out_time_us='.length));
        if (!Number.isFinite(us) || us < 0) {
          continue;
        }
        const outTimeSec = us / MICROSECONDS_PER_SECOND;
        const percent = Math.min(
          PERCENT_MAX,
          Math.round((outTimeSec / durationSeconds) * PERCENT_MAX)
        );
        const nowMs = performance.now();
        if (percent !== lastPercent || nowMs - lastEmitAtMs >= PROGRESS_THROTTLE_MS) {
          lastPercent = percent;
          lastEmitAtMs = nowMs;
          const etaSeconds = computeFfmpegEtaSeconds(
            durationSeconds,
            outTimeSec,
            percent,
            lastSpeed,
            (nowMs - startedAtMs) / MS_PER_SECOND
          );
          onProgress({ percent, etaSeconds, speed: lastSpeed });
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', (err): void => {
      registerChild?.(null);
      reject(err);
    });
    child.on('close', (code): void => {
      registerChild?.(null);
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code === 0) {
        onProgress?.({ percent: PERCENT_MAX, etaSeconds: 0, speed: lastSpeed });
        resolve(stderr);
      } else {
        reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderr}`));
      }
    });
  });
}

function runFfmpegStderr(
  args: readonly string[],
  registerChild?: (child: ChildProcess | null) => void
): Promise<string> {
  return runFfmpegProcess(args, 0, undefined, registerChild);
}

/** Runs `ffmpeg -vn -sn -dn -af volumedetect` for a single audio stream. */
export async function analyzeAudioVolume(
  filePath: string,
  streamOrder: number,
  durationSeconds = 0,
  onProgress?: (update: FfmpegProgressUpdate) => void,
  registerChild?: (child: ChildProcess | null) => void
): Promise<AudioTrackAnalysis | null> {
  const args = [
    '-hide_banner',
    '-nostats',
    '-threads',
    '0',
    '-vn',
    '-sn',
    '-dn',
    '-i',
    filePath,
    '-map',
    `0:a:${String(streamOrder)}`,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-'
  ];
  const stderr =
    onProgress && durationSeconds > 0
      ? await runFfmpegProcess(
          [...args, '-progress', 'pipe:1'],
          durationSeconds,
          onProgress,
          registerChild
        )
      : await runFfmpegStderr(args, registerChild);
  const parsed = parseVolumedetectStderr(stderr);
  if (!parsed) {
    return null;
  }
  const classified = classifyAudioSuggestion(parsed.meanVolumeDb, parsed.maxVolumeDb);
  return {
    streamOrder,
    meanVolumeDb: parsed.meanVolumeDb,
    maxVolumeDb: parsed.maxVolumeDb,
    suggestion: classified.suggestion,
    recommendedGainDb: classified.recommendedGainDb
  };
}

/** Executes pass 1 of EBU R128 2-pass `loudnorm` measurement for an audio stream. */
export async function measureLoudnormPass1(
  filePath: string,
  streamOrder: number,
  downmixStereo: boolean,
  durationSeconds = 0,
  onProgress?: (update: FfmpegProgressUpdate) => void,
  registerChild?: (child: ChildProcess | null) => void
): Promise<LoudnormMeasurements> {
  const args = [
    '-hide_banner',
    '-nostats',
    '-threads',
    '0',
    '-vn',
    '-sn',
    '-dn',
    '-i',
    filePath,
    '-map',
    `0:a:${String(streamOrder)}`
  ];
  if (downmixStereo) {
    args.push('-ac', '2');
  }
  args.push(
    '-af',
    `loudnorm=I=${String(AUDIO_LOUDNORM_TARGET_I)}:TP=${String(AUDIO_LOUDNORM_TARGET_TP)}:LRA=${String(AUDIO_LOUDNORM_TARGET_LRA)}:print_format=json`,
    '-progress',
    'pipe:1',
    '-f',
    'null',
    '-'
  );
  const stderr = await runFfmpegProcess(args, durationSeconds, onProgress, registerChild);
  const measured = parseLoudnormJsonStderr(stderr);
  if (!measured) {
    throw new Error(
      `Failed to parse loudnorm pass 1 measurements for stream ${String(streamOrder)}`
    );
  }
  return measured;
}

function resolveAudioEncoderArgs(
  sourceCodec: string,
  targetCodec: AudioOutputCodec,
  outIdx: number,
  channels: number,
  downmixStereo: boolean
): readonly string[] {
  const targetChannels = downmixStereo && channels > 2 ? 2 : channels;
  const normalizedSource = sourceCodec.toLowerCase();
  const resolvedKey =
    targetCodec === 'auto'
      ? SOURCE_AUDIO_ENCODER_MAP.has(normalizedSource)
        ? normalizedSource
        : 'ac3'
      : targetCodec;

  const spec = SOURCE_AUDIO_ENCODER_MAP.get(resolvedKey) ?? SOURCE_AUDIO_ENCODER_MAP.get('ac3')!;
  const args = [`-c:a:${String(outIdx)}`, spec.encoder];
  const bitrate = targetChannels > 2 ? spec.surroundBitrate : spec.stereoBitrate;
  if (bitrate) {
    args.push(`-b:a:${String(outIdx)}`, bitrate);
  }
  if (downmixStereo && channels > 2) {
    args.push(`-ac:a:${String(outIdx)}`, '2');
  }
  return args;
}

/** Builds deterministic shell-free `ffmpeg` arguments for lossless V/A MKV remuxing (with optional audio normalization). */
export function buildFfmpegRemuxArgs(
  item: ScannedItem,
  tempOutputPath: string,
  resolvedSubInputs: readonly { readonly sub: ExternalSubtitleFile; readonly inputPath: string }[],
  loudnormByStreamOrder?: ReadonlyMap<number, LoudnormMeasurements>
): readonly string[] {
  const args: string[] = ['-y', '-threads', '0', '-i', item.sourcePath];

  for (const entry of resolvedSubInputs) {
    args.push('-i', entry.inputPath);
  }

  args.push('-map', '0:V:0', '-c:v', 'copy');

  const norm = item.trackSelection.audioNormalization ?? DEFAULT_AUDIO_NORMALIZATION;
  const includedAudio = item.trackSelection.audioTracks.filter((t) => t.include);
  const needsPerStreamAudio = norm.mode !== 'copy' || norm.downmixStereo;

  if (!needsPerStreamAudio) {
    args.push('-c:a', 'copy');
  }

  includedAudio.forEach((track, outIdx): void => {
    args.push('-map', `0:a:${String(track.streamOrder)}`);
    args.push(`-metadata:s:a:${String(outIdx)}`, `language=${track.language}`);

    if (!needsPerStreamAudio) {
      return;
    }

    const probeStream = item.probe.audioStreams.find(
      (s): boolean => s.streamOrder === track.streamOrder
    );
    const channels = probeStream?.channels ?? 2;
    const sourceCodec = probeStream?.codecName ?? 'ac3';
    const analysis = item.probe.audioAnalysis?.find(
      (a): boolean => a.streamOrder === track.streamOrder
    );

    let filterExpr: string | null = null;
    if (norm.mode === 'peak') {
      const gainDb = analysis?.recommendedGainDb ?? 0;
      if (gainDb > 0) {
        filterExpr = `volume=${String(gainDb)}dB`;
      }
    } else if (norm.mode === 'loudnorm') {
      const measured = loudnormByStreamOrder?.get(track.streamOrder);
      if (measured) {
        filterExpr =
          `loudnorm=I=${String(AUDIO_LOUDNORM_TARGET_I)}:TP=${String(AUDIO_LOUDNORM_TARGET_TP)}:LRA=${String(AUDIO_LOUDNORM_TARGET_LRA)}:` +
          `measured_I=${measured.inputI}:measured_TP=${measured.inputTp}:measured_LRA=${measured.inputLra}:` +
          `measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true`;
      } else {
        filterExpr = `loudnorm=I=${String(AUDIO_LOUDNORM_TARGET_I)}:TP=${String(AUDIO_LOUDNORM_TARGET_TP)}:LRA=${String(AUDIO_LOUDNORM_TARGET_LRA)}`;
      }
    }

    const needsDownmix = norm.downmixStereo && channels > 2;
    if (!filterExpr && !needsDownmix) {
      args.push(`-c:a:${String(outIdx)}`, 'copy');
      return;
    }

    if (filterExpr) {
      args.push(`-filter:a:${String(outIdx)}`, filterExpr);
    }
    args.push(
      ...resolveAudioEncoderArgs(sourceCodec, norm.codec, outIdx, channels, norm.downmixStereo)
    );
  });

  if (includedAudio.length > 0) {
    args.push('-disposition:a', '0');
    const defaultIdx = includedAudio.findIndex((t) => t.isDefault);
    args.push(`-disposition:a:${String(Math.max(0, defaultIdx))}`, 'default');
  }

  let outSubIdx = 0;
  if (item.trackSelection.subtitleMergeMode !== 'replace') {
    const includedInternal =
      item.trackSelection.subtitleMergeMode === 'keep-and-add'
        ? item.probe.subtitleStreams
        : item.probe.subtitleStreams.filter((s): boolean =>
            item.trackSelection.includedInternalSubtitles.includes(s.streamOrder)
          );

    for (const internalSub of includedInternal) {
      args.push('-map', `0:s:${String(internalSub.streamOrder)}`);
      const subCodec = CONVERTIBLE_TEXT_SUBTITLE_CODEC_SET.has(
        internalSub.codecName as ConvertibleTextSubtitleCodec
      )
        ? 'srt'
        : 'copy';
      args.push(`-c:s:${String(outSubIdx)}`, subCodec);
      args.push(`-metadata:s:s:${String(outSubIdx)}`, `language=${internalSub.language}`);
      if (internalSub.isForced) {
        args.push(`-disposition:s:${String(outSubIdx)}`, 'forced');
      } else if (internalSub.isHearingImpaired) {
        args.push(`-disposition:s:${String(outSubIdx)}`, 'hearing_impaired');
      }
      outSubIdx += 1;
    }
  }

  resolvedSubInputs.forEach((entry, inputOffset): void => {
    args.push('-map', `${String(inputOffset + 1)}:0`);
    args.push(`-c:s:${String(outSubIdx)}`, 'copy');
    args.push(`-metadata:s:s:${String(outSubIdx)}`, `language=${entry.sub.language}`);
    if (entry.sub.isForced) {
      args.push(`-disposition:s:${String(outSubIdx)}`, 'forced');
    } else if (entry.sub.isHearingImpaired) {
      args.push(`-disposition:s:${String(outSubIdx)}`, 'hearing_impaired');
    }
    outSubIdx += 1;
  });

  args.push('-metadata', `ORIGINAL_FILENAME=${item.fileName}`);
  if (item.relativePath && item.relativePath !== item.fileName) {
    args.push('-metadata', `ORIGINAL_PATH=${item.relativePath}`);
  }

  args.push('-progress', 'pipe:1', '-nostats', tempOutputPath);
  return args;
}

/** Spawns `ffmpeg` without a shell and streams `0..100` progress percentage and ETA. */
export async function runFfmpegRemux(
  args: readonly string[],
  durationSeconds: number,
  onProgress: (percent: number, etaSeconds?: number) => void,
  registerChild?: (child: ChildProcess | null) => void
): Promise<void> {
  await runFfmpegProcess(
    args,
    durationSeconds,
    (update) => onProgress(update.percent, update.etaSeconds),
    registerChild
  );
}
