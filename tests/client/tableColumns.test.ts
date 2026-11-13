// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vite-plus/test';

import type { TableColumnDef } from '../../src/client/components/table/tableTypes.ts';
import { useTableColumns } from '../../src/client/components/table/useTableColumns.ts';

const TEST_COLUMNS: readonly TableColumnDef<'a' | 'b' | 'c'>[] = [
  { id: 'a', label: 'A', defaultWidthPx: 100, minWidthPx: 60 },
  { id: 'b', label: 'B', defaultWidthPx: 200, minWidthPx: 80 },
  { id: 'c', label: 'C', defaultWidthPx: 150, minWidthPx: 90, reorderable: false }
];

describe('useTableColumns', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reorders reorderable columns, persists to localStorage, and resets cleanly', () => {
    const first = useTableColumns('queue', TEST_COLUMNS);
    expect(first.orderedColumns.value.map((col) => col.id)).toEqual(['a', 'b', 'c']);
    expect(first.totalTableWidthPx.value).toBe(450);

    first.startDrag('a');
    first.onDragOver('b');
    first.dropColumn('b');
    expect(first.orderedColumns.value.map((col) => col.id)).toEqual(['b', 'a', 'c']);

    // Non-reorderable column 'c' cannot be dragged or dropped onto
    first.startDrag('c');
    expect(first.draggedColId.value).toBeNull();

    // Reloading picks up persisted order
    const reloaded = useTableColumns('queue', TEST_COLUMNS);
    expect(reloaded.orderedColumns.value.map((col) => col.id)).toEqual(['b', 'a', 'c']);

    reloaded.resetColumns();
    expect(reloaded.orderedColumns.value.map((col) => col.id)).toEqual(['a', 'b', 'c']);
    expect(localStorage.getItem('vo_table_prefs_v1_queue')).toBeNull();
  });

  it('resizes columns clamping to minWidthPx and persists across reloads', () => {
    const cols = useTableColumns('verifier', TEST_COLUMNS);
    cols.startResize('b', 100);
    globalThis.dispatchEvent(new PointerEvent('pointermove', { clientX: 0 }));
    globalThis.dispatchEvent(new PointerEvent('pointerup'));

    // 200 + (0 - 100) = 100 >= minWidthPx (80)
    expect(cols.getColumnWidth('b')).toBe(100);

    cols.startResize('b', 100);
    globalThis.dispatchEvent(new PointerEvent('pointermove', { clientX: -200 }));
    globalThis.dispatchEvent(new PointerEvent('pointerup'));
    // Clamped to minWidthPx 80
    expect(cols.getColumnWidth('b')).toBe(80);

    const reloaded = useTableColumns('verifier', TEST_COLUMNS);
    expect(reloaded.getColumnWidth('b')).toBe(80);

    // Invalid persisted payloads fall back to defaults safely
    localStorage.setItem('vo_table_prefs_v1_queue', '{bad json');
    expect(useTableColumns('queue', TEST_COLUMNS).getColumnWidth('a')).toBe(100);
    localStorage.setItem('vo_table_prefs_v1_queue', JSON.stringify({ version: 2, order: [] }));
    expect(useTableColumns('queue', TEST_COLUMNS).getColumnWidth('a')).toBe(100);

    // Drag edge cases (same column, non-reorderable target, endDrag)
    reloaded.startDrag('a');
    reloaded.onDragOver('a');
    reloaded.onDragOver('c');
    reloaded.dropColumn('c');
    reloaded.endDrag();
    expect(reloaded.draggedColId.value).toBeNull();
    expect(reloaded.getColumnWidth('unknown' as 'a')).toBe(120);

    cols.nudgeColumnWidth('a', 16);
    expect(cols.getColumnWidth('a')).toBe(116);
    cols.nudgeColumnWidth('a', -500);
    expect(cols.getColumnWidth('a')).toBe(60);

    const fixedCols = useTableColumns('queue', [
      { id: 'x', label: 'X', defaultWidthPx: 90, minWidthPx: 60, resizable: false },
      { id: 'r', label: 'R', defaultWidthPx: 90, minWidthPx: 60 }
    ]);
    fixedCols.startResize('x', 100);
    fixedCols.nudgeColumnWidth('x', 20);
    expect(fixedCols.getColumnWidth('x')).toBe(90);
    fixedCols.nudgeColumnWidth('r', -100);
    expect(fixedCols.getColumnWidth('r')).toBe(60);
  });
});
