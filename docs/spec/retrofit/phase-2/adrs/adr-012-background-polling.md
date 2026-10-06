---
title: "ADR-012: Background Polling Architecture"
phase: 2
project: localhost
date: 2026-10-05
status: accepted
---

# ADR-012: Background Polling Architecture

## Status

Accepted

## Context

The UI requires a manual page refresh to see state changes from externally-started/stopped processes. The SSE infrastructure exists but state changes aren't pushed proactively — the server only broadcasts when its own API handlers fire. There's no mechanism to detect processes started or stopped outside of Localhost.

Additionally, health checks and resource monitoring need periodic execution. These three periodic concerns (listener detection, health probes, resource sampling) must coexist without hammering the system.

## Decision

A single **background poll loop** running in the server process on a 5s `setInterval`. The loop coordinates three periodic tasks at different frequencies:

| Task | Frequency | Method |
|------|-----------|--------|
| Listener scan | Every tick (5s) | Async `lsof` via `execFile` |
| Resource sampling | Every 3rd tick (15s) | Async `ps` via `execFile` |
| Health checks | Per-project timer (30s default) | Async `fetch` HEAD |

Health checks run on separate per-project timers (not the main loop) because they're tied to individual service lifecycle — started when a service starts, stopped when it stops.

The listener scan diffs against previous state to detect:
- New listeners → `process-started` SSE event
- Removed listeners → `process-stopped` or `process-crashed` SSE event
- New ports on existing processes → `port-detected` SSE event

## Alternatives Considered

### File system watcher (fswatch/chokidar on /proc or similar)

- **Pros:** Event-driven, no polling overhead.
- **Cons:** macOS doesn't expose process state via filesystem like Linux `/proc`. No viable path.

### WebSocket with bidirectional keepalive

- **Pros:** Could push state changes instantly.
- **Cons:** Contradicts ADR-005 (SSE only). WebSocket adds complexity. The state changes we need to detect (OS process lifecycle) aren't event-driven — polling is the only mechanism.

### Separate worker process for polling

- **Pros:** Isolates polling from request handling.
- **Cons:** IPC complexity. The polling is lightweight (one `lsof` call, one `ps` call) — doesn't justify a separate process.

## Consequences

### Positive

- UI updates within 5s of any external process change — no page refresh needed
- Health and resource data flows through the same SSE channel — consistent update model
- Single coordination point prevents multiple overlapping lsof/ps calls

### Negative

- 5s latency for external changes (Localhost-spawned changes are still instant via child process events)
- Background `lsof` every 5s adds ~10-20ms CPU per tick — negligible but non-zero
- Must handle tick overlap gracefully — if a tick takes longer than 5s, skip the next one rather than queueing

## Enforcement

- Listener detection must not use `execSync` — flag any synchronous shell calls in listener-scanner
- Background poller must have a guard against overlapping ticks
- Health check timers must be cleaned up when a project stops — flag any `setInterval` without corresponding `clearInterval` on stop
- SSE events from the poller must include enough data for the client to update without a separate fetch

## Related Decisions

- ADR-005 (SSE for state updates) — polling generates SSE events, doesn't replace SSE
- ADR-006 (Listener enumeration) — same lsof mechanism, now running periodically instead of on-demand
