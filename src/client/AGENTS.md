# Purpose

Vue 3 + Pinia + SCSS + GSAP frontend console for scanning, inspecting tracks, resolving pre-flight conflicts, and monitoring remux progress over SSE.

## Ownership

Frontend Maintainers.

## Local Contracts

- Uses `<script setup lang="ts">` and Pinia Composition API stores.
- All `localStorage` and `sessionStorage` access goes through [utils/storage.ts](utils/storage.ts) with `try/catch`.
- All SCSS follows Dart Sass `@use` syntax, semantic `oklch`/`color-mix` tokens, and max 3 nesting levels.

## Key Files

- [main.ts](main.ts): Vue + Pinia bootstrap.
- [App.vue](App.vue): Main dashboard shell, theme toggle, LAN lock banner, and modal orchestration.

## Work Guidance

- Keep components focused and delegate API/SSE state to [stores/AGENTS.md](stores/AGENTS.md).

## Verification

- Run `npm run test:coverage` and `npm run auditor:stylelint` after changes.

## Child DOX Index

- [components/AGENTS.md](components/AGENTS.md): Vue UI components and modals.
- [composables/AGENTS.md](composables/AGENTS.md): Vue composables (GSAP motion).
- [stores/AGENTS.md](stores/AGENTS.md): Pinia state stores.
- [styles/AGENTS.md](styles/AGENTS.md): SCSS design tokens and global base styles.
- [utils/AGENTS.md](utils/AGENTS.md): Safe browser storage utilities.
