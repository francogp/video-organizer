<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type {
  ConflictComparison,
  ConflictDecision,
  DiskSpaceCheck,
  ItemId
} from '../../domain/types.ts';
import { useModalVars } from '../composables/useGsapMotion.ts';
import {
  CONFLICT_DECISION_OPTIONS,
  formatDuration,
  formatKbps,
  formatProbeStreams,
  formatSizeDeltaMb,
  formatSizeMb
} from '../utils/formatters.ts';

const props = defineProps<{
  readonly open: boolean;
  readonly conflicts: readonly ConflictComparison[];
  readonly diskSpace?: readonly DiskSpaceCheck[];
  readonly initialResolutions?: Readonly<Partial<Record<ItemId, ConflictDecision>>>;
  readonly allowSaveOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', resolutions: Partial<Record<ItemId, ConflictDecision>>): void;
  (e: 'confirm', resolutions: Partial<Record<ItemId, ConflictDecision>>): void;
}>();

const decisions = ref<Partial<Record<ItemId, ConflictDecision>>>({});
const modalVars = useModalVars(1);

watch(
  [() => props.conflicts, () => props.open],
  (): void => {
    const next: Partial<Record<ItemId, ConflictDecision>> = {};
    const initial = props.initialResolutions ?? {};
    for (const conflict of props.conflicts) {
      const saved = initial[conflict.itemId];
      if (saved === 'overwrite' || saved === 'ignore') {
        next[conflict.itemId] = saved;
      }
    }
    decisions.value = next;
  },
  { immediate: true }
);

function applyToAll(decision: ConflictDecision): void {
  const next: Partial<Record<ItemId, ConflictDecision>> = {};
  for (const conflict of props.conflicts) {
    next[conflict.itemId] = decision;
  }
  decisions.value = next;
}

const allResolved = computed((): boolean =>
  props.conflicts.every(
    (c): boolean =>
      decisions.value[c.itemId] === 'overwrite' || decisions.value[c.itemId] === 'ignore'
  )
);
</script>

<template>
  <div v-if="open" class="vo-modal-backdrop" :style="modalVars" role="dialog" aria-modal="true">
    <div class="vo-modal-card">
      <header class="vo-modal-header">
        <h2>
          Pre-Flight Conflicts
          <span class="vo-badge vo-badge--warn vo-badge--compact">{{ conflicts.length }}</span>
        </h2>
        <button type="button" class="vo-btn" @click="emit('close')">
          <span aria-hidden="true">✖️</span> Cancel
        </button>
      </header>

      <div v-if="diskSpace && diskSpace.length > 0" class="vo-disk-list">
        <div
          v-for="disk in diskSpace"
          :key="disk.category"
          class="vo-mono vo-disk-item"
          :class="{ 'vo-disk-item--low': !disk.sufficient }"
        >
          {{ disk.category }}: {{ formatSizeMb(disk.availableBytes) }} free /
          {{ formatSizeMb(disk.requiredBytes) }} required
        </div>
      </div>

      <div v-if="conflicts.length > 1" class="vo-conflict-bulk-actions">
        <span class="vo-mono">Bulk decision:</span>
        <button type="button" class="vo-btn" @click="applyToAll('overwrite')">
          <span aria-hidden="true">✅</span> Overwrite All
        </button>
        <button type="button" class="vo-btn" @click="applyToAll('ignore')">
          <span aria-hidden="true">⏭️</span> Ignore All
        </button>
      </div>

      <div class="vo-conflict-list">
        <article v-for="conflict in conflicts" :key="conflict.itemId" class="vo-conflict-item">
          <div v-if="conflict.sourceFileName" class="vo-conflict-source vo-mono">
            Source: {{ conflict.sourceFileName }}
          </div>
          <div class="vo-mono vo-dest">Destination: {{ conflict.destinationPath }}</div>
          <div
            v-if="conflict.existingPath && conflict.existingPath !== conflict.destinationPath"
            class="vo-mono vo-existing-path"
          >
            Existing match: {{ conflict.existingPath }}
          </div>
          <div class="vo-compare-grid">
            <div>
              <strong>Incoming</strong>
              <div class="vo-mono">
                {{ formatSizeMb(conflict.incoming.sizeBytes) }}
                <template v-if="conflict.existing">
                  ({{
                    formatSizeDeltaMb(conflict.incoming.sizeBytes, conflict.existing.sizeBytes)
                  }})
                </template>
                · {{ formatDuration(conflict.incoming.durationSeconds) }} ·
                {{ conflict.incoming.formatName }} ·
                {{ formatKbps(conflict.incoming.bitrateBps) }}
              </div>
              <div class="vo-mono vo-stream-sub">{{ formatProbeStreams(conflict.incoming) }}</div>
            </div>
            <div v-if="conflict.existing">
              <strong>Existing</strong>
              <div class="vo-mono">
                {{ formatSizeMb(conflict.existing.sizeBytes) }} ·
                {{ formatDuration(conflict.existing.durationSeconds) }} ·
                {{ conflict.existing.formatName }} ·
                {{ formatKbps(conflict.existing.bitrateBps) }}
              </div>
              <div class="vo-mono vo-stream-sub">{{ formatProbeStreams(conflict.existing) }}</div>
            </div>
            <div v-else>
              <strong>Intra-batch collision</strong>
              <div>Multiple queue items map to the same destination.</div>
            </div>
          </div>

          <div class="vo-decision-row">
            <label :for="`dec-${conflict.itemId}`">Resolution</label>
            <select
              :id="`dec-${conflict.itemId}`"
              v-model="decisions[conflict.itemId]"
              class="vo-input"
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
        </article>
      </div>

      <footer class="vo-modal-footer">
        <button type="button" class="vo-btn" @click="emit('close')">
          <span aria-hidden="true">⬅️</span> Back
        </button>
        <button
          v-if="allowSaveOnly"
          type="button"
          class="vo-btn"
          :disabled="!allResolved"
          @click="emit('save', decisions)"
        >
          <span aria-hidden="true">💾</span> Save Decisions
        </button>
        <button
          type="button"
          class="vo-btn vo-btn--primary"
          :disabled="!allResolved"
          @click="emit('confirm', decisions)"
        >
          <span aria-hidden="true">⚡</span> Confirm &amp; Process
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
.vo-conflict-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vo-space-2);
  font-size: var(--vo-text-xs);
  margin-top: var(--vo-space-3);
}

.vo-conflict-list {
  display: grid;
  gap: var(--vo-space-3);
  margin: var(--vo-space-4) 0;
}

.vo-conflict-item {
  padding: var(--vo-space-3);
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-sm);
  background-color: var(--vo-surface-elevated);
}

.vo-conflict-source {
  color: var(--vo-text);
  font-size: var(--vo-text-xs);
  font-weight: var(--vo-weight-semibold);
  margin-bottom: var(--vo-space-1);
}

.vo-dest {
  font-size: var(--vo-text-sm);
  word-break: break-all;
}

.vo-existing-path {
  color: var(--vo-warn);
  font-size: var(--vo-text-xs);
  margin-top: var(--vo-space-1);
  word-break: break-all;
}

.vo-compare-grid {
  display: grid;
  gap: var(--vo-space-3);
  grid-template-columns: 1fr 1fr;
  margin-top: var(--vo-space-2);
}

.vo-decision-row {
  display: flex;
  align-items: center;
  gap: var(--vo-space-2);
  margin-top: var(--vo-space-2);
}
</style>
