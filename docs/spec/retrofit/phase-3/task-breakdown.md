---
title: "Task Breakdown"
phase: 3
project: localhost
date: 2026-10-05
status: draft
---

# Task Breakdown

## Epics Overview

| # | Epic | Milestone | Description | Dependencies |
|---|------|-----------|-------------|--------------|
| 1 | Async I/O Migration | M1 | Convert all sync I/O to async across server modules | None |
| 2 | Config Store Hardening | M1 | Atomic writes, serialized updates, read caching | 1 |
| 3 | Process Group Lifecycle | M1 | Detached spawn, group signals, PID verification, shutdown handlers | 1, 2 |
| 4 | Stale Code Removal | M1 | Remove dead code, consolidate duplicates | 1 |
| 5 | Background Polling & Reactivity | M2 | Periodic listener scan, SSE push for external changes | 1, 2, 3 |
| 6 | Log Persistence | M3 | Disk logging, rotation, hydration fix | 1, 2, 3 |
| 7 | Port Type Detection | M3 | HTTP probe, clickable vs. informational ports | 5 |
| 8 | Crash Detection & Notifications | M3 | Unexpected exit detection, UI indicator, crash state | 5, 6 |
| 9 | Health Checks | M3 | Per-project HTTP probes, health status on cards | 5, 7 |
| 10 | Resource Monitoring | M3 | CPU/memory sampling, display on cards | 5 |
| 11 | Project Groups | M3 | Group CRUD, assignment, collapsible UI | 1, 2 |
| 12 | Project Type Registry | M4 | Config-driven detection, Rust support | 1, 2, 5 |
| 13 | Port Override Wiring | M1 | Read overrides.port, pass PORT env, conflict check | 3 |

---

## Epic 1: Async I/O Migration

Convert all synchronous I/O to async equivalents. This is the foundation — every subsequent epic depends on async being in place. Each task converts a module AND all its callers in the same commit.

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 1.1 | Convert config-store.ts: `readFileSync` → `fs.promises.readFile`, `writeFileSync` → `fs.promises.writeFile`. Update all callers in routes.ts and other modules to await. | M | — |
| 1.2 | Convert scanner.ts: `readdirSync`/`statSync`/`readFileSync` → `fs.promises` equivalents. `scan()` and `scanAndPersist()` become async. Update route handler. | M | 1.1 |
| 1.3 | Convert listener-scanner.ts: `execSync` → `execFile` (callback-wrapped in a promise). `enumerateListeners()` and `matchListenersToProjects()` become async. Update route handlers. | M | 1.1 |
| 1.4 | Convert process-manager.ts: `startProject`/`stopProject`/`stopListener` become async. Child process lifecycle already event-driven — main change is config reads/writes going async. | M | 1.1 |
| 1.5 | Verify: grep for `*Sync` in src/server/. Zero hits in production code. Update tests. | S | 1.1–1.4 |

### Acceptance Criteria

- Zero `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `execSync` calls in `src/server/`
- All route handlers use async/await
- SSE keepalives never blocked by I/O operations
- All existing tests pass (updated for async)

---

## Epic 2: Config Store Hardening

Atomic writes, serialized read-modify-write, and read caching.

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 2.1 | Implement atomic writes: write to `.tmp` file, then `fs.rename` to config path. | S | 1.1 |
| 2.2 | Implement write serialization: async queue wrapping `updateConfig` so concurrent callers are serialized. | M | 2.1 |
| 2.3 | Implement read caching: in-memory cache, populated on first read, updated on write, no disk reads on hot paths. | S | 2.2 |
| 2.4 | Add backward-compatible defaults for new config fields (`projectTypes`, `groupConfig`, `crashes`) in `readConfig`. | S | 2.3 |
| 2.5 | Write tests: concurrent update simulation, crash-during-write recovery, cache invalidation. | M | 2.1–2.4 |

### Acceptance Criteria

- Rapid concurrent `updateConfig` calls don't lose writes
- Kill the process mid-write → config file is either the old version or the new version, never corrupt
- Config reads after the first are served from memory (verify with a stat counter or mock)
- Existing configs without new fields load successfully with defaults applied

---

## Epic 3: Process Group Lifecycle

Detached spawn, process group signals, PID verification, shutdown handlers.

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 3.1 | Modify `startProject` to spawn with `detached: true`. Explicitly pipe stdout/stderr (no longer inherited). Verify on macOS that `setsid` creates a new process group. | M | 1.4 |
| 3.2 | Modify `stopProject` to use `process.kill(-pid, 'SIGTERM')` (process group signal). Update SIGKILL escalation to target the group. | M | 3.1 |
| 3.3 | Implement PID verification: before signaling, check PID is alive and cwd matches expected project path via lsof. Refuse to signal on mismatch, clean up stale entry. | M | 3.2 |
| 3.4 | Add shutdown handlers in index.ts: `process.on('SIGTERM'/'SIGINT'/'exit')` → SIGTERM all active process groups, grace period, SIGKILL survivors. | M | 3.1 |
| 3.5 | Implement startup PID cleanup: iterate `config.pids` on server start, verify each, remove dead/stale entries. | S | 2.2, 3.3 |
| 3.6 | Fix double exit handler registration: single `child.on('exit')` handler, not re-registered on stop. | S | 3.1 |
| 3.7 | Write tests: process group kill, PID verification (mock lsof), shutdown cleanup, stale PID pruning. | M | 3.1–3.6 |

### Acceptance Criteria

- Starting a pnpm project that uses concurrently → stopping it → zero orphaned processes (verify with `ps`)
- Restarting Localhost (kill -TERM the server process) → all spawned children are cleaned up
- Stale PIDs from previous sessions are removed on startup
- Attempting to stop a project whose PID now belongs to a different process → error, not SIGTERM

---

## Epic 4: Stale Code Removal

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 4.1 | Remove `getPortOwner` function from process-manager.ts. | S | 1.4 |
| 4.2 | Remove `ProcessStore` (src/client/stores/process-store.ts). Remove imports. Verify no component references it. | S | — |
| 4.3 | Consolidate duplicate project-mapping logic in routes.ts (`GET /projects` and `POST /scan`) into a shared `buildProjectResponse` function. | S | 1.1 |

### Acceptance Criteria

- No dead code: `getPortOwner` gone, `ProcessStore` gone
- `buildProjectResponse` used by both endpoints — no copy-paste mapping logic
- All tests pass, no import errors

---

## Epic 5: Background Polling & Reactivity

The core reactivity fix. Periodic listener scan detects external changes and pushes via SSE.

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 5.1 | Create `background-poller.ts`: `setInterval` at 5s, calls async `enumerateListeners` + `matchListenersToProjects`. Store previous state for diffing. | M | 1.3 |
| 5.2 | Implement listener diff logic: compare current vs. previous listener map. Identify new, removed, and changed listeners. | M | 5.1 |
| 5.3 | Wire diff results to SSE broadcasts: `process-started` for new listeners, `process-stopped` for removed, `port-detected` for new ports on existing projects. | M | 5.2 |
| 5.4 | Add overlap guard: if a tick is still running when the next fires, skip it. | S | 5.1 |
| 5.5 | Start poller on server startup (index.ts), stop on shutdown. | S | 5.1, 3.4 |
| 5.6 | Add event IDs to SSE broadcaster (monotonic counter) for future replay support. | S | — |
| 5.7 | Write tests: diff logic (mock listener data), SSE broadcast verification, overlap guard. | M | 5.1–5.4 |

### Acceptance Criteria

- Start a dev server from a terminal (not via Localhost UI) → Localhost detects it within 5s and updates the dashboard without page refresh
- Stop a dev server from a terminal → dashboard updates within 5s
- Multiple browser tabs all receive the same SSE events simultaneously
- Poller doesn't queue ticks if a previous tick is slow

---

## Epic 6: Log Persistence

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 6.1 | Create `log-store.ts`: append log lines to `~/.localhost/logs/<project>.log` with timestamp and stream prefix. Create directory on first write. | M | 1.4 |
| 6.2 | Wire process-manager stdout/stderr to both ring buffer (existing) and log-store (new). | S | 6.1, 3.1 |
| 6.3 | Implement size-based rotation: check file size before write, rotate when exceeding 10MB. Keep `.log` + `.log.1`. | M | 6.1 |
| 6.4 | Update `GET /api/projects/:id/logs` to read from disk with pagination (lines + offset params). | M | 6.1 |
| 6.5 | Fix console store hydration race condition: buffer SSE events during fetch, merge after fetch completes, then subscribe normally. | M | — |
| 6.6 | Write tests: file writing, rotation trigger, pagination, hydration race fix. | M | 6.1–6.5 |

### Acceptance Criteria

- Restart Localhost → console drawer shows historical logs for still-running processes
- Log file for an active project doesn't exceed ~20MB (current + one rotated)
- Open console drawer during active logging → no dropped lines (race condition fixed)

---

## Epic 7: Port Type Detection

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 7.1 | Add HTTP HEAD probe function: async fetch with 2s timeout, returns `http` or `tcp`. | S | — |
| 7.2 | Integrate into background poller: probe new ports when detected, cache results. Invalidate when port listener disappears. | M | 5.2 |
| 7.3 | Add `portType` field to listener data in SSE events and API responses. | S | 7.2 |
| 7.4 | Update `<lh-project-card>`: HTTP ports render as clickable links, TCP ports as plain text badges. | S | 7.3 |
| 7.5 | Update `<lh-port-table>`: add port type column. | S | 7.3 |

### Acceptance Criteria

- Database port (e.g., Postgres :5432) shows as non-clickable badge
- Vite dev server port shows as clickable link that opens in browser
- Port type is cached — no re-probe on every render or SSE event

---

## Epic 8: Crash Detection & Notifications

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 8.1 | Add crash detection to background poller diff: listener disappeared + no user-initiated stop = crash. Track user-stop flag in process manager. | M | 5.2 |
| 8.2 | For Localhost-spawned processes: capture exit code and signal from child `exit` event, broadcast `process-crashed`. | S | 3.1 |
| 8.3 | Store crash info in config: `crashes[projectId] = { timestamp, exitCode, signal }`. Clear on next successful start. | S | 8.1, 2.2 |
| 8.4 | Add `process-crashed` SSE event type. | S | 8.1 |
| 8.5 | Update `<lh-project-card>`: show crash indicator with timestamp and exit info when `crashInfo` is present. Clear on start. | M | 8.4 |
| 8.6 | Desktop notification via Notification API on crash (nice-to-have). | S | 8.4 |

### Acceptance Criteria

- Kill a dev server with `kill -9` → dashboard shows crash indicator within 5s with timestamp
- Start the project again → crash indicator clears
- Crash info survives page refresh (stored in config)
- User-initiated stop does NOT trigger crash indicator

---

## Epic 9: Health Checks

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 9.1 | Create `health-checker.ts`: per-project `setInterval` timers. HTTP HEAD probe with 3s timeout. Track consecutive failures. | M | 7.1 |
| 9.2 | Start health checks automatically when a service starts (wire into process-manager and background poller). Stop when service stops. | M | 9.1, 5.3 |
| 9.3 | Broadcast `health-changed` SSE event when status transitions (healthy → unhealthy or vice versa). | S | 9.1 |
| 9.4 | Add `GET /api/health` endpoint returning status summary for all running projects. | S | 9.1 |
| 9.5 | Update `<lh-project-card>`: health indicator (green/red/gray dot or similar). | S | 9.3 |
| 9.6 | Support per-project `healthCheckInterval` override in config (0 to disable). | S | 9.1, 2.4 |

### Acceptance Criteria

- Start a web dev server → health indicator shows green within 30s
- Kill the server process but leave the port hanging → health indicator turns red
- Non-HTTP service → health shows gray/unknown, no probes sent
- Disable health checks for a project via config → no probes for that project

---

## Epic 10: Resource Monitoring

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 10.1 | Add resource sampling to background poller: every 3rd tick, run `ps -o pid,pcpu,rss -p <all-pids>`. Parse output. | M | 5.1 |
| 10.2 | Aggregate CPU and memory per project (sum across all PIDs in process group). | S | 10.1 |
| 10.3 | Broadcast `resource-update` SSE events with per-project cpu/memory. | S | 10.1 |
| 10.4 | Add `GET /api/resources` endpoint. | S | 10.1 |
| 10.5 | Update `<lh-project-card>`: display CPU % and memory (formatted, e.g., "12% / 84MB") for running projects. | S | 10.3 |

### Acceptance Criteria

- Running project card shows current CPU and memory usage
- Values update every ~15s
- Stopped projects show no resource data
- `ps` call is non-blocking and handles missing PIDs gracefully

---

## Epic 11: Project Groups

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 11.1 | Add `groupConfig` to config schema with default. Add `GroupConfig` types to shared/types.ts. | S | 2.4 |
| 11.2 | Implement group API endpoints: `POST /api/groups`, `PATCH /api/groups/:id`, `DELETE /api/groups/:id`. | M | 11.1 |
| 11.3 | Add `group` field to `PATCH /api/projects/:id` for assignment/unassignment. | S | 11.2 |
| 11.4 | Broadcast `groups-changed` SSE event on all group mutations. | S | 11.2 |
| 11.5 | Update `<lh-dashboard>`: render projects grouped by group assignment. Ungrouped projects in a default section. Collapsible group headers. | L | 11.4 |
| 11.6 | Update drag-and-drop to work within and across groups. Custom order stays flat — groups are a UI-layer overlay on the ordered list. | M | 11.5 |
| 11.7 | Add group management UI: create/rename/delete groups, assign projects via drag or menu. | M | 11.5 |

### Acceptance Criteria

- Create a group, assign 3 projects → they appear under the group header
- Collapse a group → projects hidden, collapse state persisted
- Delete a group → projects become ungrouped, not hidden
- Drag a project from one group to another → assignment updates
- New projects from scan appear ungrouped

---

## Epic 12: Project Type Registry

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 12.1 | Add `projectTypes` to config schema with Node + Rust defaults. Add types to shared/types.ts. | S | 2.4 |
| 12.2 | Refactor scanner to iterate registry marker files instead of hardcoded `package.json`. First-match-wins ordering. | M | 12.1, 1.2 |
| 12.3 | Refactor listener-scanner to build lsof command filter from registry `processNames` arrays. | M | 12.1, 1.3 |
| 12.4 | Add `GET /api/config/project-types` and `PUT /api/config/project-types` endpoints. | S | 12.1 |
| 12.5 | Update `<lh-project-card>`: show project type indicator (icon or label). | S | 12.2 |
| 12.6 | Test with actual Rust projects in `~/Code/`: verify Cargo.toml detection, `cargo run` as default command, `cargo` process matching in lsof. | M | 12.2, 12.3 |

### Acceptance Criteria

- Rust project with Cargo.toml detected by scan, shows in dashboard
- Starting a Rust project runs `cargo run` (or `cargo watch` if configured)
- Stopping a Rust project kills the cargo process group
- Adding a new type via API → next scan picks it up

---

## Epic 13: Port Override Wiring

### Tasks

| # | Task | Size | Dependencies |
|---|------|------|--------------|
| 13.1 | Read `config.overrides[projectId].port` in `startProject`. Pass as `PORT` env var to spawned process. | S | 3.1 |
| 13.2 | Before starting with a port override: check if port is occupied via listener scanner. Return 409 if conflict. | S | 13.1, 1.3 |
| 13.3 | Write tests: port override passed correctly, conflict detection, no override (existing behavior unchanged). | S | 13.1, 13.2 |

### Acceptance Criteria

- Set `overrides.port = 4000` for a project → starting it passes `PORT=4000` to the process
- If port 4000 is already occupied → start returns error, no process spawned
- No port override → existing behavior (process picks its own port)

---

## Implementation Sequence

```
Phase A — Foundation (Epics 1–2, sequential)
  1. Async I/O migration (all modules)
  2. Config store hardening (atomic, serialized, cached)

Phase B — Process Safety (Epics 3–4, sequential)
  3. Process group lifecycle
  4. Stale code removal
  13. Port override wiring (small, depends on 3)

Phase C — Reactivity (Epic 5)
  5. Background polling & SSE push

Phase D — Features (Epics 6–12, partially parallel)
  6. Log persistence (depends on 3)
  7. Port type detection (depends on 5)
  8. Crash detection (depends on 5, 6)
  9. Health checks (depends on 5, 7)
  10. Resource monitoring (depends on 5)
  11. Project groups (depends on 2)
  12. Project type registry (depends on 5)

  Parallelizable pairs: (6, 11), (7, 10), (9, 12)
  Sequential: 7 → 9 (health checks need port type detection)
              6 → 8 (crash needs log persistence for context)
```

**Critical path:** 1 → 2 → 3 → 5 → 7 → 9

## Cutover Notes

This is a retrofit of a running personal tool. No external consumers, no data migration, no rollback complexity. The existing `~/.localhost/config.json` is backward-compatible — new fields get defaults, existing fields are preserved.

The main cutover concern: **process management changes (Epic 3) alter how processes are spawned and stopped.** If the upgrade happens while dev servers are running:
- Servers spawned by the old version won't have process groups — stopping them falls back to single-PID SIGTERM (existing behavior, no worse)
- After restart, stale PID cleanup (3.5) handles orphaned entries
- No migration script needed — the transition is graceful

## Post-MVP Backlog

- **Frontend migration (Lit → React):** Separate project. React 19 + TanStack Router + TanStack Query + Radix UI. Evaluates after server stabilization.
- **Quick-launch profiles:** Named project sets ("start these 5 together").
- **Startup dependency ordering:** "Start A, wait for port, then start B."
- **TUI mode:** Terminal dashboard alternative.
- **Auto-scan via file watcher:** fswatch/chokidar on `~/Code/`.
- **Multiple scan roots:** Support scanning beyond `~/Code/`.
- **Full process adoption:** Re-attach stdout to externally-started processes.
- **SSE replay on reconnect:** Use event IDs to replay missed events after client reconnect.
- **Resource sparklines:** Historical CPU/memory trend on project cards.
