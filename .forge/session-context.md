# Session Context

## What's next
- Epic 9: Health Checks — task 9.6: Support per-project `healthCheckInterval` override (0 to disable)
- This is the last task in Epic 9.

## Key constraints (carried forward)
- Health checker core complete (9.1-9.3): HealthChecker class, poller lifecycle wiring, SSE health-changed event.
- Health API endpoint complete (9.4): `GET /api/health` returns per-project statuses. Routes use `createApi(healthChecker)` factory pattern.
- Health indicator complete (9.5): `healthStatus` field on Project type, `buildProjectResponse` populates from healthChecker, ProjectStore handles `health-changed` SSE events, card renders colored dot with ARIA label.
- Fire-and-forget promises need `.catch()` — project rule.
- Consumer update on shape change — project rule. 4+ occurrences.

## Judgment calls from this session
- Routes refactored to `createApi(healthChecker)` factory (task 9.4) — broke circular import cleanly.
- `healthStatus` on Project type is `HealthStatus | null` — null when not running. Spec says `null if not running`.
- Health dot uses `role="img"` + `aria-label` for accessibility. Colors: success (healthy), danger (unhealthy), warning (unknown).
- `buildProjectResponse` moved inside `createApi` closure to access `healthChecker.getStatus()`.
- Process-stopped SSE handler clears `healthStatus` to null.

## Watch for
- Task 9.6 adds per-project interval override. This likely means adding a `healthCheckInterval` field to config overrides, a new API endpoint or extending PATCH /api/projects/:id, and passing the interval to `healthChecker.startChecking()`.
- The `startChecking` method already accepts `intervalMs` as third param (default 30s). The plumbing is ready.
- Config schema change → backward-compatible defaults in `readConfig`.
