# Session Context

## What's next
- Epic 9: Health Checks — task 9.5: Update `<lh-project-card>`: health indicator dot
- Remaining: 9.6 (per-project interval override)

## Key constraints (carried forward)
- Health checker core complete (9.1): HealthChecker class with per-project timers, probe (3s timeout, res.status < 500), consecutive failure tracking (threshold 3), overlap guard, onChange callback.
- Health checker lifecycle wiring complete (9.2): instance in index.ts, wired into poller onDiff. DiffCallback extended with currentListeners second arg.
- SSE health-changed event complete (9.3): event type in SSEEvent union, setOnChange → broadcast wiring, client SSE relay registered.
- Health API endpoint complete (9.4): `GET /api/health` returns `{ statuses: Record<string, { status, lastCheck, responseTime?, consecutiveFailures }> }`. Circular import solved by converting routes.ts to factory function (`createApi(healthChecker)`).
- Fire-and-forget promises need `.catch()` — project rule.
- Consumer update on shape change: grep all consumers when changing shared types/API shapes — promoted to rule.

## Judgment calls from this session
- Routes refactored from default export to `createApi(healthChecker)` factory to break circular import between index.ts and routes.ts. Clean dependency injection, no new modules needed.
- Old `GET /api/health` liveness check (`{ status: 'ok' }`) replaced entirely — server liveness is implicit (if it responds, it's alive).
- `responseTime` conditionally included (omitted when null) per spec's `responseTime?: number` optional field.
- `lastCheck` converted from epoch ms to ISO string for the API response, kept as epoch internally.

## Watch for
- Task 9.5 adds healthStatus to `<lh-project-card>`. This means adding healthStatus to the Project type in types.ts — trigger `api-shape-change-missing-consumer-update` rule. Sweep ALL consumers of Project type: buildProjectResponse in routes.ts, SSE handlers in stores, any test mocks.
- The health-changed SSE event already broadcasts `{ projectId, status, responseTime }` — the card component needs to listen for this to update the indicator in real-time without polling.
- Consider whether healthStatus should come from `GET /api/projects` (added to Project response) or from a separate `GET /api/health` call. Spec shows `healthStatus` in the Project type at api-contracts.md:38.
