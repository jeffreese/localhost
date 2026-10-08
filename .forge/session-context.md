# Session Context

## What's next
- Epic 6: Log Persistence — task 6.5: Fix console store hydration race (buffer SSE events during fetch, merge after)
- Task 6.6 (tests) follows

## Key constraints (carried forward)
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.
- Process group lifecycle complete (Epic 3). Port override complete (Epic 13).
- Background polling complete (Epic 5): 5s interval, overlap guard, listener diff → SSE broadcast, monotonic event IDs.
- Log store complete through 6.4: appendLines with per-project write lock, rotateIfNeeded (10MB, .log + .log.1), readLines with limit/offset pagination, closeLogs, closeAll.
- GET /api/projects/:id/logs now reads from disk via readLines instead of in-memory ring buffer. Supports `limit` (default 500, max 5000) and `offset` query params. Returns `{lines, hasMore}`.
- Fire-and-forget promises need `.catch()` — project rule.
- Cache clone boundaries: all getters/callbacks returning internal state must use structuredClone.

## Judgment calls this session
- readLines concatenates rotated (.log.1) + current (.log), then slices from the tail. Offset counts from the end. This gives a consistent view even across rotation boundaries.
- parseLine uses a regex to parse the `[timestamp stream] text` format back to LogLine. Lines that don't match the pattern are silently skipped (e.g., corrupted or partial lines).
- Route response changed from `LogLine[]` to `{lines: LogLine[], hasMore: boolean}` — this is a breaking API change for any existing client code.

## Watch for
- `behavior-assert-mock-calls` — every mock needs assertions, not just setup
- `overbroad-catch-swallows-errors` — narrow catches to expected error codes, re-throw others
- Console hydration race (6.5) — SSE events arriving during initial fetch must be buffered and merged. The spec shows the pattern: subscribe before fetch, buffer during, merge after.
- readLines reads entire files into memory — for very large logs near 10MB this could be significant. Consider streaming for future optimization.
