---
title: "ADR-011: Log Persistence"
phase: 2
project: localhost
date: 2026-10-05
status: accepted
---

# ADR-011: Log Persistence

## Status

Accepted

## Context

Process logs exist only in an in-memory ring buffer (500 lines). When Localhost restarts (nodemon, crash, manual), all logs are lost. The console drawer can only show output for processes spawned in the current Localhost session. Externally-started processes never have viewable logs.

Additionally, the console store has a race condition: SSE log events arriving between `open()` starting its fetch and completing it are silently dropped because the buffer map entry doesn't exist yet.

## Decision

Write process stdout/stderr to disk at `~/.localhost/logs/<project-name>.log`. Maintain the in-memory ring buffer for SSE broadcast (hot path) but persist to disk for survival across restarts.

**Format:** Each line prepended with ISO timestamp and stream identifier: `[2026-10-05T12:34:56.789Z stdout] <content>`.

**Rotation:** Size-based. Default 10MB per project, configurable via `overrides.maxLogSize`. Keep current `.log` and one rotated `.log.1` (20MB max per project). Oldest content trimmed on rotation.

**Hydration:** On console open, fetch historical logs from disk via `GET /api/projects/:id/logs`. Fix the race condition by buffering SSE events during the fetch and merging after.

## Alternatives Considered

### Increase ring buffer size, accept loss on restart

- **Pros:** Zero disk I/O. Simpler.
- **Cons:** Doesn't solve the restart problem. Large ring buffers waste memory for idle projects.

### Structured log storage (SQLite, JSONL)

- **Pros:** Queryable. Could support filtering, search.
- **Cons:** Overkill for dev server output. Adds a dependency. Plain text files are viewable with standard tools.

### Age-based rotation (keep 7 days)

- **Pros:** Intuitive retention policy.
- **Cons:** Unpredictable disk usage — a verbose project could generate GBs. Size-based gives a hard ceiling.

## Consequences

### Positive

- Logs survive Localhost restarts
- Console drawer can show historical output for any project, not just current-session spawns
- Standard log format readable with `tail`, `grep`, `less`
- Race condition fix ensures no log lines are silently dropped

### Negative

- Disk I/O on every log line (mitigated by OS write buffering and append-only access pattern)
- Log directory grows over time — rotation caps it but users should be aware
- Timestamp + stream prefix makes raw output slightly harder to read (tradeoff for traceability)

## Enforcement

- Process manager must write to both ring buffer and log file — flag any stdout/stderr handler that doesn't persist
- Log file operations must use async I/O — flag any `*Sync` calls in log-store
- Console store hydration must buffer SSE events during fetch — flag any `open()` implementation that subscribes after the fetch completes

## Related Decisions

- ADR-008 (Process console logs) — this extends ADR-008 from in-memory to persistent storage
- ADR-009 (Process groups) — `detached: true` requires explicit stdio piping, which feeds the log store
