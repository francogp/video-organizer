<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  AUDIO_LOUDNORM_TARGET_I,
  AUDIO_LOUDNORM_TARGET_TP,
  AUDIO_MEAN_QUIET_THRESHOLD_DB,
  AUDIO_NORMALIZATION_MODES,
  AUDIO_OUTPUT_CODECS,
  MEDIA_KINDS,
  OUTPUT_CATEGORIES,
  type AudioNormalizationMode,
  type AudioOutputCodec
} from '../../domain/constants.ts';
import type {
  AudioNormalizationConfig,
  AudioTrackAnalysis,
  ConflictComparison,
  ConflictDecision,
  ItemId,
  MediaKind,
  OutputCategory,
  ScannedItem
} from '../../domain/types.ts';
import {
  CONFLICT_DECISION_OPTIONS,
  formatDuration,
  formatKbps,
  formatPlexOutputSegments,
  formatProbeStreams,
  formatSizeDeltaMb,
  formatSizeMb,
  splitRelativePathSegments
} from '../utils/formatters.ts';
import { areAllVisibleRowsSelected } from './table/tableQueryCore.ts';
import type { TableColumnDef, TableWorkerRowInput } from './table/tableTypes.js';
import { useTableWorker } from './table/useTableWorker.js';
import VirtualDataTable from './table/VirtualDataTable.vue';

type QueueColId =
  | 'select'
  | 'include'
  | 'source'
  | 'type'
  | 'category'
  | 'metadata'
  | 'size'
  | 'audio'
  | 'tracks';

const QUEUE_COLUMNS: readonly TableColumnDef<QueueColId>[] = [
  {
    id: 'select',
    label: '',
    defaultWidthPx: 42,
    minWidthPx: 38,
    resizable: false,
    reorderable: false,
    align: 'center'
  },
  { id: 'include', label: 'Include', defaultWidthPx: 116, minWidthPx: 96, sortable: true },
  {
    id: 'source',
    label: 'Source -> Plex Output',
    defaultWidthPx: 360,
    minWidthPx: 220,
    sortable: true
  },
  { id: 'type', label: 'Type', defaultWidthPx: 112, minWidthPx: 92, sortable: true },
  { id: 'category', label: 'Category', defaultWidthPx: 158, minWidthPx: 120, sortable: true },
  { id: 'metadata', label: 'Metadata Match', defaultWidthPx: 270, minWidthPx: 180 },
  { id: 'size', label: 'Size', defaultWidthPx: 100, minWidthPx: 84, sortable: true },
  { id: 'audio', label: 'Audio', defaultWidthPx: 275, minWidthPx: 210 },
  { id: 'tracks', label: 'Tracks', defaultWidthPx: 185, minWidthPx: 140 }
];

type SortKey = 'include' | 'title' | 'mediaKind' | 'category' | 'size';
type SortDir = 'ascending' | 'descending';

const props = defineProps<{
  readonly items: readonly ScannedItem[];
  readonly disabled: boolean;
  readonly conflicts?: readonly ConflictComparison[];
  readonly conflictResolutions?: Readonly<Partial<Record<ItemId, ConflictDecision>>>;
}>();

const emit = defineEmits<{
  (e: 'toggle-include', item: ScannedItem, include: boolean): void;
  (e: 'bulk-include', itemIds: readonly ItemId[], include: boolean): void;
  (e: 'change-media-kind', item: ScannedItem, kind: MediaKind): void;
  (e: 'change-category', item: ScannedItem, category: OutputCategory): void;
  (e: 'change-edition', item: ScannedItem, edition: string): void;
  (e: 'change-candidate', item: ScannedItem, idx: number): void;
  (e: 'search-metadata', item: ScannedItem): void;
  (e: 'search-metadata-bulk', items: readonly ScannedItem[]): void;
  (e: 'bulk-media-kind', itemIds: readonly ItemId[], kind: MediaKind): void;
  (e: 'bulk-category', itemIds: readonly ItemId[], category: OutputCategory): void;
  (e: 'inspect-tracks', item: ScannedItem): void;
  (e: 'change-audio-normalization', item: ScannedItem, config: AudioNormalizationConfig): void;
  (e: 'bulk-audio-normalization', itemIds: readonly ItemId[], mode: AudioNormalizationMode): void;
  (e: 'resolve-conflict', itemId: ItemId, decision: ConflictDecision): void;
  (e: 'resolve-all-conflicts', decision: ConflictDecision): void;
}>();

const conflictByItemId = computed<ReadonlyMap<ItemId, ConflictComparison>>(() => {
  const map = new Map<ItemId, ConflictComparison>();
  for (const conflict of props.conflicts ?? []) {
    map.set(conflict.itemId, conflict);
  }
  return map;
});

const CATEGORY_LABELS: Readonly<Record<OutputCategory, string>> = {
  movies: 'Movies',
  'animated-movies': 'Animated Movies',
  'tv-shows': 'Series',
  'animated-series': 'Animated Series'
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const searchQuery = ref('');
const kindFilter = ref<'all' | MediaKind>('all');
const categoryFilter = ref<'all' | OutputCategory>('all');
const sortKey = ref<SortKey | null>(null);
const sortDir = ref<SortDir>('ascending');
const selectedIds = ref<Set<ItemId>>(new Set());

interface FolderSummary {
  readonly prefix: string;
  readonly count: number;
}

function extractFolderPrefixes(relativePath: string): readonly string[] {
  const normalized = relativePath.replace(/\\/gu, '/');
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return [];
  }
  const prefixes: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    prefixes.push(parts.slice(0, i).join('/'));
  }
  return prefixes;
}

watch(
  () => props.items,
  (items): void => {
    const valid = new Set(items.map((item) => item.id));
    const next = new Set<ItemId>();
    for (const id of selectedIds.value) {
      if (valid.has(id)) {
        next.add(id);
      }
    }
    selectedIds.value = next;
  }
);

const availableFolders = computed<readonly FolderSummary[]>(() => {
  const counts = new Map<string, number>();
  for (const item of props.items) {
    for (const prefix of extractFolderPrefixes(item.relativePath)) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => collator.compare(a.prefix, b.prefix));
});

const selectedItems = computed<readonly ScannedItem[]>(() =>
  props.items.filter((item): boolean => selectedIds.value.has(item.id))
);

const selectedCount = computed((): number => selectedIds.value.size);

function toggleSelect(id: ItemId, checked: boolean): void {
  const next = new Set(selectedIds.value);
  if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selectedIds.value = next;
}

function clearSelection(): void {
  selectedIds.value = new Set();
}

function onSelectFolderChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const prefix = select.value;
  if (!prefix) {
    return;
  }
  const normalizedPrefix = `${prefix}/`;
  const next = new Set(selectedIds.value);
  for (const item of props.items) {
    const normalized = item.relativePath.replace(/\\/gu, '/');
    if (normalized.startsWith(normalizedPrefix)) {
      next.add(item.id);
    }
  }
  selectedIds.value = next;
  select.value = '';
}

function onBulkKindChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  if (!value || selectedIds.value.size === 0) {
    return;
  }
  emit('bulk-media-kind', [...selectedIds.value], value as MediaKind);
  select.value = '';
}

function onBulkCategoryChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  if (!value || selectedIds.value.size === 0) {
    return;
  }
  emit('bulk-category', [...selectedIds.value], value as OutputCategory);
  select.value = '';
}

const vTableRef = ref<InstanceType<typeof VirtualDataTable> | null>(null);
const { filteredIndices, setRows, runQuery } = useTableWorker();

function buildQueueWorkerRows(items: readonly ScannedItem[]): TableWorkerRowInput[] {
  const rows: TableWorkerRowInput[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) {
      continue;
    }
    rows.push({
      index: i,
      searchText: `${item.parsedTitle} ${item.relativePath} ${item.fileName}`.toLowerCase(),
      facetValues: {
        mediaKind: item.mediaKind,
        category: item.category
      },
      sortValues: {
        include: Number(item.include),
        title: item.parsedTitle || item.fileName,
        mediaKind: item.mediaKind,
        category: CATEGORY_LABELS[item.category],
        size: item.probe.sizeBytes
      }
    });
  }
  return rows;
}

function triggerQueueQuery(): void {
  runQuery({
    searchQuery: searchQuery.value,
    facetFilters: {
      mediaKind: kindFilter.value,
      category: categoryFilter.value
    },
    sortBy: sortKey.value,
    sortDir: sortDir.value === 'descending' ? 'desc' : 'asc'
  });
}

watch(
  () => props.items,
  (nextItems): void => {
    setRows(buildQueueWorkerRows(nextItems));
    triggerQueueQuery();
  },
  { immediate: true }
);

watch([searchQuery, kindFilter, categoryFilter, sortKey, sortDir], (): void => {
  triggerQueueQuery();
});

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'ascending' ? 'descending' : 'ascending';
    return;
  }
  sortKey.value = key;
  sortDir.value = 'ascending';
}

const allVisibleSelected = computed<boolean>(() =>
  areAllVisibleRowsSelected(filteredIndices.value, props.items, selectedIds.value)
);

const targetIncludeItems = computed<readonly ScannedItem[]>(() => {
  if (selectedIds.value.size > 0) {
    return props.items.filter((item) => selectedIds.value.has(item.id));
  }
  const visible: ScannedItem[] = [];
  for (const rawIdx of filteredIndices.value) {
    const item = props.items[rawIdx];
    if (item) {
      visible.push(item);
    }
  }
  return visible;
});

const allTargetIncluded = computed<boolean>(
  () => targetIncludeItems.value.length > 0 && targetIncludeItems.value.every((i) => i.include)
);

const someTargetIncluded = computed<boolean>(() => targetIncludeItems.value.some((i) => i.include));

function toggleIncludeTarget(include: boolean): void {
  const ids = targetIncludeItems.value
    .filter((item) => item.include !== include)
    .map((item) => item.id);
  if (ids.length > 0) {
    emit('bulk-include', ids, include);
  }
}

function toggleSelectVisible(checked: boolean): void {
  const next = new Set(selectedIds.value);
  const indices = filteredIndices.value;
  for (let i = 0; i < indices.length; i++) {
    const rawIdx = indices[i];
    const item = rawIdx !== undefined ? props.items[rawIdx] : undefined;
    if (!item) {
      continue;
    }
    if (checked) {
      next.add(item.id);
    } else {
      next.delete(item.id);
    }
  }
  selectedIds.value = next;
}

function getQueueRowKey(item: ScannedItem): string {
  return item.id;
}

function getQueueRowClass(item: ScannedItem): readonly string[] {
  const classes: string[] = ['vo-queue-row'];
  if (!item.include) {
    classes.push('vo-row--muted');
  }
  if (selectedIds.value.has(item.id)) {
    classes.push('vo-row--selected');
  }
  if (conflictByItemId.value.get(item.id)) {
    classes.push('vo-row--has-conflict');
    if (props.conflictResolutions?.[item.id]) {
      classes.push('vo-row--has-conflict-resolved');
    }
  }
  return classes;
}

const COL_TO_SORT_KEY: ReadonlyMap<QueueColId, SortKey> = new Map([
  ['include', 'include'],
  ['source', 'title'],
  ['type', 'mediaKind'],
  ['category', 'category'],
  ['size', 'size']
]);

function getQueueAriaSort(colId: QueueColId): 'ascending' | 'descending' | undefined {
  const key = COL_TO_SORT_KEY.get(colId);
  if (!key || sortKey.value !== key) {
    return undefined;
  }
  return sortDir.value;
}

function formatCandidateLabel(cand: ScannedItem['candidates'][number]): string {
  const yearPart = cand.year ? ` (${String(cand.year)})` : '';
  const idPart = cand.imdbId ? ` {${cand.imdbId}}` : cand.tvdbId ? ` {tvdb-${cand.tvdbId}}` : '';
  return `${cand.title}${yearPart}${idPart}`;
}

const DEFAULT_AUDIO_NORM: AudioNormalizationConfig = {
  mode: 'copy',
  codec: 'auto',
  downmixStereo: false
};

const AUDIO_MODE_LABELS: Readonly<Record<AudioNormalizationMode, string>> = {
  copy: 'Copy (original)',
  peak: 'Peak Gain',
  loudnorm: 'Loudnorm (2-pass)'
};

const AUDIO_CODEC_LABELS: Readonly<Record<AudioOutputCodec, string>> = {
  auto: 'Auto (original)',
  flac: 'FLAC (lossless)',
  ac3: 'AC3',
  aac: 'AAC'
};

function getAudioNorm(item: ScannedItem): AudioNormalizationConfig {
  return item.trackSelection.audioNormalization ?? DEFAULT_AUDIO_NORM;
}

const SURROUND_SIX_CHANNELS = 6;
const SURROUND_EIGHT_CHANNELS = 8;

function formatChannelLayout(channels: number): string {
  if (channels === SURROUND_SIX_CHANNELS) {
    return '5.1';
  }
  if (channels === SURROUND_EIGHT_CHANNELS) {
    return '7.1';
  }
  if (channels === 2) {
    return '2.0';
  }
  return `${String(channels)}ch`;
}

function hasActionableAudioSuggestion(item: ScannedItem): boolean {
  const analysis = getAudioSummary(item).analysis;
  return Boolean(analysis && analysis.suggestion !== 'ok');
}

function getAudioSummary(item: ScannedItem): {
  readonly codecText: string;
  readonly hasSurround: boolean;
  readonly analysis?: AudioTrackAnalysis;
} {
  const includedOrders = new Set(
    item.trackSelection.audioTracks.filter((t) => t.include).map((t) => t.streamOrder)
  );
  const includedStreams = item.probe.audioStreams.filter((s): boolean =>
    includedOrders.has(s.streamOrder)
  );
  const primaryStream = includedStreams[0] ?? item.probe.audioStreams[0];
  const codecText = primaryStream
    ? `${primaryStream.codecName.toUpperCase()} ${formatChannelLayout(primaryStream.channels)}`
    : 'No audio';
  const hasSurround = includedStreams.some((s): boolean => s.channels > 2);

  const analyses = (item.probe.audioAnalysis ?? []).filter((a): boolean =>
    includedOrders.has(a.streamOrder)
  );
  const actionable = analyses.find((a): boolean => a.suggestion !== 'ok');
  return {
    codecText,
    hasSurround,
    analysis: actionable ?? analyses[0]
  };
}

type AudioTone = 'bad' | 'good' | 'neutral';

interface AudioComparisonRow {
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
  readonly tone: AudioTone;
}

function getAudioComparisonRows(analysis: AudioTrackAnalysis): readonly AudioComparisonRow[] {
  const mean = analysis.meanVolumeDb.toFixed(1);
  const peak = analysis.maxVolumeDb.toFixed(1);
  const copyTone: AudioTone = analysis.suggestion === 'ok' ? 'good' : 'bad';
  const copyRow: AudioComparisonRow = {
    icon: copyTone === 'good' ? '✓' : '✗',
    label: 'Copy',
    detail: `Avg ${mean} · Peak ${peak} dB`,
    tone: copyTone
  };

  const gain = analysis.recommendedGainDb;
  let peakRow: AudioComparisonRow;
  if (gain <= 0) {
    peakRow = {
      icon: analysis.suggestion === 'ok' ? '•' : '✗',
      label: 'Peak',
      detail: 'No headroom (peak ~0 dB)',
      tone: analysis.suggestion === 'ok' ? 'neutral' : 'bad'
    };
  } else {
    const projMean = analysis.meanVolumeDb + gain;
    const projPeak = analysis.maxVolumeDb + gain;
    const peakEnough = projMean >= AUDIO_MEAN_QUIET_THRESHOLD_DB;
    peakRow = {
      icon: peakEnough ? '✓' : '⚠',
      label: `Peak +${gain.toFixed(1)}`,
      detail: peakEnough
        ? `Avg ${projMean.toFixed(1)} · Peak ${projPeak.toFixed(1)} dB`
        : `Avg ${projMean.toFixed(1)} dB (still quiet)`,
      tone: peakEnough ? 'good' : 'bad'
    };
  }

  const loudnormRow: AudioComparisonRow = {
    icon: analysis.suggestion === 'ok' ? '•' : '✓',
    label: 'Loudnorm',
    detail: `Avg ~${AUDIO_LOUDNORM_TARGET_I.toFixed(1)} · Peak ${AUDIO_LOUDNORM_TARGET_TP.toFixed(1)} dB`,
    tone: analysis.suggestion === 'ok' ? 'neutral' : 'good'
  };

  return [copyRow, peakRow, loudnormRow];
}

function formatAudioTooltip(analysis: AudioTrackAnalysis): string {
  const base = `volumedetect: mean ${String(analysis.meanVolumeDb)} dB, max ${String(analysis.maxVolumeDb)} dB.`;
  if (analysis.suggestion === 'peak-gain') {
    return `${base} Recommended: Peak Gain (+${String(analysis.recommendedGainDb)} dB) to raise volume cleanly without dynamic compression.`;
  }
  if (analysis.suggestion === 'loudnorm') {
    return `${base} Recommended: Loudnorm (2-pass EBU R128) to lift quiet dialogue and balance peaks.`;
  }
  return `${base} Audio levels are already well-balanced.`;
}

interface TracksSummary {
  readonly addedCount: number;
  readonly addedText: string;
  readonly keptCount: number;
  readonly keptText: string;
  readonly isReplace: boolean;
  readonly hasConflict: boolean;
  readonly conflictText: string;
}

function formatSubTag(sub: {
  readonly language: string;
  readonly isForced: boolean;
  readonly isHearingImpaired: boolean;
}): string {
  const flags: string[] = [];
  if (sub.isForced) {
    flags.push('forced');
  }
  if (sub.isHearingImpaired) {
    flags.push('sdh');
  }
  return flags.length > 0 ? `${sub.language} (${flags.join('/')})` : sub.language;
}

function getTracksSummary(item: ScannedItem): TracksSummary {
  const includedPaths = new Set(item.trackSelection.externalSubtitleOrder);
  const addedSubs = item.externalSubtitles.filter((s): boolean => includedPaths.has(s.path));
  const isReplace = item.trackSelection.subtitleMergeMode === 'replace';
  const keptInternalIds = new Set(item.trackSelection.includedInternalSubtitles);
  const keptInternal = isReplace
    ? []
    : item.probe.subtitleStreams.filter((s): boolean => keptInternalIds.has(s.streamOrder));

  return {
    addedCount: addedSubs.length,
    addedText: addedSubs.map(formatSubTag).join(', '),
    keptCount: keptInternal.length,
    keptText: keptInternal.map(formatSubTag).join(', '),
    isReplace,
    hasConflict: item.trackSelection.needsUserPrompt,
    conflictText: item.trackSelection.promptReason ?? 'Resolve subtitle conflict'
  };
}

function formatMetadataIds(cand: NonNullable<ScannedItem['selectedMetadata']>): string {
  const ids: string[] = [];
  if (cand.imdbId) {
    ids.push(`{imdb-${cand.imdbId}}`);
  }
  if (cand.tvdbId) {
    ids.push(`{tvdb-${cand.tvdbId}}`);
  }
  if (cand.tmdbId) {
    ids.push(`{tmdb-${cand.tmdbId}}`);
  }
  return ids.join(' ');
}

function updateAudioNorm(item: ScannedItem, partial: Partial<AudioNormalizationConfig>): void {
  const current = getAudioNorm(item);
  emit('change-audio-normalization', item, { ...current, ...partial });
}

function onBulkAudioChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const val = select.value as AudioNormalizationMode | '';
  if (!val) {
    return;
  }
  emit(
    'bulk-audio-normalization',
    selectedItems.value.map((i) => i.id),
    val
  );
  select.value = '';
}
</script>

<template>
  <div class="vo-table-wrap">
    <div class="vo-table-toolbar">
      <input
        v-model="searchQuery"
        type="search"
        class="vo-input vo-table-search"
        placeholder="Filter by title or file..."
        aria-label="Filter queue items"
      />
      <select v-model="kindFilter" class="vo-select" aria-label="Filter by media type">
        <option value="all">All types</option>
        <option v-for="kind in MEDIA_KINDS" :key="kind" :value="kind">
          {{ kind === 'tv' ? 'Series' : 'Movie' }}
        </option>
      </select>
      <select v-model="categoryFilter" class="vo-select" aria-label="Filter by library">
        <option value="all">All libraries</option>
        <option v-for="cat in OUTPUT_CATEGORIES" :key="cat" :value="cat">
          {{ CATEGORY_LABELS[cat] }}
        </option>
      </select>
      <template v-if="availableFolders.length > 0">
        <label for="vo-select-folder" class="vo-sr-only">Select folder</label>
        <select
          id="vo-select-folder"
          class="vo-select"
          :disabled="disabled"
          @change="onSelectFolderChange"
        >
          <option value="">Select folder...</option>
          <option v-for="folder in availableFolders" :key="folder.prefix" :value="folder.prefix">
            {{ folder.prefix }} ({{ folder.count }})
          </option>
        </select>
      </template>
      <button type="button" class="vo-btn" @click="vTableRef?.resetColumns()">
        <span aria-hidden="true">🔄</span> Reset Columns
      </button>
      <span class="vo-table-count vo-mono" aria-live="polite">
        Showing {{ filteredIndices.length }} of {{ props.items.length }}
      </span>
    </div>

    <div v-if="selectedCount > 0" class="vo-bulk-bar" role="region" aria-label="Bulk actions">
      <span class="vo-bulk-count vo-mono">{{ selectedCount }} selected</span>
      <select
        class="vo-select"
        aria-label="Bulk set type"
        :disabled="disabled"
        @change="onBulkKindChange"
      >
        <option value="">Set Type...</option>
        <option v-for="kind in MEDIA_KINDS" :key="kind" :value="kind">
          {{ kind === 'tv' ? 'Series' : 'Movie' }}
        </option>
      </select>
      <select
        class="vo-select"
        aria-label="Bulk set library"
        :disabled="disabled"
        @change="onBulkCategoryChange"
      >
        <option value="">Set Library...</option>
        <option v-for="cat in OUTPUT_CATEGORIES" :key="cat" :value="cat">
          {{ CATEGORY_LABELS[cat] }}
        </option>
      </select>
      <select
        class="vo-select"
        aria-label="Bulk set audio normalization"
        :disabled="disabled"
        @change="onBulkAudioChange"
      >
        <option value="">Set Audio...</option>
        <option v-for="mode in AUDIO_NORMALIZATION_MODES" :key="mode" :value="mode">
          {{ AUDIO_MODE_LABELS[mode] }}
        </option>
      </select>
      <button
        type="button"
        class="vo-btn"
        :disabled="disabled"
        @click="emit('search-metadata-bulk', selectedItems)"
      >
        <span aria-hidden="true">🔍</span> Search Match
      </button>
      <button type="button" class="vo-btn" @click="clearSelection">
        <span aria-hidden="true">🧹</span> Clear
      </button>
    </div>

    <div
      v-if="(props.conflicts?.length ?? 0) > 0"
      class="vo-conflict-banner-bar"
      role="region"
      aria-label="Output conflicts"
    >
      <span class="vo-conflict-banner-title vo-mono">
        ⚠ {{ props.conflicts!.length }} output conflict(s) detected — resolve every conflict in the
        table before processing
      </span>
      <div class="vo-conflict-banner-actions">
        <button
          type="button"
          class="vo-btn"
          :disabled="disabled"
          @click="emit('resolve-all-conflicts', 'overwrite')"
        >
          <span aria-hidden="true">✅</span> Overwrite All Conflicts
        </button>
        <button
          type="button"
          class="vo-btn"
          :disabled="disabled"
          @click="emit('resolve-all-conflicts', 'ignore')"
        >
          <span aria-hidden="true">⏭️</span> Ignore All Conflicts
        </button>
      </div>
    </div>

    <VirtualDataTable
      ref="vTableRef"
      table-id="queue"
      :columns="QUEUE_COLUMNS"
      :rows="props.items"
      :indices="filteredIndices"
      :get-row-key="getQueueRowKey"
      :get-row-class="getQueueRowClass"
      :get-aria-sort="getQueueAriaSort"
      :estimated-row-height="136"
      :empty-message="
        props.items.length === 0
          ? 'Queue is empty. Click Scan Input to discover media files.'
          : 'No media items match the current filters.'
      "
    >
      <template #header-select>
        <label for="vo-select-all-visible" class="vo-sr-only">Select all visible</label>
        <input
          id="vo-select-all-visible"
          type="checkbox"
          :checked="allVisibleSelected"
          :disabled="disabled || filteredIndices.length === 0"
          @change="toggleSelectVisible(($event.target as HTMLInputElement).checked)"
        />
      </template>

      <template #header-include>
        <div class="vo-include-header">
          <label for="vo-include-all" class="vo-sr-only">
            {{ selectedIds.size > 0 ? 'Include selected items' : 'Include all visible items' }}
          </label>
          <input
            id="vo-include-all"
            type="checkbox"
            :checked="allTargetIncluded"
            :indeterminate.prop="someTargetIncluded && !allTargetIncluded"
            :disabled="disabled || targetIncludeItems.length === 0"
            :title="
              selectedIds.size > 0
                ? 'Toggle Include for selected items'
                : 'Toggle Include for all visible items'
            "
            @change="toggleIncludeTarget(($event.target as HTMLInputElement).checked)"
          />
          <button type="button" class="vo-sort-btn" @click="toggleSort('include')">
            Include
            <span v-if="sortKey === 'include'" class="vo-sort-indicator" aria-hidden="true">
              {{ sortDir === 'ascending' ? '▲' : '▼' }}
            </span>
          </button>
        </div>
      </template>

      <template #header-source>
        <button type="button" class="vo-sort-btn" @click="toggleSort('title')">
          Source File
          <span v-if="sortKey === 'title'" class="vo-sort-indicator" aria-hidden="true">
            {{ sortDir === 'ascending' ? '▲' : '▼' }}
          </span>
        </button>
      </template>

      <template #header-type>
        <button type="button" class="vo-sort-btn" @click="toggleSort('mediaKind')">
          Type
          <span v-if="sortKey === 'mediaKind'" class="vo-sort-indicator" aria-hidden="true">
            {{ sortDir === 'ascending' ? '▲' : '▼' }}
          </span>
        </button>
      </template>

      <template #header-category>
        <button type="button" class="vo-sort-btn" @click="toggleSort('category')">
          Library
          <span v-if="sortKey === 'category'" class="vo-sort-indicator" aria-hidden="true">
            {{ sortDir === 'ascending' ? '▲' : '▼' }}
          </span>
        </button>
      </template>

      <template #header-size>
        <button type="button" class="vo-sort-btn" @click="toggleSort('size')">
          Size
          <span v-if="sortKey === 'size'" class="vo-sort-indicator" aria-hidden="true">
            {{ sortDir === 'ascending' ? '▲' : '▼' }}
          </span>
        </button>
      </template>

      <template #cell-select="{ row }">
        <label :for="`sel-${row.id}`" class="vo-sr-only">Select {{ row.fileName }}</label>
        <input
          :id="`sel-${row.id}`"
          type="checkbox"
          :checked="selectedIds.has(row.id)"
          :disabled="disabled"
          @change="toggleSelect(row.id, ($event.target as HTMLInputElement).checked)"
        />
      </template>

      <template #cell-include="{ row }">
        <label :for="`inc-${row.id}`" class="vo-sr-only">Include {{ row.fileName }}</label>
        <input
          :id="`inc-${row.id}`"
          type="checkbox"
          :checked="row.include"
          :disabled="disabled"
          @change="emit('toggle-include', row, ($event.target as HTMLInputElement).checked)"
        />
      </template>

      <template #cell-source="{ row }">
        <div class="vo-file-cell">
          <div class="vo-file-header">
            <span class="vo-file-title">{{ row.parsedTitle }}</span>
            <span v-if="row.parsedYear" class="vo-badge vo-mono">
              {{ row.parsedYear }}
            </span>
            <span v-if="row.episode" class="vo-badge vo-mono">
              s{{ String(row.episode.seasonNumber).padStart(2, '0') }}e{{
                String(row.episode.episodeStart).padStart(2, '0')
              }}
            </span>
            <span v-if="row.extraType" class="vo-badge vo-badge--warn">
              Extra: {{ row.extraType }}
            </span>
            <span v-for="tag in row.tags" :key="tag" class="vo-badge vo-mono">
              {{ tag }}
            </span>
          </div>
          <div class="vo-path-panels vo-mono">
            <div class="vo-path-panel vo-path-panel--source">
              <span class="vo-path-label">Source</span>
              <div class="vo-path-chain">
                <template
                  v-for="(folder, fIdx) in splitRelativePathSegments(row.relativePath).folders"
                  :key="`sf-${String(fIdx)}`"
                >
                  <span class="vo-path-pill vo-path-pill--folder" title="Source Folder">
                    {{ folder }}
                  </span>
                  <span class="vo-path-sep" aria-hidden="true">›</span>
                </template>
                <span class="vo-path-pill vo-path-pill--file" title="Source File">
                  {{ splitRelativePathSegments(row.relativePath).fileName }}
                </span>
              </div>
            </div>

            <div v-if="formatPlexOutputSegments(row)" class="vo-path-panel vo-path-panel--output">
              <span class="vo-path-label vo-path-label--output">Output</span>
              <div class="vo-path-chain">
                <template
                  v-for="(folder, oIdx) in formatPlexOutputSegments(row)!.folders"
                  :key="`of-${String(oIdx)}`"
                >
                  <span class="vo-path-pill vo-path-pill--out-folder" title="Destination Folder">
                    {{ folder }}
                  </span>
                  <span class="vo-path-sep" aria-hidden="true">›</span>
                </template>
                <span class="vo-path-pill vo-path-pill--out-file" title="Destination File">
                  {{ formatPlexOutputSegments(row)!.fileName }}
                </span>
              </div>
            </div>

            <div v-else class="vo-path-panel vo-path-panel--unresolved">
              <span class="vo-path-label vo-path-label--unresolved">Output</span>
              <span class="vo-file-output--unresolved">
                Unresolved — select or search a Match Candidate
              </span>
            </div>
          </div>
          <div class="vo-edition-wrap">
            <label :for="`ed-${row.id}`" class="vo-sr-only">Edition for {{ row.fileName }}</label>
            <input
              :id="`ed-${row.id}`"
              type="text"
              class="vo-edition-input"
              :value="row.edition ?? ''"
              :disabled="disabled"
              placeholder="Edition (optional)"
              title="Optional Plex edition tag (e.g. Director's Cut, Extended, IMAX, Unrated). Adds {edition-...} so Plex keeps multiple editions distinct."
              @change="
                emit('change-edition', row, ($event.target as HTMLInputElement).value.trim())
              "
            />
            <span
              class="vo-help-tip vo-mono"
              title="Plex Edition guide: Leave empty for standard releases. Enter a short tag like 'Director's Cut', 'Extended', 'IMAX', or 'Unrated' to append {edition-...} to the Plex folder/filename."
              >?</span
            >
          </div>
          <div v-if="row.warnings.length > 0" class="vo-badge vo-badge--warn">
            {{ row.warnings[0] }}
          </div>
        </div>
      </template>

      <template #cell-type="{ row }">
        <label :for="`kind-${row.id}`" class="vo-sr-only">Media kind for {{ row.fileName }}</label>
        <select
          :id="`kind-${row.id}`"
          class="vo-select"
          :value="row.mediaKind"
          :disabled="disabled"
          @change="
            emit('change-media-kind', row, ($event.target as HTMLSelectElement).value as MediaKind)
          "
        >
          <option v-for="kind in MEDIA_KINDS" :key="kind" :value="kind">
            {{ kind === 'tv' ? 'Series' : 'Movie' }}
          </option>
        </select>
      </template>

      <template #cell-category="{ row }">
        <label :for="`cat-${row.id}`" class="vo-sr-only">Category for {{ row.fileName }}</label>
        <select
          :id="`cat-${row.id}`"
          class="vo-select"
          :value="row.category"
          :disabled="disabled"
          @change="
            emit(
              'change-category',
              row,
              ($event.target as HTMLSelectElement).value as OutputCategory
            )
          "
        >
          <option v-for="cat in OUTPUT_CATEGORIES" :key="cat" :value="cat">
            {{ CATEGORY_LABELS[cat] }}
          </option>
        </select>
      </template>

      <template #cell-metadata="{ row }">
        <div class="vo-audio-cell">
          <div
            class="vo-audio-panel"
            :class="row.selectedMetadata ? 'vo-audio-panel--ok' : 'vo-audio-panel--bad'"
            :title="
              row.selectedMetadata
                ? formatCandidateLabel(row.selectedMetadata)
                : 'No metadata match selected — use Search to match this item'
            "
          >
            <div class="vo-audio-panel-head">
              <span class="vo-path-label">MATCH</span>
              <span class="vo-path-pill vo-path-pill--folder vo-mono">{{
                row.selectedMetadata ? row.selectedMetadata.source.toUpperCase() : 'Unmatched'
              }}</span>
            </div>
            <div class="vo-audio-lines vo-mono">
              <template v-if="row.selectedMetadata">
                <div class="vo-audio-option vo-audio-option--good">
                  <span class="vo-audio-option-icon" aria-hidden="true">✓</span>
                  <span class="vo-audio-option-label">{{ row.selectedMetadata.title }}</span>
                  <span v-if="row.selectedMetadata.year">({{ row.selectedMetadata.year }})</span>
                </div>
                <div
                  v-if="formatMetadataIds(row.selectedMetadata)"
                  class="vo-audio-option vo-audio-option--neutral"
                >
                  <span class="vo-audio-option-icon" aria-hidden="true">#</span>
                  <span class="vo-audio-option-label">ID:</span>
                  <span>{{ formatMetadataIds(row.selectedMetadata) }}</span>
                </div>
              </template>
              <div v-else class="vo-audio-option vo-audio-option--bad">
                <span class="vo-audio-option-icon" aria-hidden="true">✗</span>
                <span class="vo-audio-option-label">No match:</span>
                <span>Click Search to match</span>
              </div>
            </div>
          </div>
          <div class="vo-meta-controls">
            <label :for="`meta-${row.id}`" class="vo-sr-only">Match for {{ row.fileName }}</label>
            <select
              :id="`meta-${row.id}`"
              class="vo-select vo-select--candidate"
              :title="row.selectedMetadata ? formatCandidateLabel(row.selectedMetadata) : undefined"
              :disabled="disabled || row.candidates.length === 0"
              @change="
                emit('change-candidate', row, Number(($event.target as HTMLSelectElement).value))
              "
            >
              <option v-if="row.candidates.length === 0" value="-1">No match found</option>
              <option
                v-for="(cand, idx) in row.candidates"
                :key="`${cand.source}-${String(idx)}`"
                :value="idx"
                :selected="cand === row.selectedMetadata"
              >
                {{ formatCandidateLabel(cand) }}
              </option>
            </select>
            <button
              type="button"
              class="vo-btn vo-meta-search-btn"
              :disabled="disabled"
              @click="emit('search-metadata', row)"
            >
              <span aria-hidden="true">🔍</span> Search
            </button>
          </div>
        </div>
      </template>

      <template #cell-size="{ row }">
        <span class="vo-mono vo-size-cell">{{ formatSizeMb(row.probe.sizeBytes) }}</span>
      </template>

      <template #cell-audio="{ row }">
        <div class="vo-audio-cell">
          <div
            class="vo-audio-panel"
            :class="
              !getAudioSummary(row).analysis
                ? 'vo-audio-panel--pending'
                : getAudioSummary(row).analysis!.suggestion === 'loudnorm'
                  ? 'vo-audio-panel--loudnorm'
                  : getAudioSummary(row).analysis!.suggestion === 'peak-gain'
                    ? 'vo-audio-panel--peak'
                    : 'vo-audio-panel--ok'
            "
            :title="
              getAudioSummary(row).analysis
                ? formatAudioTooltip(getAudioSummary(row).analysis!)
                : 'Click Scan Input to run volumedetect analysis'
            "
          >
            <div class="vo-audio-panel-head">
              <span class="vo-path-label">AUDIO</span>
              <span class="vo-path-pill vo-path-pill--folder vo-mono">{{
                getAudioSummary(row).codecText
              }}</span>
            </div>
            <div v-if="getAudioSummary(row).analysis" class="vo-audio-lines vo-mono">
              <div
                v-for="aRow in getAudioComparisonRows(getAudioSummary(row).analysis!)"
                :key="aRow.label"
                class="vo-audio-option"
                :class="`vo-audio-option--${aRow.tone}`"
              >
                <span class="vo-audio-option-icon" aria-hidden="true">{{ aRow.icon }}</span>
                <span class="vo-audio-option-label">{{ aRow.label }}:</span>
                <span>{{ aRow.detail }}</span>
              </div>
            </div>
            <div v-else class="vo-audio-status vo-audio-status--pending vo-mono">
              <span>Not analyzed · click Scan Input</span>
            </div>
          </div>
          <div class="vo-audio-controls">
            <label :for="`aud-mode-${row.id}`" class="vo-sr-only"
              >Audio normalization for {{ row.fileName }}</label
            >
            <select
              :id="`aud-mode-${row.id}`"
              class="vo-select vo-select--audio"
              :value="getAudioNorm(row).mode"
              :disabled="disabled || row.probe.audioStreams.length === 0"
              @change="
                updateAudioNorm(row, {
                  mode: ($event.target as HTMLSelectElement).value as AudioNormalizationMode
                })
              "
            >
              <option v-for="mode in AUDIO_NORMALIZATION_MODES" :key="mode" :value="mode">
                {{
                  mode === 'peak' &amp;&amp;
                  (getAudioSummary(row).analysis?.recommendedGainDb ?? 0) > 0
                    ? `Peak (+${getAudioSummary(row).analysis!.recommendedGainDb.toFixed(1)} dB)`
                    : AUDIO_MODE_LABELS[mode]
                }}
              </option>
            </select>
            <template v-if="getAudioNorm(row).mode !== 'copy'">
              <label :for="`aud-codec-${row.id}`" class="vo-sr-only"
                >Audio codec for {{ row.fileName }}</label
              >
              <select
                :id="`aud-codec-${row.id}`"
                class="vo-select vo-select--audio"
                :value="getAudioNorm(row).codec"
                :disabled="disabled"
                @change="
                  updateAudioNorm(row, {
                    codec: ($event.target as HTMLSelectElement).value as AudioOutputCodec
                  })
                "
              >
                <option v-for="codec in AUDIO_OUTPUT_CODECS" :key="codec" :value="codec">
                  {{ AUDIO_CODEC_LABELS[codec] }}
                </option>
              </select>
            </template>
            <label
              v-if="getAudioSummary(row).hasSurround"
              class="vo-audio-downmix vo-mono"
              title="Downmix 5.1/7.1 surround to 2.0 stereo (-ac 2)"
            >
              <input
                type="checkbox"
                :checked="getAudioNorm(row).downmixStereo"
                :disabled="disabled"
                @change="
                  updateAudioNorm(row, {
                    downmixStereo: ($event.target as HTMLInputElement).checked
                  })
                "
              />
              <span>2.0</span>
            </label>
          </div>
        </div>
      </template>

      <template #cell-tracks="{ row }">
        <div class="vo-audio-cell">
          <div
            v-if="getTracksSummary(row).hasConflict || getTracksSummary(row).addedCount > 0"
            class="vo-audio-panel"
            :class="
              getTracksSummary(row).hasConflict ? 'vo-audio-panel--bad' : 'vo-audio-panel--ok'
            "
            :title="
              getTracksSummary(row).hasConflict
                ? getTracksSummary(row).conflictText
                : `Adding external subtitles: ${getTracksSummary(row).addedText}`
            "
          >
            <div class="vo-audio-panel-head">
              <span class="vo-path-label">SUBS</span>
              <span class="vo-path-pill vo-path-pill--folder vo-mono">{{
                getTracksSummary(row).hasConflict
                  ? 'Conflict'
                  : `+${String(getTracksSummary(row).addedCount)} new`
              }}</span>
            </div>
            <div class="vo-audio-lines vo-mono">
              <div
                v-if="getTracksSummary(row).hasConflict"
                class="vo-audio-option vo-audio-option--bad"
              >
                <span class="vo-audio-option-icon" aria-hidden="true">✗</span>
                <span class="vo-audio-option-label">Conflict:</span>
                <span>{{ getTracksSummary(row).conflictText }}</span>
              </div>
              <template v-else>
                <div class="vo-audio-option vo-audio-option--good">
                  <span class="vo-audio-option-icon" aria-hidden="true">+</span>
                  <span class="vo-audio-option-label">Add:</span>
                  <span>{{ getTracksSummary(row).addedText }}</span>
                </div>
                <div
                  v-if="getTracksSummary(row).keptCount > 0"
                  class="vo-audio-option vo-audio-option--neutral"
                >
                  <span class="vo-audio-option-icon" aria-hidden="true">✓</span>
                  <span class="vo-audio-option-label">Keep:</span>
                  <span>{{ getTracksSummary(row).keptText }}</span>
                </div>
                <div
                  v-else-if="getTracksSummary(row).isReplace"
                  class="vo-audio-option vo-audio-option--neutral"
                >
                  <span class="vo-audio-option-icon" aria-hidden="true">↺</span>
                  <span class="vo-audio-option-label">Mode:</span>
                  <span>Replace existing</span>
                </div>
              </template>
            </div>
          </div>
          <button
            type="button"
            class="vo-btn"
            :class="{ 'vo-btn--danger': row.trackSelection.needsUserPrompt }"
            :disabled="disabled"
            @click="emit('inspect-tracks', row)"
          >
            <span aria-hidden="true">{{ row.trackSelection.needsUserPrompt ? '⚠️' : '🎛️' }}</span>
            {{ row.trackSelection.needsUserPrompt ? 'Resolve Subs' : 'Tracks' }}
          </button>
        </div>
      </template>

      <template #row-after="{ row, colspan, bindAfterRef }">
        <tr
          v-if="conflictByItemId.get(row.id)"
          :ref="(el) => bindAfterRef(el)"
          class="vo-conflict-row"
          :class="{
            'vo-conflict-row--resolved': Boolean(props.conflictResolutions?.[row.id])
          }"
        >
          <td :colspan="colspan">
            <div
              class="vo-row-conflict"
              :class="{
                'vo-row-conflict--resolved': Boolean(props.conflictResolutions?.[row.id])
              }"
            >
              <div class="vo-row-conflict__head vo-mono">
                <span class="vo-row-conflict__title">
                  <span>
                    {{
                      conflictByItemId.get(row.id)!.kind === 'existing-file'
                        ? '⚠ Conflict: File already exists in output'
                        : '⚠ Conflict: Duplicate output destination'
                    }}
                  </span>
                  <span class="vo-path-pill vo-path-pill--file">{{ row.fileName }}</span>
                </span>
                <label :for="`cdec-${row.id}`" class="vo-sr-only">
                  Conflict resolution for {{ row.fileName }}
                </label>
                <select
                  :id="`cdec-${row.id}`"
                  class="vo-select vo-row-conflict__select"
                  :value="props.conflictResolutions?.[row.id] ?? ''"
                  :disabled="disabled"
                  @change="
                    emit(
                      'resolve-conflict',
                      row.id,
                      ($event.target as HTMLSelectElement).value as ConflictDecision
                    )
                  "
                >
                  <option
                    v-for="opt in CONFLICT_DECISION_OPTIONS"
                    :key="opt.value"
                    :value="opt.value"
                    :disabled="opt.disabled"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </div>
              <div class="vo-row-conflict__path vo-mono">
                {{
                  conflictByItemId.get(row.id)!.displayPath ??
                  conflictByItemId.get(row.id)!.existingPath ??
                  conflictByItemId.get(row.id)!.destinationPath
                }}
              </div>
              <div class="vo-row-conflict__grid">
                <div class="vo-row-conflict__side">
                  <strong>Incoming</strong>
                  <div class="vo-mono">
                    {{ formatSizeMb(conflictByItemId.get(row.id)!.incoming.sizeBytes) }}
                    <template v-if="conflictByItemId.get(row.id)!.existing">
                      ({{
                        formatSizeDeltaMb(
                          conflictByItemId.get(row.id)!.incoming.sizeBytes,
                          conflictByItemId.get(row.id)!.existing!.sizeBytes
                        )
                      }})
                    </template>
                    ·
                    {{ formatDuration(conflictByItemId.get(row.id)!.incoming.durationSeconds) }}
                    · {{ conflictByItemId.get(row.id)!.incoming.formatName }} ·
                    {{ formatKbps(conflictByItemId.get(row.id)!.incoming.bitrateBps) }}
                  </div>
                  <div class="vo-mono vo-row-conflict__streams">
                    {{ formatProbeStreams(conflictByItemId.get(row.id)!.incoming) }}
                  </div>
                </div>
                <div v-if="conflictByItemId.get(row.id)!.existing" class="vo-row-conflict__side">
                  <strong>Existing in Output</strong>
                  <div class="vo-mono">
                    {{ formatSizeMb(conflictByItemId.get(row.id)!.existing!.sizeBytes) }} ·
                    {{ formatDuration(conflictByItemId.get(row.id)!.existing!.durationSeconds) }}
                    · {{ conflictByItemId.get(row.id)!.existing!.formatName }} ·
                    {{ formatKbps(conflictByItemId.get(row.id)!.existing!.bitrateBps) }}
                  </div>
                  <div class="vo-mono vo-row-conflict__streams">
                    {{ formatProbeStreams(conflictByItemId.get(row.id)!.existing!) }}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </template>
    </VirtualDataTable>
  </div>
</template>

<style scoped lang="scss">
.vo-table-wrap {
  width: 100%;
  max-width: 100%;
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background: var(--vo-surface-gradient);
  box-shadow: var(--vo-shadow-panel);
}

.vo-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.vo-floating-scrollbar {
  position: sticky;
  bottom: 0;
  border-radius: 0 0 var(--vo-radius-md) var(--vo-radius-md);
  background-color: color-mix(in oklch, var(--vo-surface-elevated) 92%, transparent);
  overflow: auto hidden;
  border-top: 1px solid var(--vo-border);
  backdrop-filter: blur(6px);
}

.vo-floating-scrollbar-track {
  height: 1px;
}

.vo-table-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  padding: var(--vo-space-3);
  background-color: color-mix(in oklch, var(--vo-surface-elevated) 35%, transparent);
  border-bottom: 1px solid var(--vo-border);
}

.vo-table-search {
  flex: 1 1 220px;
}

.vo-table-count {
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  margin-inline-start: auto;
}

.vo-table-empty {
  color: var(--vo-text-muted);
  text-align: center;
}

.vo-sort-btn {
  display: inline-flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-1);
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vo-text-muted);
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  cursor: pointer;

  &:hover {
    color: var(--vo-text);
  }

  &:focus-visible {
    outline: 2px solid var(--vo-accent);
    outline-offset: -2px;
  }
}

.vo-include-header {
  display: flex;
  align-items: center;
  gap: var(--vo-space-2);
  width: 100%;
}

.vo-sort-indicator::after {
  opacity: 0.4;
  content: '⇅';
}

th[aria-sort='ascending'] .vo-sort-indicator::after {
  color: var(--vo-accent);
  opacity: 1;
  content: '▲';
}

th[aria-sort='descending'] .vo-sort-indicator::after {
  color: var(--vo-accent);
  opacity: 1;
  content: '▼';
}

.vo-file-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-1);
}

.vo-file-title {
  font-weight: var(--vo-weight-semibold);
}

.vo-path-panels {
  display: grid;
  gap: var(--vo-space-2);
  font-size: var(--vo-text-xs);
  margin-top: var(--vo-space-2);
}

.vo-path-panel {
  display: grid;
  gap: var(--vo-space-1);
  padding: var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
}

.vo-path-panel--source {
  background-color: var(--vo-surface-elevated);
}

.vo-path-panel--output {
  background-color: color-mix(in oklch, var(--vo-success) 7%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-success) 38%, var(--vo-border));
}

.vo-path-panel--unresolved {
  background-color: color-mix(in oklch, var(--vo-danger) 7%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-danger) 38%, var(--vo-border));
}

.vo-path-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-1);
}

.vo-path-label {
  color: var(--vo-text-muted);
  font-weight: var(--vo-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.vo-path-label--output {
  color: var(--vo-success);
}

.vo-path-label--unresolved {
  color: var(--vo-danger);
}

.vo-path-sep {
  color: var(--vo-text-muted);
  opacity: 0.7;
}

.vo-file-output {
  color: var(--vo-success);
  font-size: var(--vo-text-xs);
  margin-top: var(--vo-space-1);
}

.vo-file-output--unresolved {
  color: var(--vo-danger);
}

.vo-select {
  max-width: 16rem;
  padding: var(--vo-space-1) var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background-color: var(--vo-surface);
  color: var(--vo-text);
}

.vo-file-cell {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.vo-col-shrink {
  width: 1%;
  white-space: nowrap;
}

.vo-col-shrink select {
  width: auto;
  max-width: none;
}

.vo-size-head .vo-sort-btn {
  justify-content: flex-end;
  width: 100%;
}

.vo-size-cell {
  text-align: end;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.vo-actions-cell {
  white-space: nowrap;
}

.vo-audio-cell {
  display: grid;
  gap: var(--vo-space-2);
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.vo-audio-panel {
  display: grid;
  gap: var(--vo-space-1);
  padding: var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background-color: var(--vo-surface-elevated);
  font-size: var(--vo-text-xs);
}

.vo-audio-panel--pending {
  background-color: var(--vo-surface-elevated);
}

.vo-audio-panel--ok {
  background-color: color-mix(in oklch, var(--vo-success) 9%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-success) 52%, var(--vo-border));
}

.vo-audio-panel--peak {
  background-color: color-mix(in oklch, var(--vo-accent) 9%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-accent) 52%, var(--vo-border));
}

.vo-audio-panel--loudnorm {
  background-color: color-mix(in oklch, var(--vo-warning) 9%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-warning) 52%, var(--vo-border));
}

.vo-audio-panel--bad {
  background-color: color-mix(in oklch, var(--vo-danger) 9%, var(--vo-surface));
  border-color: color-mix(in oklch, var(--vo-danger) 52%, var(--vo-border));
}

.vo-audio-lines {
  display: grid;
  gap: var(--vo-space-1);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.vo-audio-option {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--vo-space-1);
  padding: 2px var(--vo-space-1);
  border-radius: var(--vo-radius-sm);
}

.vo-audio-option--bad {
  background-color: color-mix(in oklch, var(--vo-danger) 14%, transparent);
  color: var(--vo-danger);
}

.vo-audio-option--good {
  background-color: color-mix(in oklch, var(--vo-success) 14%, transparent);
  color: var(--vo-success);
}

.vo-audio-option--neutral {
  color: var(--vo-text-muted);
}

.vo-audio-option-icon {
  font-weight: var(--vo-weight-bold);
  flex-shrink: 0;
}

.vo-audio-option-label {
  font-weight: var(--vo-weight-semibold);
}

.vo-audio-panel-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-1);
}

.vo-audio-status {
  display: flex;
  align-items: flex-start;
  gap: var(--vo-space-1);
  color: var(--vo-text);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.vo-audio-status--pending {
  color: var(--vo-text-muted);
}

.vo-audio-icon {
  flex-shrink: 0;
}

.vo-audio-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-1);
}

.vo-select--audio {
  max-width: 100%;
  font-size: var(--vo-text-xs);
  flex: 1;
}

.vo-audio-downmix {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-1);
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  cursor: pointer;
}

.vo-edition-wrap {
  display: flex;
  align-items: center;
  gap: var(--vo-space-2);
  width: 100%;
  margin-block-start: var(--vo-space-2);
}

.vo-edition-input {
  min-width: 0;
  max-width: none;
  padding: var(--vo-space-1) var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background-color: var(--vo-surface-elevated);
  color: var(--vo-text);
  font-size: var(--vo-text-xs);
  flex: 1;
}

.vo-help-tip {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 1px solid var(--vo-border);
  border-radius: 50%;
  background-color: var(--vo-surface-elevated);
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  flex-shrink: 0;
  cursor: help;
}

.vo-meta-controls {
  display: grid;
  gap: var(--vo-space-2);
  width: 100%;
  min-width: 0;
}

.vo-select--candidate {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.vo-meta-search-btn {
  width: 100%;
}

.vo-conflict-banner-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);
  padding: var(--vo-space-2) var(--vo-space-3);
  background-color: color-mix(in oklch, var(--vo-danger) 12%, var(--vo-surface-elevated));
  border-bottom: 1px solid var(--vo-danger);
}

.vo-conflict-banner-title {
  color: var(--vo-danger);
  font-size: var(--vo-text-xs);
  font-weight: var(--vo-weight-semibold);
}

.vo-conflict-banner-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vo-space-2);
}

.vo-queue-row--conflict {
  background-color: color-mix(in oklch, var(--vo-danger) 5%, transparent);
}

:deep(tr.vo-row--has-conflict) {
  background-color: color-mix(in oklch, var(--vo-danger) 7%, transparent);
}

:deep(tr.vo-row--has-conflict td) {
  border-block-end: none;
}

:deep(tr.vo-row--has-conflict td:first-child) {
  border-inline-start: var(--vo-space-1) solid var(--vo-danger);
}

:deep(tr.vo-row--has-conflict-resolved) {
  background-color: color-mix(in oklch, var(--vo-warning) 6%, transparent);
}

:deep(tr.vo-row--has-conflict-resolved td:first-child) {
  border-inline-start: var(--vo-space-1) solid var(--vo-warning);
}

.vo-conflict-row {
  background-color: color-mix(in oklch, var(--vo-danger) 7%, transparent);
}

.vo-conflict-row td {
  padding-block-start: 0;
  border-block-start: none;
  border-block-end: 2px solid var(--vo-danger);
  border-inline-start: var(--vo-space-1) solid var(--vo-danger);
}

.vo-conflict-row--resolved {
  background-color: color-mix(in oklch, var(--vo-warning) 6%, transparent);
}

.vo-conflict-row--resolved td {
  border-block-end: 2px solid var(--vo-warning);
  border-inline-start: var(--vo-space-1) solid var(--vo-warning);
}

.vo-row-conflict {
  display: grid;
  gap: var(--vo-space-2);
  padding: var(--vo-space-2) var(--vo-space-3);
  border: 1px solid var(--vo-danger);
  border-radius: var(--vo-radius-sm);
  background-color: color-mix(in oklch, var(--vo-danger) 10%, var(--vo-surface-elevated));
}

.vo-row-conflict--resolved {
  background-color: color-mix(in oklch, var(--vo-warning) 8%, var(--vo-surface-elevated));
  border-color: var(--vo-warning);
}

.vo-row-conflict__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);
  color: var(--vo-danger);
  font-size: var(--vo-text-xs);
  font-weight: var(--vo-weight-semibold);
}

.vo-row-conflict__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-row-conflict--resolved .vo-row-conflict__head {
  color: var(--vo-warning);
}

.vo-row-conflict__select {
  font-size: var(--vo-text-xs);
}

.vo-row-conflict__path {
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
  overflow-wrap: anywhere;
}

.vo-row-conflict__grid {
  display: grid;
  gap: var(--vo-space-2);
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  font-size: var(--vo-text-xs);
}

.vo-row-conflict__side {
  display: grid;
  gap: var(--vo-space-1);
  padding: var(--vo-space-1) var(--vo-space-2);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background-color: var(--vo-surface);
}

.vo-row-conflict__streams {
  color: var(--vo-text-muted);
}

.vo-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.vo-bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  padding: var(--vo-space-2) var(--vo-space-3);
  background-color: color-mix(in oklch, var(--vo-accent) 10%, var(--vo-surface-elevated));
  border-bottom: 1px solid var(--vo-border-highlight);
}

.vo-bulk-count {
  color: var(--vo-accent);
  font-size: var(--vo-text-xs);
  font-weight: var(--vo-weight-semibold);
}

.vo-select-col {
  width: 2.25rem;
  text-align: center;
}
</style>
