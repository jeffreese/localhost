---
title: "ADR-006: Listener Enumeration for Process Detection"
phase: 2
project: localhost
date: 2026-03-17
status: accepted
supersedes: "ADR-006 (original: Two-Step PID/Port Reconciliation)"
---

# ADR-006: Listener Enumeration for Process Detection

## Status

Accepted (supersedes original ADR-006)

## Context

The original ADR-006 used PID-based tracking: localhost stored PIDs when it spawned processes, then verified PID + port ownership on reconciliation. This had a fundamental blind spot — dev servers started outside localhost (from a terminal, IDE, etc.) were never detected. Since most developers start their servers from the terminal, the dashboard frequently showed "stopped" for projects that were actually running.

## Decision

We use **OS listener enumeration** as the source of truth for process detection. Instead of tracking what we started, we ask the OS what's actually listening:

1. **Enumerate all TCP listeners** via `lsof -iTCP -sTCP:LISTEN -P -n -F pn`
2. **Resolve each listener's working directory** via `lsof -p PID -d cwd -F n`
3. **Match working directories to known project paths** — a listener is attributed to a project if its cwd is within that project's directory

This produces two states:

| State | Condition |
|-------|-----------|
| **Running** | One or more TCP listeners have a cwd matching the project path |
| **Stopped** | No matching listeners found |

Projects can have **multiple listeners** (e.g., a backend server + Vite dev server). All are surfaced in the UI.

PID tracking (`config.pids`) is retained only for process management — stopping processes that localhost spawned. It is never used for detection.

## Alternatives Considered

### Original PID + port verification (previous ADR-006)
- **Pros:** Simple, deterministic
- **Cons:** Only detected processes localhost spawned. Missed externally-started servers entirely — the most common case.

### Port-first detection (check expected port, infer state)
- **Pros:** Simpler than full enumeration
- **Cons:** Requires knowing the expected port in advance. Many projects use dynamic ports. Can't distinguish between a project's server and an unrelated process on the same port.

### Process table scanning (pgrep for node processes)
- **Pros:** Finds all Node processes
- **Cons:** Would match non-server Node processes (build scripts, tests, etc.). No port information without additional lsof calls anyway.

## Consequences

### Positive
- Detects all running dev servers regardless of how they were started
- Supports multi-listener projects (frontend + backend in one project)
- Eliminates the entire class of stale-PID problems
- Single source of truth — the OS network stack — means no state synchronization issues

### Negative
- Depends on `lsof` (macOS) — not portable to Windows
- Per-PID cwd lookups add latency proportional to the number of unique listening processes on the system
- Projects running servers from a different working directory than their root won't be matched (uncommon for dev servers)

## Enforcement

- Process state is determined by enumerating OS TCP listeners and matching their cwds to project paths
- Never rely on stored PIDs for determining running state
- `config.pids` is only for stop/manage capability on processes localhost spawned
- `lsof` failure should gracefully return empty results (all projects show as stopped)

## Related Decisions

- ADR-005: SSE for state updates (detection results are pushed via SSE)
- ADR-007: Project visibility model (hidden projects with active listeners still show as running)
