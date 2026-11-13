# Purpose

Vue 3 composables for scoped UI behavior and motion.

## Ownership

Frontend Maintainers.

## Local Contracts

- All GSAP timelines/contexts must respect `prefers-reduced-motion` and revert on `onUnmounted`.

## Key Files

- [useGsapMotion.ts](useGsapMotion.ts): Scoped GSAP entrance animation composable.

## Work Guidance

- Always declare explicit return types on exported composables.

## Verification

- Run `npm run test:coverage` and `npm run auditor:oxlint` after changes.
