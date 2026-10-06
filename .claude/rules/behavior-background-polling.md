# Background Polling

The background poll loop runs on a 5s interval and coordinates periodic tasks at staggered frequencies. (ADR-012)

- Listener scan: every tick (5s) via async lsof
- Resource sampling: every 3rd tick (15s) via async ps
- Health checks: separate per-project timers (30s default), started/stopped with service lifecycle

The poller must include an overlap guard — if a tick is still running when the next fires, skip it rather than queuing.

All SSE events from the poller must include enough data for the client to update without a separate fetch.
