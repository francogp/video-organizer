import type {
  FacetCountsByKey,
  TableFacetKey,
  TableQueryRequest,
  TableWorkerResult,
  TableWorkerRowInput
} from './tableTypes.ts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const FACET_KEYS: readonly TableFacetKey[] = ['category', 'mediaKind'];

function incrementFacet(
  facetMap: Map<TableFacetKey, Map<string, number>>,
  facetKey: TableFacetKey,
  facetValue: string
): void {
  let counts = facetMap.get(facetKey);
  if (!counts) {
    counts = new Map<string, number>();
    facetMap.set(facetKey, counts);
  }
  counts.set(facetValue, (counts.get(facetValue) ?? 0) + 1);
}

function serializeFacets(facetMap: Map<TableFacetKey, Map<string, number>>): FacetCountsByKey {
  const result: Partial<Record<TableFacetKey, ReadonlyMap<string, number>>> = {};
  for (const [facetKey, counts] of facetMap.entries()) {
    result[facetKey] = counts;
  }
  return result;
}

/**
 * Pure O(N) filter + O(1) Map facet aggregation + O(M log M) sort returning a transferable Uint32Array of row indices.
 */
export function executeTableQuery(
  rows: readonly TableWorkerRowInput[],
  request: TableQueryRequest
): TableWorkerResult {
  const normalizedQuery = request.searchQuery.trim().toLowerCase();
  const activeFacets: Array<readonly [TableFacetKey, string]> = [];
  for (const key of FACET_KEYS) {
    const val = request.facetFilters[key];
    if (val !== undefined && val !== '' && val !== 'all') {
      activeFacets.push([key, val]);
    }
  }

  const facetMap = new Map<TableFacetKey, Map<string, number>>();
  const matched: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) {
      continue;
    }
    if (normalizedQuery.length > 0 && !row.searchText.includes(normalizedQuery)) {
      continue;
    }

    for (const key of FACET_KEYS) {
      const facetVal = row.facetValues[key];
      if (facetVal !== undefined) {
        incrementFacet(facetMap, key, facetVal);
      }
    }

    let passesFacets = true;
    for (let f = 0; f < activeFacets.length; f++) {
      const pair = activeFacets[f];
      if (!pair) {
        continue;
      }
      const [facetKey, expectedVal] = pair;
      if (row.facetValues[facetKey] !== expectedVal) {
        passesFacets = false;
        break;
      }
    }

    if (passesFacets) {
      matched.push(row.index);
    }
  }

  const sortBy = request.sortBy;
  if (sortBy) {
    const dirMultiplier = request.sortDir === 'desc' ? -1 : 1;
    matched.sort((aIdx, bIdx): number => {
      const aVal = rows[aIdx]?.sortValues[sortBy];
      const bVal = rows[bIdx]?.sortValues[sortBy];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dirMultiplier;
      }
      const aStr = aVal === undefined ? '' : String(aVal);
      const bStr = bVal === undefined ? '' : String(bVal);
      return collator.compare(aStr, bStr) * dirMultiplier;
    });
  }

  return {
    type: 'RESULT',
    requestId: request.requestId,
    indices: Uint32Array.from(matched),
    totalRows: rows.length,
    filteredRows: matched.length,
    facetCounts: serializeFacets(facetMap)
  };
}

/** Returns true when there is at least one visible row and all visible rows are selected. */
export function areAllVisibleRowsSelected<T extends { readonly id: string }>(
  indices: readonly number[] | Uint32Array,
  items: readonly T[],
  selectedIds: ReadonlySet<string>
): boolean {
  if (indices.length === 0) {
    return false;
  }
  for (let i = 0; i < indices.length; i++) {
    const rawIdx = indices[i];
    const row = rawIdx !== undefined ? items[rawIdx] : undefined;
    if (row && !selectedIds.has(row.id)) {
      return false;
    }
  }
  return true;
}
