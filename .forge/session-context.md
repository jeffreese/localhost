# Session Context

## Active decisions
- Listener scanner uses `execFile` (not `exec`) for lsof calls — avoids shell interpolation, args passed as array.
- `execAsync` helper resolves with stdout on both success and error — lsof exits 1 when some -c filters have no matches but still outputs valid data.
- `COMMAND_FLAGS` changed from string to array (`flatMap`) to work with `execFile` arg-based API.

## Gotchas discovered
- Crucible flags sequential awaits on independent operations — use `Promise.all` where calls are independent (learned from task 1.2).
- Crucible flags redundant file reads — pass already-parsed data to helpers instead of re-reading (learned from task 1.2).
- `stopProject` still uses `new Promise` wrapping with `.then()` chains — task 1.4 should clean this up.

## Conventions established
- Test mocks for async functions use `async () =>` returns.
- Fire-and-forget `updateConfig` in event handlers uses `.catch(() => {})`.
