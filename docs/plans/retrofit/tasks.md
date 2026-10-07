---
title: "Retrofit Tasks"
plan: retrofit
date: 2026-10-05
---

# Retrofit Tasks

## Epic 1: Async I/O Migration

- [x] 1.1 Convert config-store.ts to async: `readFileSync` → `fs.promises.readFile`, `writeFileSync` → `fs.promises.writeFile`. Update all callers to await.
- [x] 1.2 Convert scanner.ts to async: `readdirSync`/`statSync`/`readFileSync` → `fs.promises`. `scan()` and `scanAndPersist()` become async. Update route handler.
- [x] 1.3 Convert listener-scanner.ts to async: `execSync` → `execFile` wrapped in promise. Update route handlers.
- [x] 1.4 Convert process-manager.ts to async: `startProject`/`stopProject`/`stopListener` become async. Config reads/writes go async.
- [x] 1.5 Verify zero `*Sync` calls in src/server/ production code. Update all tests for async.

## Epic 2: Config Store Hardening

- [x] 2.1 Implement atomic writes: write to `.tmp` file, then `fs.rename` to config path.
- [x] 2.2 Implement write serialization: async queue wrapping `updateConfig` for concurrent safety.
- [x] 2.3 Implement read caching: in-memory cache populated on first read, updated on write.
- [x] 2.4 Add backward-compatible defaults for new config fields (`projectTypes`, `groupConfig`, `crashes`) in `readConfig`.
- [x] 2.5 Write tests: concurrent updates, crash-during-write recovery, cache invalidation.

## Epic 3: Process Group Lifecycle

- [x] 3.1 Modify `startProject` to spawn with `detached: true`. Explicitly pipe stdout/stderr. Verify process group creation on macOS.
- [x] 3.2 Modify `stopProject` to use `process.kill(-pid, 'SIGTERM')` (process group signal). SIGKILL escalation targets the group.
- [x] 3.3 Implement PID verification: before signaling, check PID alive and cwd matches project path. Refuse on mismatch.
- [x] 3.4 Add shutdown handlers in index.ts: SIGTERM/SIGINT/exit → kill all active process groups with grace period.
- [x] 3.5 Implement startup PID cleanup: iterate `config.pids`, verify each, remove dead/stale.
- [x] 3.6 Fix double exit handler: single `child.on('exit')` handler, not re-registered on stop.
- [x] 3.7 Write tests: process group kill, PID verification, shutdown cleanup, stale PID pruning.

## Epic 4: Stale Code Removal

- [x] 4.1 Remove `getPortOwner` from process-manager.ts.
- [ ] 4.2 Remove `ProcessStore` (src/client/stores/process-store.ts) and all imports.
- [ ] 4.3 Consolidate duplicate project-mapping in routes.ts into shared `buildProjectResponse`.

## Epic 13: Port Override Wiring

- [ ] 13.1 Read `config.overrides[projectId].port` in `startProject`, pass as `PORT` env var.
- [ ] 13.2 Check port occupancy before starting with override. Return 409 on conflict.
- [ ] 13.3 Write tests: port override passed, conflict detection, no-override unchanged.

## Epic 5: Background Polling & Reactivity

- [ ] 5.1 Create `background-poller.ts`: 5s setInterval, async listener enumeration + project matching.
- [ ] 5.2 Implement listener diff logic: compare current vs previous, identify new/removed/changed.
- [ ] 5.3 Wire diff to SSE broadcasts: `process-started`, `process-stopped`, `port-detected`.
- [ ] 5.4 Add overlap guard: skip tick if previous still running.
- [ ] 5.5 Start poller on server startup, stop on shutdown.
- [ ] 5.6 Add event IDs to SSE broadcaster (monotonic counter).
- [ ] 5.7 Write tests: diff logic, SSE broadcast verification, overlap guard.

## Epic 6: Log Persistence

- [ ] 6.1 Create `log-store.ts`: append to `~/.localhost/logs/<project>.log` with timestamp + stream prefix. Create dir on first write.
- [ ] 6.2 Wire process-manager stdout/stderr to both ring buffer and log-store.
- [ ] 6.3 Implement size-based rotation: 10MB default, keep `.log` + `.log.1`.
- [ ] 6.4 Update `GET /api/projects/:id/logs` to read from disk with pagination.
- [ ] 6.5 Fix console store hydration race: buffer SSE events during fetch, merge after.
- [ ] 6.6 Write tests: file writing, rotation, pagination, hydration race fix.

## Epic 7: Port Type Detection

- [ ] 7.1 Add HTTP HEAD probe function: async fetch, 2s timeout, returns `http` or `tcp`.
- [ ] 7.2 Integrate into background poller: probe new ports, cache results, invalidate on disappearance.
- [ ] 7.3 Add `portType` field to listener data in SSE events and API responses.
- [ ] 7.4 Update `<lh-project-card>`: HTTP ports clickable, TCP ports plain text.
- [ ] 7.5 Update `<lh-port-table>`: add port type column.

## Epic 8: Crash Detection & Notifications

- [ ] 8.1 Add crash detection to poller diff: disappeared listener + no user stop = crash. Track stop flag.
- [ ] 8.2 Capture exit code/signal from child `exit` event for Localhost-spawned processes, broadcast `process-crashed`.
- [ ] 8.3 Store crash info in `config.crashes[projectId]`. Clear on next start.
- [ ] 8.4 Add `process-crashed` SSE event type.
- [ ] 8.5 Update `<lh-project-card>`: crash indicator with timestamp and exit info.
- [ ] 8.6 Desktop notification via Notification API on crash (nice-to-have).

## Epic 9: Health Checks

- [ ] 9.1 Create `health-checker.ts`: per-project setInterval timers, HTTP HEAD with 3s timeout, track consecutive failures.
- [ ] 9.2 Auto-start health checks when service starts, stop when it stops.
- [ ] 9.3 Broadcast `health-changed` SSE event on status transitions.
- [ ] 9.4 Add `GET /api/health` endpoint.
- [ ] 9.5 Update `<lh-project-card>`: health indicator dot.
- [ ] 9.6 Support per-project `healthCheckInterval` override (0 to disable).

## Epic 10: Resource Monitoring

- [ ] 10.1 Add resource sampling to poller: every 3rd tick, `ps -o pid,pcpu,rss` for all running PIDs.
- [ ] 10.2 Aggregate CPU/memory per project across process group.
- [ ] 10.3 Broadcast `resource-update` SSE events.
- [ ] 10.4 Add `GET /api/resources` endpoint.
- [ ] 10.5 Update `<lh-project-card>`: display CPU % and memory.

## Epic 11: Project Groups

- [ ] 11.1 Add `groupConfig` to config schema with defaults. Add types.
- [ ] 11.2 Implement group API: POST/PATCH/DELETE /api/groups.
- [ ] 11.3 Add group assignment to PATCH /api/projects/:id.
- [ ] 11.4 Broadcast `groups-changed` SSE event on mutations.
- [ ] 11.5 Update `<lh-dashboard>`: grouped rendering with collapsible headers.
- [ ] 11.6 Update drag-and-drop for within/across group ordering.
- [ ] 11.7 Add group management UI: create/rename/delete, assign via drag or menu.

## Epic 12: Project Type Registry

- [ ] 12.1 Add `projectTypes` to config schema with Node + Rust defaults.
- [ ] 12.2 Refactor scanner to iterate registry marker files instead of hardcoded package.json.
- [ ] 12.3 Refactor listener-scanner to build lsof filter from registry processNames.
- [ ] 12.4 Add GET/PUT /api/config/project-types endpoints.
- [ ] 12.5 Update `<lh-project-card>`: project type indicator.
- [ ] 12.6 Test with actual Rust projects: Cargo.toml detection, cargo run, cargo process matching.
