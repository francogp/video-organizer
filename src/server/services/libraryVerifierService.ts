import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CASE_TMP_SUFFIX,
  DEFAULT_PREFERRED_LANGUAGES,
  OUTPUT_CATEGORIES,
  isActivePartialDownloadName,
  isHiddenOrTempEntryName
} from '../../domain/constants.ts';
import {
  buildMovieVerificationEntry,
  buildTvVerificationEntry,
  parseLibraryRootName,
  type SeasonDirFiles
} from '../../domain/libraryVerifier.ts';
import { resolveContainedOutputPath } from '../../domain/plexFormatter.ts';
import {
  asVerifierEntryId,
  type MetadataCandidate,
  type MetadataLanguageCode,
  type MetadataLookupOptions,
  type OutputCategory,
  type VerifierEntry,
  type VerifierProgress,
  type VerifierRenameKind,
  type VerifierRenameStep,
  type VerifierSummary
} from '../../domain/types.ts';
import { buildMountPathsMap, type AppConfig } from '../config.ts';
import { lookupMovieByImdbId, searchMovies } from './metadata/imdbClient.ts';
import {
  fetchEpisodeTitleMap,
  lookupSeriesByTvdbId,
  searchTvShows
} from './metadata/tvdbClient.ts';

const VERIFIER_CONCURRENCY = 4;

function isTvCategory(category: OutputCategory): boolean {
  return category === 'tv-shows' || category === 'animated-series';
}

function stepOrder(kind: VerifierRenameKind): number {
  if (kind === 'file') {
    return 0;
  }
  if (kind === 'season-dir') {
    return 1;
  }
  return 2;
}

export type VerifierLogCallback = (level: 'info' | 'warn' | 'error', message: string) => void;
export type VerifierProgressCallback = (progress: VerifierProgress) => void;

export interface VerifierMetadataDeps {
  readonly lookupSeriesByTvdbId?: typeof lookupSeriesByTvdbId;
  readonly searchTvShows?: typeof searchTvShows;
  readonly fetchEpisodeTitleMap?: typeof fetchEpisodeTitleMap;
  readonly lookupMovieByImdbId?: typeof lookupMovieByImdbId;
  readonly searchMovies?: typeof searchMovies;
}

export interface VerifierScanResult {
  readonly summary: VerifierSummary;
  readonly entries: readonly VerifierEntry[];
}

export interface VerifierFixFailure {
  readonly id: VerifierEntry['id'];
  readonly currentRootName: string;
  readonly error: string;
}

export interface VerifierFixResult {
  readonly fixedEntries: number;
  readonly renamedSteps: number;
  readonly renamedFiles: number;
  readonly renamedDirs: number;
  readonly failures: readonly VerifierFixFailure[];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const MIN_FALLBACK_TITLE_SIMILARITY = 0.75;

function normalizeTitleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token): boolean => token.length > 0);
}

function isPlausibleTitleFallback(queryTitle: string, candidateTitle: string): boolean {
  const qTokens = normalizeTitleTokens(queryTitle);
  const cTokens = normalizeTitleTokens(candidateTitle);
  if (qTokens.length === 0 || cTokens.length === 0) {
    return false;
  }
  if (qTokens.join(' ') === cTokens.join(' ')) {
    return true;
  }
  const qSet = new Set(qTokens);
  const cSet = new Set(cTokens);
  let intersection = 0;
  for (const token of qSet) {
    if (cSet.has(token)) {
      intersection++;
    }
  }
  const union = new Set([...qSet, ...cSet]).size;
  return union > 0 && intersection / union >= MIN_FALLBACK_TITLE_SIMILARITY;
}

function pickBestCandidate(
  candidates: readonly MetadataCandidate[],
  preferredYear?: number
): MetadataCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (preferredYear !== undefined) {
    const yearMatch = candidates.find((c): boolean => c.year === preferredYear);
    if (yearMatch) {
      return yearMatch;
    }
  }
  return candidates[0];
}

async function resolvePlausibleFallback(
  searchFn: () => Promise<readonly MetadataCandidate[]>,
  resolvedTitle: string,
  parsedYear: number | undefined
): Promise<{ readonly title: string; readonly year: number | undefined }> {
  const candidates = await searchFn();
  const best = pickBestCandidate(
    candidates.filter((c) => isPlausibleTitleFallback(resolvedTitle, c.title)),
    parsedYear
  );
  if (!best) {
    return { title: resolvedTitle, year: parsedYear };
  }
  return {
    title: best.title || resolvedTitle,
    year: parsedYear ?? best.year
  };
}

async function resolveTvMetadata(
  folderName: string,
  config: AppConfig,
  deps: Required<VerifierMetadataDeps>,
  onLog?: VerifierLogCallback,
  lookupOptions?: MetadataLookupOptions
): Promise<{
  readonly resolvedTitle: string;
  readonly resolvedYear?: number;
  readonly tvdbId?: ReturnType<typeof parseLibraryRootName>['tvdbId'];
  readonly tmdbId?: ReturnType<typeof parseLibraryRootName>['tmdbId'];
  readonly edition?: string;
  readonly episodeTitles?: ReadonlyMap<string, string>;
  readonly unresolvedMetadata: boolean;
}> {
  const parsed = parseLibraryRootName(folderName);
  let resolvedTitle = parsed.cleanTitle || folderName;
  let resolvedYear = parsed.year;
  let tvdbId = parsed.tvdbId;
  const tmdbId = parsed.tmdbId;
  let unresolvedMetadata = false;

  if (tvdbId) {
    if (!resolvedYear || !parsed.cleanTitle) {
      const lookedUp = await deps.lookupSeriesByTvdbId(
        tvdbId,
        config.tvdbApiKey,
        fetch,
        lookupOptions
      );
      if (lookedUp) {
        resolvedTitle = lookedUp.title || resolvedTitle;
        resolvedYear = resolvedYear ?? lookedUp.year;
      } else if (parsed.cleanTitle) {
        const fallback = await resolvePlausibleFallback(
          () => deps.searchTvShows(resolvedTitle, config.tvdbApiKey, fetch, lookupOptions),
          resolvedTitle,
          parsed.year
        );
        resolvedTitle = fallback.title;
        resolvedYear = resolvedYear ?? fallback.year;
      }
      if (!resolvedYear) {
        unresolvedMetadata = true;
      }
    }
  } else if (!tmdbId) {
    const candidates = await deps.searchTvShows(
      resolvedTitle,
      config.tvdbApiKey,
      fetch,
      lookupOptions
    );
    const best = pickBestCandidate(candidates, parsed.year);
    if (best) {
      resolvedTitle = best.title;
      resolvedYear = resolvedYear ?? best.year;
      tvdbId = best.tvdbId;
    } else {
      unresolvedMetadata = true;
    }
  }

  let episodeTitles: ReadonlyMap<string, string> | undefined;
  if (tvdbId) {
    try {
      episodeTitles = await deps.fetchEpisodeTitleMap(
        tvdbId,
        'aired',
        config.tvdbApiKey,
        fetch,
        lookupOptions
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.('warn', `Failed to fetch episode titles for ${folderName}: ${msg}`);
    }
  }

  return {
    resolvedTitle,
    resolvedYear,
    tvdbId,
    tmdbId,
    edition: parsed.edition,
    episodeTitles,
    unresolvedMetadata
  };
}

async function resolveMovieMetadata(
  folderName: string,
  config: AppConfig,
  deps: Required<VerifierMetadataDeps>,
  lookupOptions?: MetadataLookupOptions
): Promise<{
  readonly resolvedTitle: string;
  readonly resolvedYear?: number;
  readonly imdbId?: ReturnType<typeof parseLibraryRootName>['imdbId'];
  readonly tmdbId?: ReturnType<typeof parseLibraryRootName>['tmdbId'];
  readonly edition?: string;
  readonly unresolvedMetadata: boolean;
}> {
  const parsed = parseLibraryRootName(folderName);
  let resolvedTitle = parsed.cleanTitle || folderName;
  let resolvedYear = parsed.year;
  let imdbId = parsed.imdbId;
  let tmdbId = parsed.tmdbId;
  let unresolvedMetadata = false;

  if (imdbId) {
    if (!resolvedYear || !parsed.cleanTitle) {
      const lookedUp = await deps.lookupMovieByImdbId(
        imdbId,
        config.omdbApiKey,
        fetch,
        lookupOptions
      );
      if (lookedUp) {
        resolvedTitle = lookedUp.title || resolvedTitle;
        resolvedYear = resolvedYear ?? lookedUp.year;
      } else if (parsed.cleanTitle) {
        const fallback = await resolvePlausibleFallback(
          () =>
            deps.searchMovies(resolvedTitle, parsed.year, config.omdbApiKey, fetch, lookupOptions),
          resolvedTitle,
          parsed.year
        );
        resolvedTitle = fallback.title;
        resolvedYear = resolvedYear ?? fallback.year;
      }
      if (!resolvedYear) {
        unresolvedMetadata = true;
      }
    }
  } else if (!tmdbId || !resolvedYear) {
    const candidates = await deps.searchMovies(
      resolvedTitle,
      parsed.year,
      config.omdbApiKey,
      fetch,
      lookupOptions
    );
    const best = pickBestCandidate(candidates, parsed.year);
    if (best) {
      resolvedTitle = best.title;
      resolvedYear = resolvedYear ?? best.year;
      imdbId = best.imdbId;
      tmdbId = tmdbId ?? best.tmdbId;
    } else {
      unresolvedMetadata = true;
    }
  }

  return {
    resolvedTitle,
    resolvedYear,
    imdbId,
    tmdbId,
    edition: parsed.edition,
    unresolvedMetadata
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<readonly R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      const item = items[idx];
      if (item !== undefined) {
        results[idx] = await worker(item);
      }
    }
  }

  const workerCount = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function computePercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
}

/** Scans all configured output libraries and returns only non-compliant entries plus full analysis counts. */
function computeEtaSeconds(
  startedAtMs: number,
  completed: number,
  total: number
): number | undefined {
  if (completed <= 0 || completed >= total) {
    return undefined;
  }
  const elapsedSeconds = (performance.now() - startedAtMs) / 1000;
  if (elapsedSeconds <= 0) {
    return undefined;
  }
  const remaining = total - completed;
  return Math.max(0, Math.round((elapsedSeconds / completed) * remaining));
}

export async function scanLibrariesForCompliance(
  config: AppConfig,
  onLog?: VerifierLogCallback,
  metadataDeps: VerifierMetadataDeps = {},
  onProgress?: VerifierProgressCallback,
  preferredLanguages: readonly MetadataLanguageCode[] = DEFAULT_PREFERRED_LANGUAGES
): Promise<VerifierScanResult> {
  const deps: Required<VerifierMetadataDeps> = {
    lookupSeriesByTvdbId: metadataDeps.lookupSeriesByTvdbId ?? lookupSeriesByTvdbId,
    searchTvShows: metadataDeps.searchTvShows ?? searchTvShows,
    fetchEpisodeTitleMap: metadataDeps.fetchEpisodeTitleMap ?? fetchEpisodeTitleMap,
    lookupMovieByImdbId: metadataDeps.lookupMovieByImdbId ?? lookupMovieByImdbId,
    searchMovies: metadataDeps.searchMovies ?? searchMovies
  };

  const mountPaths = buildMountPathsMap(config);
  const discovered: {
    readonly category: OutputCategory;
    readonly libraryRoot: string;
    readonly rootDirs: readonly string[];
  }[] = [];
  let totalRootFolders = 0;

  for (const category of OUTPUT_CATEGORIES) {
    const libraryRoot = mountPaths[category];
    try {
      const dirents = await fs.readdir(libraryRoot, { withFileTypes: true });
      const rootDirs = dirents
        .filter((d): boolean => d.isDirectory() && !isHiddenOrTempEntryName(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
      discovered.push({ category, libraryRoot, rootDirs });
      totalRootFolders += rootDirs.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.('warn', `Skipping inaccessible library ${category} (${libraryRoot}): ${msg}`);
    }
  }

  const totalLibraries = discovered.length;
  const totalUnits = totalRootFolders > 0 ? totalRootFolders : Math.max(1, totalLibraries);
  const startedAtMs = performance.now();
  let completedUnits = 0;
  onProgress?.({
    completed: 0,
    total: totalUnits,
    percent: 0,
    stageLabel: 'Discovering libraries...'
  });

  const allEntries: VerifierEntry[] = [];
  const reportedDiagnostics = new Set<string>();
  const lookupOptions: MetadataLookupOptions = {
    preferredLanguages,
    onLog: (level, message) => onLog?.(level, message),
    onDiagnostic: (diagnostic) => {
      const key = `${diagnostic.provider}:${diagnostic.kind}`;
      if (!reportedDiagnostics.has(key)) {
        reportedDiagnostics.add(key);
        onLog?.('error', diagnostic.message);
      }
    }
  };
  let totalSeasonFolders = 0;
  let totalFiles = 0;

  for (const { category, libraryRoot, rootDirs } of discovered) {
    onLog?.('info', `Scanning ${category}: ${String(rootDirs.length)} folder(s)`);

    const isTv = isTvCategory(category);
    const categoryEntries = await mapWithConcurrency(
      rootDirs,
      VERIFIER_CONCURRENCY,
      async (rootName): Promise<VerifierEntry | null> => {
        const rootPath = path.join(libraryRoot, rootName);
        if (await isDirectoryEmptyRecursive(rootPath)) {
          if (totalRootFolders > 0) {
            completedUnits += 1;
            onProgress?.({
              completed: completedUnits,
              total: totalUnits,
              percent: computePercent(completedUnits, totalUnits),
              stageLabel: category,
              currentFile: rootName,
              etaSeconds: computeEtaSeconds(startedAtMs, completedUnits, totalUnits)
            });
          }
          return {
            id: asVerifierEntryId(`${category}:${rootName}`),
            category,
            mediaKind: isTv ? 'tv' : 'movie',
            currentRootName: rootName,
            expectedRootName: 'Delete empty directory',
            issues: ['EMPTY_DIRECTORY'],
            steps: [
              {
                kind: 'delete-dir',
                fromRelative: rootName,
                toRelative: '(delete)'
              }
            ]
          };
        }

        const childDirents = await fs.readdir(rootPath, { withFileTypes: true });

        let entry: VerifierEntry | null;
        if (isTv) {
          const seasonSubdirs = childDirents
            .filter((d): boolean => d.isDirectory() && !isHiddenOrTempEntryName(d.name))
            .map((d) => d.name)
            .sort((a, b) => a.localeCompare(b));
          totalSeasonFolders += seasonSubdirs.length;
          totalFiles += childDirents.filter(
            (d): boolean => d.isFile() && !isHiddenOrTempEntryName(d.name)
          ).length;

          const seasonDirs: SeasonDirFiles[] = [];
          for (const seasonName of seasonSubdirs) {
            const seasonPath = path.join(rootPath, seasonName);
            const seasonChildren = await fs.readdir(seasonPath, { withFileTypes: true });
            const files = seasonChildren
              .filter((d): boolean => d.isFile() && !isHiddenOrTempEntryName(d.name))
              .map((d) => d.name);
            totalFiles += files.length;
            seasonDirs.push({ dirName: seasonName, files });
          }

          const meta = await resolveTvMetadata(rootName, config, deps, onLog, lookupOptions);
          entry = buildTvVerificationEntry({
            category,
            currentRootName: rootName,
            resolvedTitle: meta.resolvedTitle,
            resolvedYear: meta.resolvedYear,
            tvdbId: meta.tvdbId,
            tmdbId: meta.tmdbId,
            edition: meta.edition,
            episodeTitles: meta.episodeTitles,
            seasonDirs,
            unresolvedMetadata: meta.unresolvedMetadata
          });
        } else {
          const files = childDirents
            .filter((d): boolean => d.isFile() && !isHiddenOrTempEntryName(d.name))
            .map((d) => d.name);
          totalFiles += files.length;
          const meta = await resolveMovieMetadata(rootName, config, deps, lookupOptions);
          entry = buildMovieVerificationEntry({
            category,
            currentRootName: rootName,
            resolvedTitle: meta.resolvedTitle,
            resolvedYear: meta.resolvedYear,
            imdbId: meta.imdbId,
            tmdbId: meta.tmdbId,
            edition: meta.edition,
            files,
            unresolvedMetadata: meta.unresolvedMetadata
          });
        }

        if (totalRootFolders > 0) {
          completedUnits += 1;
          onProgress?.({
            completed: completedUnits,
            total: totalUnits,
            percent: computePercent(completedUnits, totalUnits),
            stageLabel: category,
            currentFile: rootName,
            etaSeconds: computeEtaSeconds(startedAtMs, completedUnits, totalUnits)
          });
        }
        return entry;
      }
    );

    if (totalRootFolders === 0) {
      completedUnits += 1;
      onProgress?.({
        completed: completedUnits,
        total: totalUnits,
        percent: computePercent(completedUnits, totalUnits),
        stageLabel: `Scanned ${category} (0 folders)`
      });
    }

    for (const entry of categoryEntries) {
      if (entry) {
        allEntries.push(entry);
      }
    }
  }

  allEntries.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    return catCmp !== 0 ? catCmp : a.currentRootName.localeCompare(b.currentRootName);
  });

  const issueCount = allEntries.length;
  const summary: VerifierSummary = {
    librariesScanned: totalLibraries,
    totalRootsAnalyzed: totalRootFolders,
    totalSeasonDirsAnalyzed: totalSeasonFolders,
    totalFilesAnalyzed: totalFiles,
    compliantRoots: Math.max(0, totalRootFolders - issueCount),
    issueCount,
    scannedAt: Temporal.Now.instant().toString()
  };

  return { summary, entries: allEntries };
}

function sortStepsBottomUp(steps: readonly VerifierRenameStep[]): readonly VerifierRenameStep[] {
  return [...steps].sort((a, b): number => stepOrder(a.kind) - stepOrder(b.kind));
}

async function isDirectoryEmptyRecursive(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isActivePartialDownloadName(entry.name)) {
        return false;
      }
      if (isHiddenOrTempEntryName(entry.name)) {
        continue;
      }
      if (!entry.isDirectory()) {
        return false;
      }
      if (!(await isDirectoryEmptyRecursive(path.join(dirPath, entry.name)))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function moveDirectoryContentsFallback(fromAbs: string, toAbs: string): Promise<void> {
  await fs.mkdir(toAbs, { recursive: true });
  const children = await fs.readdir(fromAbs, { withFileTypes: true });
  for (const child of children) {
    const childFrom = path.join(fromAbs, child.name);
    const childTo = path.join(toAbs, child.name);
    if (isHiddenOrTempEntryName(child.name) && !isActivePartialDownloadName(child.name)) {
      await fs.rm(childFrom, { recursive: true, force: true });
      continue;
    }
    if (child.isDirectory()) {
      if (await isDirectoryEmptyRecursive(childFrom)) {
        await fs.rm(childFrom, { recursive: true });
      } else {
        await renamePathStrict(childFrom, childTo);
      }
    } else {
      await fs.rename(childFrom, childTo);
    }
  }
  await fs.rmdir(fromAbs);
}

async function renamePathStrict(fromAbs: string, toAbs: string): Promise<void> {
  try {
    await fs.rename(fromAbs, toAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
      const stats = await fs.lstat(fromAbs);
      if (stats.isDirectory()) {
        // Windows Docker bind mounts can block MoveFileEx on non-empty directories; move children safely without touching NAS ACLs.
        await moveDirectoryContentsFallback(fromAbs, toAbs);
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${detail} (Check mount write permissions or PUID/PGID ownership on the host/NAS)`,
        { cause: err }
      );
    }
    throw err;
  }
}

async function renameSingleStep(
  libraryRoot: string,
  step: VerifierRenameStep,
  onLog?: VerifierLogCallback
): Promise<boolean> {
  const fromAbs = resolveContainedOutputPath(libraryRoot, step.fromRelative);
  if (step.kind === 'delete-dir') {
    if (!(await pathExists(fromAbs))) {
      return false;
    }
    if (!(await isDirectoryEmptyRecursive(fromAbs))) {
      throw new Error(`Cannot delete non-empty directory: ${step.fromRelative}`);
    }
    await fs.rm(fromAbs, { recursive: true });
    onLog?.('info', `Removed empty directory (${step.kind}): ${step.fromRelative}`);
    return true;
  }

  const toAbs = resolveContainedOutputPath(libraryRoot, step.toRelative);
  if (fromAbs === toAbs) {
    return false;
  }

  if (
    step.kind !== 'file' &&
    (await pathExists(fromAbs)) &&
    (await isDirectoryEmptyRecursive(fromAbs))
  ) {
    await fs.rm(fromAbs, { recursive: true });
    onLog?.('info', `Removed empty directory (${step.kind}): ${step.fromRelative}`);
    return true;
  }

  const isCaseOnlyRename = fromAbs.toLowerCase() === toAbs.toLowerCase() && fromAbs !== toAbs;
  if (!isCaseOnlyRename && (await pathExists(toAbs))) {
    throw new Error(`Destination already exists: ${step.toRelative}`);
  }

  if (isCaseOnlyRename) {
    const tmpAbs = `${fromAbs}${CASE_TMP_SUFFIX}`;
    await renamePathStrict(fromAbs, tmpAbs);
    await renamePathStrict(tmpAbs, toAbs);
  } else {
    await renamePathStrict(fromAbs, toAbs);
  }

  onLog?.('info', `Renamed (${step.kind}): ${step.fromRelative} -> ${step.toRelative}`);
  return true;
}

async function applyEntrySteps(
  libraryRoot: string,
  entry: VerifierEntry,
  onLog?: VerifierLogCallback
): Promise<{ readonly renamedFiles: number; readonly renamedDirs: number }> {
  let renamedFiles = 0;
  let renamedDirs = 0;
  for (const step of sortStepsBottomUp(entry.steps)) {
    const didRename = await renameSingleStep(libraryRoot, step, onLog);
    if (!didRename) {
      continue;
    }
    if (step.kind === 'file') {
      renamedFiles += 1;
    } else {
      renamedDirs += 1;
    }
  }
  return { renamedFiles, renamedDirs };
}

/** Applies selected verification fixes using strict bottom-up rename order (`file` -> `season-dir` -> `root-dir`). */
export async function applyVerifierRenames(
  config: AppConfig,
  entries: readonly VerifierEntry[],
  onLog?: VerifierLogCallback,
  onProgress?: VerifierProgressCallback
): Promise<VerifierFixResult> {
  const mountPaths = buildMountPathsMap(config);
  let fixedEntries = 0;
  let renamedSteps = 0;
  let renamedFiles = 0;
  let renamedDirs = 0;
  const failures: VerifierFixFailure[] = [];
  const total = entries.length;
  const startedAtMs = performance.now();

  onProgress?.({
    completed: 0,
    total,
    percent: 0,
    stageLabel: 'Applying bottom-up renames...'
  });

  for (const [index, entry] of entries.entries()) {
    onProgress?.({
      completed: index,
      total,
      percent: computePercent(index, total),
      stageLabel: entry.category,
      currentFile: entry.currentRootName,
      etaSeconds: computeEtaSeconds(startedAtMs, index, total)
    });
    const libraryRoot = mountPaths[entry.category];
    try {
      const counts = await applyEntrySteps(libraryRoot, entry, onLog);
      renamedFiles += counts.renamedFiles;
      renamedDirs += counts.renamedDirs;
      renamedSteps += counts.renamedFiles + counts.renamedDirs;
      fixedEntries += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.('error', `Failed to fix ${entry.currentRootName}: ${msg}`);
      failures.push({
        id: entry.id,
        currentRootName: entry.currentRootName,
        error: msg
      });
    }
    const completed = index + 1;
    onProgress?.({
      completed,
      total,
      percent: computePercent(completed, total),
      stageLabel: entry.category,
      currentFile: entry.currentRootName,
      etaSeconds: computeEtaSeconds(startedAtMs, completed, total)
    });
  }

  return { fixedEntries, renamedSteps, renamedFiles, renamedDirs, failures };
}
