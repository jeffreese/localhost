---
title: "Phase 1 Summary: Feature Definition"
project: localhost
date: 2026-10-05
---

## Key Outcomes

- **Retrofit scope defined.** 14 features across 5 milestones, prioritizing server-side stability before any frontend changes.
- **Server stability is the foundation.** Async I/O migration, process group management, PID verification, shutdown handlers, and config store hardening — all must land before new features.
- **Frontend migration deferred.** Lit → React is explicitly out of scope. The Lit components work; the problems are server-side. React migration evaluates as a separate project after stabilization.
- **Five design decisions resolved:** port override (implement), health checks (on by default when started), resource display (current values only), log rotation (size-based 10MB), project detection (type registry in config, ship Node + Rust).
- **Codebase audit completed.** Deep dive identified: blocking I/O throughout server, dangerous stale PIDs, no process groups, no shutdown handlers, dead ProcessStore, config race conditions, console log race condition, half-built SSE reactivity.

## Documents Produced

- **feature-spec.md** — 14 features (F1–F14) organized into 5 milestones: server stability (M1), reactivity (M2), operational features (M3), broader detection (M4), cleanup (M5). All open decisions resolved.
- **scope-and-constraints.md** — Existing stack preserved. macOS-only. Backward-compatible config migration. Risk factors for process groups, async migration, and background polling.

## Context for Next Phase

Phase 2 (Technical Planning) needs to address:

1. **Async I/O migration strategy** — Sequencing the sync → async conversion across scanner, listener-scanner, config-store, and process-manager without breaking the app mid-migration.
2. **Process group architecture** — Validate `detached: true` + `setsid` + `kill(-pgid)` pattern on macOS with real pnpm → concurrently → tsx chains.
3. **Config store serialization** — Design for concurrent write safety (queue vs. lock) and atomic writes (temp + rename).
4. **Background polling coordination** — Three periodic loops (lsof listener scan, health checks, resource sampling) need to coexist without hammering the system.
5. **Project type registry schema** — Config format for extensible project detection.
6. **ADR updates** — ADR-001 (Lit) needs a deferred-migration amendment. New ADRs needed for: process groups, project type registry, log persistence, background polling architecture.
7. **Port override wiring** — Simple implementation (read config, pass `PORT` env var) but needs conflict detection design.
8. **Log persistence design** — File format, rotation mechanics, hydration on restart, fixing the console log race condition.
