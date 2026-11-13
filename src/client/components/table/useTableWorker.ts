import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from 'vue';

import { executeTableQuery } from './tableQueryCore.ts';
import type {
  FacetCountsByKey,
  SortDirection,
  TableFacetKey,
  TableQueryRequest,
  TableSortKey,
  TableWorkerResult,
  TableWorkerRowInput
} from './tableTypes.ts';

export interface TableQueryParams {
  readonly searchQuery: string;
  readonly facetFilters: Readonly<Partial<Record<TableFacetKey, string>>>;
  readonly sortBy: TableSortKey | null;
  readonly sortDir: SortDirection;
}

export interface TableWorkerHandle {
  readonly filteredIndices: ShallowRef<Uint32Array>;
  readonly totalRows: Ref<number>;
  readonly filteredRows: Ref<number>;
  readonly facetCounts: ShallowRef<FacetCountsByKey>;
  readonly isQuerying: Ref<boolean>;
  readonly setRows: (rows: readonly TableWorkerRowInput[]) => void;
  readonly runQuery: (params: TableQueryParams) => void;
}

/**
 * Offloads table filtering, sorting, and facet counting to a dedicated Web Worker
 * with automatic synchronous fallback in environments without Worker support (e.g., Happy-DOM).
 */
export function useTableWorker(): TableWorkerHandle {
  const filteredIndices = shallowRef<Uint32Array>(new Uint32Array(0));
  const totalRows = ref(0);
  const filteredRows = ref(0);
  const facetCounts = shallowRef<FacetCountsByKey>({});
  const isQuerying = ref(false);

  let fallbackRows: readonly TableWorkerRowInput[] = [];
  let latestRequestId = 0;
  let worker: Worker | null = null;

  function applyResult(result: TableWorkerResult): void {
    if (result.requestId !== latestRequestId) {
      return;
    }
    filteredIndices.value = result.indices;
    totalRows.value = result.totalRows;
    filteredRows.value = result.filteredRows;
    facetCounts.value = result.facetCounts;
    isQuerying.value = false;
  }

  function ensureWorker(): Worker | null {
    if (worker) {
      return worker;
    }
    if (typeof Worker === 'undefined') {
      return null;
    }
    try {
      const instance = new Worker(new URL('./tableQuery.worker.ts', import.meta.url), {
        type: 'module'
      });
      instance.addEventListener('message', (event: MessageEvent<TableWorkerResult>): void => {
        applyResult(event.data);
      });
      instance.addEventListener('error', (): void => {
        isQuerying.value = false;
      });
      worker = instance;
      return worker;
    } catch {
      return null;
    }
  }

  function setRows(rows: readonly TableWorkerRowInput[]): void {
    fallbackRows = rows;
    const activeWorker = ensureWorker();
    if (activeWorker) {
      activeWorker.postMessage({ type: 'SET_ROWS', rows });
    }
  }

  function runQuery(params: TableQueryParams): void {
    latestRequestId += 1;
    const request: TableQueryRequest = {
      requestId: latestRequestId,
      searchQuery: params.searchQuery,
      facetFilters: { ...params.facetFilters },
      sortBy: params.sortBy,
      sortDir: params.sortDir
    };

    const activeWorker = ensureWorker();
    if (activeWorker) {
      isQuerying.value = true;
      activeWorker.postMessage({ type: 'QUERY', ...request });
      return;
    }

    const syncResult = executeTableQuery(fallbackRows, request);
    applyResult(syncResult);
  }

  onBeforeUnmount((): void => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  });

  return {
    filteredIndices,
    totalRows,
    filteredRows,
    facetCounts,
    isQuerying,
    setRows,
    runQuery
  };
}
