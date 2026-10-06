---
title: "ADR-009: Process Group Lifecycle"
phase: 2
project: localhost
date: 2026-10-05
status: accepted
---

# ADR-009: Process Group Lifecycle

## Status

Accepted

## Context

Localhost spawns dev servers that create deep process trees: pnpm → concurrently → tsx → vite → node. The current implementation spawns with `detached: false`, so all children share the parent's process group. Stopping a project sends SIGTERM to the root PID only — intermediate processes (concurrently, tsx watchers) survive as orphans. When Localhost itself restarts (nodemon), all spawned processes become orphans with broken stdout pipes.

Additionally, stored PIDs in `config.pids` go stale — 9 of 10 observed entries were dead. Sending SIGTERM to a stale PID risks killing an unrelated process.

## Decision

1. **Spawn into new process groups** using `detached: true` (which calls `setsid()` on macOS, creating a new session and process group with PGID = child PID).
2. **Stop via process group signal**: `process.kill(-pid, 'SIGTERM')` followed by SIGKILL escalation after 5s.
3. **Verify PID ownership before signaling**: check that the PID is alive and its cwd matches the expected project path.
4. **Register shutdown handlers** on the Localhost server process to SIGTERM all active process groups on exit.
5. **Prune stale PIDs** from config on server startup.

## Alternatives Considered

### Kill by port (find PID from lsof, kill that)

- **Pros:** Always targets the right process. No stale PID problem.
- **Cons:** Kills only the listening process, not the full tree. A vite dev server process gets killed but the pnpm/concurrently wrapper survives.

### Process tree walk (pstree/ps to find all children, kill each)

- **Pros:** Doesn't require `detached: true`.
- **Cons:** Race conditions — children can spawn between the tree walk and the kill. More complex. Process group signal is the OS-level mechanism designed for this.

## Consequences

### Positive

- Single signal kills the entire process tree — no orphans
- Localhost restart cleanly tears down all spawned services
- PID verification prevents signaling unrelated processes
- Stale PID cleanup removes accumulated dead entries

### Negative

- `detached: true` means children don't inherit the parent's stdio by default — must explicitly pipe stdout/stderr
- Process groups are session-scoped on macOS — need to verify behavior with multiple Localhost instances (edge case, unlikely)

## Enforcement

- `child_process.spawn` calls must use `detached: true` — flag any spawn without it
- `process.kill(pid, ...)` (positive PID) should be flagged as suspicious — use `process.kill(-pid, ...)` (negative, process group) instead
- Direct writes to `config.pids` must include PID verification logic
- Shutdown handlers must exist in server entry point — flag if missing

## Related Decisions

- ADR-006 (Listener enumeration) — PID detection via lsof unchanged, but PID usage for stop changes
- ADR-008 (Log management) — stdout/stderr piping affected by `detached: true` stdio config
