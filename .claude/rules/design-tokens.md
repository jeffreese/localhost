# Design Tokens — No Raw Tailwind Utilities

Components must use semantic design token classes (e.g., `text-primary`, `surface-elevated`, `btn-primary`), never raw Tailwind color/spacing utilities (e.g., `bg-blue-500`, `text-gray-200`).

Token definitions live in `tailwind.config.ts` and `src/styles/tokens.css`. Typed style maps are exported from `src/styles/components.ts`.

If a token doesn't exist for what you need, add one — don't reach for raw utilities.

**Source:** ADR-002
