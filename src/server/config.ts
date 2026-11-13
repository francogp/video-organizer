import fs from 'node:fs/promises';
import path from 'node:path';

import * as v from 'valibot';

import {
  DEFAULT_APP_PORT,
  DEFAULT_DEV_CLIENT_PORT,
  DEFAULT_PGID,
  DEFAULT_PUID
} from '../domain/constants.ts';
import type { MountPathsMap } from '../domain/types.ts';

const PortSchema = v.pipe(
  v.optional(v.string()),
  v.transform((val) => {
    const parsed = Number(val);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  })
);

const EnvSchema = v.object({
  APP_PORT: PortSchema,
  DEV_CLIENT_PORT: PortSchema,
  PUID: PortSchema,
  PGID: PortSchema,
  CONFIG_DIR: v.optional(v.string()),
  INPUT_DIR: v.optional(v.string()),
  BACKUP_DIR: v.optional(v.string()),
  OUTPUT_MOVIES_DIR: v.optional(v.string()),
  OUTPUT_ANIMATED_MOVIES_DIR: v.optional(v.string()),
  OUTPUT_TV_SHOWS_DIR: v.optional(v.string()),
  OUTPUT_ANIMATED_SERIES_DIR: v.optional(v.string()),
  OMDB_API_KEY: v.optional(v.string()),
  TVDB_API_KEY: v.optional(v.string())
});

export interface AppConfig {
  readonly appPort: number;
  readonly devClientPort: number;
  readonly puid: number;
  readonly pgid: number;
  readonly configDir: string;
  readonly inputDir: string;
  readonly backupDir: string;
  readonly outputMoviesDir: string;
  readonly outputAnimatedMoviesDir: string;
  readonly outputTvShowsDir: string;
  readonly outputAnimatedSeriesDir: string;
  readonly omdbApiKey?: string;
  readonly tvdbApiKey?: string;
}

/** Parses and validates environment variables into canonical server configuration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = v.parse(EnvSchema, env);
  return {
    appPort: parsed.APP_PORT ?? DEFAULT_APP_PORT,
    devClientPort: parsed.DEV_CLIENT_PORT ?? DEFAULT_DEV_CLIENT_PORT,
    puid: parsed.PUID ?? DEFAULT_PUID,
    pgid: parsed.PGID ?? DEFAULT_PGID,
    configDir: path.resolve(parsed.CONFIG_DIR || '/config'),
    inputDir: path.resolve(parsed.INPUT_DIR || '/data/input'),
    backupDir: path.resolve(parsed.BACKUP_DIR || '/data/backup'),
    outputMoviesDir: path.resolve(parsed.OUTPUT_MOVIES_DIR || '/data/output/movies'),
    outputAnimatedMoviesDir: path.resolve(
      parsed.OUTPUT_ANIMATED_MOVIES_DIR || '/data/output/animated-movies'
    ),
    outputTvShowsDir: path.resolve(parsed.OUTPUT_TV_SHOWS_DIR || '/data/output/tv-shows'),
    outputAnimatedSeriesDir: path.resolve(
      parsed.OUTPUT_ANIMATED_SERIES_DIR || '/data/output/animated-series'
    ),
    omdbApiKey: parsed.OMDB_API_KEY?.trim() || undefined,
    tvdbApiKey: parsed.TVDB_API_KEY?.trim() || undefined
  };
}

/** Projects configured roots into the read-only `MountPathsMap` contract for `/api/state`. */
export function buildMountPathsMap(config: AppConfig): MountPathsMap {
  return {
    inputDir: config.inputDir,
    movies: config.outputMoviesDir,
    'animated-movies': config.outputAnimatedMoviesDir,
    'tv-shows': config.outputTvShowsDir,
    'animated-series': config.outputAnimatedSeriesDir
  };
}

/** Verifies that all configured mount directories exist and are readable/writable. */
export async function validateMountDirectories(config: AppConfig): Promise<readonly string[]> {
  const dirs = [
    config.configDir,
    config.inputDir,
    config.backupDir,
    config.outputMoviesDir,
    config.outputAnimatedMoviesDir,
    config.outputTvShowsDir,
    config.outputAnimatedSeriesDir
  ];
  try {
    await fs.mkdir(config.backupDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [`Backup dir create failed (${config.backupDir}): ${msg}`];
  }
  const errors: string[] = [];
  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Mount inaccessible (${dir}): ${msg}`);
    }
  }
  return errors;
}
