import gsap from 'gsap';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type {
  ActiveJobProgress,
  ClientId,
  ConflictComparison,
  ConflictDecision,
  DiskSpaceCheck,
  EpisodeOrderMode,
  ItemId,
  ItemPatch,
  JobId,
  JobPhase,
  MediaKind,
  MetadataCandidate,
  MetadataLanguageCode,
  MountPathsMap,
  OrganizerStatePayload,
  ScannedItem,
  SseLogEvent,
  SseProgressEvent,
  VerifierEntryId,
  VerifierState
} from '../../domain/types.ts';
import {
  getInitialPreferredLanguages,
  getInitialThemeMode,
  getOrCreateClientId,
  loadSavedPreferredLanguages,
  savePreferredLanguages,
  saveThemeMode,
  type ThemeMode
} from '../utils/storage.ts';

const MAX_LOG_ENTRIES = 100;

export const useOrganizerStore = defineStore('organizer', () => {
  const clientId = ref<ClientId>(getOrCreateClientId() as ClientId);
  const theme = ref<ThemeMode>(getInitialThemeMode());
  const preferredLanguages = ref<readonly MetadataLanguageCode[]>(getInitialPreferredLanguages());
  const phase = ref<JobPhase>('IDLE');
  const revision = ref<number>(0);
  const lockOwnerClientId = ref<ClientId | null>(null);
  const mountPaths = ref<MountPathsMap | null>(null);
  const items = ref<ScannedItem[]>([]);
  const activeJob = ref<ActiveJobProgress | null>(null);
  const logs = ref<SseLogEvent[]>([]);
  const preflightConflicts = ref<ConflictComparison[]>([]);
  const preflightDiskSpace = ref<DiskSpaceCheck[]>([]);
  const savedConflictResolutions = ref<Partial<Record<ItemId, ConflictDecision>>>({});
  const verifierState = ref<VerifierState>({
    scanning: false,
    fixing: false,
    summary: null,
    entries: [],
    lastFixResult: null
  });
  const errorMessage = ref<string | null>(null);
  let eventSource: EventSource | null = null;

  const isLockedByOther = computed(
    (): boolean => lockOwnerClientId.value !== null && lockOwnerClientId.value !== clientId.value
  );

  const isBusy = computed(
    (): boolean => phase.value === 'SCANNING' || phase.value === 'PROCESSING'
  );

  const hasUnresolvedConflicts = computed((): boolean =>
    preflightConflicts.value.some(
      (c): boolean =>
        savedConflictResolutions.value[c.itemId] !== 'overwrite' &&
        savedConflictResolutions.value[c.itemId] !== 'ignore'
    )
  );

  const canProcessQueue = computed((): boolean => {
    if (isLockedByOther.value || isBusy.value) {
      return false;
    }
    const included = items.value.filter((item) => item.include);
    return (
      included.length > 0 &&
      included.every(
        (item): boolean =>
          Boolean(item.selectedMetadata?.title.trim()) && !item.trackSelection.needsUserPrompt
      )
    );
  });

  function applyThemeToDocument(mode: ThemeMode): void {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = mode;
    }
  }

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
    saveThemeMode(theme.value);
    applyThemeToDocument(theme.value);
  }

  function applyServerState(state: OrganizerStatePayload): void {
    phase.value = state.phase;
    revision.value = state.revision;
    lockOwnerClientId.value = state.lockOwnerClientId;
    mountPaths.value = state.mountPaths;
    items.value = [...state.items];
    activeJob.value = state.activeJob;
    if (Array.isArray(state.logs)) {
      logs.value = [...state.logs];
    }
    if (state.verifier) {
      verifierState.value = state.verifier;
    }
    if (state.preferredLanguages && state.preferredLanguages.length > 0) {
      preferredLanguages.value = state.preferredLanguages;
    }
    if (state.phase === 'ERROR' && state.lastError) {
      errorMessage.value = state.lastError;
    }
  }

  async function setPreferredLanguages(languages: readonly MetadataLanguageCode[]): Promise<void> {
    if (languages.length === 0) {
      return;
    }
    preferredLanguages.value = [...languages];
    savePreferredLanguages(languages);
    const next = await requestJson<OrganizerStatePayload>('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ preferredLanguages: languages })
    });
    applyServerState(next);
  }

  async function clearLogs(): Promise<void> {
    logs.value = [];
    const next = await requestJson<OrganizerStatePayload>('/api/logs/clear', { method: 'POST' });
    applyServerState(next);
  }

  function clearError(): void {
    errorMessage.value = null;
  }

  async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    errorMessage.value = null;
    const headers = new Headers(init.headers);
    headers.set('X-Client-Id', clientId.value);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const safeUrl = new URL(
      url,
      typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost'
    ).toString();
    const res = await fetch(safeUrl, { ...init, headers });
    const data = (await res.json()) as T & {
      readonly error?: string;
      readonly message?: string;
      readonly state?: OrganizerStatePayload;
    };
    if (!res.ok) {
      if (data.state) {
        applyServerState(data.state);
      }
      const msg = data.message ?? data.error ?? `HTTP ${String(res.status)}`;
      errorMessage.value = msg;
      throw new Error(msg);
    }
    return data;
  }

  async function fetchState(): Promise<void> {
    applyThemeToDocument(theme.value);
    const state = await requestJson<OrganizerStatePayload>('/api/state');
    applyServerState(state);
    const savedLangs = loadSavedPreferredLanguages();
    if (
      savedLangs &&
      JSON.stringify(savedLangs) !== JSON.stringify(state.preferredLanguages ?? [])
    ) {
      await setPreferredLanguages(savedLangs);
    }
  }

  function clearVerifierErrors(): void {
    if (!verifierState.value.lastFixResult) {
      return;
    }
    verifierState.value = {
      ...verifierState.value,
      lastFixResult: {
        ...verifierState.value.lastFixResult,
        errors: []
      }
    };
  }

  let sseHadError = false;
  let lastSseActivityAt = 0;
  let syncPollCall: gsap.core.Tween | null = null;
  const SSE_STALL_FALLBACK_MS = 2000;
  const MS_PER_SECOND = 1000;

  async function resyncStateSafely(): Promise<void> {
    try {
      await fetchState();
    } catch (err) {
      console.warn('[SSE resync]', err);
    }
  }

  function stopSyncFallback(): void {
    syncPollCall?.kill();
    syncPollCall = null;
  }

  function ensureSyncFallback(): void {
    if (syncPollCall !== null) {
      return;
    }
    const scheduleTick = (): void => {
      syncPollCall = gsap.delayedCall(SSE_STALL_FALLBACK_MS / MS_PER_SECOND, (): void => {
        syncPollCall = null;
        const stillRunning =
          isBusy.value ||
          Boolean(activeJob.value) ||
          verifierState.value.scanning ||
          verifierState.value.fixing;
        if (!stillRunning) {
          return;
        }
        if (performance.now() - lastSseActivityAt >= SSE_STALL_FALLBACK_MS) {
          lastSseActivityAt = performance.now();
          void resyncStateSafely();
        }
        scheduleTick();
      });
    };
    scheduleTick();
  }

  function connectSse(): void {
    if (eventSource || typeof EventSource === 'undefined') {
      return;
    }
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('open', (): void => {
      lastSseActivityAt = performance.now();
      if (sseHadError) {
        sseHadError = false;
        void resyncStateSafely();
      }
    });
    eventSource.addEventListener('error', (): void => {
      sseHadError = true;
    });
    eventSource.addEventListener('state', (evt): void => {
      lastSseActivityAt = performance.now();
      const payload = JSON.parse((evt as MessageEvent<string>).data) as OrganizerStatePayload;
      applyServerState(payload);
    });
    eventSource.addEventListener('progress', (evt): void => {
      lastSseActivityAt = performance.now();
      const prog = JSON.parse((evt as MessageEvent<string>).data) as SseProgressEvent;
      if (activeJob.value && activeJob.value.jobId === prog.jobId) {
        activeJob.value = {
          ...activeJob.value,
          currentItemId: prog.itemId ?? activeJob.value.currentItemId,
          currentFile: prog.currentFile ?? activeJob.value.currentFile,
          totalItems: prog.totalItems ?? activeJob.value.totalItems,
          completedItems: prog.completedItems ?? activeJob.value.completedItems,
          currentPercent: prog.percent,
          stage: prog.stage ?? activeJob.value.stage,
          stageLabel: prog.stageLabel ?? activeJob.value.stageLabel,
          etaSeconds: prog.etaSeconds
        };
      }
    });
    eventSource.addEventListener('log', (evt): void => {
      lastSseActivityAt = performance.now();
      const log = JSON.parse((evt as MessageEvent<string>).data) as SseLogEvent;
      logs.value = [...logs.value.slice(-(MAX_LOG_ENTRIES - 1)), log];
    });
  }

  function disconnectSse(): void {
    eventSource?.close();
    eventSource = null;
    stopSyncFallback();
  }

  function setConflictResolutions(
    resolutions: Readonly<Partial<Record<ItemId, ConflictDecision>>>
  ): void {
    savedConflictResolutions.value = { ...resolutions };
  }

  function clearConflictResolutions(): void {
    savedConflictResolutions.value = {};
  }

  async function refreshPreflightSafely(): Promise<void> {
    if (isLockedByOther.value || isBusy.value) {
      return;
    }
    const hasIncluded = items.value.some((item) => item.include);
    if (!hasIncluded) {
      preflightConflicts.value = [];
      preflightDiskSpace.value = [];
      return;
    }
    try {
      await runPreflight();
    } catch {
      // Non-fatal background check; explicit runPreflight() on process surfaces errors
    }
  }

  async function startScan(): Promise<void> {
    clearConflictResolutions();
    lastSseActivityAt = performance.now();
    await requestJson<{ readonly revision: number }>('/api/scan', { method: 'POST' });
    ensureSyncFallback();
  }

  async function scanVerifier(): Promise<void> {
    lastSseActivityAt = performance.now();
    verifierState.value = {
      ...verifierState.value,
      scanning: true,
      progress: {
        completed: 0,
        total: 0,
        percent: 0,
        stageLabel: 'Discovering libraries...'
      },
      lastFixResult: null
    };
    await requestJson<{ readonly revision: number }>('/api/verifier/scan', { method: 'POST' });
    ensureSyncFallback();
  }

  async function fixVerifier(entryIds: readonly VerifierEntryId[]): Promise<void> {
    if (entryIds.length === 0) {
      return;
    }
    lastSseActivityAt = performance.now();
    verifierState.value = {
      ...verifierState.value,
      fixing: true,
      progress: {
        completed: 0,
        total: entryIds.length,
        percent: 0,
        stageLabel: 'Applying bottom-up renames...'
      },
      lastFixResult: null
    };
    await requestJson<{ readonly revision: number }>('/api/verifier/fix', {
      method: 'POST',
      body: JSON.stringify({ entryIds })
    });
    ensureSyncFallback();
  }

  async function patchItem(itemId: ItemId, patch: ItemPatch): Promise<void> {
    clearConflictResolutions();
    const next = await requestJson<OrganizerStatePayload>(`/api/queue/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ revision: revision.value, patch })
    });
    applyServerState(next);
  }

  async function patchItemsBulk(itemIds: readonly ItemId[], patch: ItemPatch): Promise<void> {
    if (itemIds.length === 0) {
      return;
    }
    clearConflictResolutions();
    const next = await requestJson<OrganizerStatePayload>('/api/queue/items/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ revision: revision.value, itemIds, patch })
    });
    applyServerState(next);
  }

  async function applyTracksToSeries(sourceItem: ScannedItem): Promise<void> {
    const seriesTitle = sourceItem.parsedTitle;
    for (const item of items.value) {
      if (
        item.mediaKind === 'tv' &&
        item.parsedTitle === seriesTitle &&
        item.id !== sourceItem.id
      ) {
        await patchItem(item.id, {
          category: sourceItem.category,
          edition: sourceItem.edition,
          selectedMetadata: sourceItem.selectedMetadata,
          episodeOrder: sourceItem.episodeOrder,
          trackSelection: {
            ...item.trackSelection,
            subtitleMergeMode: sourceItem.trackSelection.subtitleMergeMode,
            audioTracks: item.trackSelection.audioTracks.map((t, idx) => ({
              ...t,
              language: sourceItem.trackSelection.audioTracks[idx]?.language ?? t.language,
              isDefault: sourceItem.trackSelection.audioTracks[idx]?.isDefault ?? t.isDefault
            }))
          }
        });
      }
    }
  }

  async function searchMetadata(params: {
    readonly query: string;
    readonly year?: number;
    readonly kind: MediaKind;
    readonly imdbId?: string;
    readonly tvdbId?: string;
    readonly episodeOrder?: EpisodeOrderMode;
  }): Promise<readonly MetadataCandidate[]> {
    const res = await requestJson<{ readonly candidates: readonly MetadataCandidate[] }>(
      '/api/metadata/search',
      {
        method: 'POST',
        body: JSON.stringify(params)
      }
    );
    return res.candidates;
  }

  async function runPreflight(): Promise<boolean> {
    const res = await requestJson<{
      readonly revision: number;
      readonly ok: boolean;
      readonly diskSpace: DiskSpaceCheck[];
      readonly conflicts: ConflictComparison[];
    }>('/api/preflight', {
      method: 'POST',
      body: JSON.stringify({ revision: revision.value })
    });
    revision.value = res.revision;
    preflightConflicts.value = res.conflicts;
    preflightDiskSpace.value = res.diskSpace;
    return res.ok;
  }

  async function startJob(
    conflictResolutions: Readonly<Partial<Record<ItemId, ConflictDecision>>> = {}
  ): Promise<void> {
    await requestJson<{ readonly jobId: JobId; readonly revision: number }>('/api/jobs/start', {
      method: 'POST',
      body: JSON.stringify({ revision: revision.value, conflictResolutions })
    });
  }

  async function unlock(force: boolean): Promise<void> {
    const next = await requestJson<OrganizerStatePayload>('/api/jobs/unlock', {
      method: 'POST',
      body: JSON.stringify({ force })
    });
    applyServerState(next);
  }

  return {
    clientId,
    theme,
    preferredLanguages,
    phase,
    revision,
    lockOwnerClientId,
    mountPaths,
    items,
    activeJob,
    logs,
    preflightConflicts,
    preflightDiskSpace,
    savedConflictResolutions,
    verifierState,
    hasUnresolvedConflicts,
    errorMessage,
    isLockedByOther,
    isBusy,
    canProcessQueue,
    toggleTheme,
    setPreferredLanguages,
    fetchState,
    connectSse,
    disconnectSse,
    startScan,
    scanVerifier,
    fixVerifier,
    patchItem,
    patchItemsBulk,
    applyTracksToSeries,
    searchMetadata,
    runPreflight,
    refreshPreflightSafely,
    setConflictResolutions,
    clearConflictResolutions,
    startJob,
    unlock,
    clearLogs,
    clearError,
    clearVerifierErrors
  };
});
