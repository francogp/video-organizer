import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

import { asClientId, asItemId } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/server/config.ts';
import { createRequestHandler } from '../../src/server/routes.ts';
import { JobRunner } from '../../src/server/services/jobRunner.ts';

describe('JobRunner & HTTP routes', () => {
  it('enforces single-user LAN lock, 409 conflict, and forced unlock over HTTP', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-http-'));
    const inputDir = path.join(tmpDir, 'input');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    const cfg = loadConfig({
      CONFIG_DIR: configDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: tmpDir,
      OUTPUT_DOCUMENTARIES_DIR: tmpDir,
      OUTPUT_ANIMATED_MOVIES_DIR: tmpDir,
      OUTPUT_TV_SHOWS_DIR: tmpDir,
      OUTPUT_ANIMATED_SERIES_DIR: tmpDir
    });

    const runner = new JobRunner(cfg);
    await runner.init();

    const server = http.createServer(createRequestHandler(runner, tmpDir));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const addr = server.address() as { readonly port: number };
      const baseUrl = `http://127.0.0.1:${String(addr.port)}`;

      const stateRes = await fetch(`${baseUrl}/api/state`);
      expect(stateRes.status).toBe(200);
      const stateJson = (await stateRes.json()) as {
        readonly phase: string;
        readonly lockOwnerClientId: string | null;
      };
      expect(stateJson.phase).toBe('IDLE');
      expect(stateJson.lockOwnerClientId).toBeNull();

      // Missing X-Client-Id returns 400
      const badScan = await fetch(`${baseUrl}/api/scan`, { method: 'POST' });
      expect(badScan.status).toBe(400);

      // Put a file so scan transitions to READY or ERROR while keeping lockOwnerClientId
      await fs.writeFile(path.join(inputDir, 'Dummy.2024.mkv'), 'not-a-real-mkv');

      // Client A acquires lock via scan
      const scanRes = await fetch(`${baseUrl}/api/scan`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'browserA:tab1' }
      });
      expect(scanRes.status).toBe(202);

      // Client B receives 409 Conflict because lock is held by browserA:tab1
      const lockedRes = await fetch(`${baseUrl}/api/scan`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'browserB:tab1' }
      });
      expect(lockedRes.status).toBe(409);

      // Client B can force unlock
      const unlockRes = await fetch(`${baseUrl}/api/jobs/unlock`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'browserB:tab1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      expect(unlockRes.status).toBe(200);
      const unlockedState = (await unlockRes.json()) as {
        readonly phase: string;
        readonly lockOwnerClientId: string | null;
      };
      expect(unlockedState.phase).toBe('IDLE');
      expect(unlockedState.lockOwnerClientId).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles PATCH, preflight, startJob (ignore), SSE events, static dist serving, and 404/409 errors', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-http-full-'));
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    const configDir = path.join(tmpDir, 'config');
    const distDir = path.join(tmpDir, 'dist');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'index.html'), '<html><body>OK</body></html>');
    await fs.writeFile(
      path.join(distDir, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"></svg>'
    );

    const srcFile = path.join(inputDir, 'Movie.2024.mkv');
    await fs.writeFile(srcFile, 'video-bytes');

    // Pre-populate queue.json so runner.init() restores an item without needing live ffprobe
    await fs.writeFile(
      path.join(configDir, 'queue.json'),
      JSON.stringify({
        revision: 2,
        items: [
          {
            id: 'item-1',
            sourcePath: srcFile,
            relativeSourcePath: 'Movie.2024.mkv',
            fileName: 'Movie.2024.mkv',
            extension: '.mkv',
            mediaKind: 'movie',
            category: 'movies',
            parsedTitle: 'Movie',
            parsedYear: 2024,
            episodeOrder: 'aired',
            include: false,
            probe: {
              formatName: 'matroska',
              durationSeconds: 100,
              sizeBytes: 11,
              bitrateBps: 1000,
              videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
              audioStreams: [],
              subtitleStreams: []
            },
            externalSubtitles: [],
            trackSelection: { audioStreamIndices: [], subtitleStreamIndices: [] },
            candidates: [],
            selectedMetadata: { title: 'Movie', year: 2024, imdbId: 'tt1234567', source: 'imdb' },
            needsUserPrompt: false,
            warnings: []
          }
        ]
      })
    );

    const cfg = loadConfig({
      CONFIG_DIR: configDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: outputDir,
      OUTPUT_DOCUMENTARIES_DIR: outputDir,
      OUTPUT_ANIMATED_MOVIES_DIR: outputDir,
      OUTPUT_TV_SHOWS_DIR: outputDir,
      OUTPUT_ANIMATED_SERIES_DIR: outputDir
    });

    const runner = new JobRunner(cfg);
    await runner.init();
    const server = http.createServer(createRequestHandler(runner, distDir));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const addr = server.address() as { readonly port: number };
      const baseUrl = `http://127.0.0.1:${String(addr.port)}`;

      // Static dist & SPA fallback & unknown API
      const indexRes = await fetch(`${baseUrl}/`);
      expect(indexRes.status).toBe(200);
      await expect(indexRes.text()).resolves.toContain('OK');

      const faviconRes = await fetch(`${baseUrl}/favicon.svg`);
      expect(faviconRes.status).toBe(200);
      expect(faviconRes.headers.get('content-type')).toContain('image/svg+xml');
      await expect(faviconRes.text()).resolves.toContain('<svg');

      const repoRoot = path.resolve(import.meta.dirname, '../..');
      const repoIndexHtml = await fs.readFile(path.join(repoRoot, 'index.html'), 'utf8');
      expect(repoIndexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"');
      const repoFaviconSvg = await fs.readFile(
        path.join(repoRoot, 'public', 'favicon.svg'),
        'utf8'
      );
      expect(repoFaviconSvg).toContain('<svg');

      const spaRes = await fetch(`${baseUrl}/some/client/route`);
      expect(spaRes.status).toBe(200);

      const unknownApi = await fetch(`${baseUrl}/api/does-not-exist`);
      expect(unknownApi.status).toBe(404);

      const searchHttp = await fetch(`${baseUrl}/api/metadata/search`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '   ', kind: 'movie' })
      });
      expect(searchHttp.status).toBe(200);

      // Upstream metadata HTML/schema change surfaces explicit 502 error
      const originalFetch = globalThis.fetch;
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('media-imdb.com')) {
          return new Response('<html>Maintenance</html>', { status: 200 });
        }
        return originalFetch(input, init);
      });
      try {
        const brokenSearch = await originalFetch(`${baseUrl}/api/metadata/search`, {
          method: 'POST',
          headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'Interstellar', kind: 'movie' })
        });
        expect(brokenSearch.status).toBe(502);
        const brokenJson = (await brokenSearch.json()) as {
          readonly error?: string;
          readonly code?: string;
          readonly provider?: string;
        };
        expect(brokenJson.code).toBe('schema_incompatible');
        expect(brokenJson.provider).toBe('imdb');
        expect(brokenJson.error).toContain('Source code update required');
      } finally {
        vi.unstubAllGlobals();
      }

      // SSE subscription check
      const controller = new AbortController();
      const sseRes = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
      expect(sseRes.status).toBe(200);
      const reader = sseRes.body?.getReader();
      const firstChunk = await reader?.read();
      const sseText = new TextDecoder().decode(firstChunk?.value);
      expect(sseText).toContain('event: state');
      controller.abort();

      // PATCH stale revision -> 409
      const stalePatch = await fetch(`${baseUrl}/api/queue/items/item-1`, {
        method: 'PATCH',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 999, patch: { edition: 'IMAX' } })
      });
      expect(stalePatch.status).toBe(409);

      // Valid PATCH -> 200
      const okPatch = await fetch(`${baseUrl}/api/queue/items/item-1`, {
        method: 'PATCH',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 2, patch: { edition: 'IMAX' } })
      });
      expect(okPatch.status).toBe(200);

      // Bulk PATCH empty -> 400; valid -> 200 (revision 3 -> 4)
      const emptyBulk = await fetch(`${baseUrl}/api/queue/items/bulk`, {
        method: 'PATCH',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 3, itemIds: [], patch: { category: 'documentaries' } })
      });
      expect(emptyBulk.status).toBe(400);

      const okBulk = await fetch(`${baseUrl}/api/queue/items/bulk`, {
        method: 'PATCH',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: 3,
          itemIds: ['item-1'],
          patch: {
            mediaKind: 'tv',
            category: 'tv-shows',
            selectedMetadata: {
              title: 'Test Show',
              year: 2024,
              tvdbId: '12345',
              source: 'tvdb'
            },
            episodeOrder: 'dvd'
          }
        })
      });
      expect(okBulk.status).toBe(200);

      // Stale revision on bulk PATCH -> 409
      const staleBulk = await fetch(`${baseUrl}/api/queue/items/bulk`, {
        method: 'PATCH',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: 999,
          itemIds: ['item-1'],
          patch: { category: 'movies' }
        })
      });
      expect(staleBulk.status).toBe(409);

      // Preflight -> 200 (revision now 4)
      const preflightRes = await fetch(`${baseUrl}/api/preflight`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 4 })
      });
      expect(preflightRes.status).toBe(200);
      const preflightJson = (await preflightRes.json()) as {
        readonly ok: boolean;
        readonly revision: number;
      };
      expect(preflightJson.ok).toBe(true);

      // Start job with no included items -> 202 and completes cleanly
      const startRes = await fetch(`${baseUrl}/api/jobs/start`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: preflightJson.revision,
          conflictResolutions: {}
        })
      });
      expect(startRes.status).toBe(202);
      await new Promise((r) => setTimeout(r, 50));

      const clearLogsRes = await fetch(`${baseUrl}/api/logs/clear`, { method: 'POST' });
      expect(clearLogsRes.status).toBe(200);
      const clearedState = (await clearLogsRes.json()) as { readonly logs?: readonly unknown[] };
      expect(clearedState.logs).toEqual([]);

      // Verifier scan & fix (with a non-compliant folder whose year and imdbId are already in title so no network needed)
      const fixableDir = path.join(outputDir, 'Sample Film (2024) {imdb-tt9999999}');
      await fs.mkdir(fixableDir, { recursive: true });
      await fs.writeFile(path.join(fixableDir, 'sample.mkv'), 'video');

      // Use isolated empty dir for TV categories so Sample Film isn't scanned as a TV show over network
      const emptyTvDir = path.join(tmpDir, 'empty-tv');
      await fs.mkdir(emptyTvDir, { recursive: true });
      const verifierRunner = new JobRunner(
        loadConfig({
          CONFIG_DIR: configDir,
          INPUT_DIR: inputDir,
          OUTPUT_MOVIES_DIR: outputDir,
          OUTPUT_DOCUMENTARIES_DIR: emptyTvDir,
          OUTPUT_ANIMATED_MOVIES_DIR: emptyTvDir,
          OUTPUT_TV_SHOWS_DIR: emptyTvDir,
          OUTPUT_ANIMATED_SERIES_DIR: emptyTvDir
        })
      );
      await verifierRunner.init();
      verifierRunner.startVerifierScan(asClientId('clientA:1'));
      for (let i = 0; i < 20 && verifierRunner.getState().verifier?.scanning; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const scannedEntries = verifierRunner.getState().verifier?.entries ?? [];
      expect(scannedEntries.length).toBeGreaterThan(0);

      verifierRunner.startVerifierFix(
        asClientId('clientA:1'),
        scannedEntries[0] ? [scannedEntries[0].id] : []
      );
      for (let i = 0; i < 20 && verifierRunner.getState().verifier?.fixing; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(verifierRunner.getState().verifier?.entries).toEqual([]);

      const verifierScanRes = await fetch(`${baseUrl}/api/verifier/scan`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'clientA:1' }
      });
      expect(verifierScanRes.status).toBe(202);

      const badFixRes = await fetch(`${baseUrl}/api/verifier/fix`, {
        method: 'POST',
        headers: { 'X-Client-Id': 'clientA:1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryIds: [] })
      });
      expect(badFixRes.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('persists lastError and recent logs in getState when scan fails', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-err-'));
    try {
      const cfg = loadConfig({
        CONFIG_DIR: tmpDir,
        INPUT_DIR: path.join(tmpDir, 'does-not-exist'),
        OUTPUT_MOVIES_DIR: tmpDir,
        OUTPUT_DOCUMENTARIES_DIR: tmpDir,
        OUTPUT_ANIMATED_MOVIES_DIR: tmpDir,
        OUTPUT_TV_SHOWS_DIR: tmpDir,
        OUTPUT_ANIMATED_SERIES_DIR: tmpDir
      });
      const runner = new JobRunner(cfg);
      await runner.init();
      runner.startScan(asClientId('clientA:1'));
      await new Promise((r) => setTimeout(r, 80));

      const state = runner.getState();
      expect(state.phase).toBe('ERROR');
      expect(state.activeJob).toBeNull();
      expect(state.lastError).toBeTruthy();
      expect(state.logs?.some((entry) => entry.level === 'error')).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('updates and validates preferredLanguages via POST /api/preferences', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-pref-'));
    const inputDir = path.join(tmpDir, 'input');
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    const cfg = loadConfig({
      CONFIG_DIR: configDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: tmpDir,
      OUTPUT_DOCUMENTARIES_DIR: tmpDir,
      OUTPUT_ANIMATED_MOVIES_DIR: tmpDir,
      OUTPUT_TV_SHOWS_DIR: tmpDir,
      OUTPUT_ANIMATED_SERIES_DIR: tmpDir
    });

    const runner = new JobRunner(cfg);
    await runner.init();

    const server = http.createServer(createRequestHandler(runner, tmpDir));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const addr = server.address() as { readonly port: number };
      const baseUrl = `http://127.0.0.1:${String(addr.port)}`;

      const okRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguages: ['eng', 'spa', 'native'] })
      });
      expect(okRes.status).toBe(200);
      const okPayload = (await okRes.json()) as { readonly preferredLanguages?: readonly string[] };
      expect(okPayload.preferredLanguages).toEqual(['eng', 'spa', 'native']);

      const badRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguages: ['invalid-lang'] })
      });
      expect(badRes.status).toBe(400);

      const stateRes = await fetch(`${baseUrl}/api/state`);
      const stateJson = (await stateRes.json()) as {
        readonly preferredLanguages?: readonly string[];
      };
      expect(stateJson.preferredLanguages).toEqual(['eng', 'spa', 'native']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back to os.tmpdir() for queue.json when CONFIG_DIR throws EACCES, emits a single warn log, and rehydrates on init()', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vo-queue-eacces-'));
    const inputDir = path.join(tmpDir, 'input');
    const readonlyConfigDir = path.join(tmpDir, 'readonly-cfg');
    const fallbackQueuePath = path.join(os.tmpdir(), 'plex-video-organizer-queue.json');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(readonlyConfigDir, { recursive: true });
    await fs.rm(fallbackQueuePath, { force: true });

    const srcFile = path.join(inputDir, 'Movie.2024.mkv');
    await fs.writeFile(srcFile, 'video-bytes');
    await fs.writeFile(
      path.join(readonlyConfigDir, 'queue.json'),
      JSON.stringify({
        revision: 2,
        items: [
          {
            id: 'item-1',
            sourcePath: srcFile,
            relativePath: 'Movie.2024.mkv',
            fileName: 'Movie.2024.mkv',
            mediaKind: 'movie',
            category: 'movies',
            include: false,
            parsedTitle: 'Movie',
            parsedYear: 2024,
            tags: [],
            episodeOrder: 'aired',
            probe: {
              formatName: 'matroska',
              durationSeconds: 100,
              sizeBytes: 11,
              bitrateBps: 1000,
              videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
              audioStreams: [],
              subtitleStreams: []
            },
            externalSubtitles: [],
            trackSelection: {
              audioTracks: [],
              subtitleMergeMode: 'keep-and-add',
              includedInternalSubtitles: [],
              externalSubtitleOrder: [],
              needsUserPrompt: false
            },
            candidates: [],
            selectedMetadata: { title: 'Movie', year: 2024, imdbId: 'tt1234567', source: 'imdb' },
            warnings: []
          }
        ]
      })
    );

    const cfg = loadConfig({
      CONFIG_DIR: readonlyConfigDir,
      INPUT_DIR: inputDir,
      OUTPUT_MOVIES_DIR: tmpDir,
      OUTPUT_ANIMATED_MOVIES_DIR: tmpDir,
      OUTPUT_TV_SHOWS_DIR: tmpDir,
      OUTPUT_ANIMATED_SERIES_DIR: tmpDir
    });

    const runner1 = new JobRunner(cfg);
    await runner1.init();

    const makeEacces = (): Error =>
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const isBlockedCfg = (target: unknown): boolean => String(target).includes('readonly-cfg');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origMkdir = fs.mkdir.bind(fs);
    const origWriteFile = fs.writeFile.bind(fs);
    const origReadFile = fs.readFile.bind(fs);
    const origAccess = fs.access.bind(fs);

    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockImplementation(async (p, opts) => {
      if (isBlockedCfg(p)) {
        throw makeEacces();
      }
      return origMkdir(p, opts);
    });
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (p, d, o) => {
      if (isBlockedCfg(p)) {
        throw makeEacces();
      }
      return origWriteFile(p, d, o);
    });
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (p, o) => {
      if (isBlockedCfg(p)) {
        throw makeEacces();
      }
      return origReadFile(p, o);
    });
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (p, mode) => {
      if (isBlockedCfg(p)) {
        throw makeEacces();
      }
      return origAccess(p, mode);
    });

    try {
      await runner1.patchItem(asClientId('client-1'), 2, asItemId('item-1'), { edition: 'IMAX' });
      await runner1.patchItem(asClientId('client-1'), 3, asItemId('item-1'), {
        edition: 'Unrated'
      });

      const state1 = runner1.getState();
      expect(state1.phase).not.toBe('ERROR');
      expect(state1.revision).toBe(4);
      const cfgWarnLogs = (state1.logs ?? []).filter(
        (l) => l.level === 'warn' && l.message.includes('CONFIG_DIR')
      );
      expect(cfgWarnLogs).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const persistedRaw = await origReadFile(fallbackQueuePath, 'utf8');
      const persisted = JSON.parse(persistedRaw) as { readonly revision: number };
      expect(persisted.revision).toBe(4);

      const runner2 = new JobRunner(cfg);
      await runner2.init();
      const state2 = runner2.getState();
      expect(state2.revision).toBe(4);
      expect(state2.items[0]?.edition).toBe('Unrated');
    } finally {
      accessSpy.mockRestore();
      readSpy.mockRestore();
      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
      warnSpy.mockRestore();
      await fs.rm(fallbackQueuePath, { force: true });
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
