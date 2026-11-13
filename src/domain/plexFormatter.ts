import path from 'node:path';

import {
  PLEX_EDITION_MAX_LENGTH,
  PLEX_MAX_SPLIT_PARTS,
  RESOLUTION_TAG_MAP,
  fitTvEpisodeTitleToBudget,
  sanitizePlexSegment,
  type ResolutionToken
} from './constants.ts';
import {
  asImdbId,
  asTvdbId,
  type EpisodeInfo,
  type ImdbId,
  type MediaProbeSummary,
  type TmdbId,
  type TvdbId
} from './types.ts';

const RESOLUTION_REGEX = /\b(480p|720p|1080p|1440p|2160p|4320p|2k|4k|8k)\b/i;
const EXTENDED_REGEX = /\bextended\b/i;
const DIRECTORS_CUT_REGEX = /\bdirector'?s?[\s._-]*cut\b/i;
const UNRATED_REGEX = /\bunrated\b/i;
const SPANISH_AUDIO_REGEX = /\b(latino|espa[nñ]ol|spanish[\s._-]*audio)\b/i;
const HDR_REGEX = /\bhdr(?:10\+?)?\b/i;
const TEN_BIT_REGEX = /\b10\s*-?\s*bit\b/i;
const SPLIT_PART_REGEX = /(?:^|[\s._-])(cd|disc|disk|dvd|part|pt)\s*([1-8])(?=$|[\s._-])/i;

const WIDTH_4K_MIN = 3800;
const WIDTH_2K_MIN = 2500;
const HEIGHT_1080_MIN = 1000;
const HEIGHT_720_MIN = 700;
const TEN_BIT_DEPTH = 10;

export { sanitizePlexSegment };

/** Extracts a Plex split-part suffix (e.g. `pt1`, `cd2`) when present, up to part 8. */
export function extractSplitPart(nameWithoutExt: string): string | undefined {
  const match = SPLIT_PART_REGEX.exec(nameWithoutExt);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const partNum = Number(match[2]);
  if (!Number.isInteger(partNum) || partNum < 1 || partNum > PLEX_MAX_SPLIT_PARTS) {
    return undefined;
  }
  return `${match[1].toLowerCase()}${String(partNum)}`;
}

function inferResolutionFromProbe(probe?: MediaProbeSummary): string | undefined {
  const video = probe?.videoStreams[0];
  if (!video) {
    return undefined;
  }
  if (video.width >= WIDTH_4K_MIN) {
    return '4k';
  }
  if (video.width >= WIDTH_2K_MIN) {
    return '2k';
  }
  if (video.height >= HEIGHT_1080_MIN) {
    return '1080p';
  }
  if (video.height >= HEIGHT_720_MIN) {
    return '720p';
  }
  return video.height > 0 ? '480p' : undefined;
}

/** Extracts deterministic Plex bracket tags ported from `MovieFolder.java`. */
export function extractPlexTags(rawName: string, probe?: MediaProbeSummary): readonly string[] {
  const tags: string[] = [];

  const resMatch = RESOLUTION_REGEX.exec(rawName);
  const resToken = resMatch?.[1]?.toLowerCase();
  const resTag =
    resToken && Object.hasOwn(RESOLUTION_TAG_MAP, resToken)
      ? RESOLUTION_TAG_MAP[resToken as ResolutionToken]
      : inferResolutionFromProbe(probe);
  if (resTag) {
    tags.push(resTag);
  }

  if (EXTENDED_REGEX.test(rawName)) {
    tags.push('Extended');
  }
  if (DIRECTORS_CUT_REGEX.test(rawName)) {
    tags.push('Directors Cut');
  }
  if (UNRATED_REGEX.test(rawName)) {
    tags.push('Unrated');
  }
  if (SPANISH_AUDIO_REGEX.test(rawName)) {
    tags.push('Spanish Audio');
  }

  const video = probe?.videoStreams[0];
  const isHdr =
    HDR_REGEX.test(rawName) ||
    video?.colorTransfer === 'smpte2084' ||
    video?.colorTransfer === 'arib-std-b67';
  if (isHdr) {
    tags.push('HDR');
  }

  const isTenBit = TEN_BIT_REGEX.test(rawName) || video?.bitDepth === TEN_BIT_DEPTH;
  if (isTenBit) {
    tags.push('10bit');
  }

  return tags;
}

/** Formats a Plex `{edition-...}` tag enforcing the 32-character limit. */
export function formatEditionTag(rawEdition?: string): string | undefined {
  if (!rawEdition) {
    return undefined;
  }
  const clean = sanitizePlexSegment(rawEdition).slice(0, PLEX_EDITION_MAX_LENGTH).trim();
  return clean.length > 0 ? `{edition-${clean}}` : undefined;
}

export interface MoviePathInput {
  readonly title: string;
  readonly year?: number;
  readonly imdbId?: ImdbId;
  readonly tmdbId?: TmdbId;
  readonly edition?: string;
  readonly tags?: readonly string[];
  readonly splitPart?: string;
}

/** Builds relative Plex movie path (`Folder/File.mkv`). */
export function formatMovieRelativePath(input: MoviePathInput): string {
  const parts: string[] = [sanitizePlexSegment(input.title)];
  if (input.year) {
    parts.push(`(${String(input.year)})`);
  }
  if (input.imdbId) {
    parts.push(`{imdb-${input.imdbId}}`);
  } else if (input.tmdbId) {
    parts.push(`{tmdb-${input.tmdbId}}`);
  }

  const editionTag = formatEditionTag(input.edition);
  if (editionTag) {
    parts.push(editionTag);
  }
  if (input.tags && input.tags.length > 0) {
    parts.push(`[${input.tags.join(', ')}]`);
  }

  const baseName = parts.join(' ');
  const fileName = input.splitPart ? `${baseName} - ${input.splitPart}.mkv` : `${baseName}.mkv`;
  return path.join(baseName, fileName);
}

export interface TvPathInput {
  readonly showTitle: string;
  readonly year?: number;
  readonly tvdbId?: TvdbId;
  readonly tmdbId?: TmdbId;
  readonly edition?: string;
  readonly episode: EpisodeInfo;
  readonly splitPart?: string;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/** Builds relative Plex TV episode path (`Show/Season XX/Episode.mkv`). */
export function formatTvRelativePath(input: TvPathInput): string {
  const cleanShow = sanitizePlexSegment(input.showTitle);
  const showDisplay = input.year ? `${cleanShow} (${String(input.year)})` : cleanShow;

  const folderParts: string[] = [showDisplay];
  if (input.tvdbId) {
    folderParts.push(`{tvdb-${input.tvdbId}}`);
  } else if (input.tmdbId) {
    folderParts.push(`{tmdb-${input.tmdbId}}`);
  }

  const editionTag = formatEditionTag(input.edition);
  if (editionTag) {
    folderParts.push(editionTag);
  }

  const showFolder = folderParts.join(' ');
  const seasonFolder = `Season ${padTwo(input.episode.seasonNumber)}`;

  const epParts: string[] = [showDisplay];
  if (input.episode.airDate) {
    epParts.push(input.episode.airDate);
  } else {
    const startCode = `s${padTwo(input.episode.seasonNumber)}e${padTwo(input.episode.episodeStart)}`;
    const epCode =
      input.episode.episodeEnd && input.episode.episodeEnd > input.episode.episodeStart
        ? `${startCode}-e${padTwo(input.episode.episodeEnd)}`
        : startCode;
    epParts.push(epCode);
  }

  const split = input.splitPart ?? input.episode.splitPart;
  const suffixParts = split ? [split] : [];
  const baseFileName = `${[...epParts, ...suffixParts].join(' - ')}.mkv`;
  const baseRelativeLength = path.join(showFolder, seasonFolder, baseFileName).length;

  if (input.episode.episodeTitle) {
    const fittedTitle = fitTvEpisodeTitleToBudget(baseRelativeLength, input.episode.episodeTitle);
    if (fittedTitle.length > 0) {
      epParts.push(fittedTitle);
    }
  }

  if (split) {
    epParts.push(split);
  }

  const fileName = `${epParts.join(' - ')}.mkv`;
  return path.join(showFolder, seasonFolder, fileName);
}

/** Resolves a relative Plex path inside `libraryRoot`, throwing on path traversal. */
export function resolveContainedOutputPath(libraryRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(libraryRoot);
  const resolvedTarget = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootPrefix)) {
    throw new Error(`Path traversal rejected: ${relativePath}`);
  }
  return resolvedTarget;
}

export interface ParsedProviderReference {
  readonly imdbId?: ImdbId;
  readonly tvdbId?: TvdbId;
  readonly tvmazeId?: number;
}

/** Extracts an IMDb, TVDB, or TVmaze ID from raw IDs, `{tvdb-...}` tags, or provider URLs. */
export function parseProviderReference(raw: string): ParsedProviderReference {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const imdbMatch = /(?:imdb\.com\/title\/|\b)(tt\d+)\b/i.exec(trimmed);
  if (imdbMatch?.[1]) {
    return { imdbId: asImdbId(imdbMatch[1].toLowerCase()) };
  }
  const tvmazeMatch = /tvmaze\.com\/shows\/(\d+)/i.exec(trimmed);
  if (tvmazeMatch?.[1]) {
    const id = Number(tvmazeMatch[1]);
    if (Number.isInteger(id) && id > 0) {
      return { tvmazeId: id };
    }
  }
  const tvdbUrlMatch =
    /(?:thetvdb\.com\/(?:[^\s#]*[?&]id=|dereferrer\/series\/)(\d+))|\{tvdb-(\d+)\}/i.exec(trimmed);
  const tvdbDigits = tvdbUrlMatch?.[1] ?? tvdbUrlMatch?.[2];
  if (tvdbDigits) {
    return { tvdbId: asTvdbId(tvdbDigits) };
  }
  return {};
}
