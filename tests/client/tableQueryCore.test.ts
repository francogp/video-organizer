import { describe, expect, it, vi } from 'vite-plus/test';

import { executeTableQuery } from '../../src/client/components/table/tableQueryCore.ts';
import type {
  TableWorkerInMessage,
  TableWorkerResult,
  TableWorkerRowInput
} from '../../src/client/components/table/tableTypes.ts';
import { useTableWorker } from '../../src/client/components/table/useTableWorker.ts';

describe('executeTableQuery & useTableWorker', () => {
  it('filters, counts facets in O(N), and sorts 5,000 rows returning Uint32Array indices', () => {
    const rows: TableWorkerRowInput[] = [];
    for (let i = 0; i < 5_000; i++) {
      rows.push({
        index: i,
        searchText: `video title ${i} ${i % 2 === 0 ? 'movies' : 'series'}`,
        facetValues: {
          category: i % 2 === 0 ? 'movies' : 'tv-shows'
        },
        sortValues: {
          size: 5_000 - i,
          title: `Title ${String(i).padStart(4, '0')}`
        }
      });
    }

    const res = executeTableQuery(rows, {
      requestId: 7,
      searchQuery: 'title 499',
      facetFilters: { category: 'movies' },
      sortBy: 'size',
      sortDir: 'asc'
    });

    expect(res.requestId).toBe(7);
    expect(res.totalRows).toBe(5_000);
    // Matches 499 (odd -> tv-shows) and 4990..4999 (5 even, 5 odd)
    expect(res.facetCounts.category?.get('movies')).toBe(5);
    expect(res.facetCounts.category?.get('tv-shows')).toBe(6);
    expect(Array.from(res.indices)).toEqual([4998, 4996, 4994, 4992, 4990]);

    const sortedByTitle = executeTableQuery(rows.slice(0, 3), {
      requestId: 8,
      searchQuery: '',
      facetFilters: {},
      sortBy: 'title',
      sortDir: 'desc'
    });
    expect(Array.from(sortedByTitle.indices)).toEqual([2, 1, 0]);

    const missingSort = executeTableQuery(
      [
        { index: 0, searchText: 'a', facetValues: {}, sortValues: {} },
        { index: 1, searchText: 'b', facetValues: {}, sortValues: { title: 'b' } }
      ],
      { requestId: 9, searchQuery: '', facetFilters: {}, sortBy: 'title', sortDir: 'asc' }
    );
    expect(Array.from(missingSort.indices)).toEqual([0, 1]);
  });

  it('uses Web Worker when available and drops stale out-of-order responses', () => {
    const listeners = new Map<string, Array<(event: MessageEvent<TableWorkerResult>) => void>>();
    const posted: TableWorkerInMessage[] = [];

    class MockWorker {
      public addEventListener(
        type: string,
        fn: (event: MessageEvent<TableWorkerResult>) => void
      ): void {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      }
      public postMessage(msg: TableWorkerInMessage): void {
        posted.push(msg);
      }
      public terminate(): void {}
    }

    vi.stubGlobal('Worker', MockWorker);
    try {
      const workerHandle = useTableWorker();
      workerHandle.setRows([
        { index: 0, searchText: 'alpha', facetValues: {}, sortValues: {} },
        { index: 1, searchText: 'beta', facetValues: {}, sortValues: {} }
      ]);
      workerHandle.runQuery({
        searchQuery: 'a',
        facetFilters: {},
        sortBy: null,
        sortDir: 'asc'
      });
      workerHandle.runQuery({
        searchQuery: 'beta',
        facetFilters: {},
        sortBy: null,
        sortDir: 'asc'
      });

      expect(posted).toHaveLength(3);
      expect(workerHandle.isQuerying.value).toBe(true);

      const messageHandlers = listeners.get('message') ?? [];
      // Stale requestId=1 should be ignored
      messageHandlers[0]?.({
        data: {
          type: 'RESULT',
          requestId: 1,
          indices: Uint32Array.from([0, 1]),
          totalRows: 2,
          filteredRows: 2,
          facetCounts: {}
        }
      } as MessageEvent<TableWorkerResult>);
      expect(workerHandle.isQuerying.value).toBe(true);

      // Current requestId=2 is applied
      messageHandlers[0]?.({
        data: {
          type: 'RESULT',
          requestId: 2,
          indices: Uint32Array.from([1]),
          totalRows: 2,
          filteredRows: 1,
          facetCounts: {}
        }
      } as MessageEvent<TableWorkerResult>);
      expect(workerHandle.isQuerying.value).toBe(false);
      expect(Array.from(workerHandle.filteredIndices.value)).toEqual([1]);

      const errorHandlers = listeners.get('error') ?? [];
      errorHandlers[0]?.({} as MessageEvent<TableWorkerResult>);
      expect(workerHandle.isQuerying.value).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
