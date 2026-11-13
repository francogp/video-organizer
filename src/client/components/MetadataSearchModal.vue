<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { EPISODE_ORDER_MODES } from '../../domain/constants.ts';
import { parseProviderReference } from '../../domain/plexFormatter.ts';
import {
  asImdbId,
  asTvdbId,
  type EpisodeOrderMode,
  type MediaKind,
  type MetadataCandidate,
  type ScannedItem
} from '../../domain/types.ts';
import { useModalVars } from '../composables/useGsapMotion.ts';

const props = defineProps<{
  readonly item: ScannedItem | null;
  readonly bulkCount?: number;
  readonly searchFn: (params: {
    readonly query: string;
    readonly year?: number;
    readonly kind: MediaKind;
    readonly imdbId?: string;
    readonly tvdbId?: string;
    readonly episodeOrder?: EpisodeOrderMode;
  }) => Promise<readonly MetadataCandidate[]>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', candidate: MetadataCandidate, episodeOrder: EpisodeOrderMode): void;
}>();

const modalVars = useModalVars(1);
const query = ref('');
const yearInput = ref('');
const imdbInput = ref('');
const tvdbInput = ref('');
const episodeOrder = ref<EpisodeOrderMode>('aired');
const results = ref<readonly MetadataCandidate[]>([]);
const searching = ref(false);
const errorText = ref<string | null>(null);

watch(
  () => props.item,
  (next): void => {
    if (!next) {
      return;
    }
    query.value = next.selectedMetadata?.title ?? next.parsedTitle;
    yearInput.value = next.parsedYear ? String(next.parsedYear) : '';
    imdbInput.value = next.selectedMetadata?.imdbId ?? '';
    tvdbInput.value = next.selectedMetadata?.tvdbId ?? '';
    episodeOrder.value = next.episodeOrder;
    results.value = next.candidates;
    errorText.value = null;
  },
  { immediate: true }
);

async function handleSearch(): Promise<void> {
  if (!props.item) {
    return;
  }
  searching.value = true;
  errorText.value = null;
  try {
    const parsedYear = Number(yearInput.value);
    results.value = await props.searchFn({
      query: query.value.trim(),
      year: yearInput.value.trim() && Number.isInteger(parsedYear) ? parsedYear : undefined,
      kind: props.item.mediaKind,
      imdbId: imdbInput.value.trim() || undefined,
      tvdbId: tvdbInput.value.trim() || undefined,
      episodeOrder: episodeOrder.value
    });
  } catch (err: unknown) {
    errorText.value = err instanceof Error ? err.message : String(err);
  } finally {
    searching.value = false;
  }
}

function handleApplyManual(): void {
  if (!props.item) {
    return;
  }
  const rawImdb = imdbInput.value.trim();
  const rawTvdb = tvdbInput.value.trim();
  const cleanImdb = rawImdb ? (parseProviderReference(rawImdb).imdbId ?? rawImdb) : '';
  const cleanTvdb = rawTvdb ? (parseProviderReference(rawTvdb).tvdbId ?? rawTvdb) : '';
  if (cleanImdb && !/^tt\d+$/.test(cleanImdb)) {
    errorText.value = 'IMDb ID must match tt followed by digits (e.g. tt0816692).';
    return;
  }
  if (cleanTvdb && !/^\d+$/.test(cleanTvdb)) {
    errorText.value = 'TVDB ID must contain only digits.';
    return;
  }
  const parsedYear = Number(yearInput.value);
  emit(
    'apply',
    {
      title: query.value.trim() || props.item.parsedTitle,
      year: yearInput.value.trim() && Number.isInteger(parsedYear) ? parsedYear : undefined,
      imdbId: cleanImdb ? asImdbId(cleanImdb) : undefined,
      tvdbId: cleanTvdb ? asTvdbId(cleanTvdb) : undefined,
      source: 'manual'
    },
    episodeOrder.value
  );
}

const filePillLabel = computed<string>(() => {
  if (!props.item) {
    return '';
  }
  if ((props.bulkCount ?? 0) > 1) {
    return `Applying match to ${String(props.bulkCount)} selected items (seed: ${props.item.fileName})`;
  }
  return props.item.fileName;
});
</script>

<template>
  <div v-if="item" class="vo-modal-backdrop" :style="modalVars" role="dialog" aria-modal="true">
    <div class="vo-modal-card vo-meta-modal">
      <header class="vo-modal-header vo-meta-header">
        <div class="vo-meta-title-group">
          <div class="vo-meta-eyebrow">
            <h2>Metadata Lookup</h2>
            <span class="vo-badge">{{ item.mediaKind === 'tv' ? 'Series' : 'Movie' }}</span>
            <span v-if="(bulkCount ?? 0) > 1" class="vo-badge">{{ bulkCount }} selected</span>
          </div>
          <p class="vo-file-pill vo-mono">{{ filePillLabel }}</p>
        </div>
        <button type="button" class="vo-btn" @click="emit('close')">
          <span aria-hidden="true">✖️</span> Close
        </button>
      </header>

      <section class="vo-search-grid">
        <div class="vo-field vo-field--wide">
          <label for="meta-query">Title</label>
          <input id="meta-query" v-model="query" type="text" class="vo-input" />
        </div>
        <div class="vo-field">
          <label for="meta-year">Year</label>
          <input id="meta-year" v-model="yearInput" type="text" class="vo-input" />
        </div>
        <div class="vo-field">
          <label for="meta-imdb">IMDb ID</label>
          <input
            id="meta-imdb"
            v-model="imdbInput"
            type="text"
            placeholder="tt0816692"
            class="vo-input"
          />
        </div>
        <div class="vo-field">
          <label for="meta-tvdb">TVDB ID</label>
          <input
            id="meta-tvdb"
            v-model="tvdbInput"
            type="text"
            placeholder="416744"
            class="vo-input"
          />
        </div>
        <div v-if="item.mediaKind === 'tv'" class="vo-field">
          <label for="meta-order">Episode Order</label>
          <select id="meta-order" v-model="episodeOrder" class="vo-input">
            <option v-for="ord in EPISODE_ORDER_MODES" :key="ord" :value="ord">{{ ord }}</option>
          </select>
        </div>
      </section>

      <div class="vo-search-actions">
        <button
          type="button"
          class="vo-btn vo-btn--primary"
          :disabled="searching"
          @click="handleSearch"
        >
          <span aria-hidden="true">{{ searching ? '⏳' : '🔍' }}</span>
          {{ searching ? 'Searching...' : 'Search Providers' }}
        </button>
        <button type="button" class="vo-btn" @click="handleApplyManual">
          <span aria-hidden="true">✏️</span> Apply Manual Values
        </button>
      </div>

      <p v-if="errorText" class="vo-alert">{{ errorText }}</p>

      <div class="vo-results-list">
        <article
          v-for="(cand, idx) in results"
          :key="`${cand.source}-${String(idx)}`"
          class="vo-result-item"
        >
          <div>
            <strong>{{ cand.title }}</strong>
            <span v-if="cand.year"> ({{ cand.year }})</span>
            <span class="vo-mono vo-muted"> · {{ cand.source }}</span>
            <div class="vo-mono vo-muted">
              <span v-if="cand.imdbId">{{ cand.imdbId }} </span>
              <span v-if="cand.tvdbId">tvdb-{{ cand.tvdbId }}</span>
            </div>
          </div>
          <button type="button" class="vo-btn" @click="emit('apply', cand, episodeOrder)">
            <span aria-hidden="true">✅</span> Select
          </button>
        </article>
        <p v-if="results.length === 0" class="vo-muted">No metadata candidates yet.</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.vo-meta-modal {
  display: grid;
  gap: var(--vo-space-4);
}

.vo-meta-header {
  align-items: flex-start;
  padding-bottom: var(--vo-space-3);
  border-bottom: 1px solid var(--vo-border);
}

.vo-meta-title-group {
  display: grid;
  gap: var(--vo-space-2);
  min-width: 0;
  flex: 1 1 240px;
}

.vo-search-grid {
  display: grid;
  gap: var(--vo-space-3);
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
}

.vo-field {
  display: grid;
  gap: var(--vo-space-1);
  min-width: 0;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);

  .vo-input {
    width: 100%;
  }
}

.vo-field--wide {
  grid-column: 1 / -1;
}

.vo-search-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vo-space-2);
}

.vo-alert {
  margin: 0;
  padding: var(--vo-space-2) var(--vo-space-3);
  border: 1px solid var(--vo-danger);
  border-radius: var(--vo-radius-sm);
  color: var(--vo-danger);
  font-size: var(--vo-text-xs);
}

.vo-results-list {
  display: grid;
  gap: var(--vo-space-2);
}

.vo-result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-3);
  padding: var(--vo-space-3);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background-color: var(--vo-surface-elevated);
}

.vo-muted {
  margin: 0;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
}
</style>
