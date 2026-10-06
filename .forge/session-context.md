# Session Context

## Active decisions
- Epic 1 (Async I/O Migration) complete. Zero `*Sync` calls in `src/server/` production code.
- Last sync holdout (`existsSync` in config-store.ts) removed — the `readFile` catch block already handles ENOENT, making the existence check redundant.

## Gotchas discovered
- Stashed changes can leak into commits when popping across branches. Always check `git diff --cached --stat` before committing.
- Crucible consistently catches: un-awaited async calls at call sites, missing `.catch()` on fire-and-forget promises, redundant file reads, missing test coverage for refactored code.

## Conventions established
- Fire-and-forget async cleanup: `.catch(() => {})`, not async callbacks on EventEmitters.
- `new Promise` wrapper is acceptable for event-based flows (child process exit).
- Test mocks for async functions must use `async () =>` returns.
- Independent async I/O calls should use `Promise.all` when possible.
