# Purpose

SCSS design tokens (`oklch` / `color-mix`) and global base styles.

## Ownership

Frontend Maintainers.

## Local Contracts

- Use modern Dart Sass `@use` syntax exclusively (no `@import`).
- Define all spacing, font, radius, and color tokens as CSS custom properties in [_tokens.scss](_tokens.scss).

## Key Files

- [_tokens.scss](_tokens.scss): Dark/light theme CSS custom properties.
- [main.scss](main.scss): Global base styles, button/badge primitives, and shared modal layout classes.

## Work Guidance

- Keep nesting depth <= 3 and avoid literal magic values in component or global styles.

## Verification

- Run `npm run auditor:stylelint` after style changes.
