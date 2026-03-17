# SSE for Real-Time Updates — No WebSocket or Polling

All real-time state updates flow from backend to frontend via Server-Sent Events (SSE). The frontend uses the native `EventSource` API.

Rules:
- No WebSocket dependencies
- No polling for state — subscribe to the SSE stream
- All state changes must flow through the SSE broadcaster
- REST is for commands only (start, stop, scan, config updates) — not for state reads after initial load

**Source:** ADR-005
