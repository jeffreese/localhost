# Session Context

## Active decisions
- Config-store async migration complete. All three exports (`readConfig`, `writeConfig`, `updateConfig`) return Promises. All callers updated to await.
- `existsSync` kept for the config-path check in `readConfig` — fast single check, no benefit from async.

## Gotchas discovered
- Async config-store cascades through every caller: scanner.ts, process-manager.ts, routes.ts all changed signatures. Test mocks must return async values.
- `stopProject` uses `new Promise` wrapping with `.then()` chains for async config calls — task 1.4 is the right place to clean this up.

## Conventions established
- Test mocks for config-store must use `async () =>` to match real return types.
