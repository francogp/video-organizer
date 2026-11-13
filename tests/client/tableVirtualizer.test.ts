// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vite-plus/test';
import { defineComponent, ref } from 'vue';

import { useTableVirtualizer } from '../../src/client/components/table/useTableVirtualizer.ts';

describe('useTableVirtualizer', () => {
  it('computes O(log N) prefix sums, totalHeightPx, and scroll offset lookups across 10k rows', async () => {
    const rowCount = ref(10_000);
    const virtualizer = useTableVirtualizer({
      rowCount,
      estimatedRowHeight: 100,
      overscan: 2
    });

    expect(virtualizer.totalHeightPx.value).toBe(1_000_000);
    expect(virtualizer.startIndex.value).toBe(0);
    expect(virtualizer.endIndex.value).toBeGreaterThan(0);

    virtualizer.measureRowHeight(2, 240);
    expect(virtualizer.totalHeightPx.value).toBe(1_000_140);
    virtualizer.measureRowHeight(2, 240.2);
    expect(virtualizer.totalHeightPx.value).toBe(1_000_140);

    virtualizer.handleScroll(999_500);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(virtualizer.endIndex.value).toBe(10_000);
  });

  it('virtualizes visible slice, handles scroll updates, and measures dynamic row heights', async () => {
    const rowCount = ref(500);
    const virtualizer = useTableVirtualizer({
      rowCount,
      estimatedRowHeight: 100,
      overscan: 2
    });

    expect(virtualizer.startIndex.value).toBe(0);
    expect(virtualizer.endIndex.value).toBeGreaterThan(0);
    expect(virtualizer.totalHeightPx.value).toBe(50_000);
    expect(virtualizer.topSpacerPx.value).toBe(0);
    expect(virtualizer.bottomSpacerPx.value).toBeGreaterThan(0);

    virtualizer.handleScroll(2_000);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(virtualizer.startIndex.value).toBeGreaterThan(10);
    expect(virtualizer.topSpacerPx.value).toBeGreaterThan(0);

    virtualizer.measureRowHeight(0, 160);
    virtualizer.measureRowHeight(0, 0);
    expect(virtualizer.totalHeightPx.value).toBe(50_060);

    const div = document.createElement('div');
    virtualizer.observeViewport(div);
    virtualizer.observeViewport(null);

    rowCount.value = 0;
    expect(virtualizer.endIndex.value).toBe(0);
  });

  it('cleans up rAF and ResizeObserver on component unmount', () => {
    const disconnectSpy = vi.fn();
    const observeSpy = vi.fn();
    let roCallback: ResizeObserverCallback | null = null;

    class MockResizeObserver {
      public constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      public observe(el: Element): void {
        observeSpy(el);
      }
      public disconnect(): void {
        disconnectSpy();
      }
      public unobserve(): void {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    try {
      const Host = defineComponent({
        setup() {
          const count = ref(20);
          const v = useTableVirtualizer({ rowCount: count, estimatedRowHeight: 80 });
          const div = document.createElement('div');
          v.observeViewport(div);
          v.handleScroll(120);
          roCallback?.(
            [{ contentRect: { height: 700 } } as ResizeObserverEntry],
            {} as ResizeObserver
          );
          return v;
        },
        template: '<div />'
      });
      const wrapper = mount(Host);
      expect(observeSpy).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
