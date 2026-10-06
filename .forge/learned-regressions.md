# Learned Regressions

Bug patterns discovered during development. The `/crucible:review` agent checks new code against these patterns. When a pattern recurs 2+ times, consider promoting it to a `.claude/rules/` file.

## async-event-handler-rejection
**Occurrences:** 1 (PR #9)
**Pattern:** Passing an async callback to a Node EventEmitter (`emitter.on('event', async () => { await ... })`) — if the awaited promise rejects, the rejection is unhandled because EventEmitter doesn't catch promise rejections from async listeners.
**Fix:** Use `.catch()` on the promise chain or wrap the body in try/catch. For fire-and-forget cleanup, use `promise.catch(() => {})`.

## mutable-cache-reference
**Occurrences:** 1 (PR #16)
**Pattern:** Returning a cached object by reference from a read function, or storing a caller's object as the cache without cloning. Callers (or the write queue's updater) can mutate the shared reference, corrupting the cache for all subsequent readers. On write failure, the cache retains mutations that were never persisted to disk.
**Fix:** `structuredClone` on every cache boundary — both storage (cache owns its copy) and retrieval (caller owns their copy). Verify all code paths, not just the hot-cache return.
**Status:** promoted to rule (behavior-cache-clone-boundaries.md)

## hanging-promise-no-catch
**Occurrences:** 1 (PR #9)
**Pattern:** `.then(() => resolve())` chains inside `new Promise()` constructors without `.catch()` — if the upstream promise rejects, `resolve()` never runs and the outer promise hangs indefinitely.
**Fix:** Always add `.catch(() => resolve())` or `.catch((err) => reject(err))` to `.then()` chains inside Promise constructors.
