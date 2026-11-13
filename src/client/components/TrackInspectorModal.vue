<script setup lang="ts">
import { ref, toRaw, watch } from 'vue';

import {
  ISO_639_2_LABELS,
  ISO_639_2_PRESETS,
  SUBTITLE_MERGE_MODES
} from '../../domain/constants.ts';
import {
  asIso639_2Code,
  type ScannedItem,
  type SubtitleMergeMode,
  type TrackSelection
} from '../../domain/types.ts';
import { useModalVars } from '../composables/useGsapMotion.ts';

const props = defineProps<{
  readonly item: ScannedItem | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', selection: TrackSelection, applySeries: boolean): void;
}>();

const draft = ref<TrackSelection | null>(null);
const applyToSeries = ref(false);
const modalVars = useModalVars(1);

watch(
  () => props.item,
  (next): void => {
    draft.value = next ? structuredClone(toRaw(next.trackSelection)) : null;
    applyToSeries.value = false;
  },
  { immediate: true }
);

function updateAudioLang(idx: number, raw: string): void {
  if (!draft.value) {
    return;
  }
  const clean = raw.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(clean)) {
    return;
  }
  const nextTracks = draft.value.audioTracks.map((t, i) =>
    i === idx ? { ...t, language: asIso639_2Code(clean) } : t
  );
  draft.value = { ...draft.value, audioTracks: nextTracks };
}

function setDefaultAudio(idx: number): void {
  if (!draft.value) {
    return;
  }
  const nextTracks = draft.value.audioTracks.map((t, i) => ({
    ...t,
    isDefault: i === idx
  }));
  draft.value = { ...draft.value, audioTracks: nextTracks };
}

function setMergeMode(mode: SubtitleMergeMode): void {
  if (!draft.value) {
    return;
  }
  draft.value = { ...draft.value, subtitleMergeMode: mode, needsUserPrompt: false };
}

function toggleInternalSubtitle(streamOrder: number, checked: boolean): void {
  if (!draft.value) {
    return;
  }
  const current = new Set(draft.value.includedInternalSubtitles);
  if (checked) {
    current.add(streamOrder);
  } else {
    current.delete(streamOrder);
  }
  draft.value = {
    ...draft.value,
    includedInternalSubtitles: [...current].sort((a, b): number => a - b)
  };
}

function moveExternalSubtitle(idx: number, delta: -1 | 1): void {
  if (!draft.value) {
    return;
  }
  const nextIdx = idx + delta;
  const list = [...draft.value.externalSubtitleOrder];
  if (nextIdx < 0 || nextIdx >= list.length) {
    return;
  }
  const current = list[idx]!;
  list[idx] = list[nextIdx]!;
  list[nextIdx] = current;
  draft.value = { ...draft.value, externalSubtitleOrder: list };
}

function mergeModeDescription(mode: SubtitleMergeMode): string {
  switch (mode) {
    case 'keep-and-add': {
      return 'Preserves embedded container subtitles and muxes external subtitle files.';
    }
    case 'replace': {
      return 'Replaces embedded subtitles with external subtitle files when available.';
    }
    case 'selected-only': {
      return 'Includes only the embedded subtitles you check below plus external files.';
    }
  }
}

function handleSave(): void {
  if (!draft.value) {
    return;
  }
  emit('save', { ...draft.value, needsUserPrompt: false }, applyToSeries.value);
}
</script>

<template>
  <div
    v-if="item && draft"
    class="vo-modal-backdrop"
    :style="modalVars"
    role="dialog"
    aria-modal="true"
  >
    <div class="vo-modal-card vo-inspector-modal">
      <header class="vo-modal-header vo-inspector-header">
        <div class="vo-inspector-title-group">
          <div class="vo-inspector-eyebrow">
            <h2>Track Inspector</h2>
            <span class="vo-badge">{{ item.mediaKind === 'tv' ? 'Series' : 'Movie' }}</span>
          </div>
          <p class="vo-file-pill vo-mono">{{ item.fileName }}</p>
        </div>
        <button type="button" class="vo-btn" @click="emit('close')">
          <span aria-hidden="true">✖️</span> Close
        </button>
      </header>

      <div v-if="draft.promptReason" class="vo-alert">
        {{ draft.promptReason }}
      </div>

      <section class="vo-section">
        <div class="vo-section-head">
          <h3>Audio Tracks</h3>
          <span class="vo-hint">{{ draft.audioTracks.length }} stream(s)</span>
        </div>

        <div class="vo-track-list">
          <div
            v-for="(track, idx) in draft.audioTracks"
            :key="track.streamOrder"
            class="vo-track-card"
          >
            <div class="vo-track-card-top">
              <div class="vo-track-identity">
                <span class="vo-badge vo-mono">#{{ track.streamOrder }}</span>
                <span class="vo-mono vo-track-codec">
                  {{ item.probe.audioStreams[idx]?.codecName ?? 'audio' }}
                  <template v-if="item.probe.audioStreams[idx]?.channels">
                    · {{ item.probe.audioStreams[idx]?.channels }}ch
                  </template>
                </span>
                <span v-if="item.probe.audioStreams[idx]?.title" class="vo-hint">
                  {{ item.probe.audioStreams[idx]?.title }}
                </span>
              </div>

              <label :for="`aud-def-${String(idx)}`" class="vo-radio-pill">
                <input
                  :id="`aud-def-${String(idx)}`"
                  type="radio"
                  name="defaultAudio"
                  :checked="track.isDefault"
                  @change="setDefaultAudio(idx)"
                />
                Default
              </label>
            </div>

            <div class="vo-track-controls">
              <label :for="`aud-lang-${String(idx)}`" class="vo-control-label">
                Language (ISO-639-2)
              </label>
              <div class="vo-lang-inputs">
                <select
                  :id="`aud-lang-${String(idx)}`"
                  class="vo-input"
                  :value="
                    ISO_639_2_PRESETS.includes(track.language as (typeof ISO_639_2_PRESETS)[number])
                      ? track.language
                      : ''
                  "
                  @change="updateAudioLang(idx, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="" disabled>Custom</option>
                  <option v-for="code in ISO_639_2_PRESETS" :key="code" :value="code">
                    {{ code }} — {{ ISO_639_2_LABELS[code] }}
                  </option>
                </select>
                <input
                  type="text"
                  maxlength="3"
                  class="vo-input vo-code-input vo-mono"
                  :value="track.language"
                  :aria-label="`Custom ISO 639-2 code for stream ${String(track.streamOrder)}`"
                  @change="updateAudioLang(idx, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="vo-section">
        <div class="vo-section-head">
          <h3>Subtitle Merge Strategy</h3>
          <div class="vo-sub-counts">
            <span class="vo-badge">Internal: {{ item.probe.subtitleStreams.length }}</span>
            <span class="vo-badge">External: {{ item.externalSubtitles.length }}</span>
          </div>
        </div>

        <div class="vo-track-card">
          <div class="vo-merge-row">
            <label for="sub-merge-mode" class="vo-control-label">Merge Mode</label>
            <select
              id="sub-merge-mode"
              class="vo-input vo-merge-select"
              :value="draft.subtitleMergeMode"
              @change="
                setMergeMode(($event.target as HTMLSelectElement).value as SubtitleMergeMode)
              "
            >
              <option v-for="mode in SUBTITLE_MERGE_MODES" :key="mode" :value="mode">
                {{ mode }}
              </option>
            </select>
          </div>
          <p class="vo-hint">{{ mergeModeDescription(draft.subtitleMergeMode) }}</p>

          <div v-if="item.probe.subtitleStreams.length > 0" class="vo-sub-list">
            <label
              v-for="sub in item.probe.subtitleStreams"
              :key="sub.streamOrder"
              class="vo-sub-check"
            >
              <input
                v-if="draft.subtitleMergeMode === 'selected-only'"
                type="checkbox"
                :checked="draft.includedInternalSubtitles.includes(sub.streamOrder)"
                :aria-label="`Include internal subtitle stream ${String(sub.streamOrder)}`"
                @change="
                  toggleInternalSubtitle(
                    sub.streamOrder,
                    ($event.target as HTMLInputElement).checked
                  )
                "
              />
              <span class="vo-mono vo-sub-meta">
                #{{ sub.streamOrder }} · {{ sub.language }} ({{ sub.codecName }})
                <template v-if="sub.title"> · {{ sub.title }}</template>
              </span>
              <span class="vo-sub-flags">
                <span v-if="sub.isDefault" class="vo-badge vo-badge--ok">default</span>
                <span v-if="sub.isForced" class="vo-badge vo-badge--warn">forced</span>
              </span>
            </label>
          </div>

          <div v-if="draft.externalSubtitleOrder.length > 0" class="vo-sub-list">
            <div
              v-for="(extPath, idx) in draft.externalSubtitleOrder"
              :key="extPath"
              class="vo-ext-row"
            >
              <span class="vo-mono vo-ext-path">{{ idx + 1 }}. {{ extPath }}</span>
              <div class="vo-actions">
                <button
                  type="button"
                  class="vo-btn"
                  :disabled="idx === 0"
                  @click="moveExternalSubtitle(idx, -1)"
                >
                  <span aria-hidden="true">⬆️</span> Up
                </button>
                <button
                  type="button"
                  class="vo-btn"
                  :disabled="idx === draft.externalSubtitleOrder.length - 1"
                  @click="moveExternalSubtitle(idx, 1)"
                >
                  <span aria-hidden="true">⬇️</span> Down
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="vo-modal-footer vo-inspector-footer">
        <label v-if="item.mediaKind === 'tv'" class="vo-series-check">
          <input
            id="apply-series"
            v-model="applyToSeries"
            type="checkbox"
            aria-label="Apply track setup to entire series"
          />
          Apply track setup to entire series
        </label>
        <div class="vo-actions">
          <button type="button" class="vo-btn" @click="emit('close')">
            <span aria-hidden="true">✖️</span> Cancel
          </button>
          <button type="button" class="vo-btn vo-btn--primary" @click="handleSave">
            <span aria-hidden="true">💾</span> Save Tracks
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
.vo-inspector-modal {
  display: grid;
  gap: var(--vo-space-4);
}

.vo-inspector-header {
  align-items: flex-start;
  padding-bottom: var(--vo-space-3);
  border-bottom: 1px solid var(--vo-border);
}

.vo-inspector-title-group {
  display: grid;
  gap: var(--vo-space-2);
  min-width: 0;
  flex: 1 1 240px;
}

.vo-section {
  display: grid;
  gap: var(--vo-space-2);
}

.vo-section-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);

  h3 {
    margin: 0;
    font-size: var(--vo-text-md);
  }
}

.vo-track-list {
  display: grid;
  gap: var(--vo-space-2);
}

.vo-track-card {
  display: grid;
  gap: var(--vo-space-3);
  padding: var(--vo-space-3);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background-color: var(--vo-surface-elevated);
}

.vo-track-card-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-track-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  min-width: 0;
}

.vo-track-codec {
  color: var(--vo-text);
  font-size: var(--vo-text-sm);
}

.vo-radio-pill,
.vo-series-check {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-2);
  font-size: var(--vo-text-sm);
  cursor: pointer;
}

.vo-track-controls,
.vo-merge-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-3);
}

.vo-control-label {
  color: var(--vo-text-muted);
  font-size: var(--vo-text-sm);
}

.vo-lang-inputs {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-merge-select {
  min-width: 12rem;
}

.vo-sub-counts {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-alert {
  padding: var(--vo-space-3);
  border: 1px solid var(--vo-warning);
  border-radius: var(--vo-radius-sm);
  color: var(--vo-warning);
}

.vo-hint {
  margin: 0;
  color: var(--vo-text-muted);
  font-size: var(--vo-text-xs);
}

.vo-actions {
  display: flex;
  gap: var(--vo-space-2);
}

.vo-code-input {
  width: 4.5rem;
  text-align: center;
}

.vo-sub-list {
  display: grid;
  gap: var(--vo-space-2);
  padding-top: var(--vo-space-2);
  border-top: 1px solid var(--vo-border);
}

.vo-sub-check,
.vo-ext-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--vo-space-2);
}

.vo-sub-meta {
  font-size: var(--vo-text-xs);
  flex: 1 1 200px;
  overflow-wrap: anywhere;
}

.vo-sub-flags {
  display: inline-flex;
  align-items: center;
  gap: var(--vo-space-1);
}

.vo-ext-path {
  font-size: var(--vo-text-xs);
  flex: 1 1 200px;
  overflow-wrap: anywhere;
}

.vo-inspector-footer {
  padding-top: var(--vo-space-4);
  border-top: 1px solid var(--vo-border);
  margin-top: var(--vo-space-2);

  .vo-actions {
    margin-left: auto;
  }
}
</style>
