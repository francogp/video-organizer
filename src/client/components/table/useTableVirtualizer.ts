import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue';

/**
 * Binary Indexed Tree (Fenwick Tree) over Float64Array for O(log N) prefix sums,
 * O(log N) height updates, O(log N) binary-lifted scroll offset lookup, and O(1) total height.
 */
class FenwickHeightTree {
  private tree = new Float64Array(1);
  private heights = new Float64Array(0);
  private cachedTotal = 0;

  public get size(): number {
    return this.heights.length;
  }

  public get totalHeight(): number {
    return this.cachedTotal;
  }

  public reset(count: number, defaultHeight: number): void {
    const safeCount = Math.max(0, count);
    this.heights = new Float64Array(safeCount);
    this.tree = new Float64Array(safeCount + 1);
    this.cachedTotal = safeCount * defaultHeight;

    for (let i = 0; i < safeCount; i++) {
      this.heights[i] = defaultHeight;
      this.tree[i + 1] = defaultHeight;
    }
    for (let i = 1; i <= safeCount; i++) {
      const parent = i + (i & -i);
      if (parent <= safeCount) {
        this.tree[parent] = (this.tree[parent] ?? 0) + (this.tree[i] ?? 0);
      }
    }
  }

  public getHeight(index: number): number {
    if (index < 0 || index >= this.heights.length) {
      return 0;
    }
    return this.heights[index] ?? 0;
  }

  public updateHeight(index: number, nextHeight: number): boolean {
    if (index < 0 || index >= this.heights.length) {
      return false;
    }
    const prev = this.heights[index] ?? 0;
    const delta = nextHeight - prev;
    if (Math.abs(delta) < 0.5) {
      return false;
    }
    this.heights[index] = nextHeight;
    this.cachedTotal += delta;

    let idx = index + 1;
    const limit = this.heights.length;
    while (idx <= limit) {
      this.tree[idx] = (this.tree[idx] ?? 0) + delta;
      idx += idx & -idx;
    }
    return true;
  }

  /** Returns the cumulative height of rows [0, count). */
  public prefixSum(count: number): number {
    const clamped = Math.max(0, Math.min(count, this.heights.length));
    let sum = 0;
    let idx = clamped;
    while (idx > 0) {
      sum += this.tree[idx] ?? 0;
      idx -= idx & -idx;
    }
    return sum;
  }

  /**
   * Binary-lifts through the Fenwick tree in O(log N) to find the first row index
   * whose bottom edge is strictly greater than `offsetPx`.
   */
  public findIndexForOffset(offsetPx: number): number {
    const n = this.heights.length;
    if (n === 0 || offsetPx <= 0) {
      return 0;
    }
    if (offsetPx >= this.cachedTotal) {
      return n - 1;
    }

    let idx = 0;
    let acc = 0;
    let bit = 1;
    while (bit << 1 <= n) {
      bit <<= 1;
    }

    while (bit > 0) {
      const next = idx + bit;
      if (next <= n && acc + (this.tree[next] ?? 0) <= offsetPx) {
        idx = next;
        acc += this.tree[next] ?? 0;
      }
      bit >>= 1;
    }

    return Math.min(idx, n - 1);
  }
}

export interface UseTableVirtualizerOptions {
  readonly rowCount: Ref<number>;
  readonly estimatedRowHeight: number;
  readonly overscan?: number;
}

export interface TableVirtualizerHandle {
  readonly startIndex: ComputedRef<number>;
  readonly endIndex: ComputedRef<number>;
  readonly topSpacerPx: ComputedRef<number>;
  readonly bottomSpacerPx: ComputedRef<number>;
  readonly totalHeightPx: ComputedRef<number>;
  readonly handleScroll: (nextScrollTop: number) => void;
  readonly measureRowHeight: (index: number, heightPx: number) => void;
  readonly observeViewport: (el: HTMLElement | null) => void;
}

/**
 * Virtualizes large tables using a FenwickHeightTree, ResizeObserver, and rAF scroll batching.
 */
export function useTableVirtualizer(options: UseTableVirtualizerOptions): TableVirtualizerHandle {
  const overscan = options.overscan ?? 8;
  const fenwick = new FenwickHeightTree();
  const scrollTop = ref(0);
  const viewportHeight = ref(560);
  const heightRevision = ref(0);

  let lastCount = -1;
  let scrollRafId: number | null = null;
  let pendingScrollTop = 0;
  let resizeObserver: ResizeObserver | null = null;

  function syncTreeSize(): void {
    const count = options.rowCount.value;
    if (count !== lastCount) {
      fenwick.reset(count, options.estimatedRowHeight);
      lastCount = count;
      heightRevision.value += 1;
    }
  }

  const startIndex = computed((): number => {
    void heightRevision.value;
    syncTreeSize();
    const first = fenwick.findIndexForOffset(scrollTop.value);
    return Math.max(0, first - overscan);
  });

  const endIndex = computed((): number => {
    void heightRevision.value;
    syncTreeSize();
    const count = options.rowCount.value;
    if (count === 0) {
      return 0;
    }
    const bottomOffset = scrollTop.value + viewportHeight.value;
    const lastVisible = fenwick.findIndexForOffset(bottomOffset);
    return Math.min(count, lastVisible + 1 + overscan);
  });

  const topSpacerPx = computed(() => {
    void heightRevision.value;
    syncTreeSize();
    return fenwick.prefixSum(startIndex.value);
  });

  const totalHeightPx = computed(() => {
    void heightRevision.value;
    syncTreeSize();
    return fenwick.totalHeight;
  });

  const bottomSpacerPx = computed((): number => {
    void heightRevision.value;
    syncTreeSize();
    const renderedBottom = fenwick.prefixSum(endIndex.value);
    return Math.max(0, fenwick.totalHeight - renderedBottom);
  });

  function handleScroll(nextScrollTop: number): void {
    pendingScrollTop = nextScrollTop;
    if (scrollRafId !== null) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      scrollTop.value = pendingScrollTop;
      return;
    }
    scrollRafId = globalThis.requestAnimationFrame((): void => {
      scrollRafId = null;
      scrollTop.value = pendingScrollTop;
    });
  }

  function measureRowHeight(index: number, heightPx: number): void {
    if (heightPx <= 0) {
      return;
    }
    if (fenwick.updateHeight(index, heightPx)) {
      heightRevision.value += 1;
    }
  }

  function observeViewport(el: HTMLElement | null): void {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (!el) {
      return;
    }
    if (el.clientHeight > 0) {
      viewportHeight.value = el.clientHeight;
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries): void => {
        const first = entries[0];
        if (first && first.contentRect.height > 0) {
          viewportHeight.value = first.contentRect.height;
        }
      });
      resizeObserver.observe(el);
    }
  }

  onBeforeUnmount((): void => {
    if (scrollRafId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    totalHeightPx,
    handleScroll,
    measureRowHeight,
    observeViewport
  };
}
