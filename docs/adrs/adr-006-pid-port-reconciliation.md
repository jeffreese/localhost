---
title: "ADR-006: Two-Step PID/Port Reconciliation"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
---

# ADR-006: Two-Step PID/Port Reconciliation

## Status

Accepted

## Context

Localhost spawns dev server processes and tracks their PIDs. When localhost itself restarts (or crashes), it needs to determine which previously-spawned servers are still running. A naive approach — checking if the expected port is responding — produces false positives when a different process has taken over that port (e.g., the user manually started something else on port 3000).

## Decision

We will use **two-step verification** on startup to reconcile process state:

1. **PID check** — for each stored PID, verify it's still alive (`process.kill(pid, 0)`)
2. **Port ownership check** — if the PID is alive, verify it owns the expected port via `lsof -i :port -t` and confirm the PID matches

This produces three states:

| State | Condition |
|-------|-----------|
| **Running** | Our PID is alive and owns the expected port |
| **Stopped** | PID is dead and port is free |
| **Port conflict** | Port is occupied by a process we didn't spawn |

## Alternatives Considered

### Port check only (TCP connect)
- **Pros:** Simple, works everywhere, no OS-specific tools
- **Cons:** False positives — can't distinguish "our app on port 3000" from "some other app on port 3000." This was the specific failure mode that prompted this decision.

### PID check only
- **Pros:** Simple, no OS-specific tools
- **Cons:** Doesn't detect port conflicts. A stale PID could be reused by the OS for an unrelated process (unlikely but possible).

### Store process metadata (command, cwd) and verify
- **Pros:** Most reliable identification
- **Cons:** Over-engineered. PID + port ownership is sufficient for a local dev tool. Process metadata verification adds complexity for an edge case of an edge case.

## Consequences

### Positive
- Eliminates false "running" signals from port squatters
- Surfaces port conflicts explicitly so the user can resolve them
- PID persistence enables crash recovery — localhost can reconnect to orphaned servers it spawned

### Negative
- Depends on `lsof` (macOS/Linux) — not portable to Windows (acceptable: macOS is the target platform)
- Two system calls per project on startup instead of one — negligible for the expected project count

## Enforcement

- Never mark a project as "running" based on port check alone — PID ownership must be verified
- `lsof` failure (command not found) should fall back to port-only check with a logged warning, not crash
- Stale PIDs must be cleared from config when the process is confirmed dead

## Related Decisions

- ADR-005: SSE for state updates (reconciliation results are pushed via SSE on startup)
- ADR-007: Project visibility model (hidden/ignored projects still undergo reconciliation if they have stored PIDs)
