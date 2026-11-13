/** Supported media kinds governing Plex naming templates. */
export const MEDIA_KINDS = ['movie', 'tv'] as const;

/** Supported output library categories mapped to container mounts. */
export const OUTPUT_CATEGORIES = [
  'movies',
  'tv-shows',
  'animated-movies',
  'animated-series'
] as const;

/** Server-owned state machine phases. */
export const JOB_PHASES = [
  'IDLE',
  'SCANNING',
  'READY',
  'PREFLIGHT_BLOCKED',
  'PROCESSING',
  'ERROR'
] as const;

/** Pre-flight conflict resolution decisions. */
export const CONFLICT_DECISIONS = ['overwrite', 'ignore'] as const;

/** Subtitle merge strategies during MKV remuxing. */
export const SUBTITLE_MERGE_MODES = ['keep-and-add', 'replace', 'selected-only'] as const;

/** Supported TVDB episode ordering modes. */
export const EPISODE_ORDER_MODES = ['aired', 'dvd', 'absolute'] as const;

/** Active sub-stage labels emitted during scanning, remuxing, verification, moving, and cleanup. */
export const JOB_STAGE_KINDS = ['scanning', 'remuxing', 'verifying', 'moving', 'cleanup'] as const;

/**
 * Maximum safe relative Plex path length (`ShowFolder/Season XX/FileName.mkv`)
 * leaving ~80 characters of headroom before Windows' classic 259-char path limit.
 */
const PLEX_MAX_RELATIVE_PATH_LENGTH = 180;
const MIN_READABLE_EPISODE_TITLE_LENGTH = 12;

const WINDOWS_RESERVED_NAME_REGEX = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN_FS_CHARS_REGEX = /[\\/:*?"<>|]/g;
const MIN_PRINTABLE_CODE_POINT = 0x20;

/**
 * Sanitizes a Plex folder or filename segment for cross-filesystem compatibility
 * (Linux, macOS, Windows, SMB/NAS) by stripping forbidden symbols, repeated dots, and trailing dots.
 */
export function sanitizePlexSegment(raw: string): string {
  const printable = Array.from(raw)
    .filter((ch): boolean => (ch.codePointAt(0) ?? 0) >= MIN_PRINTABLE_CODE_POINT)
    .join('');
  const cleaned = printable
    .replaceAll('&', 'and')
    .replaceAll(FORBIDDEN_FS_CHARS_REGEX, '')
    .replaceAll(/\.{2,}/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!cleaned) {
    return '';
  }
  return WINDOWS_RESERVED_NAME_REGEX.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Fits an optional TV episode title within `maxLength` for the relative output path,
 * trimming cleanly at a word boundary while preserving show title, year, and `sXXeYY`.
 */
export function fitTvEpisodeTitleToBudget(
  baseRelativeLengthWithoutTitle: number,
  episodeTitle: string,
  maxLength = PLEX_MAX_RELATIVE_PATH_LENGTH
): string {
  const cleanTitle = sanitizePlexSegment(episodeTitle);
  if (!cleanTitle) {
    return '';
  }
  const separatorLength = ' - '.length;
  const remaining = maxLength - baseRelativeLengthWithoutTitle - separatorLength;
  if (remaining >= cleanTitle.length) {
    return cleanTitle;
  }
  if (remaining < MIN_READABLE_EPISODE_TITLE_LENGTH) {
    return '';
  }
  const slice = cleanTitle.slice(0, remaining);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = (
    lastSpace >= MIN_READABLE_EPISODE_TITLE_LENGTH ? slice.slice(0, lastSpace) : slice
  )
    .replaceAll(/[\s,\-–—.;:]+$/g, '')
    .trim();
  return trimmed.length >= MIN_READABLE_EPISODE_TITLE_LENGTH ? trimmed : '';
}

/** Quick-select ISO-639-2 language presets in UI. */
export const ISO_639_2_PRESETS = [
  'spa',
  'eng',
  'jpn',
  'zho',
  'chi',
  'kor',
  'por',
  'fra',
  'fre',
  'deu',
  'ger',
  'ita',
  'rus',
  'ara',
  'hin',
  'tha',
  'vie',
  'ind',
  'pol',
  'nld',
  'dut',
  'swe',
  'nor',
  'dan',
  'fin',
  'tur',
  'und'
] as const;

/** Human-readable labels for ISO-639-2 preset codes. */
export const ISO_639_2_LABELS: Record<(typeof ISO_639_2_PRESETS)[number], string> = {
  spa: 'Spanish',
  eng: 'English',
  jpn: 'Japanese',
  zho: 'Chinese (zho)',
  chi: 'Chinese (chi)',
  kor: 'Korean',
  por: 'Portuguese',
  fra: 'French (fra)',
  fre: 'French (fre)',
  deu: 'German (deu)',
  ger: 'German (ger)',
  ita: 'Italian',
  rus: 'Russian',
  ara: 'Arabic',
  hin: 'Hindi',
  tha: 'Thai',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  pol: 'Polish',
  nld: 'Dutch (nld)',
  dut: 'Dutch (dut)',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  tur: 'Turkish',
  und: 'Undetermined'
};

/** Supported metadata title language codes in priority order. */
export const METADATA_LANGUAGE_CODES = [
  'spa',
  'eng',
  'jpn',
  'por',
  'fra',
  'deu',
  'ita',
  'native'
] as const;

/** Human-readable labels for metadata title language codes. */
export const METADATA_LANGUAGE_LABELS: Record<(typeof METADATA_LANGUAGE_CODES)[number], string> = {
  spa: 'Español (spa)',
  eng: 'English (eng)',
  jpn: 'Japanese (jpn)',
  por: 'Português (por)',
  fra: 'Français (fra)',
  deu: 'Deutsch (deu)',
  ita: 'Italiano (ita)',
  native: 'Native'
};

/** Default preferred metadata title language order. */
export const DEFAULT_PREFERRED_LANGUAGES: readonly (typeof METADATA_LANGUAGE_CODES)[number][] = [
  'eng',
  'spa',
  'native'
];

/** Log event severity levels. */
export const LOG_LEVELS = ['info', 'warn', 'error'] as const;

/** Metadata lookup providers and manual/hint sources. */
export const METADATA_CANDIDATE_SOURCES = [
  'imdb',
  'omdb',
  'tvdb',
  'tvmaze',
  'plexmatch',
  'manual'
] as const;

/** Pre-flight conflict classification kinds. */
export const CONFLICT_KINDS = ['existing-file', 'intra-batch'] as const;

/** LAN concurrency/lock error codes. */
export const LOCK_ERROR_CODES = ['LOCK_HELD', 'STALE_REVISION'] as const;

/** Recognized video container extensions (lowercase, leading dot). */
const VIDEO_EXTENSIONS = [
  '.mkv',
  '.mp4',
  '.avi',
  '.m4v',
  '.mov',
  '.ts',
  '.m2ts',
  '.wmv',
  '.flv',
  '.webm'
] as const;

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];
export const VIDEO_EXTENSION_SET: ReadonlySet<VideoExtension> = new Set<VideoExtension>(
  VIDEO_EXTENSIONS
);

/** Supported external text/bitmap subtitle extensions. */
const SUBTITLE_EXTENSIONS = ['.srt', '.smi', '.ssa', '.ass', '.vtt', '.idx', '.sub'] as const;

export type SubtitleExtension = (typeof SUBTITLE_EXTENSIONS)[number];
export const SUBTITLE_EXTENSION_SET: ReadonlySet<SubtitleExtension> = new Set<SubtitleExtension>(
  SUBTITLE_EXTENSIONS
);

/** Unsupported Plex disk image extensions. */
const DISK_IMAGE_EXTENSIONS = ['.dvdmedia', '.iso', '.img'] as const;

export type DiskImageExtension = (typeof DISK_IMAGE_EXTENSIONS)[number];
export const DISK_IMAGE_EXTENSION_SET: ReadonlySet<DiskImageExtension> =
  new Set<DiskImageExtension>(DISK_IMAGE_EXTENSIONS);

/** Unsupported Plex disk image folder names (lowercase). */
const DISK_IMAGE_FOLDERS = ['video_ts', 'bdmv'] as const;
export type DiskImageFolder = (typeof DISK_IMAGE_FOLDERS)[number];
export const DISK_IMAGE_FOLDER_SET: ReadonlySet<DiskImageFolder> = new Set<DiskImageFolder>(
  DISK_IMAGE_FOLDERS
);

/** Plex official local extra subdirectory names (lowercase). */
const PLEX_EXTRA_FOLDERS = [
  'behind the scenes',
  'deleted scenes',
  'featurettes',
  'interviews',
  'scenes',
  'shorts',
  'trailers',
  'other'
] as const;
export type PlexExtraFolder = (typeof PLEX_EXTRA_FOLDERS)[number];
export const PLEX_EXTRA_FOLDER_SET: ReadonlySet<PlexExtraFolder> = new Set<PlexExtraFolder>(
  PLEX_EXTRA_FOLDERS
);

/** Auxiliary folder tokens excluded by Plex or scanner. */
export const EXCLUDED_FOLDER_TOKENS = ['extras', 'samples', 'bonus', 'bonus disc'] as const;

/** Subtitle sidecar subfolder names recognized by Plex (lowercase). */
const SUBTITLE_FOLDERS = ['subs', 'subtitles'] as const;
export type SubtitleFolder = (typeof SUBTITLE_FOLDERS)[number];
export const SUBTITLE_FOLDER_SET: ReadonlySet<SubtitleFolder> = new Set<SubtitleFolder>(
  SUBTITLE_FOLDERS
);

/** Plex inline extra suffixes (without leading hyphen). */
export const PLEX_INLINE_EXTRA_SUFFIXES = [
  'behindthescenes',
  'deleted',
  'featurette',
  'interview',
  'scene',
  'short',
  'trailer',
  'other'
] as const;

/** Plex sample file threshold: files with "sample" strictly below 300 MB are ignored. */
export const PLEX_SAMPLE_MAX_BYTES = 300 * 1024 * 1024;

/** Plex maximum edition name length inside `{edition-...}`. */
export const PLEX_EDITION_MAX_LENGTH = 32;

/** Maximum split-part index supported by Plex stacking. */
export const PLEX_MAX_SPLIT_PARTS = 8;

/** TVmaze public API rate limit (<= 20 requests per 10 seconds). */
export const TVMAZE_MAX_REQUESTS = 20;
export const TVMAZE_WINDOW_MS = 10_000;

/** Default ports and permissions. */
export const DEFAULT_APP_PORT = 3000;
export const DEFAULT_DEV_CLIENT_PORT = 5173;
export const DEFAULT_PUID = 1000;
export const DEFAULT_PGID = 1000;
export const PERCENT_MAX = 100;

/** Temporary remux suffix before atomic move. */
export const ORGANIZING_TEMP_MARKER = '.organizing.';
export const ORGANIZING_TEMP_SUFFIX = '.tmp.mkv';

/** Deterministic ISO-639-1 / regional / ISO-639-2/B -> ISO-639-2/T normalization map. */
export const LANGUAGE_CODE_MAP = {
  es: 'spa',
  esp: 'spa',
  spa: 'spa',
  'es-419': 'spa',
  'es-es': 'spa',
  'es-mx': 'spa',
  latino: 'spa',
  castellano: 'spa',
  en: 'eng',
  eng: 'eng',
  ing: 'eng',
  'en-us': 'eng',
  'en-gb': 'eng',
  ja: 'jpn',
  jp: 'jpn',
  jpn: 'jpn',
  de: 'deu',
  ger: 'deu',
  deu: 'deu',
  fr: 'fra',
  fre: 'fra',
  fra: 'fra',
  pt: 'por',
  por: 'por',
  'pt-br': 'por',
  'pt-pt': 'por',
  it: 'ita',
  ita: 'ita',
  zh: 'zho',
  chi: 'zho',
  zho: 'zho',
  nl: 'nld',
  dut: 'nld',
  nld: 'nld',
  ru: 'rus',
  rus: 'rus',
  ko: 'kor',
  kor: 'kor',
  und: 'und'
} as const;

export type LanguageAlias = keyof typeof LANGUAGE_CODE_MAP;

/** Subtitle text codecs incompatible with MKV copy that convert cleanly to SRT. */
const CONVERTIBLE_TEXT_SUBTITLE_CODECS = ['mov_text', 'tx3g'] as const;
export type ConvertibleTextSubtitleCodec = (typeof CONVERTIBLE_TEXT_SUBTITLE_CODECS)[number];
export const CONVERTIBLE_TEXT_SUBTITLE_CODEC_SET: ReadonlySet<ConvertibleTextSubtitleCodec> =
  new Set<ConvertibleTextSubtitleCodec>(CONVERTIBLE_TEXT_SUBTITLE_CODECS);

/** Resolution normalization map (lowercased input -> Plex bracket tag). */
export const RESOLUTION_TAG_MAP = {
  '480p': '480p',
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '2k',
  '2k': '2k',
  '2160p': '4k',
  '4k': '4k',
  '4320p': '8k',
  '8k': '8k'
} as const;

export type ResolutionToken = keyof typeof RESOLUTION_TAG_MAP;

/** Supported audio normalization strategies during MKV remuxing. */
export const AUDIO_NORMALIZATION_MODES = ['copy', 'peak', 'loudnorm'] as const;
export type AudioNormalizationMode = (typeof AUDIO_NORMALIZATION_MODES)[number];

/** Target audio encoders when normalization or downmixing re-encodes audio. */
export const AUDIO_OUTPUT_CODECS = ['auto', 'flac', 'ac3', 'aac'] as const;
export type AudioOutputCodec = (typeof AUDIO_OUTPUT_CODECS)[number];

/** Diagnostic audio level recommendation derived from ffmpeg volumedetect. */
const AUDIO_SUGGESTION_KINDS = ['ok', 'peak-gain', 'loudnorm'] as const;
export type AudioSuggestionKind = (typeof AUDIO_SUGGESTION_KINDS)[number];

/** Peak threshold (dBFS) below which fixed peak gain is suggested without compression. */
export const AUDIO_PEAK_SUGGEST_THRESHOLD_DB = -2.0;

/** Mean loudness threshold (dBFS) below which 2-pass EBU R128 loudnorm is suggested. */
export const AUDIO_MEAN_QUIET_THRESHOLD_DB = -22.0;

/** Safe peak ceiling (dBFS) used when computing recommended peak gain to avoid clipping. */
export const AUDIO_SAFE_PEAK_CEILING_DB = -1.0;

/** Maximum concurrent ffmpeg volumedetect processes during input scan. */
export const AUDIO_SCAN_CONCURRENCY = 3;

/** EBU R128 loudnorm target parameters for 2-pass normalization. */
export const AUDIO_LOUDNORM_TARGET_I = -16;
export const AUDIO_LOUDNORM_TARGET_TP = -1.5;
export const AUDIO_LOUDNORM_TARGET_LRA = 11;

/** Retention window (7 days in ms) for processed originals stored in backupDir. */
export const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Metadata provider rate limiting, retry, and persistent cache settings. */
export const IMDB_MIN_INTERVAL_MS = 400;
export const TVDB_MIN_INTERVAL_MS = 350;
export const METADATA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const METADATA_MAX_RETRIES = 2;
export const METADATA_RETRY_BASE_MS = 500;
export const METADATA_RETRY_MAX_MS = 30_000;
