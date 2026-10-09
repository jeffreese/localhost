# Session Context

## What's next
- Epic 11 (Project Groups) complete. Next: Epic 12 (Project Type Registry).
- Check backlog to pick the next epic.

## Key constraints (carried forward)
- Routes use `createApi(healthChecker, poller)` factory — `buildProjectResponse` takes a pre-fetched `resourceMap` parameter (hoisted per request, not per project).
- `ResourceGetter` interface decouples routes from BackgroundPoller.
- Server does NOT kill spawned processes on exit — only on explicit user stop request.
- Consumer update on shape change — project rule. 8th occurrence (group field). The SSE handler checklist is in recall.
- Fire-and-forget promises need `.catch()` — project rule.

## Judgment calls from this session
- Task 11.1 was already done as part of task 2.4 (backward-compatible defaults for new config fields). Types and config defaults existed.
- Fixed missing SSE event listener registrations in sse-client.ts: `resource-update` and `groups-changed` were never wired, so those events were silently dropped on the client. This was a pre-existing bug affecting resource monitoring real-time updates too.
- Group assignment ignores nonexistent group IDs silently (doesn't error) — defensive choice since group deletion races are possible.
- Context menu group assignment uses CustomEvent dispatch + parent handler pattern (card fires `assign-group`, dashboard handles the API call) to avoid store-to-store coupling.

## Watch for
- Epic 12 (Project Type Registry) will refactor scanner to use registry marker files and listener-scanner to build lsof filter from processNames arrays. Flag any hardcoded `package.json` or process name literals.
- The `customOrder` array stays flat across groups — group display is UI-layer grouping only.
- Pre-existing security issues: unvalidated PID in stopListener (arbitrary signal), no CORS/origin checks on POST routes.
