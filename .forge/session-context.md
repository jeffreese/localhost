# Session Context

## What's next
- Epic 6: Log Persistence — task 6.4: Update `GET /api/projects/:id/logs` to read from disk with pagination
- Tasks 6.5 (hydration race fix) and 6.6 (tests) follow

## Key constraints (carried forward)
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.
- Process group lifecycle complete (Epic 3). Port override complete (Epic 13).
- Background polling complete (Epic 5): 5s interval, overlap guard, listener diff → SSE broadcast, monotonic event IDs.
- Log store complete through 6.3: appendLines, rotateIfNeeded wired into write path, closeLogs, closeAll. Rotation at 10MB default, keeps .log + .log.1.
- Fire-and-forget promises need `.catch()` — project rule.
- Cache clone boundaries: all getters/callbacks returning internal state must use structuredClone.

## Judgment calls this session
- Rotation wiring goes inside appendLines (not in the caller) — it's an internal log-store concern, transparent to process-manager.
- appendLines gained an optional maxSize parameter (default 10MB) to enable testing without writing 10MB and to prepare for future per-project config.

## Watch for
- `behavior-assert-mock-calls` — every mock needs assertions, not just setup
- `overbroad-catch-swallows-errors` — narrow catches to expected error codes, re-throw others
- `resource-cleanup-on-failure` — per-item try/catch in cleanup loops
- Console hydration race (6.5) — SSE events arriving during initial fetch must be buffered and merged
- 6.4 pagination: the read path from disk needs to handle the rotated file (.log.1) too
