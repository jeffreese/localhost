# Session Context

## What's next
- Epic 12 (Project Type Registry) complete. All retrofit epics (1-12) are done.
- The backlog.md "retrofit" plan is fully shipped. Next work comes from the "Future" section of the backlog or new planning.

## Key constraints (carried forward)
- Routes use `createApi(healthChecker, poller)` factory — `buildProjectResponse` takes a pre-fetched `resourceMap` parameter (hoisted per request, not per project).
- `ResourceGetter` interface decouples routes from BackgroundPoller.
- Server does NOT kill spawned processes on exit — only on explicit user stop request.
- Consumer update on shape change — project rule. 9 occurrences (added projectType to ProjectCache and Project).
- Fire-and-forget promises need `.catch()` — project rule.
- New SSE event types need addEventListener in sse-client.ts — manual registration required.

## Discoveries from this session
- Task 12.1 was already done from Epic 2 (types and config defaults existed). Same pattern as 11.1.
- Scanner refactor: `detectProject()` iterates registry entries, first match wins. For `detectManager: true` types, reads the marker file as JSON for name/scripts. For others, uses `defaultCommand` and directory name.
- Listener scanner: `buildCommandFlags()` collects unique process names from all registry entries. `enumerateListeners()` now reads config to build flags dynamically per call.
- `ProjectCache` and `Project` both gained `projectType: string` field — required field, set by scanner from `typeEntry.name`.
- Project card shows `projectType` in header. For node projects: "node · pnpm". For non-node: just the type name (no meaningless package manager).
- Rust sub-crates inside evolution-sim were all detected (persistence, rendering, seeding, simulation) — total projects went from 44 to 52.
- GET/PUT /api/config/project-types endpoints added. PUT validates each entry has a `name` string and `processNames` is an array if present.

## Watch for
- The `packageManager` field defaults to `npm` for non-Node project types. This is technically wrong but harmless — the field is only displayed for node type projects on the card. If it becomes meaningful elsewhere (e.g., build commands), it should be made optional.
- Pre-existing security issues still present: unvalidated PID in stopListener (arbitrary signal), no CORS/origin checks on POST routes.
