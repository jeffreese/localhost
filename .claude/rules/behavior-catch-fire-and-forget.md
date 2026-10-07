# Catch Fire-and-Forget Promises

Every fire-and-forget promise chain must have a `.catch()`. An unhandled rejection in Node.js crashes the process.

## What to check

- `someAsyncFn().then(...)` without `.catch()` — add `.catch((err) => console.error(..., err))`
- `.then(() => resolve())` inside `new Promise()` without `.catch()` — add `.catch((err) => reject(err))`
- `async () => { await ... }` passed to EventEmitter `.on()` — wrap body in try/catch or append `.catch()` to the call

## When it's safe to omit

Only when the caller awaits the promise and handles rejection at that level. Fire-and-forget means nobody awaits — the rejection has nowhere to go except `unhandledRejection`.
