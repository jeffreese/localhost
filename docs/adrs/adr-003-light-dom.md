---
title: "ADR-003: Light DOM for All Components"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
carried_from: sonicforge/ADR-003
---

# ADR-003: Light DOM for All Components

## Status

Accepted (carried from sonicforge)

## Context

Lit supports both shadow DOM (default, with style encapsulation) and light DOM (renders into the regular document tree). The choice affects how Tailwind CSS and design tokens apply to components.

## Decision

All Lit components will use **light DOM** — no shadow DOM anywhere in the application.

## Alternatives Considered

### Shadow DOM everywhere (Lit default)
- **Pros:** Style encapsulation, no CSS leaks between components
- **Cons:** Tailwind's global stylesheet can't reach inside shadow roots. Would need to inject styles into every shadow root — wasteful and complex.

### Mixed mode
- **Pros:** Encapsulation where needed
- **Cons:** Cognitive overhead about which components use which mode. Unnecessary for a dashboard app.

## Consequences

### Positive
- Tailwind classes work naturally across all components
- Design token CSS custom properties apply everywhere without injection
- Simpler mental model — one DOM, one stylesheet
- Easier debugging (all elements visible in the regular DOM tree)

### Negative
- No style encapsulation — components must be disciplined about class naming
- Mitigated by Tailwind's utility approach

## Enforcement

- Flag any `createRenderRoot` override that returns `this.shadowRoot` — all components must use light DOM
- Flag `static styles` in components — use Tailwind/token approach instead of component-scoped CSS

## Related Decisions

- ADR-001: Lit over React
- ADR-002: Tailwind with design tokens (requires light DOM)
