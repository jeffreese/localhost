# MVP Tasks

## Phase A — Foundation

### Epic 1: Project Scaffolding

- [x] 1.1 Init pnpm project, configure `package.json` scripts (S)
- [x] 1.2 Set up Vite with Lit plugin and Tailwind (S)
- [x] 1.3 Set up Hono server entry point with hello-world route (S)
- [x] 1.4 Configure concurrent dev script (Vite + Hono) (S)
- [x] 1.5 Configure Biome (lint + format) (S)
- [x] 1.6 Configure Vitest (S)
- [x] 1.7 Set up Tailwind design tokens (base theme) (M)
- [x] 1.8 Create `src/server/`, `src/client/`, `src/shared/` structure with placeholder files (S)

**Done when:** `pnpm dev` starts both backend and frontend; `pnpm lint` and `pnpm test` pass on scaffolded code; Tailwind tokens render correctly.

### Epic 2: Config Store

- [x] 2.1 Define config schema TypeScript types in `src/shared/` (S)
- [x] 2.2 Implement config read/write with default creation (M)
- [x] 2.3 Add corruption detection and backup/recreate recovery (S)

**Done when:** First run creates `~/.localhost/config.json` with valid defaults; corrupt JSON is backed up and replaced.

## Phase B — Backend Services (parallel)

### Epic 3: Scanner

- [x] 3.1 Recursive `~/Code/` walk finding `package.json` files (M)
- [x] 3.2 Package manager detection from lock files (S)
- [x] 3.3 Dev script identification (`dev`, `start`, `serve`) (S)
- [x] 3.4 Filter ignored paths from scan results (S)
- [x] 3.5 Persist scan results to config cache (S)

**Done when:** Scan discovers all JS projects, detects package managers, excludes ignored paths, persists results.

### Epic 4: Process Manager

- [x] 4.1 Spawn dev server via `child_process.spawn()` (M)
- [x] 4.2 Stop server with SIGTERM → SIGKILL timeout fallback (S)
- [x] 4.3 PID-to-project mapping persistence in config (S)
- [x] 4.4 Startup reconciliation — PID alive check + port ownership via `lsof` (M)
- [x] 4.5 Port conflict detection and state reporting (S)

**Done when:** Start/stop works; startup reconciliation correctly identifies running/stopped/port-conflict states.

## Phase C — API Layer

### Epic 5: API & SSE

- [x] 5.1 REST endpoints — `POST /api/scan`, `POST /api/projects/:id/start`, `POST /api/projects/:id/stop` (M)
- [x] 5.2 REST endpoints — `PATCH /api/projects/:id` (visibility, config overrides), `GET /api/projects` (S)
- [x] 5.3 SSE broadcaster — client connection management, event serialization (M)
- [x] 5.4 Wire service state changes to SSE events (scan-complete, process-started, process-stopped, project-updated) (M)

**Done when:** All REST endpoints work; SSE delivers events within 1s; multiple tabs receive same events.

## Phase D — Frontend

### Epic 6: Frontend Stores

- [x] 6.1 SSE client — `EventSource` connection with auto-reconnect (S)
- [x] 6.2 ProjectStore — parse SSE project data, expose filtered views (M)
- [x] 6.3 ProcessStore — parse SSE process state, expose per-project status (M)
- [x] 6.4 UIStore — local view state (selected project, panel visibility, filters) (S)

**Done when:** Stores update reactively from SSE; ProjectStore filters hidden/ignored; ProcessStore exposes all three states.

### Epic 7: Dashboard UI

- [x] 7.1 `<lh-dashboard>` — root layout, scan button, global status bar (M)
- [x] 7.2 `<lh-project-card>` — status indicator, start/stop, open-in-browser, GitHub link (L)
- [x] 7.3 `<lh-port-table>` — port-to-project mapping overview, conflict indicators (M)
- [x] 7.4 `<lh-config-panel>` — scan root setting, per-project overrides, manage ignored/hidden (M)

**Done when:** Dashboard shows all visible projects with live status; cards update in real-time; port table flags conflicts; config panel works.

## Phase E — Visibility

### Epic 8: Project Visibility

- [x] 8.1 Hide/ignore actions on project cards (overflow menu) (S)
- [x] 8.2 "Show hidden" toggle on dashboard, muted card styling for hidden projects (S)
- [x] 8.3 Restore flow in config panel (manage hidden/ignored lists) (M)

**Done when:** Hide/ignore/restore all work end-to-end; no permanent deletion path exists.

## Critical Path

1 → 2 → (3 | 4) → 5 → 6 → 7 → 8
