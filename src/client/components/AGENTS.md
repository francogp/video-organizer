# Purpose

Vue 3 UI components and accessible modals for the organizer queue and track inspection.

## Ownership

Frontend Maintainers.

## Local Contracts

- Modals must resolve z-index CSS custom properties via `@francogp/auditor/modals`.
- Scoped styles must consume CSS custom properties from `src/client/styles/_tokens.scss`.
- Table headers (`<th>`) must use an opaque surface (`var(--vo-surface-elevated)`) with explicit cell borders, a single horizontal scrollbar on the table wrapper, and `min-width: 0; max-width: 100%;` on cells so content never overlaps adjacent columns.
- Parent components styling `VirtualDataTable` rows (`QueueTable.vue`) must use `:deep(tr.vo-row--has-conflict)` and `--vo-warning` (never `--vo-warn`), keeping a continuous left accent border across the parent row and `#row-after` conflict panel plus the target filename in the conflict header.
- Include descriptive `<span aria-hidden="true">` emojis on action buttons, count badges on primary batch triggers, and keep the active job progress bar split into three rows (Cancel button + metrics/ETA, active filename, `<progress>`).
- Expose visible-row bulk selection exclusively via the `#vo-select-all-visible` header checkbox in `QueueTable.vue` (never duplicate a toolbar `Select Visible` button), and serve the standalone vector Chevron Stack icon from `public/favicon.svg` across `index.html` and the `src/client/App.vue` header.

## Key Files

- [QueueTable.vue](QueueTable.vue): Dense media queue table.
- [MetadataSearchModal.vue](MetadataSearchModal.vue): Interactive provider search and manual IMDb/TVDB ID override modal.
- [TrackInspectorModal.vue](TrackInspectorModal.vue): Audio/subtitle track inspector and series batch apply.
- [ConflictResolutionModal.vue](ConflictResolutionModal.vue): Blocking pre-flight conflict comparator.
- [VerifierView.vue](VerifierView.vue): Plex library naming compliance verifier and bottom-up rename view.

## Work Guidance

- Keep UI components declarative and emit typed events to `App.vue`.

## Verification

- Run `npm run test:coverage` and `npm run auditor:stylelint` after changes.

## Child DOX Index

- [table/AGENTS.md](table/AGENTS.md): Modular virtualized table engine (`VirtualDataTable.vue`, `FenwickHeightTree`, Web Worker query/sort, and column drag/resize persistence).
