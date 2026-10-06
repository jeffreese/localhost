# Session Context

## Active decisions
- `stopProject` refactored: no-child path uses clean async/await, child path keeps `new Promise` wrapper (event-based exit handling requires it). Config cleanup in child exit handler is fire-and-forget with `.catch(() => {})`.
- `getPortOwner` removed (was dead code using `execSync`). Also completed task 4.1.
- `stopListener` made async for API consistency, though `process.kill` is inherently synchronous.

## Gotchas discovered
- Task 1.5 (verify zero *Sync calls) should now be straightforward — config-store, scanner, listener-scanner, and process-manager are all async.
- The `existsSync` in config-store.ts is the only remaining sync call in production server code (intentional — see task 1.1 decision).

## Conventions established
- Fire-and-forget async cleanup in event handlers: use `.catch(() => {})`, not async callbacks.
- `new Promise` wrapper is acceptable when waiting on EventEmitter events — don't force async/await where the event model doesn't support it.
