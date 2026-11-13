import crypto from 'node:crypto';
import { createReadStream, type Dirent, type Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BACKUP_RETENTION_MS,
  ORGANIZING_TEMP_MARKER,
  ORGANIZING_TEMP_SUFFIX,
  PERCENT_MAX,
  VIDEO_EXTENSION_SET
} from '../../domain/constants.ts';
import type { ScannedItem } from '../../domain/types.ts';

const COPY_CHUNK_BYTES = 256 * 1024;
const PROGRESS_THROTTLE_MS = 150;

/** Removes leftover `*.organizing.*.tmp.mkv` files on startup or forced unlock. */
export async function cleanupOrphanTempFiles(inputDir: string): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.readdir(inputDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (
        entry.name.includes(ORGANIZING_TEMP_MARKER) &&
        entry.name.endsWith(ORGANIZING_TEMP_SUFFIX)
      ) {
        await fs.rm(path.join(entry.parentPath, entry.name), { force: true });
        removed += 1;
      }
    }
  } catch {
    // Ignore inaccessible directory during cleanup
  }
  return removed;
}

async function copyFileWithProgress(
  srcPath: string,
  destPath: string,
  totalBytes: number,
  onProgress?: (percent: number) => void
): Promise<void> {
  const srcHandle = await fs.open(srcPath, 'r');
  const dstHandle = await fs.open(destPath, 'w');
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let copied = 0;
  let lastReportAt = 0;
  let lastPercent = -1;

  try {
    onProgress?.(0);
    while (true) {
      const { bytesRead } = await srcHandle.read(buffer, 0, COPY_CHUNK_BYTES, null);
      if (bytesRead === 0) {
        break;
      }
      await dstHandle.write(buffer, 0, bytesRead);
      copied += bytesRead;
      if (onProgress && totalBytes > 0) {
        const now = performance.now();
        const percent = Math.min(PERCENT_MAX, Math.round((copied / totalBytes) * PERCENT_MAX));
        if (
          percent !== lastPercent &&
          (now - lastReportAt >= PROGRESS_THROTTLE_MS || percent === PERCENT_MAX)
        ) {
          lastPercent = percent;
          lastReportAt = now;
          onProgress(percent);
        }
      }
    }
    onProgress?.(PERCENT_MAX);
  } finally {
    await dstHandle.close();
    await srcHandle.close();
  }
}

/** Moves a verified temporary `.mkv` into its final Plex destination, handling cross-device `EXDEV`. */
export async function moveTempOutputFile(
  tempPath: string,
  destPath: string,
  allowOverwrite: boolean,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!allowOverwrite) {
    let exists = false;
    try {
      await fs.access(destPath);
      exists = true;
    } catch {
      // Destination does not exist yet
    }
    if (exists) {
      throw new Error(`Destination appeared before move (TOCTOU guard): ${destPath}`);
    }
  }

  await fs.mkdir(path.dirname(destPath), { recursive: true });

  try {
    await fs.rename(tempPath, destPath);
    onProgress?.(PERCENT_MAX);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') {
      throw err;
    }
    const stagingPath = `${destPath}.part.tmp`;
    try {
      const srcStat = await fs.stat(tempPath);
      await copyFileWithProgress(tempPath, stagingPath, srcStat.size, onProgress);
      const dstStat = await fs.stat(stagingPath);
      if (srcStat.size !== dstStat.size) {
        throw new Error(
          `Cross-device copy byte mismatch for ${destPath}: expected ${String(srcStat.size)}, got ${String(dstStat.size)}`
        );
      }
      await fs.rename(stagingPath, destPath);
      await fs.unlink(tempPath);
    } catch (copyErr) {
      await fs.rm(stagingPath, { force: true });
      throw copyErr;
    }
  }
}

async function pruneEmptyAncestors(startDir: string, rootStopDir: string): Promise<void> {
  const resolvedRoot = path.resolve(rootStopDir);
  let current = path.resolve(startDir);

  while (current !== resolvedRoot && current.startsWith(`${resolvedRoot}${path.sep}`)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) {
        break;
      }
      await fs.rmdir(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

async function hasAnyVideoFile(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    return entries.some(
      (entry): boolean =>
        entry.isFile() && VIDEO_EXTENSION_SET.has(path.extname(entry.name).toLowerCase() as never)
    );
  } catch {
    return false;
  }
}

const MS_PER_SECOND = 1000;

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject): void => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

interface BackupDedupIndex {
  readonly bySize: Map<number, string[]>;
  readonly hashByPath: Map<string, string>;
}

async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function buildBackupDedupIndex(backupRootDir: string): Promise<BackupDedupIndex> {
  const bySize = new Map<number, string[]>();
  const hashByPath = new Map<string, string>();
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(backupRootDir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(entry.parentPath, entry.name);
    const stat = await safeStat(fullPath);
    if (!stat) {
      continue;
    }
    const list = bySize.get(stat.size) ?? [];
    list.push(fullPath);
    bySize.set(stat.size, list);
  }
  return { bySize, hashByPath };
}

async function findIdenticalBackupFile(
  sourcePath: string,
  sourceSize: number,
  index: BackupDedupIndex
): Promise<string | null> {
  const candidates = index.bySize.get(sourceSize);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  const sourceHash = await computeFileSha256(sourcePath);
  for (const candidatePath of candidates) {
    let candidateHash = index.hashByPath.get(candidatePath);
    if (!candidateHash) {
      try {
        candidateHash = await computeFileSha256(candidatePath);
        index.hashByPath.set(candidatePath, candidateHash);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    if (candidateHash === sourceHash) {
      return candidatePath;
    }
  }
  return null;
}

async function moveFileToBackup(
  sourcePath: string,
  backupRootDir: string,
  relativePath: string,
  nowMs: number,
  dedupIndex: BackupDedupIndex
): Promise<void> {
  const sourceStat = await fs.stat(sourcePath);
  const nowSeconds = nowMs / MS_PER_SECOND;
  const duplicatePath = await findIdenticalBackupFile(sourcePath, sourceStat.size, dedupIndex);
  if (duplicatePath) {
    await fs.utimes(duplicatePath, nowSeconds, nowSeconds);
    await fs.rm(sourcePath, { force: true });
    return;
  }

  const safeRel = relativePath.replace(/^[/\\]+/, '');
  let targetPath = path.join(backupRootDir, safeRel);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const exists = await fs
    .access(targetPath)
    .then((): boolean => true)
    .catch((): boolean => false);
  if (exists) {
    const parsed = path.parse(targetPath);
    targetPath = path.join(parsed.dir, `${parsed.name}.${String(nowMs)}${parsed.ext}`);
  }

  try {
    await fs.rename(sourcePath, targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') {
      throw err;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
  }

  await fs.utimes(targetPath, nowSeconds, nowSeconds);
  const list = dedupIndex.bySize.get(sourceStat.size) ?? [];
  list.push(targetPath);
  dedupIndex.bySize.set(sourceStat.size, list);
}

/**
 * Purges backup files whose modification time is older than `maxAgeMs` (default: 7 days)
 * and prunes empty directories left behind under `backupDir`.
 */
export async function purgeExpiredBackups(
  backupDir: string,
  maxAgeMs: number = BACKUP_RETENTION_MS,
  nowMs: number = Temporal.Now.instant().epochMilliseconds
): Promise<{ readonly removedFiles: number; readonly freedBytes: number }> {
  const resolvedBackupDir = path.resolve(backupDir);
  await fs.mkdir(resolvedBackupDir, { recursive: true });

  let removedFiles = 0;
  let freedBytes = 0;
  const cutoffMs = nowMs - maxAgeMs;
  const candidateDirs = new Set<string>();

  const entries = await fs.readdir(resolvedBackupDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      candidateDirs.add(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stat = await safeStat(fullPath);
    if (stat && stat.mtimeMs < cutoffMs) {
      await fs.rm(fullPath, { force: true });
      removedFiles += 1;
      freedBytes += stat.size;
      candidateDirs.add(path.dirname(fullPath));
    }
  }

  const sortedDirs = Array.from(candidateDirs)
    .map((dir) => path.resolve(dir))
    .filter(
      (dir): boolean =>
        dir !== resolvedBackupDir && dir.startsWith(`${resolvedBackupDir}${path.sep}`)
    )
    .sort((a, b): number => b.length - a.length);

  for (const dir of sortedDirs) {
    await pruneEmptyAncestors(dir, resolvedBackupDir);
  }

  return { removedFiles, freedBytes };
}

/**
 * Runs deferred end-of-job backup & cleanup only after all file moves succeed.
 * Moves processed sources and matched subtitles (including `.idx`) into `backupDir`
 * with updated timestamps for 7-day retention, and removes empty/leftover item dirs in `inputDir`.
 */
export async function backupAndCleanupAfterJob(
  movedItems: readonly ScannedItem[],
  inputDir: string,
  backupDir: string,
  onProgress?: (completed: number, total: number, fileName: string) => void
): Promise<void> {
  const resolvedInputDir = path.resolve(inputDir);
  const resolvedBackupDir = path.resolve(backupDir);
  await fs.mkdir(resolvedBackupDir, { recursive: true });
  const dedupIndex = await buildBackupDedupIndex(resolvedBackupDir);
  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const candidateDirs = new Set<string>();

  for (let idx = 0; idx < movedItems.length; idx += 1) {
    const item = movedItems[idx]!;
    await moveFileToBackup(
      item.sourcePath,
      resolvedBackupDir,
      item.relativePath,
      nowMs,
      dedupIndex
    );
    candidateDirs.add(path.dirname(item.sourcePath));

    for (const sub of item.externalSubtitles) {
      await moveFileToBackup(sub.path, resolvedBackupDir, sub.relativePath, nowMs, dedupIndex);
      if (sub.idxPairPath) {
        const idxRel = path.relative(resolvedInputDir, sub.idxPairPath);
        await moveFileToBackup(sub.idxPairPath, resolvedBackupDir, idxRel, nowMs, dedupIndex);
      }
      candidateDirs.add(path.dirname(sub.path));
    }

    onProgress?.(idx + 1, movedItems.length, item.fileName);
  }

  const sortedDirs = Array.from(candidateDirs)
    .map((dir) => path.resolve(dir))
    .filter(
      (dir): boolean => dir !== resolvedInputDir && dir.startsWith(`${resolvedInputDir}${path.sep}`)
    )
    .sort((a, b): number => b.length - a.length);

  for (const dir of sortedDirs) {
    if (!(await hasAnyVideoFile(dir))) {
      await fs.rm(dir, { recursive: true, force: true });
      await pruneEmptyAncestors(path.dirname(dir), resolvedInputDir);
    }
  }
}
