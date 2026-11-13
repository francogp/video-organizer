import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

import {
  asIso639_2Code,
  asItemId,
  type MediaProbeSummary,
  type ScannedItem
} from '../../src/domain/types.ts';
import {
  backupAndCleanupAfterJob,
  cleanupOrphanTempFiles,
  moveTempOutputFile,
  purgeExpiredBackups
} from '../../src/server/services/fileMover.ts';

const EMPTY_PROBE: MediaProbeSummary = {
  formatName: 'matroska',
  durationSeconds: 100,
  sizeBytes: 100,
  bitrateBps: 100,
  videoStreams: [],
  audioStreams: [],
  subtitleStreams: []
};

describe('fileMover', () => {
  it('enforces TOCTOU guard, moves temp output, and runs deferred cleanup preserving unselected items', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-move-'));
    try {
      const inputDir = path.join(tmpDir, 'input');
      const outputDir = path.join(tmpDir, 'output');
      const movieDir = path.join(inputDir, 'MovieA');
      const subsDir = path.join(movieDir, 'Subs');
      const ignoredDir = path.join(inputDir, 'MovieB_Ignored');
      await fs.mkdir(subsDir, { recursive: true });
      await fs.mkdir(ignoredDir, { recursive: true });
      await fs.mkdir(outputDir, { recursive: true });

      const srcVideo = path.join(movieDir, 'MovieA.mkv');
      const subFile = path.join(subsDir, 'MovieA.es.srt');
      const posterFile = path.join(movieDir, 'poster.jpg');
      const torrentJunkDir = path.join(movieDir, 'Torrent Downloaded From');
      const torrentJunkFile = path.join(torrentJunkDir, 'info.txt');
      const ignoredVideo = path.join(ignoredDir, 'MovieB.mkv');
      const tempMkv = path.join(movieDir, 'MovieA.organizing.j1.i1.tmp.mkv');
      const orphanTmp = path.join(ignoredDir, 'Other.organizing.j0.i0.tmp.mkv');

      await fs.mkdir(torrentJunkDir, { recursive: true });
      await fs.writeFile(srcVideo, 'source');
      await fs.writeFile(subFile, '1');
      await fs.writeFile(posterFile, 'img');
      await fs.writeFile(torrentJunkFile, 'junk');
      await fs.writeFile(ignoredVideo, 'keep-me');
      await fs.writeFile(orphanTmp, 'orphan');

      const removedOrphans = await cleanupOrphanTempFiles(inputDir);
      expect(removedOrphans).toBe(1);

      await fs.writeFile(tempMkv, 'remuxed');

      const destPath = path.join(outputDir, 'MovieA (2020)', 'MovieA (2020).mkv');
      await moveTempOutputFile(tempMkv, destPath, false);
      await expect(fs.readFile(destPath, 'utf8')).resolves.toBe('remuxed');

      // TOCTOU guard blocks overwrite when allowOverwrite is false
      await fs.writeFile(tempMkv, 'remuxed2');
      await expect(moveTempOutputFile(tempMkv, destPath, false)).rejects.toThrow('TOCTOU guard');
      await fs.rm(tempMkv, { force: true });

      const movedItem: ScannedItem = {
        id: asItemId('i1'),
        sourcePath: srcVideo,
        relativePath: 'MovieA/MovieA.mkv',
        fileName: 'MovieA.mkv',
        mediaKind: 'movie',
        category: 'movies',
        include: true,
        parsedTitle: 'MovieA',
        tags: [],
        probe: EMPTY_PROBE,
        externalSubtitles: [
          {
            path: subFile,
            relativePath: 'MovieA/Subs/MovieA.es.srt',
            extension: '.srt',
            language: asIso639_2Code('spa'),
            isForced: false,
            isHearingImpaired: false,
            isLanguageAmbiguous: false
          }
        ],
        candidates: [],
        episodeOrder: 'aired',
        trackSelection: {
          audioTracks: [],
          subtitleMergeMode: 'keep-and-add',
          includedInternalSubtitles: [],
          externalSubtitleOrder: [subFile],
          needsUserPrompt: false
        },
        warnings: []
      };

      const backupDir = path.join(tmpDir, 'backup');
      await fs.mkdir(path.join(backupDir, 'MovieA'), { recursive: true });
      await fs.writeFile(path.join(backupDir, 'MovieA', 'MovieA.mkv'), 'older-different-bytes');
      await backupAndCleanupAfterJob([movedItem], inputDir, backupDir);

      // Moved folder removed, ignored folder & inputDir preserved, source + sub backed up (with collision suffix)
      await expect(fs.access(movieDir)).rejects.toThrow(/ENOENT/i);
      await expect(fs.readFile(ignoredVideo, 'utf8')).resolves.toBe('keep-me');
      await fs.access(inputDir);
      const movieABackups = await fs.readdir(path.join(backupDir, 'MovieA'));
      const suffixedBackup = movieABackups.find(
        (f) => f.startsWith('MovieA.') && f !== 'MovieA.mkv'
      );
      expect(suffixedBackup).toBeDefined();
      await expect(
        fs.readFile(path.join(backupDir, 'MovieA', suffixedBackup!), 'utf8')
      ).resolves.toBe('source');
      await expect(
        fs.readFile(path.join(backupDir, 'MovieA', 'Subs', 'MovieA.es.srt'), 'utf8')
      ).resolves.toBe('1');

      // Deduplication: identical content under a different name is not duplicated in backupDir
      const dupDir = path.join(inputDir, 'MovieA_Dup');
      await fs.mkdir(dupDir, { recursive: true });
      const dupVideo = path.join(dupDir, 'MovieA.renamed.mkv');
      await fs.writeFile(dupVideo, 'source');
      await backupAndCleanupAfterJob(
        [
          {
            ...movedItem,
            id: asItemId('i-dup'),
            sourcePath: dupVideo,
            relativePath: 'MovieA_Dup/MovieA.renamed.mkv',
            fileName: 'MovieA.renamed.mkv',
            externalSubtitles: []
          }
        ],
        inputDir,
        backupDir
      );
      await expect(
        fs.access(path.join(backupDir, 'MovieA_Dup', 'MovieA.renamed.mkv'))
      ).rejects.toThrow(/ENOENT/i);

      // Same relative path with different content creates timestamp-disambiguated backup
      await fs.mkdir(movieDir, { recursive: true });
      await fs.writeFile(srcVideo, 'source-modified');
      await backupAndCleanupAfterJob(
        [{ ...movedItem, externalSubtitles: [] }],
        inputDir,
        backupDir
      );
      const backupEntries = await fs.readdir(path.join(backupDir, 'MovieA'));
      expect(
        backupEntries.some((name) => name.startsWith('MovieA.') && name !== 'MovieA.mkv')
      ).toBe(true);

      // Retention purge: files older than 7 days are removed; fresh files are kept
      const eightDaysAgoSec = (Temporal.Now.instant().epochMilliseconds - 8 * 86_400_000) / 1000;
      const oldBackupFile = path.join(backupDir, 'MovieA', 'Subs', 'MovieA.es.srt');
      await fs.utimes(oldBackupFile, eightDaysAgoSec, eightDaysAgoSec);
      const purged = await purgeExpiredBackups(backupDir);
      expect(purged.removedFiles).toBe(1);
      await expect(fs.access(oldBackupFile)).rejects.toThrow(/ENOENT/i);
      await expect(
        fs.readFile(path.join(backupDir, 'MovieA', suffixedBackup!), 'utf8')
      ).resolves.toBe('source');

      const missingPurged = await purgeExpiredBackups(path.join(tmpDir, 'missing-backup'));
      expect(missingPurged.removedFiles).toBe(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back to copyFile + atomic rename when fs.rename throws EXDEV', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-exdev-'));
    try {
      const src = path.join(tmpDir, 'src.tmp.mkv');
      const dest = path.join(tmpDir, 'out', 'Movie (2024).mkv');
      await fs.writeFile(src, 'payload-bytes');

      const realRename = fs.rename.bind(fs);
      const spy = vi
        .spyOn(fs, 'rename')
        .mockRejectedValueOnce(Object.assign(new Error('cross-device'), { code: 'EXDEV' }))
        .mockImplementation(realRename);

      const progressUpdates: number[] = [];
      await moveTempOutputFile(src, dest, true, (pct) => {
        progressUpdates.push(pct);
      });
      await expect(fs.readFile(dest, 'utf8')).resolves.toBe('payload-bytes');
      await expect(fs.access(src)).rejects.toThrow(/ENOENT/i);
      expect(progressUpdates.at(-1)).toBe(100);
      spy.mockRestore();

      await fs.writeFile(src, 'new-bytes');
      await expect(moveTempOutputFile(src, dest, false)).rejects.toThrow(/TOCTOU guard/i);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
