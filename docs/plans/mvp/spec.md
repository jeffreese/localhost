# MVP Plan — Localhost

## Overview

Build a local web dashboard for discovering and managing JavaScript dev servers. Scans `~/Code/` for npm/pnpm/yarn projects, displays their run status, and provides start/stop/port management from a browser UI at `localhost:7770`.

## Requirements

### Core Features
- **Project Discovery** — Recursive scan of `~/Code/` for `package.json` projects; detect package manager from lock files and available dev scripts
- **Start/Stop Servers** — Spawn/kill dev server processes via `child_process`, track PIDs, handle orphaned processes
- **Status Dashboard** — Real-time view of all projects with running/stopped/port-conflict states, updated via SSE
- **One-Click Open** — Launch running app in default browser
- **GitHub Repo Link** — Detect and display GitHub remote URLs per project
- **Port Management** — Port-to-project mapping, conflict detection, locked port assignments
- **Project Visibility** — Hide/ignore/restore projects; no permanent deletion

### Non-Goals (MVP)
- Docker/container management
- Remote server management
- Log viewing/streaming
- Environment variable management
- Non-JS projects
- TUI client

## Architecture

Two-layer local application:

- **Backend (Node.js + Hono on port 7770):** Scanner Service, Process Manager, Config Store, SSE Broadcaster
- **Frontend (Lit + Tailwind):** `<lh-dashboard>`, `<lh-project-card>`, `<lh-port-table>`, `<lh-config-panel>` + three reactive stores (ProjectStore, ProcessStore, UIStore)
- **Communication:** REST for commands, SSE for real-time state pushes. No WebSocket, no polling.
- **Persistence:** `~/.localhost/config.json` — project cache, PID mappings, overrides, hidden/ignored lists. No database.

## Key Technical Decisions

- **Lit over React** (ADR-001) — ~5KB, native custom elements, light DOM
- **Tailwind + design tokens** (ADR-002) — Semantic token classes, not raw utilities
- **Light DOM only** (ADR-003) — Global Tailwind stylesheet reaches all components
- **Reactive stores** (ADR-004) — One per domain, no external state library
- **SSE for state** (ADR-005) — EventSource with auto-reconnect, no polling
- **PID/port reconciliation** (ADR-006) — Two-step verification on startup to avoid false "running" from port squatters
- **Project visibility model** (ADR-007) — Visible/hidden/ignored, all reversible

## Risk Flags

| Risk | Mitigation |
|------|------------|
| Orphaned processes after unclean shutdown | Two-step PID/port reconciliation on startup |
| Port detection edge cases across macOS versions | Use `lsof`; fall back to port-only check if unavailable |
| Monorepo/workspace package detection | Defer to post-MVP; start with simple lock file detection |

## Dependencies

All local — no external APIs or services. Runtime dependencies: Node.js (LTS), Lit, Tailwind, Vite, Hono, Biome, Vitest.

## Out of Scope

- TUI mode (post-MVP milestone)
- Auto-scan on filesystem changes
- Multiple scan root directories
- Log streaming in dashboard
