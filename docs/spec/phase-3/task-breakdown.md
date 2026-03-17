---
title: "Task Breakdown"
phase: 3
project: localhost
date: 2026-03-16
status: draft
---

# Task Breakdown

## Epics Overview

| # | Epic | Description | Dependencies |
|---|------|-------------|--------------|
| 1 | Project Scaffolding | Vite + Lit + Tailwind + Hono monorepo setup, dev tooling (Biome, Vitest), concurrent `pnpm dev` | None |
| 2 | Config Store | `~/.localhost/config.json` read/write, schema, defaults, corruption recovery | 1 |
| 3 | Scanner | Recursive project discovery, package manager detection, dev script identification, ignore list filtering | 2 |
| 4 | Process Manager | Spawn/kill via child_process, PID tracking, startup reconciliation, port conflict detection | 2 |
| 5 | API & SSE | Hono REST endpoints, SSE broadcaster, event schema | 3, 4 |
| 6 | Frontend Stores | ProjectStore, ProcessStore, UIStore wired to SSE | 5 |
| 7 | Dashboard UI | All four Lit components — dashboard, project cards, port table, config panel | 6 |
| 8 | Project Visibility | Hide/ignore/restore flows end-to-end | 5, 7 |

---

## Epic 1: Project Scaffolding

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 1.1 | Init pnpm project, configure `package.json` scripts | S | Yes | — |
| 1.2 | Set up Vite with Lit plugin and Tailwind | S | Yes | 1.1 |
| 1.3 | Set up Hono server entry point with hello-world route | S | Yes | 1.1 |
| 1.4 | Configure concurrent dev script (Vite + Hono) | S | Yes | 1.2, 1.3 |
| 1.5 | Configure Biome (lint + format) | S | Yes | 1.1 |
| 1.6 | Configure Vitest | S | Yes | 1.1 |
| 1.7 | Set up Tailwind design tokens (base theme) | M | Yes | 1.2 |
| 1.8 | Create `src/server/`, `src/client/`, `src/shared/` structure with placeholder files | S | Yes | 1.1 |

### Acceptance Criteria

- `pnpm dev` starts both Hono backend and Vite frontend concurrently
- `pnpm lint` runs Biome with no errors on scaffolded code
- `pnpm test` runs Vitest (even if no tests yet)
- Tailwind design tokens are available and a test component renders with token classes

---

## Epic 2: Config Store

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 2.1 | Define config schema TypeScript types in `src/shared/` | S | Yes | 1.8 |
| 2.2 | Implement config read/write with default creation | M | Yes | 2.1 |
| 2.3 | Add corruption detection and backup/recreate recovery | S | Yes | 2.2 |

### Acceptance Criteria

- First run creates `~/.localhost/config.json` with valid defaults
- Read/write round-trips preserve all fields
- Corrupt JSON is backed up and replaced with fresh defaults

---

## Epic 3: Scanner

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 3.1 | Recursive `~/Code/` walk finding `package.json` files | M | Yes | 1.8 |
| 3.2 | Package manager detection from lock files | S | Yes | 3.1 |
| 3.3 | Dev script identification (`dev`, `start`, `serve`) | S | Yes | 3.1 |
| 3.4 | Filter ignored paths from scan results | S | Yes | 3.1, 2.2 |
| 3.5 | Persist scan results to config cache | S | Yes | 3.1, 2.2 |

### Acceptance Criteria

- Scan discovers all JS projects under `~/Code/` with a `package.json`
- Each project has correct package manager detected from lock file
- Ignored paths are excluded from results
- Results persist to config so next launch loads instantly without re-scanning

---

## Epic 4: Process Manager

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 4.1 | Spawn dev server via `child_process.spawn()` | M | Yes | 2.2 |
| 4.2 | Stop server with SIGTERM → SIGKILL timeout fallback | S | Yes | 4.1 |
| 4.3 | PID-to-project mapping persistence in config | S | Yes | 4.1, 2.2 |
| 4.4 | Startup reconciliation — PID alive check + port ownership via `lsof` | M | Yes | 4.3 |
| 4.5 | Port conflict detection and state reporting | S | Yes | 4.4 |

### Acceptance Criteria

- Start spawns the correct dev command for the project's package manager
- Stop terminates the process; SIGKILL fires after timeout if SIGTERM doesn't work
- Startup reconciliation correctly identifies running, stopped, and port-conflict states
- Port conflict detected when another process occupies the expected port

---

## Epic 5: API & SSE

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 5.1 | REST endpoints — `POST /api/scan`, `POST /api/projects/:id/start`, `POST /api/projects/:id/stop` | M | Yes | 3.1, 4.1 |
| 5.2 | REST endpoints — `PATCH /api/projects/:id` (visibility, config overrides), `GET /api/projects` | S | Yes | 2.2 |
| 5.3 | SSE broadcaster — client connection management, event serialization | M | Yes | 1.3 |
| 5.4 | Wire service state changes to SSE events (scan-complete, process-started, process-stopped, project-updated) | M | Yes | 5.1, 5.3 |

### Acceptance Criteria

- All REST endpoints return correct responses and update state
- SSE stream delivers events within 1s of state changes
- Multiple browser tabs receive the same SSE events
- Disconnected clients reconnect automatically via EventSource

---

## Epic 6: Frontend Stores

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 6.1 | SSE client — `EventSource` connection with auto-reconnect | S | Yes | 5.3 |
| 6.2 | ProjectStore — parse SSE project data, expose filtered views | M | Yes | 6.1 |
| 6.3 | ProcessStore — parse SSE process state, expose per-project status | M | Yes | 6.1 |
| 6.4 | UIStore — local view state (selected project, panel visibility, filters) | S | Yes | — |

### Acceptance Criteria

- Stores update reactively when SSE events arrive
- ProjectStore filters hidden/ignored projects from default view
- ProcessStore exposes running/stopped/port-conflict per project
- UIStore state is local-only and doesn't trigger backend calls

---

## Epic 7: Dashboard UI

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 7.1 | `<lh-dashboard>` — root layout, scan button, global status bar | M | Yes | 6.2, 6.3 |
| 7.2 | `<lh-project-card>` — status indicator, start/stop, open-in-browser, GitHub link | L | Yes | 6.2, 6.3 |
| 7.3 | `<lh-port-table>` — port-to-project mapping overview, conflict indicators | M | Yes | 6.3 |
| 7.4 | `<lh-config-panel>` — scan root setting, per-project overrides, manage ignored/hidden | M | Yes | 6.2 |

### Acceptance Criteria

- Dashboard shows all visible projects with live status
- Project cards update in real-time when processes start/stop
- Port table shows all active ports and flags conflicts
- Config panel allows changing scan root and per-project overrides

---

## Epic 8: Project Visibility

### Tasks

| # | Task | Size | MVP? | Dependencies |
|---|------|------|------|--------------|
| 8.1 | Hide/ignore actions on project cards (overflow menu) | S | Yes | 7.2, 5.2 |
| 8.2 | "Show hidden" toggle on dashboard, muted card styling for hidden projects | S | Yes | 7.1, 6.2 |
| 8.3 | Restore flow in config panel (manage hidden/ignored lists) | M | Yes | 7.4, 5.2 |

### Acceptance Criteria

- Hide removes a project from default view; it reappears with "show hidden" toggle
- Ignore removes from dashboard and skips on future rescans
- Both are reversible from the config panel
- No permanent deletion path exists

## Implementation Sequence

**Phase A — Foundation (Epics 1–2)**
Scaffolding first, then config store. Everything else depends on these.

**Phase B — Backend Services (Epics 3–4, parallel)**
Scanner and Process Manager are independent of each other — both depend on Config Store but not on each other. Can be built in parallel.

**Phase C — API Layer (Epic 5)**
REST + SSE wiring. Depends on both backend services being functional.

**Phase D — Frontend (Epics 6–7, sequential)**
Stores first (need SSE to subscribe to), then UI components that consume them.

**Phase E — Visibility (Epic 8)**
End-to-end feature that touches API, stores, and UI — goes last.

**Critical path:** 1 → 2 → (3 | 4) → 5 → 6 → 7 → 8

## Post-MVP Backlog

- **TUI mode** — Terminal dashboard alternative to the browser UI
- **Auto-scan on filesystem changes** — File watcher on `~/Code/` instead of manual scan trigger
- **Custom scan roots** — Support multiple scan directories beyond `~/Code/`
- **Log viewer** — Stream dev server stdout/stderr in the dashboard
