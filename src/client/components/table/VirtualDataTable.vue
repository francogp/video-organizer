<script setup lang="ts" generic="T, ColId extends string = string">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { TableColumnDef, TableId } from './tableTypes.js';
import { useTableColumns } from './useTableColumns.js';
import { useTableVirtualizer } from './useTableVirtualizer.js';

const KEYBOARD_RESIZE_STEP_PX = 16;

const props = withDefaults(
  defineProps<{
    tableId: TableId;
    columns: readonly TableColumnDef<ColId>[];
    rows: readonly T[];
    indices: Uint32Array;
    getRowKey: (row: T, rawIndex: number) => string;
    getRowClass?: (row: T, rawIndex: number) => string | readonly string[] | undefined;
    getAriaSort?: (colId: ColId) => 'ascending' | 'descending' | undefined;
    estimatedRowHeight?: number;
    emptyMessage?: string;
  }>(),
  {
    estimatedRowHeight: 84,
    emptyMessage: 'No items to display.'
  }
);

const {
  orderedColumns,
  draggedColId,
  dragOverColId,
  resizingColId,
  totalTableWidthPx,
  getColumnWidth,
  startDrag,
  onDragOver,
  dropColumn,
  endDrag,
  startResize,
  nudgeColumnWidth,
  resetColumns
} = useTableColumns<ColId>(props.tableId, props.columns);

const rowCount = computed((): number => props.indices.length);

const {
  startIndex,
  endIndex,
  topSpacerPx,
  bottomSpacerPx,
  handleScroll,
  measureRowHeight,
  observeViewport
} = useTableVirtualizer({
  rowCount,
  estimatedRowHeight: props.estimatedRowHeight,
  overscan: 8
});

interface VisibleEntry {
  readonly displayIndex: number;
  readonly rawIndex: number;
  readonly key: string;
  readonly row: T;
}

const visibleEntries = computed<VisibleEntry[]>(() => {
  const result: VisibleEntry[] = [];
  const start = startIndex.value;
  const end = endIndex.value;
  for (let displayIndex = start; displayIndex < end; displayIndex++) {
    const rawIndex = props.indices[displayIndex];
    if (rawIndex === undefined) {
      continue;
    }
    const row = props.rows[rawIndex];
    if (!row) {
      continue;
    }
    result.push({
      displayIndex,
      rawIndex,
      key: props.getRowKey(row, rawIndex),
      row
    });
  }
  return result;
});

const scrollViewportRef = ref<HTMLElement | null>(null);

function onViewportScroll(): void {
  const vp = scrollViewportRef.value;
  if (!vp) {
    return;
  }
  handleScroll(vp.scrollTop);
}

// Shared ResizeObserver for dynamic row heights (supports optional #row-after tr)
const rowIndexByElement = new WeakMap<Element, number>();
const primaryRowByIndex = new Map<number, HTMLElement>();
const afterRowByIndex = new Map<number, HTMLElement>();
let rowResizeObserver: ResizeObserver | null = null;

function reportCombinedHeight(displayIndex: number): void {
  const primary = primaryRowByIndex.get(displayIndex);
  const after = afterRowByIndex.get(displayIndex);
  const h1 = primary ? primary.getBoundingClientRect().height : 0;
  const h2 = after ? after.getBoundingClientRect().height : 0;
  const total = h1 + h2;
  if (total > 0) {
    measureRowHeight(displayIndex, total);
  }
}

function ensureRowObserver(): ResizeObserver | null {
  if (rowResizeObserver) {
    return rowResizeObserver;
  }
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  rowResizeObserver = new ResizeObserver((entries): void => {
    for (const entry of entries) {
      const idx = rowIndexByElement.get(entry.target);
      if (idx !== undefined) {
        reportCombinedHeight(idx);
      }
    }
  });
  return rowResizeObserver;
}

function bindRowRef(
  displayIndex: number,
  el: unknown,
  kind: 'primary' | 'after' = 'primary'
): void {
  const map = kind === 'primary' ? primaryRowByIndex : afterRowByIndex;
  if (!(el instanceof HTMLElement)) {
    map.delete(displayIndex);
    return;
  }
  map.set(displayIndex, el);
  const prevIdx = rowIndexByElement.get(el);
  if (prevIdx !== displayIndex) {
    rowIndexByElement.set(el, displayIndex);
    ensureRowObserver()?.observe(el);
  }
  reportCombinedHeight(displayIndex);
}

onMounted((): void => {
  observeViewport(scrollViewportRef.value);
});

onBeforeUnmount((): void => {
  observeViewport(null);
  if (rowResizeObserver) {
    rowResizeObserver.disconnect();
    rowResizeObserver = null;
  }
});

defineExpose({
  resetColumns
});
</script>

<template>
  <div class="vo-vtable-shell" :class="{ 'vo-vtable-shell--resizing': resizingColId !== null }">
    <div ref="scrollViewportRef" class="vo-vtable-scroll" @scroll.passive="onViewportScroll">
      <table class="vo-table vo-vtable" :style="{ width: `${totalTableWidthPx}px` }">
        <colgroup>
          <col
            v-for="col in orderedColumns"
            :key="col.id"
            :style="{ width: `${getColumnWidth(col.id)}px` }"
          />
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="col in orderedColumns"
              :key="col.id"
              :draggable="col.reorderable !== false"
              :aria-sort="getAriaSort?.(col.id)"
              :class="[
                'vo-vtable-th',
                col.align ? `vo-td--${col.align}` : '',
                {
                  'vo-vtable-th--reorderable': col.reorderable !== false,
                  'vo-vtable-th--dragging': draggedColId === col.id,
                  'vo-vtable-th--drag-over': dragOverColId === col.id
                }
              ]"
              @dragstart="startDrag(col.id)"
              @dragover.prevent="onDragOver(col.id)"
              @drop.prevent="dropColumn(col.id)"
              @dragend="endDrag"
            >
              <div class="vo-vtable-th-inner">
                <slot :name="`header-${col.id}`" :column="col">
                  <span>{{ col.label }}</span>
                </slot>
              </div>
              <span
                v-if="col.resizable !== false"
                class="vo-col-resizer"
                role="separator"
                tabindex="0"
                aria-orientation="vertical"
                :aria-label="`Resize ${col.label} column`"
                @pointerdown.stop.prevent="startResize(col.id, $event.clientX)"
                @keydown.left.prevent="nudgeColumnWidth(col.id, -KEYBOARD_RESIZE_STEP_PX)"
                @keydown.right.prevent="nudgeColumnWidth(col.id, KEYBOARD_RESIZE_STEP_PX)"
                @click.stop
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="indices.length === 0">
            <td :colspan="orderedColumns.length" class="vo-vtable-empty">
              {{ emptyMessage }}
            </td>
          </tr>
          <template v-else>
            <tr v-if="topSpacerPx > 0" aria-hidden="true" class="vo-vtable-spacer">
              <td :colspan="orderedColumns.length" :style="{ height: `${topSpacerPx}px` }" />
            </tr>
            <template v-for="entry in visibleEntries" :key="entry.key">
              <tr
                :ref="(el) => bindRowRef(entry.displayIndex, el, 'primary')"
                :class="getRowClass?.(entry.row, entry.rawIndex)"
              >
                <td
                  v-for="col in orderedColumns"
                  :key="col.id"
                  :class="col.align ? `vo-td--${col.align}` : undefined"
                >
                  <slot
                    :name="`cell-${col.id}`"
                    :row="entry.row"
                    :raw-index="entry.rawIndex"
                    :display-index="entry.displayIndex"
                  />
                </td>
              </tr>
              <slot
                name="row-after"
                :row="entry.row"
                :raw-index="entry.rawIndex"
                :display-index="entry.displayIndex"
                :colspan="orderedColumns.length"
                :bind-after-ref="(el: unknown) => bindRowRef(entry.displayIndex, el, 'after')"
              />
            </template>
            <tr v-if="bottomSpacerPx > 0" aria-hidden="true" class="vo-vtable-spacer">
              <td :colspan="orderedColumns.length" :style="{ height: `${bottomSpacerPx}px` }" />
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style lang="scss">
.vo-vtable-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--vo-border);
  border-radius: var(--vo-radius-md);
  background: var(--vo-surface);
  overflow: hidden;
}

.vo-vtable-shell--resizing {
  user-select: none;
  cursor: col-resize;
}

.vo-vtable-scroll {
  width: 100%;
  max-height: 68dvh;
  overflow: auto;
  will-change: scroll-position;
}

.vo-vtable {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;

  :is(th, td) {
    min-width: 0;
    padding: var(--vo-space-2) var(--vo-space-3);
    text-align: start;
    box-sizing: border-box;
    vertical-align: top;
    border-block-end: 1px solid var(--vo-border);
    border-inline-end: 1px solid var(--vo-border);
    overflow: hidden;

    &:last-child {
      border-inline-end: none;
    }
  }

  td select,
  td input:not([type='checkbox']) {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: var(--vo-z-sticky, 3);
    background-color: var(--vo-surface-elevated);
    color: var(--vo-text-muted);
    font-size: var(--vo-text-xs);
    font-weight: var(--vo-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    vertical-align: middle;
  }
}

.vo-vtable-th {
  position: relative;
  user-select: none;
}

.vo-vtable-th--reorderable {
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.vo-vtable-th--dragging {
  opacity: 0.45;
}

.vo-vtable-th--drag-over {
  border-inline-start: 2px solid var(--vo-accent);
}

.vo-vtable-th-inner {
  display: flex;
  align-items: center;
  gap: var(--vo-space-2);
  inline-size: 100%;
  padding-inline-end: var(--vo-space-2);
  overflow: hidden;
  text-overflow: ellipsis;
}

.vo-col-resizer {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  inline-size: 8px;
  cursor: col-resize;
  touch-action: none;

  &:hover::after,
  &:focus-visible::after {
    background: var(--vo-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--vo-accent);
    outline-offset: -2px;
  }

  &::after {
    position: absolute;
    border-radius: var(--vo-radius-sm);
    background: var(--vo-border);
    content: '';
    inset-block: 20%;
    inset-inline-end: 2px;
    inline-size: 2px;
  }
}

.vo-vtable-spacer td {
  padding: 0;
  border: 0;
}

.vo-vtable-empty {
  padding: var(--vo-space-6);
  color: var(--vo-text-muted);
  text-align: center;
}

.vo-td--center {
  text-align: center;
}

.vo-td--right {
  text-align: end;
}
</style>
