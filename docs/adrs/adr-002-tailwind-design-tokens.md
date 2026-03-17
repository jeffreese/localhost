---
title: "ADR-002: Tailwind CSS with Design Token Abstraction"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
carried_from: sonicforge/ADR-002
---

# ADR-002: Tailwind CSS with Design Token Abstraction

## Status

Accepted (carried from sonicforge)

## Context

Localhost needs consistent styling across its dashboard components (project cards, status indicators, port table, config panel). The styling approach must work with Lit's light DOM and support potential theming.

## Decision

We will use **Tailwind CSS** with a design token abstraction layer:

1. `tailwind.config.ts` defines semantic design tokens as CSS custom properties
2. `src/styles/tokens.css` maps token values per theme
3. `src/styles/components.ts` exports typed style maps that Lit components import

Components reference semantic names (`btn.primary`, `surface.elevated`, `status.running`, `status.error`), never raw Tailwind classes.

## Alternatives Considered

### Raw Tailwind in templates
- **Pros:** Fast to write, no abstraction layer
- **Cons:** No centralized control. Theme changes touch every component. Inconsistency at scale.

### Plain CSS custom properties (no Tailwind)
- **Pros:** Zero dependencies
- **Cons:** Slower to author, no utility shortcuts, must build spacing/typography systems from scratch

## Consequences

### Positive
- Consistent vocabulary across all components
- One place to update when the design system evolves
- Type-safe style maps catch typos at build time
- Tailwind's utility power for rapid development

### Negative
- Extra abstraction layer to maintain (`components.ts`)
- Developers must use style maps, not raw classes — requires discipline

## Enforcement

- Flag raw Tailwind color/spacing classes in component templates — must use semantic token names
- All theme values defined as CSS custom properties, not hardcoded values

## Related Decisions

- ADR-001: Lit over React
- ADR-003: Light DOM for all components (enables Tailwind's global stylesheet)
