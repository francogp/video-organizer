import { CANONICAL_Z_LAYERS, resolveModalCssVars } from '@francogp/auditor/modals';
import gsap from 'gsap';
import { computed, onUnmounted, type ComputedRef, type Ref } from 'vue';

const ENTER_DURATION_SEC = 0.28;
const ENTER_Y_OFFSET_PX = 10;
const STAGGER_SEC = 0.03;

/** Returns reactive modal z-index CSS custom properties for a given stack layer. */
export function useModalVars(
  layerIndex: number
): ComputedRef<ReturnType<typeof resolveModalCssVars>> {
  const baseZ =
    CANONICAL_Z_LAYERS.MODAL + CANONICAL_Z_LAYERS.MODAL_STEP * Math.max(0, layerIndex - 1);
  return computed(() =>
    resolveModalCssVars({
      zIndex: baseZ,
      backdropZIndex: baseZ,
      contentZIndex: baseZ + CANONICAL_Z_LAYERS.MODAL_STEP
    })
  );
}

/** Manages scoped GSAP timelines and entrance animations with `prefers-reduced-motion` support. */
export function useGsapMotion(rootRef: Ref<HTMLElement | null>): {
  readonly animateShellTimeline: () => void;
  readonly animateEntrance: (selector: string) => void;
} {
  let ctx: gsap.Context | undefined;

  function animateShellTimeline(): void {
    if (!rootRef.value) {
      return;
    }
    ctx?.revert();
    ctx = gsap.context((): void => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', (): void => {
        const tl = gsap.timeline({
          defaults: { duration: ENTER_DURATION_SEC, ease: 'power3.out' }
        });
        tl.from('.vo-header', {
          opacity: 0,
          y: -ENTER_Y_OFFSET_PX,
          clearProps: 'transform,opacity'
        }).from(
          '.vo-panel',
          {
            opacity: 0,
            y: ENTER_Y_OFFSET_PX,
            stagger: STAGGER_SEC,
            clearProps: 'transform,opacity'
          },
          '<0.06'
        );
      });
    }, rootRef.value);
  }

  function animateEntrance(selector: string): void {
    if (!rootRef.value) {
      return;
    }
    ctx?.revert();
    ctx = gsap.context((): void => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', (): void => {
        gsap.from(selector, {
          opacity: 0,
          y: ENTER_Y_OFFSET_PX,
          duration: ENTER_DURATION_SEC,
          stagger: STAGGER_SEC,
          ease: 'power2.out',
          clearProps: 'transform,opacity'
        });
      });
    }, rootRef.value);
  }

  onUnmounted((): void => {
    ctx?.revert();
  });

  return { animateShellTimeline, animateEntrance };
}
