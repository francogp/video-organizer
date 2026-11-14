<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  METADATA_LANGUAGE_CODES,
  METADATA_LANGUAGE_LABELS,
  type AudioNormalizationMode,
  type JobPhase
} from '../domain/constants.ts';
import type {
  AudioNormalizationConfig,
  ConflictDecision,
  EpisodeOrderMode,
  ItemId,
  MediaKind,
  MetadataCandidate,
  MetadataLanguageCode,
  OutputCategory,
  ScannedItem,
  TrackSelection,
  VerifierEntryId
} from '../domain/types.ts';
import ConflictResolutionModal from './components/ConflictResolutionModal.vue';
import MetadataSearchModal from './components/MetadataSearchModal.vue';
import QueueTable from './components/QueueTable.vue';
import TrackInspectorModal from './components/TrackInspectorModal.vue';
import VerifierView from './components/VerifierView.vue';
import { useGsapMotion } from './composables/useGsapMotion.ts';
import { useOrganizerStore } from './stores/organizerStore.ts';
import { formatBuenosAiresTimestamp, formatEta } from './utils/formatters.ts';

declare const __APP_SEMVER__: string;

const store = useOrganizerStore();
const appSemver = typeof __APP_SEMVER__ === 'string' ? __APP_SEMVER__ : 'v1.0.0';

const PHASE_LABELS: ReadonlyMap<JobPhase, string> = new Map([
  ['IDLE', 'Idle'],
  ['SCANNING', 'Scanning'],
  ['READY', 'Ready'],
  ['PREFLIGHT_BLOCKED', 'Action Required'],
  ['PROCESSING', 'Processing'],
  ['ERROR', 'Error']
]);

function phaseLabel(phase: JobPhase): string {
  return PHASE_LABELS.get(phase) ?? phase;
}
const rootRef = ref<HTMLElement | null>(null);
const inspectingItem = ref<ScannedItem | null>(null);
const searchingItem = ref<ScannedItem | null>(null);
const bulkSearchingItems = ref<readonly ScannedItem[] | null>(null);
const selectedVerifierIds = ref<readonly VerifierEntryId[]>([]);
const conflictsOpen = ref(false);
const confirmUnlockOpen = ref(false);
const mountsExpanded = ref(false);
const activeTab = ref<'organizer' | 'verifier'>('organizer');

const { animateShellTimeline, animateEntrance } = useGsapMotion(rootRef);

onMounted(async (): Promise<void> => {
  await store.fetchState();
  store.connectSse();
  animateShellTimeline();
  await store.refreshPreflightSafely();
});

watch(
  () => store.phase,
  (nextPhase, prevPhase): void => {
    if (prevPhase === 'SCANNING' && nextPhase === 'READY') {
      void store.refreshPreflightSafely();
    }
  }
);

watch(
  (): number => store.items.length,
  (nextLen, prevLen): void => {
    if (nextLen > 0 && nextLen !== prevLen) {
      animateEntrance('.vo-queue-row');
    }
  }
);

onUnmounted((): void => {
  store.disconnectSse();
});

async function handleProcess(): Promise<void> {
  const ok = await store.runPreflight();
  if (ok || !store.hasUnresolvedConflicts) {
    await store.startJob(store.savedConflictResolutions);
  }
}

function handleResolveConflict(itemId: ItemId, decision: ConflictDecision): void {
  store.setConflictResolutions({
    ...store.savedConflictResolutions,
    [itemId]: decision
  });
}

function handleResolveAllConflicts(decision: ConflictDecision): void {
  const next: Partial<Record<ItemId, ConflictDecision>> = {};
  for (const conflict of store.preflightConflicts) {
    next[conflict.itemId] = decision;
  }
  store.setConflictResolutions(next);
}

async function patchItemAndRefresh(
  itemId: ItemId,
  patch: Parameters<typeof store.patchItem>[1]
): Promise<void> {
  await store.patchItem(itemId, patch);
  await store.refreshPreflightSafely();
}

async function handleConfirmConflicts(
  resolutions: Partial<Record<ItemId, ConflictDecision>>
): Promise<void> {
  conflictsOpen.value = false;
  await store.startJob(resolutions);
}

async function handleSaveTracks(selection: TrackSelection, applySeries: boolean): Promise<void> {
  const target = inspectingItem.value;
  if (!target) {
    return;
  }
  await store.patchItem(target.id, { trackSelection: selection });
  if (applySeries) {
    await store.applyTracksToSeries({ ...target, trackSelection: selection });
  }
  inspectingItem.value = null;
  await store.refreshPreflightSafely();
}

function handleOpenBulkMetadata(items: readonly ScannedItem[]): void {
  if (items.length === 0) {
    return;
  }
  bulkSearchingItems.value = items;
  searchingItem.value = items[0] ?? null;
}

async function handleBulkInclude(itemIds: readonly ItemId[], include: boolean): Promise<void> {
  await store.patchItemsBulk(itemIds, { include });
  await store.refreshPreflightSafely();
}

async function handleBulkMediaKind(
  itemIds: readonly ItemId[],
  mediaKind: MediaKind
): Promise<void> {
  await store.patchItemsBulk(itemIds, { mediaKind });
  await store.refreshPreflightSafely();
}

async function handleBulkCategory(
  itemIds: readonly ItemId[],
  category: OutputCategory
): Promise<void> {
  await store.patchItemsBulk(itemIds, { category });
  await store.refreshPreflightSafely();
}

async function handleBulkAudioNormalization(
  itemIds: readonly ItemId[],
  mode: AudioNormalizationMode
): Promise<void> {
  await store.patchItemsBulk(itemIds, {
    audioNormalization: { mode, codec: 'auto', downmixStereo: false }
  });
}

async function handleApplyMetadata(
  candidate: MetadataCandidate,
  episodeOrder: EpisodeOrderMode
): Promise<void> {
  const bulkTargets = bulkSearchingItems.value;
  if (bulkTargets && bulkTargets.length > 0) {
    await store.patchItemsBulk(
      bulkTargets.map((item) => item.id),
      { selectedMetadata: candidate, episodeOrder }
    );
    bulkSearchingItems.value = null;
    searchingItem.value = null;
    await store.refreshPreflightSafely();
    return;
  }
  const target = searchingItem.value;
  if (!target) {
    return;
  }
  await store.patchItem(target.id, { selectedMetadata: candidate, episodeOrder });
  searchingItem.value = null;
  await store.refreshPreflightSafely();
}

const includedQueueCount = computed(() => {
  let count = 0;
  for (const item of store.items) {
    if (item.include) {
      count += 1;
    }
  }
  return count;
});

const isCancellingJob = ref(false);

async function handleCancelJob(): Promise<void> {
  if (isCancellingJob.value) {
    return;
  }
  isCancellingJob.value = true;
  try {
    await store.unlock(false);
  } finally {
    isCancellingJob.value = false;
  }
}

const activeStageParts = computed<{ readonly step: string; readonly fileName: string }>(() => {
  const job = store.activeJob;
  if (!job?.stageLabel && !job?.currentFile) {
    return { step: '', fileName: '' };
  }
  const label = job.stageLabel ?? '';
  if (job.currentFile) {
    return {
      step: label,
      fileName: job.currentFile
    };
  }
  const dotIdx = label.lastIndexOf(' · ');
  if (dotIdx !== -1) {
    return {
      step: label.slice(0, dotIdx),
      fileName: label.slice(dotIdx + 3)
    };
  }
  const colonIdx = label.indexOf(': ');
  if (colonIdx !== -1) {
    return {
      step: label.slice(0, colonIdx),
      fileName: label.slice(colonIdx + 2)
    };
  }
  const currentItem = job.currentItemId
    ? store.items.find((item): boolean => item.id === job.currentItemId)
    : undefined;
  if (currentItem && label.endsWith(currentItem.fileName)) {
    return {
      step: label.slice(0, label.length - currentItem.fileName.length).trim(),
      fileName: currentItem.fileName
    };
  }
  return {
    step: label,
    fileName: currentItem?.fileName ?? ''
  };
});

async function handleForceUnlock(): Promise<void> {
  confirmUnlockOpen.value = false;
  await store.unlock(true);
}
const availableExtraLanguages = computed<readonly MetadataLanguageCode[]>(() =>
  METADATA_LANGUAGE_CODES.filter((code) => !store.preferredLanguages.includes(code))
);

function movePreferredLanguage(index: number, delta: -1 | 1): void {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= store.preferredLanguages.length) {
    return;
  }
  const next = [...store.preferredLanguages];
  const current = next[index];
  const target = next[nextIndex];
  if (!current || !target) {
    return;
  }
  next[index] = target;
  next[nextIndex] = current;
  void store.setPreferredLanguages(next);
}

function removePreferredLanguage(code: MetadataLanguageCode): void {
  if (store.preferredLanguages.length <= 1) {
    return;
  }
  void store.setPreferredLanguages(store.preferredLanguages.filter((c) => c !== code));
}

function handleAddPreferredLanguage(evt: Event): void {
  const select = evt.target as HTMLSelectElement;
  const value = select.value as MetadataLanguageCode | '';
  if (!value || store.preferredLanguages.includes(value)) {
    select.value = '';
    return;
  }
  void store.setPreferredLanguages([...store.preferredLanguages, value]);
  select.value = '';
}
</script>

<template>
  <main ref="rootRef" class="vo-shell">
    <header class="vo-header vo-panel">
      <div class="vo-header-left">
        <div>
          <div class="vo-title-row">
            <img
              :src="'/favicon.svg'"
              alt=""
              width="28"
              height="28"
              decoding="async"
              class="vo-brand-icon"
            />
            <h1>Plex Video Organizer</h1>
            <span class="vo-badge vo-badge--compact vo-mono" title="Application version">
              {{ appSemver }}
            </span>
            <span
              class="vo-badge vo-phase-badge"
              :data-phase="store.phase"
              :title="
                store.phase === 'PREFLIGHT_BLOCKED'
                  ? 'Pre-flight check found destination conflicts or insufficient disk space'
                  : undefined
              "
            >
              {{ phaseLabel(store.phase) }}
            </span>
          </div>
          <p class="vo-subtitle vo-mono">Client: {{ store.clientId }} · TZ: Buenos Aires (ART)</p>
        </div>
        <nav class="vo-tabs" role="tablist" aria-label="Workspace mode">
          <button
            type="button"
            role="tab"
            class="vo-tab"
            :aria-selected="activeTab === 'organizer'"
            :data-active="activeTab === 'organizer'"
            @click="activeTab = 'organizer'"
          >
            Organizer
            <span v-if="store.items.length > 0" class="vo-badge vo-badge--compact">
              {{ store.items.length }}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            class="vo-tab"
            :aria-selected="activeTab === 'verifier'"
            :data-active="activeTab === 'verifier'"
            @click="activeTab = 'verifier'"
          >
            Verifier
            <span
              v-if="store.verifierState.entries.length > 0"
              class="vo-badge vo-badge--danger vo-badge--compact"
            >
              {{ store.verifierState.entries.length }}
            </span>
          </button>
        </nav>
      </div>
      <div class="vo-header-actions">
        <button type="button" class="vo-btn" @click="mountsExpanded = !mountsExpanded">
          <span aria-hidden="true">{{ mountsExpanded ? '📂' : '📁' }}</span>
          {{ mountsExpanded ? 'Hide Mounts' : 'Mounts' }}
        </button>
        <button type="button" class="vo-btn" @click="store.toggleTheme()">
          <span aria-hidden="true">{{ store.theme === 'dark' ? '☀️' : '🌙' }}</span>
          {{ store.theme === 'dark' ? 'Light Mode' : 'Dark Mode' }}
        </button>
        <template v-if="activeTab === 'organizer'">
          <button
            type="button"
            class="vo-btn vo-btn--scan"
            :disabled="store.isLockedByOther || store.isBusy"
            @click="store.startScan()"
          >
            <span aria-hidden="true">🔍</span> Scan Input
          </button>
          <button
            type="button"
            class="vo-btn vo-btn--primary"
            :disabled="!store.canProcessQueue || store.hasUnresolvedConflicts"
            :title="
              store.hasUnresolvedConflicts
                ? 'Resolve all output conflicts in the table first'
                : store.canProcessQueue
                  ? 'Process included items'
                  : 'Resolve Match Candidate and Tracks for all included items first'
            "
            @click="handleProcess()"
          >
            <span aria-hidden="true">⚡</span>
            <span>Process Queue</span>
            <span class="vo-badge vo-badge--compact">{{ includedQueueCount }}</span>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="vo-btn vo-btn--scan"
            :disabled="
              store.isLockedByOther || store.verifierState.scanning || store.verifierState.fixing
            "
            @click="store.scanVerifier()"
          >
            <span aria-hidden="true">{{ store.verifierState.scanning ? '⏳' : '🔍' }}</span>
            {{ store.verifierState.scanning ? 'Scanning Libraries...' : 'Scan Libraries' }}
          </button>
          <button
            type="button"
            class="vo-btn vo-btn--primary"
            :disabled="
              store.isLockedByOther ||
              store.verifierState.scanning ||
              store.verifierState.fixing ||
              selectedVerifierIds.length === 0
            "
            @click="store.fixVerifier(selectedVerifierIds)"
          >
            <template v-if="store.verifierState.fixing">
              <span aria-hidden="true">⏳</span> Renaming...
            </template>
            <template v-else>
              <span aria-hidden="true">🔧</span>
              <span>Fix Selected (Rename)</span>
              <span class="vo-badge vo-badge--compact">{{ selectedVerifierIds.length }}</span>
            </template>
          </button>
        </template>
      </div>
    </header>

    <section v-if="mountsExpanded && store.mountPaths" class="vo-mounts vo-panel vo-mono">
      <div>input: {{ store.mountPaths.inputDir }}</div>
      <div>movies: {{ store.mountPaths.movies }}</div>
      <div>animated-movies: {{ store.mountPaths['animated-movies'] }}</div>
      <div>tv-shows: {{ store.mountPaths['tv-shows'] }}</div>
      <div>animated-series: {{ store.mountPaths['animated-series'] }}</div>
    </section>

    <section class="vo-lang-bar vo-panel" aria-label="Preferred Title Language Order">
      <span class="vo-lang-bar__label">Title Language Order</span>
      <div class="vo-lang-bar__chips">
        <span
          v-for="(lang, idx) in store.preferredLanguages"
          :key="lang"
          class="vo-lang-chip vo-mono"
        >
          <span class="vo-lang-chip__rank">{{ idx + 1 }}.</span>
          <span>{{ METADATA_LANGUAGE_LABELS[lang] }}</span>
          <button
            type="button"
            class="vo-lang-chip__btn"
            :disabled="idx === 0"
            :aria-label="`Move ${lang} earlier`"
            @click="movePreferredLanguage(idx, -1)"
          >
            ←
          </button>
          <button
            type="button"
            class="vo-lang-chip__btn"
            :disabled="idx === store.preferredLanguages.length - 1"
            :aria-label="`Move ${lang} later`"
            @click="movePreferredLanguage(idx, 1)"
          >
            →
          </button>
          <button
            v-if="store.preferredLanguages.length > 1"
            type="button"
            class="vo-lang-chip__btn vo-lang-chip__btn--remove"
            :aria-label="`Remove ${lang}`"
            @click="removePreferredLanguage(lang)"
          >
            ×
          </button>
        </span>
        <select
          v-if="availableExtraLanguages.length > 0"
          class="vo-lang-bar__select"
          aria-label="Add preferred title language"
          @change="handleAddPreferredLanguage"
        >
          <option value="">+ Add language</option>
          <option v-for="code in availableExtraLanguages" :key="code" :value="code">
            {{ METADATA_LANGUAGE_LABELS[code] }}
          </option>
        </select>
      </div>
    </section>

    <section v-if="store.isLockedByOther" class="vo-banner vo-panel">
      <span>
        Active session locked by <strong class="vo-mono">{{ store.lockOwnerClientId }}</strong>.
      </span>
      <div v-if="!confirmUnlockOpen">
        <button type="button" class="vo-btn vo-btn--danger" @click="confirmUnlockOpen = true">
          <span aria-hidden="true">🔓</span> Force Unlock
        </button>
      </div>
      <div v-else class="vo-header-actions">
        <span>Confirm overriding active session lock?</span>
        <button type="button" class="vo-btn vo-btn--danger" @click="handleForceUnlock()">
          <span aria-hidden="true">🔓</span> Confirm Unlock
        </button>
        <button type="button" class="vo-btn" @click="confirmUnlockOpen = false">
          <span aria-hidden="true">✖️</span> Cancel
        </button>
      </div>
    </section>

    <template v-if="activeTab === 'organizer'">
      <section
        class="vo-status-bar vo-panel"
        :class="{
          'vo-status-bar--busy': store.isBusy || store.activeJob,
          'vo-status-bar--error': Boolean(store.errorMessage)
        }"
        aria-live="polite"
      >
        <template v-if="store.isBusy || store.activeJob">
          <div class="vo-progress__stack">
            <div class="vo-progress__row">
              <button
                v-if="!store.isLockedByOther"
                type="button"
                class="vo-btn vo-btn--danger vo-progress__cancel"
                :disabled="isCancellingJob"
                @click="handleCancelJob"
              >
                <span aria-hidden="true">🛑</span>
                {{ isCancellingJob ? 'Cancelling...' : 'Cancel Job' }}
              </button>
              <div class="vo-progress__meta vo-mono">
                <template v-if="store.activeJob && store.activeJob.totalItems > 0">
                  {{ phaseLabel(store.phase) }} ({{ store.activeJob.jobId }}) ·
                  {{ store.activeJob.completedItems }}/{{ store.activeJob.totalItems }} ({{
                    store.activeJob.currentPercent
                  }}%){{
                    store.activeJob.etaSeconds !== undefined
                      ? ` · ${formatEta(store.activeJob.etaSeconds)}`
                      : ''
                  }}{{ activeStageParts.step ? ` · ${activeStageParts.step}` : '' }}
                </template>
                <template v-else> {{ phaseLabel(store.phase) }} · Scanning... </template>
              </div>
            </div>
            <div v-if="activeStageParts.fileName" class="vo-progress__file vo-mono">
              {{ activeStageParts.fileName }}
            </div>
            <progress
              v-if="store.activeJob && store.activeJob.totalItems > 0"
              class="vo-progress__bar"
              :value="store.activeJob.currentPercent"
              max="100"
            />
            <progress v-else class="vo-progress__bar" />
          </div>
        </template>
        <template v-else-if="store.errorMessage">
          <span class="vo-status-bar__error" role="alert">{{ store.errorMessage }}</span>
          <button type="button" class="vo-btn" @click="store.clearError()">
            <span aria-hidden="true">✖️</span> Dismiss
          </button>
        </template>
        <template v-else>
          <span class="vo-status-bar__idle vo-mono">
            Ready · {{ store.items.length }} item(s) in queue
          </span>
        </template>
      </section>

      <section class="vo-panel">
        <QueueTable
          :items="store.items"
          :disabled="store.isLockedByOther || store.isBusy"
          :conflicts="store.preflightConflicts"
          :conflict-resolutions="store.savedConflictResolutions"
          @toggle-include="(item, inc) => patchItemAndRefresh(item.id, { include: inc })"
          @change-media-kind="
            (item, kind: MediaKind) => patchItemAndRefresh(item.id, { mediaKind: kind })
          "
          @change-category="
            (item, cat: OutputCategory) => patchItemAndRefresh(item.id, { category: cat })
          "
          @change-edition="(item, ed: string) => patchItemAndRefresh(item.id, { edition: ed })"
          @change-candidate="
            (item, idx) =>
              item.candidates[idx] &&
              patchItemAndRefresh(item.id, { selectedMetadata: item.candidates[idx] })
          "
          @search-metadata="
            (item) => {
              bulkSearchingItems = null;
              searchingItem = item;
            }
          "
          @search-metadata-bulk="handleOpenBulkMetadata"
          @bulk-include="handleBulkInclude"
          @bulk-media-kind="handleBulkMediaKind"
          @bulk-category="handleBulkCategory"
          @change-audio-normalization="
            (item, audioNormalization: AudioNormalizationConfig) =>
              store.patchItem(item.id, { audioNormalization })
          "
          @bulk-audio-normalization="handleBulkAudioNormalization"
          @inspect-tracks="(item) => (inspectingItem = item)"
          @resolve-conflict="handleResolveConflict"
          @resolve-all-conflicts="handleResolveAllConflicts"
        />
      </section>
    </template>

    <VerifierView
      v-else
      :state="store.verifierState"
      :disabled="store.isLockedByOther"
      @update:selected-ids="(ids: readonly VerifierEntryId[]) => (selectedVerifierIds = ids)"
      @dismiss-error="store.clearVerifierErrors()"
    />

    <section class="vo-logs vo-panel" aria-label="Server logs">
      <div class="vo-logs__header">
        <h2>
          Server Logs
          <span class="vo-badge vo-badge--compact">{{ store.logs.length }}</span>
        </h2>
        <button
          type="button"
          class="vo-btn"
          :disabled="store.logs.length === 0"
          @click="store.clearLogs()"
        >
          <span aria-hidden="true">🧹</span> Clear
        </button>
      </div>
      <div v-if="store.logs.length === 0" class="vo-logs__empty vo-mono">
        No server logs yet. Click Scan Input or Process Queue to see activity.
      </div>
      <ul v-else class="vo-logs__list vo-mono">
        <li
          v-for="(entry, idx) in store.logs"
          :key="`${entry.timestamp}-${idx}`"
          class="vo-logs__item"
          :data-level="entry.level"
        >
          <time class="vo-logs__time" :datetime="entry.timestamp">{{
            formatBuenosAiresTimestamp(entry.timestamp)
          }}</time>
          <span class="vo-logs__level">[{{ entry.level.toUpperCase() }}]</span>
          <span class="vo-logs__msg">{{ entry.message }}</span>
        </li>
      </ul>
    </section>

    <MetadataSearchModal
      :item="searchingItem"
      :bulk-count="bulkSearchingItems?.length"
      :search-fn="store.searchMetadata"
      @close="
        () => {
          searchingItem = null;
          bulkSearchingItems = null;
        }
      "
      @apply="handleApplyMetadata"
    />

    <TrackInspectorModal
      :item="inspectingItem"
      @close="inspectingItem = null"
      @save="handleSaveTracks"
    />

    <ConflictResolutionModal
      :open="conflictsOpen"
      :conflicts="store.preflightConflicts"
      :disk-space="store.preflightDiskSpace"
      @close="conflictsOpen = false"
      @confirm="handleConfirmConflicts"
    />
  </main>
</template>

<style scoped lang="scss">
.vo-shell {
  display: grid;
  gap: var(--vo-space-3);
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  padding: var(--vo-space-2);
}

.vo-panel {
  min-width: 0;
  max-width: 100%;
}

.vo-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-4);
  padding: var(--vo-space-4);
  border: 1px solid var(--vo-border-highlight);
  border-radius: var(--vo-radius-lg);
  background: var(--vo-surface-gradient);
  box-shadow: var(--vo-shadow-panel);
  will-change: transform;

  h1 {
    margin: 0;
    font-size: var(--vo-text-lg);
  }
}

.vo-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-brand-icon {
  border-radius: var(--vo-radius-sm);
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
}

.vo-phase-badge {
  &[data-phase='READY'],
  &[data-phase='DONE'] {
    background-color: color-mix(in oklch, var(--vo-success) 14%, var(--vo-surface));
    color: var(--vo-success);
    border-color: color-mix(in oklch, var(--vo-success) 50%, var(--vo-border));
  }

  &[data-phase='SCANNING'],
  &[data-phase='PROCESSING'] {
    background-color: color-mix(in oklch, var(--vo-accent) 14%, var(--vo-surface));
    color: var(--vo-accent);
    border-color: color-mix(in oklch, var(--vo-accent) 50%, var(--vo-border));
  }

  &[data-phase='PREFLIGHT_BLOCKED'] {
    background-color: color-mix(in oklch, var(--vo-warning) 14%, var(--vo-surface));
    color: var(--vo-warning);
    border-color: color-mix(in oklch, var(--vo-warning) 50%, var(--vo-border));
  }

  &[data-phase='ERROR'] {
    background-color: color-mix(in oklch, var(--vo-danger) 14%, var(--vo-surface));
    color: var(--vo-danger);
    border-color: color-mix(in oklch, var(--vo-danger) 50%, var(--vo-border));
  }
}

.vo-lang-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  padding: var(--vo-space-2) var(--vo-space-3);
}

.vo-lang-bar__label {
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  font-weight: var(--vo-weight-semibold);
}

.vo-lang-bar__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-lang-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-1);
  padding: 2px var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background: color-mix(in oklch, var(--vo-accent) 8%, var(--vo-surface));
  font-size: var(--vo-text-xs);
}

.vo-lang-chip__rank {
  color: var(--vo-text-muted);
}

.vo-lang-chip__btn {
  padding: 0 3px;
  border: none;
  background: transparent;
  color: var(--vo-text-muted);
  cursor: pointer;

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &:hover:not(:disabled) {
    color: var(--vo-text);
  }
}

.vo-lang-chip__btn--remove:hover:not(:disabled) {
  color: var(--vo-danger);
}

.vo-lang-bar__select {
  padding: 2px var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background: var(--vo-surface);
  color: var(--vo-text);
  font-size: var(--vo-text-xs);
}

.vo-subtitle {
  margin: var(--vo-space-1) 0 0;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
}

.vo-header-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-4);
}

.vo-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  margin-inline-start: auto;
}

.vo-progress__row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: var(--vo-space-3);
  width: 100%;
}

.vo-progress__file {
  width: 100%;
  min-width: 0;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  overflow-wrap: anywhere;
}

.vo-progress__cancel {
  flex-shrink: 0;
}

.vo-tabs {
  display: inline-flex;
  gap: var(--vo-space-1);
  padding: var(--vo-space-1);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background: var(--vo-surface-elevated);
}

.vo-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-1);
  border: 1px solid transparent;
  border-radius: var(--vo-radius-sm);
  background: transparent;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-sm);
  font-weight: var(--vo-weight-semibold);
  padding-block: var(--vo-space-1);
  padding-inline: var(--vo-space-3);
  cursor: pointer;

  &[data-active='true'] {
    background: var(--vo-accent-gradient);
    color: var(--vo-accent-contrast);
  }
}

.vo-logs {
  display: grid;
  gap: var(--vo-space-3);
  padding: var(--vo-space-4);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-lg);
  background: var(--vo-surface-gradient);
  box-shadow: var(--vo-shadow-panel);
}

.vo-logs__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);

  h2 {
    margin: 0;
    font-size: var(--vo-text-md);
  }
}

.vo-logs__empty {
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
}

.vo-logs__list {
  display: grid;
  gap: var(--vo-space-1);
  max-height: 240px;
  margin: 0;
  padding: var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background-color: var(--vo-bg);
  font-size: var(--vo-text-xs);
  overflow-y: auto;
  list-style: none;
}

.vo-logs__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vo-space-2);
  line-height: 1.4;

  &[data-level='error'] {
    color: var(--vo-danger);
  }

  &[data-level='warn'] {
    color: var(--vo-warning);
  }
}

.vo-logs__time {
  color: var(--vo-text-muted);
}

.vo-logs__level {
  font-weight: var(--vo-weight-semibold);
}

.vo-logs__msg {
  overflow-wrap: anywhere;
}

.vo-mounts {
  display: grid;
  gap: var(--vo-space-2);
  padding: var(--vo-space-3) var(--vo-space-4);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background-color: var(--vo-surface);
  font-size: var(--vo-text-xs);
}
</style>
