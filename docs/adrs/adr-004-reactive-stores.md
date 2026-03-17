---
title: "ADR-004: Reactive Stores for State Management"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
carried_from: sonicforge/ADR-004
---

# ADR-004: Reactive Stores for State Management

## Status

Accepted (carried from sonicforge)

## Context

Localhost's dashboard needs to reflect real-time state from the backend (process status, port assignments, scan results) while also managing UI-local state (selected project, panel visibility). Multiple components observe the same data — e.g., both the project card and port table need process state.

## Decision

We will use **small, typed reactive store classes** — one per domain:

- **ProjectStore** — discovered projects, metadata, visibility (visible/hidden/ignored)
- **ProcessStore** — running state, PIDs, ports, health, port conflicts
- **UIStore** — dashboard view state (local only, no backend persistence)

Stores are observable: Lit components subscribe on `connectedCallback`, unsubscribe on `disconnectedCallback`. The SSE event handler pushes backend state into ProjectStore and ProcessStore. No external state management framework.

## Alternatives Considered

### Redux / Zustand / external state library
- **Pros:** Battle-tested patterns, devtools
- **Cons:** Overkill for three small stores. Adds framework weight and concepts that don't match the simplicity of the data model.

### Component-local state only
- **Pros:** Zero overhead
- **Cons:** Multiple components need the same data (project card + port table both need process state). No clean way to share without prop drilling or events.

## Consequences

### Positive
- Clear state ownership — each store is the single source of truth for its domain
- Multiple components can subscribe to the same store
- No framework dependency — stores are plain TypeScript classes
- SSE events map directly to store updates

### Negative
- Custom implementation to maintain
- Must manage subscription lifecycle carefully (connect/disconnect)

## Enforcement

- No external state management libraries (Redux, Zustand, MobX, etc.)
- One store per domain — flag new stores that overlap existing store responsibilities
- Components must unsubscribe in `disconnectedCallback`

## Related Decisions

- ADR-001: Lit over React
- ADR-005: SSE for real-time state updates (SSE feeds into stores)
