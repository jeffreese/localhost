---
title: "ADR-005: SSE for Real-Time State Updates"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
---

# ADR-005: SSE for Real-Time State Updates

## Status

Accepted

## Context

The localhost dashboard needs to reflect backend state changes (process started/stopped, scan results, port conflicts) in near-real-time. Commands flow from the frontend to the backend via REST — the question is how state updates flow back.

## Decision

We will use **Server-Sent Events (SSE)** for pushing state updates from the backend to the frontend. The browser's native `EventSource` API connects to a single SSE endpoint. The backend broadcasts state changes to all connected clients when any service emits an event (process state change, scan complete, config update).

Commands remain REST: `POST /api/projects/:id/start`, `POST /api/scan`, etc. SSE is one-way (server → client) only.

## Alternatives Considered

### WebSocket
- **Pros:** Bidirectional communication, widely supported
- **Cons:** Bidirectional is unnecessary — commands go via REST, only state pushes need the reverse channel. WebSocket adds connection management complexity (heartbeats, reconnection logic) that SSE handles natively. More code for no benefit.

### Polling
- **Pros:** Simplest to implement, no persistent connections
- **Cons:** Up to N seconds of stale UI after an action (where N is the poll interval). Feels unresponsive — user clicks "start," then waits for the next poll to see the card update. Wastes requests when nothing has changed.

### Long polling
- **Pros:** Immediate updates without persistent connection
- **Cons:** More complex than SSE with no advantage. `EventSource` is purpose-built for this pattern.

## Consequences

### Positive
- Instant UI feedback when process state changes — no polling delay
- Native browser API (`EventSource`) — no library needed, automatic reconnection built in
- Simple server implementation — streaming response from Hono
- Clean separation: REST for commands, SSE for state
- Low overhead — single HTTP connection per client

### Negative
- SSE is unidirectional — if we later need server-initiated commands (unlikely for a local tool), we'd need to add WebSocket
- `EventSource` doesn't support custom headers — not a concern since there's no auth (local-only tool)
- Connection limit per domain in browsers (6 in HTTP/1.1) — not a concern since there's only one SSE endpoint

## Enforcement

- No WebSocket dependencies — SSE is the only real-time channel
- All state updates must flow through the SSE broadcaster, not through REST response bodies (except for the initial state snapshot)
- Frontend must not poll for state — subscribe to SSE stream instead

## Related Decisions

- ADR-004: Reactive stores (SSE events feed into stores)
