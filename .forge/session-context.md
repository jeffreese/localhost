# Session Context

## What's next
- Epic 6: Log Persistence — task 6.2: Wire process-manager stdout/stderr to both ring buffer and log-store
- Tasks 6.3–6.6 follow (rotation wiring, disk pagination, hydration race fix, tests)

## Key constraints (carried forward)
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.
- Process group lifecycle complete (Epic 3).
- Port override complete (Epic 13).
- Background polling complete (Epic 5): 5s interval, overlap guard, listener diff → SSE broadcast, monotonic event IDs.
- Fire-and-forget promises need `.catch()` — project rule.
- Cache clone boundaries: all getters/callbacks returning internal state must use structuredClone.

## Judgment calls this session
- Log store uses `mkdir(LOG_DIR, { recursive: true })` on every `getHandle` call instead of a `dirEnsured` flag — avoids test isolation race where config-store tests delete the shared `.localhost` parent.
- Test isolation: log-store tests use `mkdtempSync` for a unique temp home, not the shared `tmpdir()/.localhost` that config-store tests clean.
- `rotateIfNeeded` uses `stat(path)` on the disk path (not `fstat` on handle) and closes the handle before renaming — simple, correct for the append-only pattern.
- `__resetLogStore` only clears the handle map — no `dirEnsured` flag to reset.

## Watch for
- `mutable-cache-reference` (4 occurrences) — any new getter, callback, or return path from a cached module needs structuredClone
- `untested-delivery-path` — when testing fan-out functions, register at least one mock consumer
- 6.2 wiring: `appendLines` must be called alongside the existing `appendLogLines` in process-manager's `handleChunk` and exit handler — both paths need the log-store call
- 6.2 wiring: `closeLogs` should be called on process exit (after flushing tail lines) and in server shutdown
- Log rotation (6.3) needs to be checked before each write batch — or at process start
- Console hydration race (6.5) is the trickiest task — SSE events arriving during initial fetch must be buffered and merged
