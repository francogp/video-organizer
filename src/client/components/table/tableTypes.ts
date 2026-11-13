/**
 * Canonical table identifiers persisted in localStorage and dispatched to table workers.
 */
export type TableId = 'queue' | 'verifier';

export type SortDirection = 'asc' | 'desc';

export type TableFacetKey = 'category' | 'mediaKind';

export type TableSortKey = 'include' | 'title' | 'mediaKind' | 'category' | 'size';

/**
 * Column definition for a virtualized table.
 */
export interface TableColumnDef<ColId extends string = string> {
  readonly id: ColId;
  readonly label: string;
  readonly defaultWidthPx: number;
  readonly minWidthPx: number;
  readonly resizable?: boolean;
  readonly reorderable?: boolean;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'center' | 'right';
}

/**
 * Persisted user preferences for column order and widths.
 */
export interface PersistedTablePreferences<ColId extends string = string> {
  readonly version: 1;
  readonly order: readonly ColId[];
  readonly widths: Readonly<Partial<Record<ColId, number>>>;
}

/**
 * Row projection sent to the table query Web Worker.
 */
export interface TableWorkerRowInput {
  readonly index: number;
  readonly searchText: string;
  readonly facetValues: Readonly<Partial<Record<TableFacetKey, string>>>;
  readonly sortValues: Readonly<Partial<Record<TableSortKey, string | number>>>;
}

export interface TableQueryRequest {
  readonly requestId: number;
  readonly searchQuery: string;
  readonly facetFilters: Readonly<Partial<Record<TableFacetKey, string>>>;
  readonly sortBy: TableSortKey | null;
  readonly sortDir: SortDirection;
}

export type TableWorkerInMessage =
  | {
      readonly type: 'SET_ROWS';
      readonly rows: readonly TableWorkerRowInput[];
    }
  | ({
      readonly type: 'QUERY';
    } & TableQueryRequest);

export type FacetCountsByKey = Readonly<
  Partial<Record<TableFacetKey, ReadonlyMap<string, number>>>
>;

export interface TableWorkerResult {
  readonly type: 'RESULT';
  readonly requestId: number;
  readonly indices: Uint32Array;
  readonly totalRows: number;
  readonly filteredRows: number;
  readonly facetCounts: FacetCountsByKey;
}
