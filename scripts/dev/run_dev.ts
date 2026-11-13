/**
 * @file run_dev.ts
 * @description Native local development orchestrator.
 * Starts the Node.js backend (`--watch --env-file-if-exists=.env`) and Vite HMR frontend (`vp dev`)
 * directly on the host OS without Docker (Docker is reserved for production / NAS deployment).
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { enableCompileCache } from 'node:module';
import path from 'node:path';
import { styleText } from 'node:util';

import { renderBanner } from '@francogp/auditor';
import { defineCommand, runMain } from 'citty';

enableCompileCache();

const ROOT_DIR = process.cwd();

function isCommandInPath(cmd: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const res = spawnSync(cmd, ['-version'], { stdio: 'ignore', env });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function resolveNativeFfmpegPath(baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (isCommandInPath('ffmpeg', baseEnv) && isCommandInPath('ffprobe', baseEnv)) {
    return baseEnv;
  }
  if (process.platform !== 'win32') {
    return baseEnv;
  }

  const localAppData = baseEnv.LOCALAPPDATA;
  if (!localAppData) {
    return baseEnv;
  }

  const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    const entries = await fsPromises.readdir(packagesDir, { withFileTypes: true });
    const ffmpegPkg = entries.find((e) => e.isDirectory() && e.name.startsWith('Gyan.FFmpeg'));
    if (!ffmpegPkg) {
      return baseEnv;
    }
    const pkgPath = path.join(packagesDir, ffmpegPkg.name);
    const subEntries = await fsPromises.readdir(pkgPath, { withFileTypes: true });
    for (const sub of subEntries) {
      if (!sub.isDirectory()) {
        continue;
      }
      const binDir = path.join(pkgPath, sub.name, 'bin');
      try {
        await fsPromises.access(path.join(binDir, 'ffmpeg.exe'));
        return {
          ...baseEnv,
          PATH: `${binDir}${path.delimiter}${baseEnv.PATH ?? ''}`
        };
      } catch {
        // Continue searching
      }
    }
  } catch {
    // WinGet Packages folder absent
  }

  return baseEnv;
}

const main = defineCommand({
  meta: {
    name: 'run_dev',
    description: 'Plex Video Organizer — Native local development orchestrator (no Docker)'
  },
  async run(): Promise<void> {
    console.log(
      renderBanner(
        'PLEX VIDEO ORGANIZER — NATIVE DEV ORCHESTRATOR',
        'Local Node Backend (ffmpeg/ffprobe) + Vite HMR Frontend',
        'cyan'
      )
    );

    const serverEnv = await resolveNativeFfmpegPath(process.env);
    if (!isCommandInPath('ffmpeg', serverEnv) || !isCommandInPath('ffprobe', serverEnv)) {
      console.warn(
        styleText(
          'yellow',
          '⚠️  ffmpeg/ffprobe not found in PATH. Audio analysis & MKV remuxing require FFmpeg (e.g. `winget install Gyan.FFmpeg`).'
        )
      );
    }

    const serverProc = spawn(
      process.execPath,
      ['--watch', '--env-file-if-exists=.env', 'src/server/index.ts'],
      {
        stdio: 'inherit',
        cwd: ROOT_DIR,
        env: serverEnv
      }
    );

    const vpCmd = path.resolve(
      ROOT_DIR,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'vp.cmd' : 'vp'
    );
    const clientProc = spawn(vpCmd, ['dev'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: ROOT_DIR
    });

    const children: readonly ChildProcess[] = [serverProc, clientProc];
    const shutdown = (): void => {
      for (const child of children) {
        if (!child.killed) {
          child.kill();
        }
      }
    };

    process.on('SIGINT', (): void => {
      shutdown();
      process.exit(0);
    });
    process.on('SIGTERM', (): void => {
      shutdown();
      process.exit(0);
    });
  }
});

void runMain(main);
