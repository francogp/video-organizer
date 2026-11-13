import { computed, onBeforeUnmount, shallowRef, type ComputedRef } from 'vue';

import {
  clearTablePreferences,
  loadTablePreferences,
  saveTablePreferences
} from '../../utils/storage.ts';
import type { PersistedTablePreferences, TableColumnDef, TableId } from './tableTypes.ts';

export interface TableColumnsHandle<ColId extends string> {
  readonly orderedColumns: ComputedRef<readonly TableColumnDef<ColId>[]>;
  readonly columnOrder: ComputedRef<readonly ColId[]>;
  readonly draggedColId: ComputedRef<ColId | null>;
  readonly dragOverColId: ComputedRef<ColId | null>;
  readonly resizingColId: ComputedRef<ColId | null>;
  readonly totalTableWidthPx: ComputedRef<number>;
  readonly getColumnWidth: (colId: ColId) => number;
  readonly startDrag: (colId: ColId) => void;
  readonly onDragOver: (targetId: ColId) => void;
  readonly dropColumn: (targetId: ColId) => void;
  readonly endDrag: () => void;
  readonly startResize: (colId: ColId, clientX: number) => void;
  readonly nudgeColumnWidth: (colId: ColId, deltaPx: number) => void;
  readonly resetColumns: () => void;
}

function reconcileOrder<ColId extends string>(
  defaults: readonly TableColumnDef<ColId>[],
  savedOrder: readonly ColId[] | undefined
): ColId[] {
  const validIds = new Set(defaults.map((col) => col.id));
  const seen = new Set<ColId>();
  const result: ColId[] = [];

  if (savedOrder) {
    for (const id of savedOrder) {
      if (validIds.has(id) && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }
  for (const col of defaults) {
    if (!seen.has(col.id)) {
      seen.add(col.id);
      result.push(col.id);
    }
  }
  return result;
}

/**
 * Manages column ordering (drag-and-drop), resizing (pointer capture + rAF),
 * O(1) column width lookups, and localStorage persistence.
 */
export function useTableColumns<ColId extends string>(
  tableId: TableId,
  defaultColumns: readonly TableColumnDef<ColId>[]
): TableColumnsHandle<ColId> {
  const columnDefMap = new Map<ColId, TableColumnDef<ColId>>();
  for (const col of defaultColumns) {
    columnDefMap.set(col.id, col);
  }

  const saved = loadTablePreferences<ColId>(tableId);
  const columnOrder = shallowRef<ColId[]>(reconcileOrder(defaultColumns, saved?.order));
  const widthMap = shallowRef<Map<ColId, number>>(new Map());

  function initWidthMap(savedWidths?: Readonly<Partial<Record<ColId, number>>>): void {
    const next = new Map<ColId, number>();
    for (const col of defaultColumns) {
      const persistedWidth = savedWidths?.[col.id];
      const clamped =
        typeof persistedWidth === 'number' && Number.isFinite(persistedWidth)
          ? Math.max(col.minWidthPx, Math.round(persistedWidth))
          : col.defaultWidthPx;
      next.set(col.id, clamped);
    }
    widthMap.value = next;
  }

  initWidthMap(saved?.widths);

  const orderedColumns = computed<readonly TableColumnDef<ColId>[]>(() => {
    const list: TableColumnDef<ColId>[] = [];
    for (const id of columnOrder.value) {
      const def = columnDefMap.get(id);
      if (def) {
        list.push(def);
      }
    }
    return list;
  });

  const totalTableWidthPx = computed(() => {
    let total = 0;
    for (const col of orderedColumns.value) {
      total += getColumnWidth(col.id);
    }
    return total;
  });

  const DEFAULT_FALLBACK_COLUMN_WIDTH_PX = 120;

  function getColumnWidth(colId: ColId): number {
    return (
      widthMap.value.get(colId) ??
      columnDefMap.get(colId)?.defaultWidthPx ??
      DEFAULT_FALLBACK_COLUMN_WIDTH_PX
    );
  }

  function persist(): void {
    const widths: Partial<Record<ColId, number>> = {};
    for (const [id, width] of widthMap.value.entries()) {
      widths[id] = width;
    }
    const prefs: PersistedTablePreferences<ColId> = {
      version: 1,
      order: [...columnOrder.value],
      widths
    };
    saveTablePreferences(tableId, prefs);
  }

  // Drag-and-drop column reordering
  const draggedColId = shallowRef<ColId | null>(null);
  const dragOverColId = shallowRef<ColId | null>(null);

  function startDrag(colId: ColId): void {
    const def = columnDefMap.get(colId);
    if (def?.reorderable === false) {
      return;
    }
    draggedColId.value = colId;
  }

  function onDragOver(targetId: ColId): void {
    if (!draggedColId.value || draggedColId.value === targetId) {
      return;
    }
    const targetDef = columnDefMap.get(targetId);
    if (targetDef?.reorderable === false) {
      return;
    }
    dragOverColId.value = targetId;
  }

  function dropColumn(targetId: ColId): void {
    const sourceId = draggedColId.value;
    draggedColId.value = null;
    dragOverColId.value = null;
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const targetDef = columnDefMap.get(targetId);
    if (targetDef?.reorderable === false) {
      return;
    }
    const nextOrder = [...columnOrder.value];
    const fromIdx = nextOrder.indexOf(sourceId);
    const toIdx = nextOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      return;
    }
    nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, sourceId);
    columnOrder.value = nextOrder;
    persist();
  }

  function endDrag(): void {
    draggedColId.value = null;
    dragOverColId.value = null;
  }

  // Pointer column resizing
  const resizingColId = shallowRef<ColId | null>(null);
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let resizeRafId: number | null = null;
  let pendingWidth = 0;

  function applyPendingResize(): void {
    resizeRafId = null;
    const activeId = resizingColId.value;
    if (!activeId) {
      return;
    }
    const next = new Map(widthMap.value);
    next.set(activeId, pendingWidth);
    widthMap.value = next;
  }

  function handlePointerMove(event: PointerEvent): void {
    const activeId = resizingColId.value;
    if (!activeId) {
      return;
    }
    const def = columnDefMap.get(activeId);
    const minWidth = def?.minWidthPx ?? 48;
    const delta = event.clientX - resizeStartX;
    pendingWidth = Math.max(minWidth, Math.round(resizeStartWidth + delta));

    if (resizeRafId === null) {
      if (typeof globalThis.requestAnimationFrame === 'function') {
        resizeRafId = globalThis.requestAnimationFrame(applyPendingResize);
      } else {
        applyPendingResize();
      }
    }
  }

  function stopResize(): void {
    if (!resizingColId.value) {
      return;
    }
    if (resizeRafId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(resizeRafId);
      applyPendingResize();
    }
    resizingColId.value = null;
    if (typeof globalThis.window !== 'undefined') {
      globalThis.removeEventListener('pointermove', handlePointerMove);
      globalThis.removeEventListener('pointerup', stopResize);
      globalThis.removeEventListener('pointercancel', stopResize);
    }
    persist();
  }

  function startResize(colId: ColId, clientX: number): void {
    const def = columnDefMap.get(colId);
    if (def?.resizable === false) {
      return;
    }
    resizingColId.value = colId;
    resizeStartX = clientX;
    resizeStartWidth = getColumnWidth(colId);
    pendingWidth = resizeStartWidth;

    if (typeof globalThis.window !== 'undefined') {
      globalThis.addEventListener('pointermove', handlePointerMove);
      globalThis.addEventListener('pointerup', stopResize);
      globalThis.addEventListener('pointercancel', stopResize);
    }
  }

  function nudgeColumnWidth(colId: ColId, deltaPx: number): void {
    const def = columnDefMap.get(colId);
    if (def?.resizable === false) {
      return;
    }
    const minWidth = def?.minWidthPx ?? 48;
    const clamped = Math.max(minWidth, Math.round(getColumnWidth(colId) + deltaPx));
    const next = new Map(widthMap.value);
    next.set(colId, clamped);
    widthMap.value = next;
    persist();
  }

  function resetColumns(): void {
    columnOrder.value = defaultColumns.map((col) => col.id);
    initWidthMap(undefined);
    clearTablePreferences(tableId);
  }

  onBeforeUnmount((): void => {
    stopResize();
  });

  return {
    orderedColumns,
    columnOrder: computed(() => columnOrder.value),
    draggedColId: computed(() => draggedColId.value),
    dragOverColId: computed(() => dragOverColId.value),
    resizingColId: computed(() => resizingColId.value),
    totalTableWidthPx,
    getColumnWidth,
    startDrag,
    onDragOver,
    dropColumn,
    endDrag,
    startResize,
    nudgeColumnWidth,
    resetColumns
  };
}
