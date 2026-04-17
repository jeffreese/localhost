---
title: "ADR-008: Process Console Logs (Capture, Retention, Eligibility)"
phase: 2
project: localhost
date: 2026-04-16
status: accepted
---

# ADR-008: Process Console Logs (Capture, Retention, Eligibility)

## Status

Accepted

## Context

Users want to see the stdout/stderr of dev servers running in Localhost — to debug startup failures, watch HMR output, and see why a process crashed. Today, `process-manager.ts` already spawns with `stdio: 'pipe'` and attaches `data` handlers solely for port detection; the output is then discarded.

Two questions need concrete answers before we build:

1. **Which processes get a console?** ADR-006 establishes that Localhost detects externally-started dev servers via `lsof` — it shows them on the dashboard but does not own their stdio file descriptors. On macOS, we cannot retroactively attach to another process's fds, so there is no general-purpose path to capture their output.
2. **How much output, and for how long?** An unbounded buffer leaks memory across long sessions. Clearing on exit destroys the most useful moment (why the process died).

## Decision

### Eligibility

The console is available **only for processes Localhost spawned in the current session** (those for which we have a captured log buffer). Externally-detected processes that Localhost did not start surface in the dashboard normally but show no console button — the action is simply absent, not disabled.

The project DTO exposes this as a boolean `spawnedByUs` flag, derived on the server from `hasLogs(projectId)`. This naturally covers the post-mortem case: a process we started and that has since exited still has `spawnedByUs: true` because its buffer is retained.

### Capture

A per-project, in-memory ring buffer holds the last **500 lines** of combined stdout/stderr. Each entry records:

```ts
type LogLine = { stream: 'stdout' | 'stderr'; ts: number; text: string }
```

Line assembly buffers partial chunks per stream and flushes on `\n`; any trailing partial line is flushed when the process exits.

### Retention

- Buffers persist **after process exit** so users can open the console post-mortem and see why it died.
- Buffers are **cleared when `startProject` is called again** for the same project id — a fresh start means a fresh console.
- Buffers are **in-memory only** — they do not survive a Localhost restart. No disk persistence.

### Delivery

- **REST hydration:** `GET /api/projects/:id/logs` returns the current buffer contents as `LogLine[]`.
- **SSE deltas:** a new `{ type: 'log', projectId, lines: LogLine[] }` event streams new lines to any subscribed frontend.
- Lines are batched over a ~50ms window before broadcast so chatty dev servers (e.g., webpack rebuilds) don't flood the SSE channel.

## Alternatives Considered

### Byte-based buffer cap (e.g., 100KB per project)

- **Pros:** Hard memory ceiling
- **Cons:** Users think in lines, not bytes. A single noisy stack trace could evict dozens of meaningful lines. Line-based is simpler to reason about and 500 lines × typical line length is already bounded well enough.

### Clear buffer on process exit

- **Pros:** Lowest steady-state memory
- **Cons:** Destroys the most useful log moment — the one right before a crash. The retention cost (500 lines per dead project) is negligible against the UX loss.

### Disk persistence (rolling log files per project)

- **Pros:** Survives Localhost restarts; richer history
- **Cons:** Adds a new storage contract, cleanup policy, and filesystem coupling for a feature whose value is mostly live. The session-scoped ring buffer covers the primary use cases; we can revisit if persistent logs become a real need.

### Console for externally-detected processes

- **Pros:** Feature parity across all cards
- **Cons:** Requires either `log stream --predicate 'processID == N'` (macOS unified log — noisy, permission-gated, rabbit hole) or running every dev server through a wrapper (defeats the purpose of ADR-006's listener enumeration). The honest answer — "we didn't start this process, so we can't show you its output" — is better than a flaky best-effort.

## Consequences

### Positive

- Adds real debugging value without changing the process model — we already pipe stdio.
- Memory bounded by design: `N projects × 500 lines × ~200 bytes ≈ 100KB per project`, trivial at any realistic project count.
- Reuses the existing SSE channel (ADR-005) — no new transport.
- Honest about the ADR-006 constraint rather than papering over it.

### Negative

- Inconsistent affordance: two cards that look identical may differ in whether they show a Console button. We accept this because the alternative (a disabled button with a tooltip) adds visual noise without conveying anything actionable — users who want console output for an external process need to restart it through Localhost.
- Post-mortem buffers occupy memory for dead processes until Localhost is restarted or the project is started again. Acceptable at expected scale.
- Users restarting Localhost lose their logs. We accept this — the live console is the primary value.

## Enforcement

- `spawnedByUs` must be derived from the log buffer map (`hasLogs`), not from `activeProcesses` or `config.pids`. The buffer is the canonical signal because it persists after the process exits — a stopped process we spawned still has a console, so `spawnedByUs` must remain true.
- The SSE broadcaster must batch log events (~50ms window) before emission — no per-line broadcasts.
- The ring buffer must cap at 500 lines per project, dropping oldest on overflow.
- Partial-line buffers (pre-newline chunks) must flush on process exit so the last line isn't silently lost.

## Related Decisions

- **ADR-005 (SSE for state updates):** the console stream rides the existing SSE channel as a new event type.
- **ADR-006 (Listener enumeration):** the reason externally-detected processes are ineligible for the console — we don't own their stdio.
