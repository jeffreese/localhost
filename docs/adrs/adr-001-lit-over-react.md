---
title: "ADR-001: Lit over React for UI Components"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
carried_from: sonicforge/ADR-001
---

# ADR-001: Lit over React for UI Components

## Status

Accepted (carried from sonicforge)

## Context

Localhost needs a component framework for its dashboard UI. The application is a straightforward CRUD-style dashboard (project cards, status indicators, settings panels) with real-time updates via SSE. This is a shared architectural decision with sonicforge — both projects use the same view layer stack.

## Decision

We will use **Lit** as the UI component framework, using light DOM mode.

## Alternatives Considered

### React
- **Pros:** Mature ecosystem, large community, strong component patterns
- **Cons:** Virtual DOM overhead unnecessary for a simple dashboard. 40KB+ bundle for an app that doesn't need reconciliation complexity. Lit's ~5KB footprint is more appropriate for a local dev tool.

### Vanilla TypeScript
- **Pros:** Zero dependencies, maximum control
- **Cons:** No built-in reactivity, manual DOM wiring. Would require building what Lit already provides.

## Consequences

### Positive
- ~5KB footprint — appropriate for a local dev tool
- Native custom elements — web standards, not a framework abstraction
- Reactive properties with automatic re-rendering
- Lifecycle callbacks (connectedCallback/disconnectedCallback) for clean store subscription management
- Shared knowledge with sonicforge — same patterns, same mental model

### Negative
- Smaller ecosystem than React — fewer pre-built components
- Template literals syntax differs from JSX

## Enforcement

- Flag any React, Preact, or Solid imports — Lit is the only UI framework
- All UI components must extend `LitElement`
- Component files use `.ts` extension with Lit template literals

## Related Decisions

- ADR-002: Tailwind with design token abstraction
- ADR-003: Light DOM for all components
- ADR-004: Reactive stores for state management
