// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useOrganizerStore } from '../../src/client/stores/organizerStore.ts';
import { asItemId, asTvdbId } from '../../src/domain/types.ts';

function makeBaseState(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'READY',
    revision: 3,
    lockOwnerClientId: null,
    mountPaths: {
      inputDir: '/data/input',
      movies: '/data/output/movies',
      documentaries: '/data/output/documentaries',
      'animated-movies': '/data/output/animated-movies',
      'tv-shows': '/data/output/tv-shows',
      'animated-series': '/data/output/animated-series'
    },
    items: [],
    activeJob: null,
    ...overrides
  };
}

describe('organizerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles theme mode and fetches server state with X-Client-Id header', async () => {
    localStorage.setItem('vo_theme_mode', 'light');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(makeBaseState()), { status: 200 }));

    const store = useOrganizerStore();
    const initialTheme = store.theme;
    store.toggleTheme();
    expect(store.theme).toBe(initialTheme === 'dark' ? 'light' : 'dark');
    store.toggleTheme();
    expect(store.theme).toBe(initialTheme);

    await store.fetchState();
    expect(store.revision).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles scan, patchItem, applyTracksToSeries, searchMetadata, preflight, startJob, unlock, and errors', async () => {
    const ep1 = {
      id: asItemId('ep-1'),
      sourcePath: '/in/Show.S01E01.mkv',
      relativeSourcePath: 'Show.S01E01.mkv',
      fileName: 'Show.S01E01.mkv',
      extension: '.mkv',
      mediaKind: 'tv',
      category: 'tv-shows',
      parsedTitle: 'Fallout',
      episodeOrder: 'aired',
      include: true,
      probe: {
        formatName: 'matroska',
        durationSeconds: 100,
        sizeBytes: 1000,
        bitrateBps: 1000,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
        audioStreams: [],
        subtitleStreams: []
      },
      externalSubtitles: [],
      trackSelection: {
        subtitleMergeMode: 'merge_all',
        audioTracks: [{ streamIndex: 1, language: 'eng', isDefault: true, include: true }],
        subtitleTracks: []
      },
      candidates: [],
      selectedMetadata: { title: 'Fallout', tvdbId: asTvdbId('416744'), source: 'tvdb' },
      needsUserPrompt: false,
      warnings: []
    };
    const ep2 = {
      ...ep1,
      id: asItemId('ep-2'),
      sourcePath: '/in/Show.S01E02.mkv',
      relativeSourcePath: 'Show.S01E02.mkv',
      fileName: 'Show.S01E02.mkv'
    };

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 4 }), { status: 202 })) // startScan
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeBaseState({ revision: 5, items: [ep1, ep2] })), {
          status: 200
        })
      ) // patchItem
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeBaseState({ revision: 6, items: [ep1, ep2] })), {
          status: 200
        })
      ) // applyTracksToSeries -> patchItem(ep2)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ title: 'Fallout', source: 'tvdb' }] }), {
          status: 200
        })
      ) // searchMetadata
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 7, ok: true, diskSpace: [], conflicts: [] }), {
          status: 200
        })
      ) // runPreflight
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobId: 'job-1', revision: 8 }), { status: 202 })
      ) // startJob
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeBaseState({ revision: 9, phase: 'IDLE' })), { status: 200 })
      ) // unlock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'LOCK_HELD',
            message: 'Locked by other',
            state: makeBaseState({ lockOwnerClientId: 'other:1' })
          }),
          { status: 409 }
        )
      ); // error branch

    const store = useOrganizerStore();
    await store.startScan();
    await store.patchItem(asItemId('ep-1'), { include: true });
    expect(store.items).toHaveLength(2);

    await store.applyTracksToSeries(store.items[0]!);
    const candidates = await store.searchMetadata({ query: 'Fallout', kind: 'tv' });
    expect(candidates).toHaveLength(1);

    const ok = await store.runPreflight();
    expect(ok).toBe(true);
    await store.startJob({});
    await store.unlock(true);
    expect(store.phase).toBe('IDLE');

    await expect(store.startScan()).rejects.toThrow('Locked by other');
    expect(store.isLockedByOther).toBe(true);

    // Fallback HTTP status error without message/state
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
    await expect(store.startScan()).rejects.toThrow('HTTP 500');
    expect(fetchSpy).toHaveBeenCalledTimes(9);
  });

  it('connects and disconnects SSE EventSource and handles state/progress/log events', async () => {
    const listeners = new Map<string, (evt: MessageEvent<string>) => void>();
    const closeSpy = vi.fn();
    class MockEventSource {
      constructor(_url: string) {}
      addEventListener(type: string, cb: (evt: MessageEvent<string>) => void) {
        listeners.set(type, cb);
      }
      close = closeSpy;
    }
    vi.stubGlobal('EventSource', MockEventSource);

    const store = useOrganizerStore();
    store.connectSse();
    listeners.get('state')?.(
      new MessageEvent('state', {
        data: JSON.stringify(
          makeBaseState({
            phase: 'PROCESSING',
            activeJob: { jobId: 'j1', totalItems: 1, completedItems: 0, currentPercent: 0 }
          })
        )
      })
    );
    expect(store.isBusy).toBe(true);

    listeners.get('progress')?.(
      new MessageEvent('progress', {
        data: JSON.stringify({
          jobId: 'j1',
          itemId: 'ep-1',
          percent: 45,
          etaSeconds: 12,
          stage: 'moving',
          stageLabel: 'Moving Show.S01E01.mkv (45%)',
          completedItems: 1,
          totalItems: 2
        })
      })
    );
    expect(store.activeJob?.currentPercent).toBe(45);
    expect(store.activeJob?.stage).toBe('moving');
    expect(store.activeJob?.stageLabel).toBe('Moving Show.S01E01.mkv (45%)');
    expect(store.activeJob?.completedItems).toBe(1);
    expect(store.activeJob?.totalItems).toBe(2);

    listeners.get('progress')?.(
      new MessageEvent('progress', {
        data: JSON.stringify({ jobId: 'other-job', itemId: 'ep-1', percent: 99 })
      })
    );
    expect(store.activeJob?.currentPercent).toBe(45);

    listeners.get('log')?.(
      new MessageEvent('log', {
        data: JSON.stringify({
          level: 'info',
          message: 'Remuxing',
          timestamp: '2026-01-01T00:00:00Z'
        })
      })
    );
    expect(store.logs).toHaveLength(1);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(makeBaseState({ logs: [] })), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(makeBaseState({ logs: [] })), { status: 200 })
        )
    );
    await store.clearLogs();
    expect(store.logs).toHaveLength(0);

    await store.patchItemsBulk([], { category: 'animated-series' });
    await store.patchItemsBulk([asItemId('ep-1'), asItemId('ep-2')], {
      category: 'animated-series'
    });

    await store.refreshPreflightSafely();
    store.setConflictResolutions({ [asItemId('ep-1')]: 'overwrite' });
    expect(store.savedConflictResolutions[asItemId('ep-1')]).toBe('overwrite');
    expect(store.hasUnresolvedConflicts).toBe(false);
    store.clearConflictResolutions();

    // Verify refreshPreflightSafely when an included item is present and conflict is returned
    listeners.get('state')?.(
      new MessageEvent('state', {
        data: JSON.stringify(
          makeBaseState({
            phase: 'READY',
            revision: 10,
            items: [
              {
                id: asItemId('ep-1'),
                sourcePath: '/in/ep1.mkv',
                relativePath: 'ep1.mkv',
                fileName: 'ep1.mkv',
                mediaKind: 'tv',
                category: 'tv-shows',
                include: true,
                parsedTitle: 'Show',
                tags: [],
                episodeOrder: 'aired',
                probe: {
                  formatName: 'matroska',
                  durationSeconds: 100,
                  sizeBytes: 100,
                  bitrateBps: 100,
                  videoStreams: [],
                  audioStreams: [],
                  subtitleStreams: []
                },
                externalSubtitles: [],
                candidates: [],
                trackSelection: {
                  audioTracks: [],
                  subtitleMergeMode: 'keep-and-add',
                  includedInternalSubtitles: [],
                  externalSubtitleOrder: [],
                  needsUserPrompt: false
                },
                warnings: []
              }
            ]
          })
        )
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            revision: 11,
            ok: false,
            diskSpace: [],
            conflicts: [
              {
                itemId: 'ep-1',
                kind: 'existing-file',
                destinationPath: '/out/ep1.mkv',
                incoming: {
                  formatName: 'matroska',
                  durationSeconds: 100,
                  sizeBytes: 100,
                  bitrateBps: 100,
                  videoStreams: [],
                  audioStreams: [],
                  subtitleStreams: []
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );
    await store.refreshPreflightSafely();
    expect(store.hasUnresolvedConflicts).toBe(true);
    store.setConflictResolutions({ [asItemId('ep-1')]: 'ignore' });
    expect(store.hasUnresolvedConflicts).toBe(false);

    listeners.get('state')?.(
      new MessageEvent('state', {
        data: JSON.stringify(
          makeBaseState({
            phase: 'ERROR',
            lastError: 'ffprobe not found',
            logs: [
              {
                level: 'error',
                message: 'Scan failed: ffprobe not found',
                timestamp: '2026-01-01T00:00:01Z'
              }
            ]
          })
        )
      })
    );
    expect(store.errorMessage).toBe('ffprobe not found');
    expect(store.logs).toHaveLength(1);
    store.clearError();
    expect(store.errorMessage).toBeNull();

    store.disconnectSse();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('handles storage fallbacks for client id and theme detection', async () => {
    const { getInitialThemeMode, getOrCreateClientId } =
      await import('../../src/client/utils/storage.ts');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(getInitialThemeMode()).toBe('light');
    expect(getOrCreateClientId()).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/i);
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('calls verifier scan and fix endpoints, handles SSE resync, and clears verifier errors', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { default: gsap } = await import('gsap');
    gsap.ticker.lagSmoothing(0);
    const { useOrganizerStore: createFreshOrganizerStore } =
      await import('../../src/client/stores/organizerStore.ts');
    setActivePinia(createPinia());
    const store = createFreshOrganizerStore();

    const sseListeners = new Map<string, (evt: Event) => void>();
    const MockEventSource = vi.fn(function (this: {
      addEventListener: (name: string, cb: (evt: Event) => void) => void;
      close: () => void;
    }) {
      this.addEventListener = (name, cb) => {
        sseListeners.set(name, cb);
      };
      this.close = vi.fn();
    });
    vi.stubGlobal('EventSource', MockEventSource);
    store.connectSse();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/verifier/scan')) {
        return new Response(JSON.stringify({ revision: 10 }), { status: 202 });
      }
      if (url.includes('/api/verifier/fix')) {
        return new Response(JSON.stringify({ revision: 11 }), { status: 202 });
      }
      return new Response(
        JSON.stringify(
          makeBaseState({
            verifier: {
              scanning: false,
              fixing: false,
              progress: null,
              summary: null,
              entries: [],
              lastFixResult: { renamedFiles: 0, renamedDirs: 0, errors: ['EACCES'] }
            }
          })
        ),
        { status: 200 }
      );
    });

    await store.scanVerifier();
    expect(store.verifierState.scanning).toBe(true);

    // Simulate SSE drop + reconnect and fallback poll
    sseListeners.get('error')?.(new Event('error'));
    sseListeners.get('open')?.(new Event('open'));
    for (let elapsed = 0; elapsed < 2200; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      gsap.ticker.tick();
    }

    await store.fixVerifier([]);
    const { asVerifierEntryId } = await import('../../src/domain/types.ts');
    await store.fixVerifier([asVerifierEntryId('tv-shows:Fallout')]);
    for (let elapsed = 0; elapsed < 2200; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      gsap.ticker.tick();
    }

    expect(store.verifierState.lastFixResult?.errors).toEqual(['EACCES']);
    store.clearVerifierErrors();
    expect(store.verifierState.lastFixResult?.errors).toEqual([]);

    store.disconnectSse();
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('formats ETA seconds into compact human-readable strings', async () => {
    const { formatEta } = await import('../../src/client/utils/formatters.ts');
    expect(formatEta(undefined)).toBe('');
    expect(formatEta(-5)).toBe('');
    expect(formatEta(42)).toBe('ETA 42s');
    expect(formatEta(125)).toBe('ETA 2m 5s');
    expect(formatEta(3725)).toBe('ETA 1h 2m');
  });

  it('persists and syncs preferredLanguages in storage and store', async () => {
    const storage = await import('../../src/client/utils/storage.ts');
    localStorage.clear();
    expect(storage.getInitialPreferredLanguages()).toEqual(['eng', 'spa', 'native']);

    localStorage.setItem('vo.preferredLanguages.v1', '{bad-json');
    expect(storage.loadSavedPreferredLanguages()).toBeNull();

    localStorage.setItem('vo.preferredLanguages.v1', JSON.stringify('not-an-array'));
    expect(storage.loadSavedPreferredLanguages()).toBeNull();

    localStorage.setItem('vo.preferredLanguages.v1', JSON.stringify(['invalid']));
    expect(storage.loadSavedPreferredLanguages()).toBeNull();

    storage.savePreferredLanguages(['eng', 'spa']);
    expect(storage.loadSavedPreferredLanguages()).toEqual(['eng', 'spa']);

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeBaseState({ preferredLanguages: ['eng', 'native'] })), {
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const store = useOrganizerStore();
    await store.setPreferredLanguages(['eng', 'native']);
    expect(store.preferredLanguages).toEqual(['eng', 'native']);
    expect(storage.loadSavedPreferredLanguages()).toEqual(['eng', 'native']);
    vi.unstubAllGlobals();
  });
});
