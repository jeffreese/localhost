# Session Context

## What's next
- Epic 6: Log Persistence — task 6.3: Implement size-based rotation (10MB default, keep .log + .log.1)
- Tasks 6.4–6.6 follow (disk pagination, hydration race fix, tests)

## Key constraints (carried forward)
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.
- Process group lifecycle complete (Epic 3).
- Port override complete (Epic 13).
- Background polling complete (Epic 5): 5s interval, overlap guard, listener diff → SSE broadcast, monotonic event IDs.
- Fire-and-forget promises need `.catch()` — project rule.
- Cache clone boundaries: all getters/callbacks returning internal state must use structuredClone.
- Log store wired into process-manager: appendToLogFile in handleChunk and exit handler, closeLogs on exit, closeAllLogs in gracefulShutdown.

## Judgment calls this session
- Log-store calls in process-manager are fire-and-forget with `.catch()` — don't back-pressure process output for disk I/O.
- `closeAllLogs()` is awaited in gracefulShutdown before SIGTERM — ensures log buffers are flushed before killing processes.
- Process-manager tests mock `./log-store` to avoid disk side effects.
- Index tests mock `./log-store` and flush microtasks with `advanceTimersByTimeAsync(0)` to account for async closeAllLogs before SIGTERM assertion.

## Watch for
- `mutable-cache-reference` — any new getter, callback, or return path from a cached module needs structuredClone
- `overbroad-catch-swallows-errors` (new regression) — narrow catches to expected error codes
- `resource-cleanup-on-failure` (new regression) — per-item try/catch in cleanup loops
- 6.3 rotation: call `rotateIfNeeded` before each write batch or at process start
- Console hydration race (6.5) — SSE events arriving during initial fetch must be buffered and merged
