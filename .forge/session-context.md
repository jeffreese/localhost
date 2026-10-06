# Session Context

## What's next
- Task 2.4: Backward-compatible defaults for new config fields (`projectTypes`, `groupConfig`, `crashes`) in `readConfig`.
- Task 2.5: Integration tests for concurrent updates, crash-during-write recovery, cache invalidation.

## Key constraints (carried forward)
- `updateConfig` serializes via a promise-chain queue (`writeQueue`). The entire read-modify-write cycle runs inside the queue.
- `readConfig` returns from an in-memory cache after the first successful read. Cache is populated on disk read and updated by `writeConfig`.
- Recovery paths in `readConfig` call `writeConfig`, so they automatically update the cache.
- `resetCache()` exported for test isolation — clears the in-memory cache so the next `readConfig` hits disk.

## Judgment calls this session
- No deep-copy on cache read. All production `readConfig` callers use the returned object read-only; mutations go through `updateConfig`. Deep-copying would defeat the purpose of caching. The convention is documented in CLAUDE.md ("Always go through `updateConfig()` which serializes access").
- `resetCache` exported as a named function rather than a test-only module trick. It's explicit and simple.

## Watch for
- Task 2.4 will add new fields to `defaultConfig()` and the `repairConfig` path. The cache should be transparent to this — new fields appear in the config object whether it came from cache or disk.
- Callers must not mutate the object returned by `readConfig` directly — that would corrupt the cache. All mutations must go through `updateConfig`.
- Async mock consistency — every mock for an async function must use `async () =>` returns.
- Fire-and-forget patterns — use `.catch(() => {})` on promises in event handlers.
