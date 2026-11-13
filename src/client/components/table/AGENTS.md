# Purpose

Modular virtualized table engine with dynamic row-height measurement, Web Worker filtering/sorting, and persistent column ordering/sizing.

## Ownership

Frontend Maintainers.

## Local Contracts

- Dynamic row heights use `FenwickHeightTree` (`O(log N)`) in `useTableVirtualizer.ts` and `ResizeObserver` measurements.
- Column order and widths persist per `tableId` via `src/client/utils/storage.ts` (`vo_table_prefs_v1_<tableId>`).
- Keep filtering/sorting logic pure in `tableQueryCore.ts` so `tableQuery.worker.ts` executes off the main thread.

## Key Files

- [tableTypes.ts](tableTypes.ts): Shared TypeScript contracts for table columns, queries, and persisted preferences.
- [tableQueryCore.ts](tableQueryCore.ts): Pure filtering, sorting, and projection helpers.
- [tableQuery.worker.ts](tableQuery.worker.ts): Web Worker entrypoint for off-main-thread table queries.
- [VirtualDataTable.vue](VirtualDataTable.vue): Shared virtualized table shell with opaque sticky headers and `#row-after` conflict slot.
- [useTableVirtualizer.ts](useTableVirtualizer.ts): `FenwickHeightTree` prefix-sum virtualizer.
- [useTableColumns.ts](useTableColumns.ts): Drag-and-drop column reordering, pointer resizing, and `Reset Columns`.
- [useTableWorker.ts](useTableWorker.ts): Stale-safe Web Worker bridge for table queries.

## Work Guidance

- Reuse `VirtualDataTable.vue` and `useTableWorker.ts` for all tabular views rather than implementing standalone table scrolling or sorting logic.

## Verification

- Run `npm run test:coverage` and `npm run auditor:stylelint` after changes.
