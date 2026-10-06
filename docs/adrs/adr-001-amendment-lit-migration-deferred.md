---
title: "ADR-001 Amendment: Lit → React Migration Deferred"
phase: 2
project: localhost
date: 2026-10-05
status: accepted
---

# ADR-001 Amendment: Lit → React Migration Deferred

## Status

Accepted — amends ADR-001 (Lit over React)

## Context

The original ADR-001 chose Lit over React for bundle size and alignment with sonicforge. Since then, the user's standard stack has shifted to React 19 + TanStack Router + TanStack Query + Radix UI (used in HealthPulse, FinPulse, and other projects). The Lit choice now creates context-switching friction.

However, the critical problems in localhost are all server-side: blocking I/O, dangerous process management, half-built reactivity, config race conditions. The Lit frontend is functional. A React migration touches every file in `src/client/` and would be a big-bang rewrite of the working half of the app.

## Decision

Defer the Lit → React migration. Stabilize the server first. Evaluate React migration as a separate project once server-side work is complete.

ADR-001's "Lit only" constraint remains in effect for this retrofit — no new framework dependencies are introduced. The existing Lit components receive only the changes needed to consume new SSE events and display new features.

## Consequences

### Positive

- Focus stays on the broken parts (server) instead of rewriting working code (client)
- New SSE events and features can be added to Lit components without a framework migration blocking progress
- React migration, when it happens, lands on a stable server — cleaner separation of concerns

### Negative

- Lit components accumulate more features that will later need to be rewritten
- Context-switching cost persists for this project

## Enforcement

- ADR-001 enforcement rule (no React/Preact/Solid imports) stays active
- ADR-003 (Light DOM) and ADR-004 (reactive stores) stay active with Lit-specific enforcement
- These rules will be superseded when a React migration project is created

## Related Decisions

- ADR-001 (original Lit over React)
- ADR-003 (Light DOM — moot after React migration)
- ADR-004 (Reactive stores — pattern survives, implementation changes)
