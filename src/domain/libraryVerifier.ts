import path from 'node:path';

import {
  SUBTITLE_EXTENSION_SET,
  VIDEO_EXTENSION_SET,
  type SubtitleExtension,
  type VideoExtension
} from './constants.ts';
import {
  extractPlexTags,
  extractSplitPart,
  formatMovieRelativePath,
  formatTvRelativePath
} from './plexFormatter.ts';
import {
  asImdbId,
  asTmdbId,
  asTvdbId,
  asVerifierEntryId,
  type ImdbId,
  type OutputCategory,
  type TmdbId,
  type TvdbId,
  type VerifierEntry,
  type VerifierIssueCode,
  type VerifierRenameStep
} from './types.ts';

const TVDB_TAG_REGEX = /\{tvdb-(\d+)\}/i;
const IMDB_TAG_REGEX = /\{imdb-(tt\d+)\}/i;
const TMDB_TAG_REGEX = /\{tmdb-(\d+)\}/i;
const EDITION_TAG_REGEX = /\{edition-([^}]+)\}/i;
const BRACKET_TAG_REGEX = /\[([^\]]+)\]/g;
const YEAR_PAREN_REGEX = /\((\d{4})\)/;
const SEASON_DIR_REGEX = /^(?:season|temporada|s)[\s._-]*(\d{1,2})$/i;
const EPISODE_CODE_REGEX =
  /(?:^|[\s._-])(?:s(\d{1,2})e(\d{1,3})(?:-?e(\d{1,3}))?|(\d{1,2})x(\d{2,3}))(?=$|[\s._-])/i;

const MIN_VALID_YEAR = 1888;
const MAX_VALID_YEAR = 2100;

export interface ParsedLibraryRoot {
  readonly rawName: string;
  readonly cleanTitle: string;
  readonly year?: number;
  readonly tvdbId?: TvdbId;
  readonly imdbId?: ImdbId;
  readonly tmdbId?: TmdbId;
  readonly edition?: string;
  readonly bracketTags: readonly string[];
}

export interface SeasonDirFiles {
  readonly dirName: string;
  readonly files: readonly string[];
}

/** Parses metadata tags, year, and clean title from a Plex library root folder name. */
export function parseLibraryRootName(folderName: string): ParsedLibraryRoot {
  const tvdbMatch = TVDB_TAG_REGEX.exec(folderName);
  const imdbMatch = IMDB_TAG_REGEX.exec(folderName);
  const tmdbMatch = TMDB_TAG_REGEX.exec(folderName);
  const editionMatch = EDITION_TAG_REGEX.exec(folderName);

  const bracketTags: string[] = [];
  let bracketMatch: RegExpExecArray | null;
  BRACKET_TAG_REGEX.lastIndex = 0;
  while ((bracketMatch = BRACKET_TAG_REGEX.exec(folderName)) !== null) {
    const inner = bracketMatch[1]?.trim();
    if (inner) {
      for (const part of inner.split(',')) {
        const trimmed = part.trim();
        if (trimmed) {
          bracketTags.push(trimmed);
        }
      }
    }
  }

  const yearMatch = YEAR_PAREN_REGEX.exec(folderName);
  const parsedYear = yearMatch?.[1] ? Number(yearMatch[1]) : undefined;
  const year =
    parsedYear && parsedYear >= MIN_VALID_YEAR && parsedYear <= MAX_VALID_YEAR
      ? parsedYear
      : undefined;

  const cleanTitle = folderName
    .replace(TVDB_TAG_REGEX, '')
    .replace(IMDB_TAG_REGEX, '')
    .replace(TMDB_TAG_REGEX, '')
    .replace(EDITION_TAG_REGEX, '')
    .replace(BRACKET_TAG_REGEX, '')
    .replace(YEAR_PAREN_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    rawName: folderName,
    cleanTitle,
    year,
    tvdbId: tvdbMatch?.[1] ? asTvdbId(tvdbMatch[1]) : undefined,
    imdbId: imdbMatch?.[1] ? asImdbId(imdbMatch[1]) : undefined,
    tmdbId: tmdbMatch?.[1] ? asTmdbId(tmdbMatch[1]) : undefined,
    edition: editionMatch?.[1]?.trim(),
    bracketTags
  };
}

/** Parses a season directory name (`Season 01`, `Season 1`, `S01`, `Specials`) into its season number. */
function parseSeasonDirName(dirName: string): number | null {
  if (/^specials$/i.test(dirName.trim())) {
    return 0;
  }
  const match = SEASON_DIR_REGEX.exec(dirName.trim());
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

function parseEpisodeFromFileName(
  fileName: string,
  fallbackSeason?: number
): {
  readonly seasonNumber: number;
  readonly episodeStart: number;
  readonly episodeEnd?: number;
} | null {
  const match = EPISODE_CODE_REGEX.exec(fileName);
  if (!match) {
    return null;
  }
  const seasonRaw = match[1] ?? match[4];
  const epStartRaw = match[2] ?? match[5];
  const epEndRaw = match[3];
  const seasonNumber = seasonRaw ? Number(seasonRaw) : fallbackSeason;
  const episodeStart = epStartRaw ? Number(epStartRaw) : NaN;
  if (
    seasonNumber === undefined ||
    !Number.isInteger(seasonNumber) ||
    !Number.isInteger(episodeStart)
  ) {
    return null;
  }
  const episodeEnd = epEndRaw ? Number(epEndRaw) : undefined;
  return {
    seasonNumber,
    episodeStart,
    episodeEnd: episodeEnd && episodeEnd > episodeStart ? episodeEnd : undefined
  };
}

function isVideoFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase() as VideoExtension;
  return VIDEO_EXTENSION_SET.has(ext);
}

function isSubtitleFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase() as SubtitleExtension;
  return SUBTITLE_EXTENSION_SET.has(ext);
}

function swapExtension(mkvPath: string, originalExt: string): string {
  const parsed = path.posix.parse(mkvPath);
  return parsed.dir ? `${parsed.dir}/${parsed.name}${originalExt}` : `${parsed.name}${originalExt}`;
}

function collectCompanionSubtitleSteps(
  dirRelative: string,
  oldStem: string,
  newStem: string,
  allFiles: readonly string[],
  steps: VerifierRenameStep[]
): void {
  if (oldStem === newStem) {
    return;
  }
  for (const file of allFiles) {
    if (!isSubtitleFile(file)) {
      continue;
    }
    if (file === `${oldStem}${path.extname(file)}` || file.startsWith(`${oldStem}.`)) {
      const suffix = file.slice(oldStem.length);
      const expectedSub = `${newStem}${suffix}`;
      if (file !== expectedSub) {
        steps.push({
          kind: 'file',
          fromRelative: path.posix.join(dirRelative, file),
          toRelative: path.posix.join(dirRelative, expectedSub)
        });
      }
    }
  }
}

export interface TvVerifyInput {
  readonly category: OutputCategory;
  readonly currentRootName: string;
  readonly resolvedTitle: string;
  readonly resolvedYear?: number;
  readonly tvdbId?: TvdbId;
  readonly tmdbId?: TmdbId;
  readonly edition?: string;
  readonly episodeTitles?: ReadonlyMap<string, string>;
  readonly seasonDirs: readonly SeasonDirFiles[];
  readonly unresolvedMetadata?: boolean;
}

interface VerificationContext {
  readonly parsed: ReturnType<typeof parseLibraryRootName>;
  readonly issues: Set<VerifierIssueCode>;
  readonly fileSteps: VerifierRenameStep[];
  readonly rootDirSteps: VerifierRenameStep[];
}

function createVerificationContext(
  currentRootName: string,
  unresolvedMetadata: boolean | undefined,
  resolvedYear: number | undefined,
  hasProviderId: boolean
): VerificationContext {
  const parsed = parseLibraryRootName(currentRootName);
  const issues = new Set<VerifierIssueCode>();
  if (unresolvedMetadata) {
    issues.add('UNRESOLVED_METADATA');
  }
  if (!parsed.year && resolvedYear) {
    issues.add('MISSING_YEAR');
  }
  if (!hasProviderId) {
    issues.add('MISSING_PROVIDER_ID');
  }
  return { parsed, issues, fileSteps: [], rootDirSteps: [] };
}

function collectVideoAndCompanionSteps(params: {
  dirRel: string;
  file: string;
  formattedRelative: string;
  allFiles: readonly string[];
  fileSteps: VerifierRenameStep[];
  issues: Set<VerifierIssueCode>;
}): void {
  const ext = path.extname(params.file);
  const oldStem = path.basename(params.file, ext);
  const expectedFileWithExt = swapExtension(path.basename(params.formattedRelative), ext);
  if (params.file === expectedFileWithExt) {
    return;
  }
  params.issues.add('NON_STANDARD_FILENAME');
  params.fileSteps.push({
    kind: 'file',
    fromRelative: path.posix.join(params.dirRel, params.file),
    toRelative: path.posix.join(params.dirRel, expectedFileWithExt)
  });
  const newStem = path.basename(expectedFileWithExt, ext);
  collectCompanionSubtitleSteps(params.dirRel, oldStem, newStem, params.allFiles, params.fileSteps);
}

/** Verifies a TV show folder and generates bottom-up rename steps (`file` -> `season-dir` -> `root-dir`). */
export function buildTvVerificationEntry(input: TvVerifyInput): VerifierEntry | null {
  const { issues, fileSteps, rootDirSteps } = createVerificationContext(
    input.currentRootName,
    input.unresolvedMetadata,
    input.resolvedYear,
    Boolean(input.tvdbId || input.tmdbId)
  );
  const seasonDirSteps: VerifierRenameStep[] = [];

  const sampleRelative = formatTvRelativePath({
    showTitle: input.resolvedTitle,
    year: input.resolvedYear,
    tvdbId: input.tvdbId,
    tmdbId: input.tmdbId,
    edition: input.edition,
    episode: { seasonNumber: 1, episodeStart: 1 }
  });
  const [expectedRootName] = sampleRelative.split(path.sep);
  const targetRootName = expectedRootName || input.currentRootName;

  for (const season of input.seasonDirs) {
    const dirSeasonNum = parseSeasonDirName(season.dirName);
    const currentSeasonRel = path.posix.join(input.currentRootName, season.dirName);

    for (const file of season.files) {
      if (!isVideoFile(file)) {
        continue;
      }
      const ext = path.extname(file);
      const oldStem = path.basename(file, ext);
      const ep = parseEpisodeFromFileName(oldStem, dirSeasonNum ?? undefined);
      if (!ep) {
        continue;
      }
      const epKey = `${String(ep.seasonNumber)}:${String(ep.episodeStart)}`;
      const episodeTitle = input.episodeTitles?.get(epKey);
      const formatted = formatTvRelativePath({
        showTitle: input.resolvedTitle,
        year: input.resolvedYear,
        tvdbId: input.tvdbId,
        tmdbId: input.tmdbId,
        edition: input.edition,
        episode: {
          seasonNumber: ep.seasonNumber,
          episodeStart: ep.episodeStart,
          episodeEnd: ep.episodeEnd,
          episodeTitle
        },
        splitPart: extractSplitPart(oldStem)
      });
      collectVideoAndCompanionSteps({
        dirRel: currentSeasonRel,
        file,
        formattedRelative: formatted,
        allFiles: season.files,
        fileSteps,
        issues
      });
    }

    if (dirSeasonNum !== null) {
      const expectedSeasonDir = `Season ${String(dirSeasonNum).padStart(2, '0')}`;
      if (season.dirName !== expectedSeasonDir) {
        issues.add('NON_STANDARD_SEASON_DIR');
        seasonDirSteps.push({
          kind: 'season-dir',
          fromRelative: currentSeasonRel,
          toRelative: path.posix.join(input.currentRootName, expectedSeasonDir)
        });
      }
    }
  }

  if (input.currentRootName !== targetRootName) {
    rootDirSteps.push({
      kind: 'root-dir',
      fromRelative: input.currentRootName,
      toRelative: targetRootName
    });
  }

  const steps = [...fileSteps, ...seasonDirSteps, ...rootDirSteps];
  if (steps.length === 0 && !input.unresolvedMetadata) {
    return null;
  }

  return {
    id: asVerifierEntryId(`${input.category}:${input.currentRootName}`),
    category: input.category,
    mediaKind: 'tv',
    currentRootName: input.currentRootName,
    expectedRootName: targetRootName,
    issues: [...issues],
    steps,
    providerTag: input.tvdbId
      ? `tvdb-${input.tvdbId}`
      : input.tmdbId
        ? `tmdb-${input.tmdbId}`
        : undefined,
    resolvedTitle: input.resolvedTitle,
    resolvedYear: input.resolvedYear
  };
}

export interface MovieVerifyInput {
  readonly category: OutputCategory;
  readonly currentRootName: string;
  readonly resolvedTitle: string;
  readonly resolvedYear?: number;
  readonly imdbId?: ImdbId;
  readonly tmdbId?: TmdbId;
  readonly edition?: string;
  readonly files: readonly string[];
  readonly unresolvedMetadata?: boolean;
}

/** Verifies a movie folder and generates bottom-up rename steps (`file` -> `root-dir`). */
export function buildMovieVerificationEntry(input: MovieVerifyInput): VerifierEntry | null {
  const { parsed, issues, fileSteps, rootDirSteps } = createVerificationContext(
    input.currentRootName,
    input.unresolvedMetadata,
    input.resolvedYear,
    Boolean(input.imdbId || input.tmdbId)
  );

  const videoFiles = input.files.filter(isVideoFile);
  const tags =
    parsed.bracketTags.length > 0
      ? parsed.bracketTags
      : extractPlexTags(videoFiles[0] ?? input.currentRootName);

  const rootFormatted = formatMovieRelativePath({
    title: input.resolvedTitle,
    year: input.resolvedYear,
    imdbId: input.imdbId,
    tmdbId: input.tmdbId,
    edition: input.edition,
    tags
  });
  const [expectedRootName] = rootFormatted.split(path.sep);
  const targetRootName = expectedRootName || input.currentRootName;

  for (const file of videoFiles) {
    const ext = path.extname(file);
    const oldStem = path.basename(file, ext);
    const splitPart = extractSplitPart(oldStem);
    const fileTags = parsed.bracketTags.length > 0 ? parsed.bracketTags : extractPlexTags(oldStem);
    const formatted = formatMovieRelativePath({
      title: input.resolvedTitle,
      year: input.resolvedYear,
      imdbId: input.imdbId,
      tmdbId: input.tmdbId,
      edition: input.edition,
      tags: fileTags,
      splitPart
    });
    collectVideoAndCompanionSteps({
      dirRel: input.currentRootName,
      file,
      formattedRelative: formatted,
      allFiles: input.files,
      fileSteps,
      issues
    });
  }

  if (input.currentRootName !== targetRootName) {
    rootDirSteps.push({
      kind: 'root-dir',
      fromRelative: input.currentRootName,
      toRelative: targetRootName
    });
  }

  const steps = [...fileSteps, ...rootDirSteps];
  if (steps.length === 0 && !input.unresolvedMetadata) {
    return null;
  }

  return {
    id: asVerifierEntryId(`${input.category}:${input.currentRootName}`),
    category: input.category,
    mediaKind: 'movie',
    currentRootName: input.currentRootName,
    expectedRootName: targetRootName,
    issues: [...issues],
    steps,
    providerTag: input.imdbId
      ? `imdb-${input.imdbId}`
      : input.tmdbId
        ? `tmdb-${input.tmdbId}`
        : undefined,
    resolvedTitle: input.resolvedTitle,
    resolvedYear: input.resolvedYear
  };
}
