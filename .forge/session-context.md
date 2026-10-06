# Session Context

## Active decisions
- Scanner async migration complete. All internal helpers (`detectPackageManager`, `detectDevScript`, `detectGithubUrl`, `walk`) are async. `existsSync` replaced with `access()`-based `fileExists()` helper.
- `scan()` and `scanAndPersist()` were already async from task 1.1's caller updates — no route changes needed.

## Gotchas discovered
- Crucible will flag fire-and-forget `updateConfig` calls in event handlers — use `.catch(() => {})` pattern, not `async` callbacks on EventEmitters. (Learned regression: `async-event-handler-rejection`)
- `.then()` chains inside `new Promise()` constructors need `.catch()` to prevent hanging promises. (Learned regression: `hanging-promise-no-catch`)
- The `stopProject` function still uses `new Promise` wrapping with `.then()` chains — task 1.4 should refactor this to proper async/await.

## Conventions established
- Test mocks for async config-store use `async () =>` returns.
- Scanner test mock for `readConfig` returns async config object.
