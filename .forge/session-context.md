# Session Context

## What's next
- Epic 10 (Resource Monitoring) complete. Next: Epic 11 (Project Groups) or Epic 12 (Project Type Registry).
- Check backlog and retrofit tasks to pick the next epic.

## Key constraints (carried forward)
- Routes use `createApi(healthChecker, poller)` factory pattern — `buildProjectResponse` inside the closure now uses both for healthStatus and resourceUsage.
- `ResourceGetter` interface decouples routes from the full `BackgroundPoller` class.
- Resource sampling runs every 3rd tick (15s) inside the background poller. `execPsAsync` calls `ps -o pid,pcpu,rss -p <pids>`.
- RSS from `ps` is in KB — `parsePsOutput` converts to bytes (× 1024).
- `onResourceUpdate` callback follows the same async-safe pattern as `onDiff` (duck-type `.catch` check).
- Fire-and-forget promises need `.catch()` — project rule.
- Consumer update on shape change — project rule. The SSE handler checklist is in recall (7 occurrences now with resourceUsage).

## Judgment calls from this session
- Implemented all 5 Epic 10 tasks in one branch since they're tightly coupled (sampling → aggregation → SSE → API → UI).
- Aggregation (10.2) was implemented alongside sampling (10.1) since the sampling data needs aggregation to be useful. Marked both.
- `resourceUsage` field added to `Project` type — required updating all SSE handlers per the consumer-update checklist (handleProcessStarted, handleProcessStopped, handleProcessCrashed all clear resourceUsage to null).
- The `resource-update` SSE event carries only `cpu` and `memory` (not `pids` or `sampledAt`) since those are display-oriented. The full `ResourceUsage` shape is on the API response.

## Watch for
- Epic 11 (Project Groups) will need a new SSE event type (`groups-changed`) and UI component updates.
- Any new field on `Project` type: run the consumer-update checklist from recall before submitting.
- The `node:child_process` mock is now needed in `background-poller.test.ts` and `index.test.ts` since `background-poller.ts` imports `execFile` directly.
