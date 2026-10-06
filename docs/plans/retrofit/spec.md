---
title: "Retrofit Plan Spec"
plan: retrofit
date: 2026-10-05
---

# Retrofit Plan

## Overview

Stabilize and extend Localhost — the local dev server dashboard. The server-side has accumulated significant technical debt (blocking I/O, dangerous process management, half-built reactivity, config race conditions) that needs to be resolved before adding new capabilities. Six new features layer on top of the stabilized foundation.

## Requirements

### Server Stability (M1)
- All I/O converted to async (no `*Sync` calls in production code)
- Process group lifecycle: detached spawn, group signals, PID verification, shutdown handlers
- Config store: atomic writes, serialized updates, read caching
- Dead code removal, route consolidation

### Reactivity (M2)
- Background polling loop (5s) detecting external process changes
- Proactive SSE push for all state changes
- UI updates without page refresh

### Operational Features (M3)
- Project groups (named, collapsible, persistent)
- Health checks (HTTP HEAD, auto-start on service start, 30s default)
- Resource monitoring (CPU/memory via ps, 15s sampling)
- Log persistence (disk files, 10MB size rotation, hydration race fix)
- Crash notifications (detection, UI indicator, config persistence)
- Port type detection (HTTP vs TCP, clickable vs informational)

### Broader Detection (M4)
- Project type registry in config (extensible)
- Rust support (Cargo.toml, cargo process matching)

## Architecture

See `docs/spec/retrofit/phase-2/technical-spec.md` for full architecture. Key changes:
- New modules: `background-poller.ts`, `health-checker.ts`, `log-store.ts`
- Config schema extended with `projectTypes`, `groupConfig`, `crashes`
- 4 new SSE event types: `process-crashed`, `health-changed`, `resource-update`, `groups-changed`
- 7 new/modified API endpoints

## Risk Flags

- Process group behavior on macOS needs prototype validation before committing
- Async migration must be sequenced carefully (config → scanner → listener → process-manager)
- Config concurrent write serialization must be tested under rapid operations

## Dependencies

All local — Node.js built-ins, lsof, ps. No external APIs or new packages.

## Out of Scope

- Lit → React migration (separate project)
- Quick-launch profiles, startup dependency ordering, TUI mode
- Auto-scan file watcher, multiple scan roots, cross-platform
