import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { VIDEO_EXTENSION_SET } from '../../domain/constants.ts';
import {
  formatMovieRelativePath,
  formatTvRelativePath,
  resolveContainedOutputPath
} from '../../domain/plexFormatter.ts';
import type {
  ConflictComparison,
  DiskSpaceCheck,
  ItemId,
  MediaProbeSummary,
  MountPathsMap,
  OutputCategory,
  ScannedItem
} from '../../domain/types.ts';

/** Computes the projected absolute destination path for a queue item. */
export function computeProjectedDestination(item: ScannedItem, mountPaths: MountPathsMap): string {
  const root = mountPaths[item.category];
  const meta = item.selectedMetadata ?? item.candidates[0];
  const title = meta?.title ?? item.parsedTitle;
  const year = meta?.year ?? item.parsedYear;

  const relPath =
    item.mediaKind === 'tv'
      ? formatTvRelativePath({
          showTitle: title,
          year,
          tvdbId: meta?.tvdbId,
          tmdbId: meta?.tmdbId,
          edition: item.edition,
          episode: item.episode ?? { seasonNumber: 1, episodeStart: 1 },
          splitPart: item.splitPart
        })
      : formatMovieRelativePath({
          title,
          year,
          imdbId: meta?.imdbId,
          tmdbId: meta?.tmdbId,
          edition: item.edition,
          tags: item.tags,
          splitPart: item.splitPart
        });

  return resolveContainedOutputPath(root, relPath);
}

export interface PreflightReport {
  readonly ok: boolean;
  readonly diskSpace: readonly DiskSpaceCheck[];
  readonly conflicts: readonly ConflictComparison[];
  readonly projectedByItemId: Readonly<Partial<Record<ItemId, string>>>;
}

const EXTRA_SUFFIX_REGEX =
  /-(trailer|behindthescenes|deleted|featurette|interview|scene|short|other)\.[^.]+$/iu;

function toDisplayHostPath(
  targetPath: string,
  category: OutputCategory,
  mountPaths: MountPathsMap
): string {
  const containerRoot = mountPaths[category];
  const rel = path.relative(containerRoot, targetPath);
  return `${category}/${rel.replaceAll('\\', '/')}`;
}

function buildEpisodeCollisionMarker(item: ScannedItem): string | null {
  if (item.mediaKind !== 'tv') {
    return null;
  }
  const ep = item.episode ?? { seasonNumber: 1, episodeStart: 1 };
  if (ep.airDate) {
    return ` - ${ep.airDate.toLowerCase()}`;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  const start = `s${pad(ep.seasonNumber)}e${pad(ep.episodeStart)}`;
  const code =
    ep.episodeEnd && ep.episodeEnd > ep.episodeStart ? `${start}-e${pad(ep.episodeEnd)}` : start;
  return ` - ${code}`;
}

async function findExistingCollision(item: ScannedItem, dest: string): Promise<string | null> {
  try {
    await fs.access(dest);
    return dest;
  } catch {
    // Exact path does not exist; check destination folder for semantic Plex collisions
  }

  const parentDir = path.dirname(dest);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const videoExtensions: ReadonlySet<string> = VIDEO_EXTENSION_SET;
  const videoFiles = entries.filter(
    (entry): boolean =>
      entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())
  );
  if (videoFiles.length === 0) {
    return null;
  }

  if (item.mediaKind === 'tv') {
    const marker = buildEpisodeCollisionMarker(item);
    if (!marker) {
      return null;
    }
    const match = videoFiles.find((entry): boolean => {
      const lower = entry.name.toLowerCase();
      return (
        lower.includes(`${marker} `) || lower.includes(`${marker}.`) || lower.includes(`${marker}-`)
      );
    });
    return match ? path.join(parentDir, match.name) : null;
  }

  // For movies, any main non-extra video inside the dedicated movie folder is a collision
  const mainMovie = videoFiles.find((entry): boolean => !EXTRA_SUFFIX_REGEX.test(entry.name));
  return mainMovie ? path.join(parentDir, mainMovie.name) : null;
}

/** Runs blocking pre-flight checks: destination resolution, intra-batch collisions, existing files, and disk space. */
export async function runPreflightCheck(
  items: readonly ScannedItem[],
  mountPaths: MountPathsMap,
  probeFile: (filePath: string) => Promise<MediaProbeSummary>
): Promise<PreflightReport> {
  const included = items.filter((item) => item.include);
  const projectedByItemId: Partial<Record<ItemId, string>> = {};
  const destGroups = new Map<string, ScannedItem[]>();
  const requiredByCategory = new Map<OutputCategory, number>();

  for (const item of included) {
    const dest = computeProjectedDestination(item, mountPaths);
    projectedByItemId[item.id] = dest;
    const list = destGroups.get(dest) ?? [];
    list.push(item);
    destGroups.set(dest, list);
    requiredByCategory.set(
      item.category,
      (requiredByCategory.get(item.category) ?? 0) + item.probe.sizeBytes
    );
  }

  const conflicts: ConflictComparison[] = [];

  for (const [dest, group] of destGroups.entries()) {
    if (group.length > 1) {
      for (const item of group) {
        conflicts.push({
          itemId: item.id,
          sourceFileName: item.fileName,
          kind: 'intra-batch',
          destinationPath: dest,
          displayPath: toDisplayHostPath(dest, item.category, mountPaths),
          incoming: item.probe,
          collidingItemIds: group.filter((g): boolean => g.id !== item.id).map((g) => g.id)
        });
      }
      continue;
    }

    const single = group[0];
    if (!single) {
      continue;
    }
    const existingPath = await findExistingCollision(single, dest);
    if (existingPath) {
      const existingProbe = await probeFile(existingPath);
      conflicts.push({
        itemId: single.id,
        sourceFileName: single.fileName,
        kind: 'existing-file',
        destinationPath: dest,
        existingPath,
        displayPath: toDisplayHostPath(existingPath, single.category, mountPaths),
        incoming: single.probe,
        existing: existingProbe
      });
    }
  }

  const diskSpace: DiskSpaceCheck[] = [];
  for (const [category, requiredBytes] of requiredByCategory.entries()) {
    const targetRoot = mountPaths[category];
    try {
      const stats = await fs.statfs(targetRoot);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      diskSpace.push({
        category,
        targetRoot,
        availableBytes,
        requiredBytes,
        sufficient: availableBytes >= requiredBytes
      });
    } catch {
      diskSpace.push({
        category,
        targetRoot,
        availableBytes: 0,
        requiredBytes,
        sufficient: false
      });
    }
  }

  const hasInsufficientSpace = diskSpace.some((d): boolean => !d.sufficient);
  return {
    ok: conflicts.length === 0 && !hasInsufficientSpace,
    diskSpace,
    conflicts,
    projectedByItemId
  };
}
