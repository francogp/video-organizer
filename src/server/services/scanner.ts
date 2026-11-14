import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AUDIO_SCAN_CONCURRENCY,
  DISK_IMAGE_EXTENSION_SET,
  DISK_IMAGE_FOLDER_SET,
  EXCLUDED_FOLDER_TOKENS,
  LANGUAGE_CODE_MAP,
  ORGANIZING_TEMP_MARKER,
  ORGANIZING_TEMP_SUFFIX,
  PLEX_EXTRA_FOLDER_SET,
  PLEX_INLINE_EXTRA_SUFFIXES,
  PLEX_SAMPLE_MAX_BYTES,
  SUBTITLE_EXTENSION_SET,
  SUBTITLE_FOLDER_SET,
  VIDEO_EXTENSION_SET,
  type LanguageAlias
} from '../../domain/constants.ts';
import { extractPlexTags, extractSplitPart } from '../../domain/plexFormatter.ts';
import {
  asImdbId,
  asIso639_2Code,
  asItemId,
  asTmdbId,
  asTvdbId,
  type AudioTrackAnalysis,
  type EpisodeInfo,
  type ExternalSubtitleFile,
  type ImdbId,
  type Iso639_2Code,
  type MediaKind,
  type MediaProbeSummary,
  type MetadataCandidate,
  type OutputCategory,
  type ScannedItem,
  type TmdbId,
  type TrackSelection,
  type TvdbId
} from '../../domain/types.ts';

const SEASON_FOLDER_REGEX = /\b(?:season|temporada|specials)\s*(\d{0,2})\b/i;
const SXXEXX_REGEX = /\bs(\d{1,2})e(\d{1,3})(?:-?e(\d{1,3}))?\b/i;
const NXNN_REGEX = /(?:^|[\s._-])(\d{1,2})x(\d{2,3})(?=$|[\s._-])/i;
const DATE_YMD_REGEX = /(?:^|[\s._-])(\d{4})[-.\s](\d{2})[-.\s](\d{2})(?=$|[\s._-])/;
const DATE_DMY_REGEX = /(?:^|[\s._-])(\d{2})[-.\s](\d{2})[-.\s](\d{4})(?=$|[\s._-])/;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/;
const RELEASE_MARKER_REGEX =
  /(?:^|[\s._-])(?:2160p|1080p|720p|480p|4k|uhd|hdr\d*|bluray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|remux|uncensored|x264|x265|h\.?264|h\.?265|hevc|av1|aac\d*(?:\.\d)?|ac3|eac3|dts|flac|dual|multi|esub|subbed|proper|repack)(?=$|[\s._-])/i;
const INLINE_EXTRA_REGEX = new RegExp(`-(?:${PLEX_INLINE_EXTRA_SUFFIXES.join('|')})\\d*$`, 'i');
const MICRODVD_TEXT_REGEX = /^\{\d+\}\{\d+\}/;
const SAMPLE_SNIFF_BYTES = 128;
const MIN_MEDIA_YEAR = 1888;

export interface PlexmatchHints {
  readonly title?: string;
  readonly year?: number;
  readonly season?: number;
  readonly tvdbId?: TvdbId;
  readonly tmdbId?: TmdbId;
  readonly imdbId?: ImdbId;
  readonly pattern?: string;
  readonly episodes: ReadonlyMap<string, string>;
}

function escapeGlobToRegex(glob: string): RegExp {
  const escaped = glob.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesPlexignore(
  relPosixPath: string,
  fileName: string,
  rules: readonly { readonly dirPosix: string; readonly pattern: string }[]
): boolean {
  for (const rule of rules) {
    const clean = rule.pattern.trim();
    if (!clean || clean.startsWith('#')) {
      continue;
    }
    if (clean.includes('/')) {
      const target = rule.dirPosix ? `${rule.dirPosix}/${clean}` : clean;
      if (escapeGlobToRegex(target.replaceAll(/^\//g, '')).test(relPosixPath)) {
        return true;
      }
    } else if (escapeGlobToRegex(clean).test(fileName)) {
      return true;
    }
  }
  return false;
}

function parsePlexmatchContent(raw: string): PlexmatchHints {
  let title: string | undefined;
  let year: number | undefined;
  let season: number | undefined;
  let tvdbId: TvdbId | undefined;
  let tmdbId: TmdbId | undefined;
  let imdbId: ImdbId | undefined;
  let pattern: string | undefined;
  const episodes = new Map<string, string>();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key === 'title' || key === 'show') {
      title = val;
    } else if (key === 'year') {
      const y = Number(val);
      if (Number.isInteger(y) && y >= MIN_MEDIA_YEAR) {
        year = y;
      }
    } else if (key === 'season') {
      const s = Number(val);
      if (Number.isInteger(s) && s >= 0) {
        season = s;
      }
    } else if (key === 'tvdbid' && /^\d+$/.test(val)) {
      tvdbId = asTvdbId(val);
    } else if (key === 'tmdbid' && /^\d+$/.test(val)) {
      tmdbId = asTmdbId(val);
    } else if (key === 'imdbid') {
      const normalized = val.startsWith('tt') ? val : `tt${val}`;
      if (/^tt\d+$/.test(normalized)) {
        imdbId = asImdbId(normalized);
      }
    } else if (key === 'guid') {
      const imdbMatch = /^imdb:\/\/(tt\d+)/i.exec(val);
      const tvdbMatch = /^tvdb:\/\/(\d+)/i.exec(val);
      const tmdbMatch = /^tmdb:\/\/(\d+)/i.exec(val);
      if (imdbMatch?.[1]) {
        imdbId = asImdbId(imdbMatch[1]);
      } else if (tvdbMatch?.[1]) {
        tvdbId = asTvdbId(tvdbMatch[1]);
      } else if (tmdbMatch?.[1]) {
        tmdbId = asTmdbId(tmdbMatch[1]);
      }
    } else if (key === 'pattern' || key === 'pt') {
      pattern = val;
    } else if (key === 'ep' || key === 'episode') {
      const epColon = val.indexOf(':');
      if (epColon > 0) {
        const epCode = val.slice(0, epColon).trim();
        const epTarget = val.slice(epColon + 1).trim();
        episodes.set(epTarget, epCode);
      }
    }
  }

  return { title, year, season, tvdbId, tmdbId, imdbId, pattern, episodes };
}

function resolveCascadedPlexmatchHints(
  startDir: string,
  inputDir: string,
  plexmatchByDir: ReadonlyMap<string, PlexmatchHints>
): PlexmatchHints | undefined {
  const chain: PlexmatchHints[] = [];
  let cursor = path.resolve(startDir);
  const root = path.resolve(inputDir);

  while (cursor.startsWith(root)) {
    const hint = plexmatchByDir.get(cursor);
    if (hint) {
      chain.unshift(hint);
    }
    if (cursor === root) {
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  if (chain.length === 0) {
    return undefined;
  }

  const mergedEpisodes = new Map<string, string>();
  let title: string | undefined;
  let year: number | undefined;
  let season: number | undefined;
  let tvdbId: TvdbId | undefined;
  let tmdbId: TmdbId | undefined;
  let imdbId: ImdbId | undefined;
  let pattern: string | undefined;

  for (const hint of chain) {
    title = hint.title ?? title;
    year = hint.year ?? year;
    season = hint.season ?? season;
    tvdbId = hint.tvdbId ?? tvdbId;
    tmdbId = hint.tmdbId ?? tmdbId;
    imdbId = hint.imdbId ?? imdbId;
    pattern = hint.pattern ?? pattern;
    for (const [k, v] of hint.episodes) {
      mergedEpisodes.set(k, v);
    }
  }

  return { title, year, season, tvdbId, tmdbId, imdbId, pattern, episodes: mergedEpisodes };
}

function applyPlexmatchEpisodeOverride(
  fileName: string,
  baseNoExt: string,
  relPosix: string,
  dirHints: PlexmatchHints | undefined,
  fallbackEpisode: EpisodeInfo | undefined
): EpisodeInfo | undefined {
  const rawCode =
    dirHints?.episodes.get(fileName) ??
    dirHints?.episodes.get(relPosix) ??
    dirHints?.episodes.get(baseNoExt);
  if (!rawCode) {
    return fallbackEpisode;
  }
  const sxx = SXXEXX_REGEX.exec(rawCode);
  if (sxx) {
    return {
      seasonNumber: Number(sxx[1]),
      episodeStart: Number(sxx[2]),
      episodeEnd: sxx[3] ? Number(sxx[3]) : undefined
    };
  }
  const nxn = NXNN_REGEX.exec(rawCode);
  if (nxn) {
    return {
      seasonNumber: Number(nxn[1]),
      episodeStart: Number(nxn[2])
    };
  }
  const numOnly = /^(\d{1,3})$/.exec(rawCode.trim());
  if (numOnly) {
    return {
      seasonNumber: dirHints?.season ?? fallbackEpisode?.seasonNumber ?? 1,
      episodeStart: Number(numOnly[1])
    };
  }
  return fallbackEpisode;
}

function isExcludedFolderSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (
    DISK_IMAGE_FOLDER_SET.has(
      lower as typeof DISK_IMAGE_FOLDER_SET extends ReadonlySet<infer U> ? U : never
    ) ||
    PLEX_EXTRA_FOLDER_SET.has(
      lower as typeof PLEX_EXTRA_FOLDER_SET extends ReadonlySet<infer U> ? U : never
    ) ||
    SUBTITLE_FOLDER_SET.has(
      lower as typeof SUBTITLE_FOLDER_SET extends ReadonlySet<infer U> ? U : never
    )
  ) {
    return true;
  }
  return EXCLUDED_FOLDER_TOKENS.some((token): boolean => lower.includes(token));
}

function normalizeIsoLanguage(token: string): Iso639_2Code | undefined {
  const lower = token.toLowerCase();
  if (Object.hasOwn(LANGUAGE_CODE_MAP, lower)) {
    return asIso639_2Code(LANGUAGE_CODE_MAP[lower as LanguageAlias]);
  }
  return undefined;
}

async function isBinarySubFile(subPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(subPath, 'r');
    try {
      const buf = Buffer.alloc(SAMPLE_SNIFF_BYTES);
      const { bytesRead } = await handle.read(buf, 0, SAMPLE_SNIFF_BYTES, 0);
      const snippet = buf.subarray(0, bytesRead).toString('utf8');
      if (snippet.includes('\u0000')) {
        return true;
      }
      return !MICRODVD_TEXT_REGEX.test(snippet.trim()) && !snippet.trim().startsWith('#');
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function collectExternalSubtitles(
  videoPath: string,
  inputDir: string
): Promise<readonly ExternalSubtitleFile[]> {
  const videoDir = path.dirname(videoPath);
  const videoStem = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  const candidateDirs = [videoDir];

  try {
    const entries = await fs.readdir(videoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        SUBTITLE_FOLDER_SET.has(entry.name.toLowerCase() as 'subs' | 'subtitles')
      ) {
        candidateDirs.push(path.join(videoDir, entry.name));
      }
    }
  } catch {
    // Ignore unreadable subfolder
  }

  const results: ExternalSubtitleFile[] = [];
  for (const dir of candidateDirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const idxFiles = new Set(
      entries
        .filter((e): boolean => e.isFile() && path.extname(e.name).toLowerCase() === '.idx')
        .map((e): string => path.basename(e.name, path.extname(e.name)).toLowerCase())
    );

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (
        !SUBTITLE_EXTENSION_SET.has(
          ext as typeof SUBTITLE_EXTENSION_SET extends ReadonlySet<infer U> ? U : never
        )
      ) {
        continue;
      }
      if (ext === '.idx') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const baseName = path.basename(entry.name, ext);
      const lowerBase = baseName.toLowerCase();

      if (
        dir === videoDir &&
        !lowerBase.startsWith(videoStem) &&
        entries.filter(
          (e): boolean =>
            e.isFile() && VIDEO_EXTENSION_SET.has(path.extname(e.name).toLowerCase() as never)
        ).length > 1
      ) {
        continue;
      }

      const tokens = lowerBase.split('.').slice(1);
      const isForced = tokens.includes('forced');
      const isHearingImpaired = tokens.includes('sdh') || tokens.includes('cc');
      let detectedLang: Iso639_2Code | undefined;
      for (const tok of tokens) {
        if (tok === 'forced' || tok === 'sdh' || tok === 'cc') {
          continue;
        }
        detectedLang = normalizeIsoLanguage(tok);
        if (detectedLang) {
          break;
        }
      }

      let idxPairPath: string | undefined;
      let missingIdxWarning: string | undefined;
      if (ext === '.sub') {
        const hasIdx = idxFiles.has(lowerBase);
        if (hasIdx) {
          idxPairPath = path.join(dir, `${baseName}.idx`);
        } else if (await isBinarySubFile(fullPath)) {
          missingIdxWarning = `Binary VobSub file "${entry.name}" is missing its companion .idx file.`;
        }
      }

      results.push({
        path: fullPath,
        relativePath: path.relative(inputDir, fullPath),
        extension: ext,
        language: detectedLang ?? asIso639_2Code('und'),
        isForced,
        isHearingImpaired,
        isLanguageAmbiguous: !detectedLang,
        idxPairPath,
        missingIdxWarning
      });
    }
  }

  return results;
}

function parseEpisodeInfo(
  relativePath: string,
  fileNameNoExt: string,
  plexmatchSeason?: number
): EpisodeInfo | undefined {
  const sxxExx = SXXEXX_REGEX.exec(fileNameNoExt);
  if (sxxExx?.[1] && sxxExx[2]) {
    return {
      seasonNumber: Number(sxxExx[1]),
      episodeStart: Number(sxxExx[2]),
      episodeEnd: sxxExx[3] ? Number(sxxExx[3]) : undefined,
      splitPart: extractSplitPart(fileNameNoExt)
    };
  }

  const nxnn = NXNN_REGEX.exec(fileNameNoExt);
  if (nxnn?.[1] && nxnn[2]) {
    return {
      seasonNumber: Number(nxnn[1]),
      episodeStart: Number(nxnn[2]),
      splitPart: extractSplitPart(fileNameNoExt)
    };
  }

  const ymd = DATE_YMD_REGEX.exec(fileNameNoExt);
  if (ymd?.[1] && ymd[2] && ymd[3]) {
    return {
      seasonNumber: plexmatchSeason ?? Number(ymd[1]),
      episodeStart: 1,
      airDate: `${ymd[1]}-${ymd[2]}-${ymd[3]}`,
      splitPart: extractSplitPart(fileNameNoExt)
    };
  }

  const dmy = DATE_DMY_REGEX.exec(fileNameNoExt);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    return {
      seasonNumber: plexmatchSeason ?? Number(dmy[3]),
      episodeStart: 1,
      airDate: `${dmy[3]}-${dmy[2]}-${dmy[1]}`,
      splitPart: extractSplitPart(fileNameNoExt)
    };
  }

  const segments = path.dirname(relativePath).split(path.sep);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (!seg) {
      continue;
    }
    const seasonMatch = SEASON_FOLDER_REGEX.exec(seg);
    if (seasonMatch) {
      const seasonNum = seg.toLowerCase().includes('special') ? 0 : Number(seasonMatch[1] || '1');
      return {
        seasonNumber: plexmatchSeason ?? seasonNum,
        episodeStart: 1,
        splitPart: extractSplitPart(fileNameNoExt)
      };
    }
  }

  return undefined;
}

function cleanTitleFromName(rawName: string): { readonly title: string; readonly year?: number } {
  const yearMatch = YEAR_REGEX.exec(rawName);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : undefined;

  const cutCandidates = [
    SXXEXX_REGEX.exec(rawName)?.index,
    NXNN_REGEX.exec(rawName)?.index,
    DATE_YMD_REGEX.exec(rawName)?.index,
    DATE_DMY_REGEX.exec(rawName)?.index,
    SEASON_FOLDER_REGEX.exec(rawName)?.index,
    RELEASE_MARKER_REGEX.exec(rawName)?.index,
    yearMatch?.index
  ].filter((idx): idx is number => typeof idx === 'number' && idx > 0);

  let title = cutCandidates.length > 0 ? rawName.slice(0, Math.min(...cutCandidates)) : rawName;
  const leadingBracketMatch = /^(\[[^\]]+\])/.exec(title);
  const leadingBracket = leadingBracketMatch?.[1] ?? '';
  const remainderTitle = leadingBracket ? title.slice(leadingBracket.length) : title;
  const cleanedRemainder = remainderTitle
    .replaceAll(/\[[^\]]*\]/g, ' ')
    .replaceAll(/\{[^}]*\}/g, ' ')
    .replaceAll(/[._]/g, ' ')
    .replaceAll(/[()]/g, ' ')
    .replaceAll(/[\s-]+$/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  title = `${leadingBracket} ${cleanedRemainder}`.trim();
  return { title: title || rawName, year };
}

function buildInitialTrackSelection(
  probe: MediaProbeSummary,
  externalSubtitles: readonly ExternalSubtitleFile[]
): TrackSelection {
  const audioTracks = probe.audioStreams.map((stream, idx) => ({
    streamOrder: stream.streamOrder,
    include: true,
    language: stream.language,
    isDefault: stream.isDefault || idx === 0
  }));

  const subtitleCollisionKey = (sub: {
    readonly language: string;
    readonly isForced: boolean;
    readonly isHearingImpaired: boolean;
  }): string => `${sub.language}:${String(sub.isForced)}:${String(sub.isHearingImpaired)}`;

  const hasAmbiguousLang = externalSubtitles.some(
    (s) => s.isLanguageAmbiguous || Boolean(s.missingIdxWarning)
  );
  const internalKeys = new Set(probe.subtitleStreams.map(subtitleCollisionKey));
  const externalLangCounts = new Map<string, number>();
  let hasInternalExternalCollision = false;
  for (const sub of externalSubtitles) {
    const key = subtitleCollisionKey(sub);
    externalLangCounts.set(key, (externalLangCounts.get(key) ?? 0) + 1);
    if (internalKeys.has(key)) {
      hasInternalExternalCollision = true;
    }
  }
  const hasDuplicateCollision = Array.from(externalLangCounts.values()).some((c): boolean => c > 1);

  const needsUserPrompt = hasAmbiguousLang || hasDuplicateCollision || hasInternalExternalCollision;
  let promptReason: string | undefined;
  if (hasAmbiguousLang) {
    promptReason =
      'One or more external subtitle files have an unrecognized language or missing .idx pair.';
  } else if (hasDuplicateCollision) {
    promptReason = 'Multiple external subtitles share the same language and flags.';
  } else if (hasInternalExternalCollision) {
    promptReason =
      'One or more external subtitles share the same language and flags as an existing embedded subtitle.';
  }

  return {
    audioTracks,
    subtitleMergeMode: 'keep-and-add',
    includedInternalSubtitles: probe.subtitleStreams.map((s) => s.streamOrder),
    externalSubtitleOrder: externalSubtitles.map((s) => s.path),
    needsUserPrompt,
    promptReason
  };
}

export type ProbeFn = (filePath: string) => Promise<MediaProbeSummary>;

/** Walks `inputDir` with Node 26 native recursive `readdir` and produces `ScannedItem[]`. */
export async function scanInputDirectory(
  inputDir: string,
  probeFile: ProbeFn,
  shouldCancel?: () => boolean
): Promise<readonly ScannedItem[]> {
  const entries = await fs.readdir(inputDir, { recursive: true, withFileTypes: true });
  const plexignoreRules: { readonly dirPosix: string; readonly pattern: string }[] = [];
  const plexmatchByDir = new Map<string, PlexmatchHints>();

  for (const entry of entries) {
    if (shouldCancel?.()) {
      break;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(entry.parentPath, entry.name);
    const relDirPosix = path.relative(inputDir, entry.parentPath).split(path.sep).join('/');
    if (entry.name === '.plexignore') {
      const content = await fs.readFile(fullPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        plexignoreRules.push({ dirPosix: relDirPosix === '.' ? '' : relDirPosix, pattern: line });
      }
    } else if (entry.name === '.plexmatch') {
      const content = await fs.readFile(fullPath, 'utf8');
      plexmatchByDir.set(entry.parentPath, parsePlexmatchContent(content));
    }
  }

  const items: ScannedItem[] = [];

  for (const entry of entries) {
    if (shouldCancel?.()) {
      break;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (
      entry.name.includes(ORGANIZING_TEMP_MARKER) &&
      entry.name.endsWith(ORGANIZING_TEMP_SUFFIX)
    ) {
      continue;
    }

    const fullPath = path.join(entry.parentPath, entry.name);
    const relPath = path.relative(inputDir, fullPath);
    const relPosix = relPath.split(path.sep).join('/');
    const ext = path.extname(entry.name).toLowerCase();
    const baseNoExt = path.basename(entry.name, ext);

    if (DISK_IMAGE_EXTENSION_SET.has(ext as never)) {
      continue;
    }
    if (!VIDEO_EXTENSION_SET.has(ext as never)) {
      continue;
    }
    if (INLINE_EXTRA_REGEX.test(baseNoExt)) {
      continue;
    }

    const dirSegments = path
      .dirname(relPath)
      .split(path.sep)
      .filter((s): boolean => s !== '.');
    if (dirSegments.some((seg): boolean => isExcludedFolderSegment(seg))) {
      continue;
    }
    if (matchesPlexignore(relPosix, entry.name, plexignoreRules)) {
      continue;
    }

    const stat = await fs.stat(fullPath);
    if (entry.name.toLowerCase().includes('sample') && stat.size < PLEX_SAMPLE_MAX_BYTES) {
      continue;
    }

    const dirHints = resolveCascadedPlexmatchHints(entry.parentPath, inputDir, plexmatchByDir);

    const parsedEpisode = parseEpisodeInfo(relPath, baseNoExt, dirHints?.season);
    const episode = applyPlexmatchEpisodeOverride(
      entry.name,
      baseNoExt,
      relPosix,
      dirHints,
      parsedEpisode
    );
    const mediaKind: MediaKind = episode ? 'tv' : 'movie';
    const category: OutputCategory = mediaKind === 'tv' ? 'tv-shows' : 'movies';

    const probe = await probeFile(fullPath);
    const externalSubtitles = await collectExternalSubtitles(fullPath, inputDir);
    const warnings: string[] = [];
    for (const sub of externalSubtitles) {
      if (sub.missingIdxWarning) {
        warnings.push(sub.missingIdxWarning);
      }
    }

    const nameHintSource = mediaKind === 'tv' && dirSegments[0] ? dirSegments[0] : baseNoExt;
    const parsedFromPath = cleanTitleFromName(nameHintSource);
    const parsedTitle = dirHints?.title ?? parsedFromPath.title;
    const parsedYear = dirHints?.year ?? parsedFromPath.year;

    const candidates: MetadataCandidate[] = [];
    if (dirHints?.imdbId || dirHints?.tvdbId || dirHints?.tmdbId) {
      candidates.push({
        title: parsedTitle,
        year: parsedYear,
        imdbId: dirHints.imdbId,
        tvdbId: dirHints.tvdbId,
        tmdbId: dirHints.tmdbId,
        source: 'plexmatch'
      });
    }

    const idHash = crypto.createHash('sha1').update(relPosix).digest('hex').slice(0, 12);
    items.push({
      id: asItemId(idHash),
      sourcePath: fullPath,
      relativePath: relPath,
      fileName: entry.name,
      mediaKind,
      category,
      include: true,
      parsedTitle,
      parsedYear,
      tags: extractPlexTags(baseNoExt, probe),
      splitPart: extractSplitPart(baseNoExt),
      episode,
      probe,
      externalSubtitles,
      candidates,
      selectedMetadata: candidates[0],
      episodeOrder: 'aired',
      trackSelection: buildInitialTrackSelection(probe, externalSubtitles),
      warnings
    });
  }

  return items;
}

export type AudioAnalysisFn = (
  filePath: string,
  streamOrder: number,
  durationSeconds?: number,
  onProgress?: (update: { readonly percent: number; readonly etaSeconds?: number }) => void
) => Promise<AudioTrackAnalysis | null>;

type AudioCacheMap = Map<string, readonly AudioTrackAnalysis[]>;

async function loadAudioCache(cachePath: string): Promise<AudioCacheMap> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as [string, readonly AudioTrackAnalysis[]][];
    if (Array.isArray(parsed)) {
      return new Map(parsed);
    }
  } catch {
    // Ignore missing or corrupt cache; it will be rebuilt.
  }
  return new Map();
}

async function analyzeItemAudio(
  item: ScannedItem,
  cache: AudioCacheMap,
  analyzeAudio: AudioAnalysisFn,
  onItemProgress?: (fraction: number) => void
): Promise<{ readonly item: ScannedItem; readonly cacheUpdated: boolean }> {
  const includedTracks = item.trackSelection.audioTracks.filter((t) => t.include);
  if (includedTracks.length === 0) {
    return { item, cacheUpdated: false };
  }

  let cacheKey: string | null;
  try {
    const stat = await fs.stat(item.sourcePath);
    cacheKey = `${item.sourcePath}::${String(stat.size)}::${String(Math.round(stat.mtimeMs))}`;
  } catch {
    cacheKey = null;
  }

  const cached = cacheKey ? cache.get(cacheKey) : undefined;
  const analyses: AudioTrackAnalysis[] = cached ? [...cached] : [];
  let cacheUpdated = false;

  if (!cached) {
    for (const [trackIdx, track] of includedTracks.entries()) {
      try {
        const res = await analyzeAudio(
          item.sourcePath,
          track.streamOrder,
          item.probe.durationSeconds,
          (update) => {
            const trackFraction = Math.max(0, Math.min(1, update.percent / 100));
            onItemProgress?.((trackIdx + trackFraction) / includedTracks.length);
          }
        );
        if (res) {
          analyses.push(res);
        }
      } catch {
        // Non-fatal: item remains usable without volumedetect metrics.
      }
    }
    if (cacheKey && analyses.length > 0) {
      cache.set(cacheKey, analyses);
      cacheUpdated = true;
    }
  }

  if (analyses.length === 0) {
    return { item, cacheUpdated };
  }
  return {
    item: {
      ...item,
      probe: {
        ...item.probe,
        audioAnalysis: analyses
      }
    },
    cacheUpdated
  };
}

/**
 * Runs `volumedetect` analysis across scanned items with bounded concurrency and
 * persistent disk caching keyed by `(sourcePath, sizeBytes, mtimeMs)`.
 */
export async function enrichItemsWithAudioAnalysis(
  items: readonly ScannedItem[],
  configDir: string,
  analyzeAudio: AudioAnalysisFn,
  onProgress?: (
    completed: number,
    total: number,
    item: ScannedItem,
    overallFraction?: number
  ) => void,
  shouldCancel?: () => boolean
): Promise<readonly ScannedItem[]> {
  if (items.length === 0) {
    return items;
  }

  const cachePath = path.join(configDir, 'audio-cache.json');
  const cache = await loadAudioCache(cachePath);
  const results = [...items];
  const completedIndices = new Set<number>();
  const itemBytes = items.map((item) => Math.max(1, item.probe.sizeBytes));
  const totalBytes = itemBytes.reduce((sum, bytes) => sum + bytes, 0);
  const itemFractions = items.map(() => 0);
  let nextIndex = 0;
  let completed = 0;
  let cacheDirty = false;

  function computeOverallFraction(): number {
    if (totalBytes <= 0) {
      return items.length > 0 ? completed / items.length : 1;
    }
    let doneBytes = 0;
    for (let i = 0; i < itemBytes.length; i++) {
      doneBytes += (itemBytes[i] ?? 0) * (itemFractions[i] ?? 0);
    }
    return Math.max(0, Math.min(1, doneBytes / totalBytes));
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (shouldCancel?.()) {
        break;
      }
      const currentIdx = nextIndex;
      nextIndex += 1;
      const item = items[currentIdx]!;
      const outcome = await analyzeItemAudio(item, cache, analyzeAudio, (fraction) => {
        if (!shouldCancel?.()) {
          itemFractions[currentIdx] = fraction;
          onProgress?.(completed, items.length, item, computeOverallFraction());
        }
      });
      if (shouldCancel?.()) {
        break;
      }
      results[currentIdx] = outcome.item;
      completedIndices.add(currentIdx);
      itemFractions[currentIdx] = 1;
      if (outcome.cacheUpdated) {
        cacheDirty = true;
      }
      completed += 1;
      onProgress?.(completed, items.length, results[currentIdx], computeOverallFraction());
    }
  }

  const workerCount = Math.min(AUDIO_SCAN_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (cacheDirty) {
    const serializedCache = JSON.stringify([...cache.entries()], null, 2);
    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(cachePath, serializedCache, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'EACCES' || code === 'EPERM') {
        const fallbackPath = path.join(os.tmpdir(), 'video-organizer-audio-cache.json');
        console.warn(
          `Audio cache path is not writable (${cachePath}). Falling back to ${fallbackPath}.`
        );
        try {
          await fs.writeFile(fallbackPath, serializedCache, 'utf8');
        } catch (fallbackErr) {
          console.warn('Audio cache fallback persistence failed:', fallbackErr);
        }
      } else {
        console.warn('Audio cache persistence failed:', err);
      }
    }
  }

  if (shouldCancel?.()) {
    return results.filter((_, idx) => completedIndices.has(idx));
  }
  return results;
}
