---
title: "Technical Specification"
phase: 2
project: localhost
date: 2026-03-16
status: draft
---

# Technical Specification

## System Overview

Localhost is a two-layer local application for managing JS dev servers:

**Backend (Node.js + Hono)** — The backend owns all system interactions: scanning the filesystem for projects, spawning and killing dev server processes via `child_process`, tracking PIDs and port assignments, reading/writing the central config file, and exposing everything through a REST API. It also maintains an SSE stream for pushing real-time state changes to connected clients.

**Frontend (Lit + Tailwind)** — A lightweight web dashboard that subscribes to the backend's SSE stream for live status updates and dispatches commands (start, stop, scan, configure) via REST. Built with Lit web components using Light DOM, Tailwind with design token abstraction, and reactive stores per domain (ProjectStore, ProcessStore, UIStore).

**Communication model:** Commands flow frontend → backend via REST (`POST /api/projects/:id/start`). State updates flow backend → frontend via SSE. This one-way data push avoids the complexity of WebSockets while providing instant UI feedback when process state changes. The browser's native `EventSource` handles reconnection automatically.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ ProjectStore │  │ ProcessStore │  │  UIStore  │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         └────────────────┼────────────────┘         │
│                          │ subscribe                │
│                    ┌─────┴─────┐                    │
│                    │ EventSource│                    │
│                    │   (SSE)    │                    │
│                    └─────┬─────┘                    │
│  ┌──────────┐            │           ┌───────────┐  │
│  │ Dashboard │  REST ────┼────────── │  Project   │  │
│  │  Layout   │  cmds     │           │   Cards    │  │
│  └──────────┘      │     │           └───────────┘  │
└────────────────────┼─────┼──────────────────────────┘
                     │     │ SSE stream
                     ▼     ▼
┌────────────────────────────────────────────────────┐
│              Hono HTTP Server (:7770)               │
│                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Scanner   │  │   Process    │  │   Config    │  │
│  │  Service   │  │   Manager    │  │   Store     │  │
│  └─────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│        │                │                 │         │
└────────┼────────────────┼─────────────────┼─────────┘
         │                │                 │
         ▼                ▼                 ▼
   ~/Code/**        child_process      config.json
   package.json     spawn/kill         ~/.localhost/
```

## Component Breakdown

### Backend Services

#### Scanner Service

Recursively walks the configured root directory (default `~/Code/`), finds `package.json` files, detects package manager from lock files (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn), and identifies runnable dev scripts (`dev`, `start`, `serve`). Returns a list of discovered projects with metadata. Triggered on demand (user clicks "scan"), not on a file watcher or interval. Results are persisted to config so the dashboard loads instantly on next launch.

#### Process Manager

Spawns dev servers via `child_process.spawn()`, tracks PIDs, kills processes on stop. Persists PID-to-project mapping in config for crash recovery.

**Startup reconciliation** uses two-step verification to avoid false positives:

1. Check if we have a stored PID from the last session. If yes, verify it's still alive (`process.kill(pid, 0)`).
2. If PID is alive, confirm it owns the expected port via `lsof -i :port -t`. PID match → mark running. PID mismatch → port conflict.
3. If PID is dead or missing but the port responds → port conflict (unknown process).

This produces three states beyond stopped:

| State | Condition | UI behavior |
|-------|-----------|-------------|
| **Running** | Our PID is alive and owns the port | Show stop button, open button |
| **Stopped** | No PID, port is free | Show start button |
| **Port conflict** | Port occupied by something we didn't spawn | Warning badge, disable start, offer "pick another port" |

Emits state change events that feed the SSE stream.

#### Config Store

Reads/writes `~/.localhost/config.json`. Contents:

- Scan root path (default `~/Code/`)
- Discovered project cache (paths, detected package manager, dev scripts)
- Per-project overrides (selected dev script, locked port assignment)
- Last-known PID-to-project mapping for startup reconciliation
- Hidden projects list (paths excluded from dashboard but recoverable via "show hidden")
- Ignored projects list (paths skipped during rescan, recoverable from settings)

Simple JSON read/write — no database.

#### SSE Broadcaster

Maintains a set of connected `EventSource` clients. When any service emits a state change (process started, stopped, errored, scan complete, port conflict detected), serializes the current state and pushes to all connected clients.

### Frontend Components

#### `<lh-dashboard>`

Root layout component. Holds the project list, scan button, "show hidden" toggle, and global status bar. Orchestrates child components. When "show hidden" is active, hidden projects appear with a muted style and a "restore" action.

#### `<lh-project-card>`

One per discovered project. Displays project name, status indicator (running/stopped/error/port conflict), port, package manager icon, start/stop button, open-in-browser button, and GitHub repo link. Includes "hide" and "delete" actions (e.g., in an overflow menu). Subscribes to ProcessStore for live status updates.

#### `<lh-port-table>`

Overview of port-to-project mapping. Shows which ports are in use, which have conflicts, and which are locked assignments.

#### `<lh-config-panel>`

Settings UI for scan root directory, per-project overrides (dev script selection, port locking), and managing ignored/hidden projects (restore or permanently forget). Reads/writes via REST to the Config Store.

### Reactive Stores (Frontend)

**ProjectStore** — Discovered projects and their metadata (path, package manager, available scripts, config overrides, visibility status: visible/hidden/ignored). Updated when scan results arrive via SSE. Filters hidden/ignored projects from the default view; exposes them when "show hidden" is active.

**ProcessStore** — Running state, PIDs, ports, and health status per project. Updated on process state change events via SSE. Includes the port conflict state.

**UIStore** — Dashboard view state (selected project, panel visibility, filter/sort preferences). Local only, no backend persistence.

## Data Flow

### 1. First Launch / Scan

1. User clicks "Scan" → `POST /api/scan`
2. Scanner walks `~/Code/` recursively, finds `package.json` files, skips paths on the ignored list
3. Detects package manager and available dev scripts per project
4. Results written to config (project cache)
5. SSE pushes `scan-complete` event with full project list
6. ProjectStore updates → dashboard renders project cards

### 2. Start a Server

1. User clicks "Start" on a project card → `POST /api/projects/:id/start`
2. Process Manager spawns the appropriate command (`pnpm dev`, `npm run dev`, etc.) via `child_process.spawn()`
3. PID and port stored in config
4. SSE pushes `process-started` with PID, port, project ID
5. ProcessStore updates → card flips to "running" state with stop/open buttons

### 3. Stop a Server

1. User clicks "Stop" → `POST /api/projects/:id/stop`
2. Process Manager sends `SIGTERM` to stored PID
3. Waits for exit; sends `SIGKILL` after timeout if process doesn't terminate
4. PID cleared from config
5. SSE pushes `process-stopped` → card flips to "stopped" state

### 4. Startup Reconciliation

1. Localhost server starts → reads last-known PIDs and project cache from config
2. For each project with a stored PID:
   - Check PID alive (`process.kill(pid, 0)`)
   - If alive, verify port ownership via `lsof -i :port -t`
   - PID matches → **running**. PID mismatch → **port conflict**
   - PID dead but port responds → **port conflict**
   - PID dead and port free → **stopped**, clear stale PID from config
3. SSE pushes initial state snapshot to connected clients
4. Frontend renders current reality from first SSE event

### 5. Hide a Project

1. User clicks "Hide" on a project card → `PATCH /api/projects/:id` with `{ visibility: "hidden" }`
2. Config Store adds the project path to the hidden list
3. SSE pushes `project-updated` → ProjectStore updates → card removed from default view
4. Project reappears when user toggles "show hidden," with a "restore" action

### 6. Delete (Ignore) a Project

1. User clicks "Delete" on a project card → `PATCH /api/projects/:id` with `{ visibility: "ignored" }`
2. Config Store adds the project path to the ignored list
3. SSE pushes `project-updated` → ProjectStore updates → card removed from dashboard
4. Future rescans skip this path entirely
5. Recoverable from the config panel (settings → manage ignored projects → restore)

## Integration Points

Localhost has no external APIs, network services, or third-party dependencies. All integration points are local system interfaces:

| Interface | Used by | Purpose | Failure mode |
|-----------|---------|---------|--------------|
| **Filesystem** (`fs`) | Scanner Service | Read `package.json`, lock files, `.git/config` from `~/Code/` | Permission errors → skip project, log warning |
| **child_process** (`spawn`) | Process Manager | Spawn and kill dev server processes | Spawn failure → report error state on project card |
| **lsof** | Process Manager | Verify port ownership during startup reconciliation | Command not found → fall back to port-only check (accept false positive risk) |
| **OS open command** (`open`) | One-click open | Launch `http://localhost:<port>` in default browser | Failure → surface error, non-critical |
| **Config file** (`~/.localhost/config.json`) | Config Store | Persist project cache, overrides, PID mappings, hidden/ignored lists | Missing file → create with defaults. Corrupt file → back up and recreate |
