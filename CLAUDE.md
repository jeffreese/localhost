# Localhost

Local dev server dashboard at `localhost:7770`. Scans `~/Code/` for projects, detects running dev servers via OS TCP listener enumeration, and provides a browser UI to start/stop/monitor them. Two-layer architecture: Hono backend (:7769) + Lit web components + Tailwind frontend (:7770). REST for commands, SSE for real-time state push.

## Quick Reference

```
pnpm dev          # Start Hono backend + Vite frontend concurrently
pnpm build        # Production build
pnpm lint         # Biome lint + format check
pnpm lint:fix     # Biome auto-fix
pnpm test         # Vitest unit/integration tests
pnpm test:watch   # Vitest watch mode
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Hono (port 7769) |
| Frontend | Lit web components + Tailwind CSS (port 7770) |
| Build | Vite |
| Package manager | pnpm |
| Lint/format | Biome |
| Tests | Vitest |

## Architecture

### Backend (src/server/)

Six services, all async:

- **Scanner** — Walks `~/Code/` using the project type registry to discover projects. Detects marker files (package.json, Cargo.toml, user-defined), package managers, dev scripts, GitHub URLs.
- **Listener Scanner** — Async `lsof` calls enumerate OS TCP listeners, resolve cwds, match to project paths. Command filter built dynamically from the project type registry's `processNames` arrays.
- **Process Manager** — Spawns dev servers into own process groups (`detached: true`). Stops via `kill(-pgid)` on user request only. PID verification before signaling. Startup cleanup prunes stale PIDs from config. Spawned processes survive server restarts.
- **Config Store** — Reads/writes `~/.localhost/config.json`. Atomic writes (temp + rename). Serialized read-modify-write (async queue). In-memory cache.
- **Log Store** — Writes process stdout/stderr to `~/.localhost/logs/<project>.log`. Size-based rotation (10MB). Provides hydration endpoint for console drawer.
- **SSE Broadcaster** — Pushes state changes to connected clients. 30s keepalive. Event types: scan-complete, process-started, process-stopped, process-crashed, port-detected, log, health-changed, resource-update, groups-changed.

### Background Poll Loop

Single `setInterval` (5s) coordinating periodic tasks:
- Every tick: async listener scan → diff → port type probes (new ports) → SSE broadcast for changes
- Every 3rd tick (15s): resource sampling via async `ps`
- Per-project health check timers (30s default, configurable via `healthCheckInterval` override, 0 to disable): HTTP HEAD probe, started/stopped with service lifecycle

### Frontend (src/client/)

Lit components with light DOM (global Tailwind styling):
- `<lh-dashboard>` — Root component. Filter, sort, scan, project grid, console drawer.
- `<lh-project-card>` — Status, start/stop, port links, console toggle, visibility menu, health indicator, resource usage.
- `<lh-port-table>` — Active ports overview. HTTP ports clickable, TCP ports informational.
- `<lh-config-panel>` — Hidden/ignored lists, restore actions.
- `<lh-console>` — Bottom drawer for process logs. ANSI stripping.

Reactive stores (one per domain):
- **ProjectStore** — Project list, visibility filtering, SSE subscriptions
- **UIStore** — Filter, sort, panel state, custom order
- **ConsoleStore** — Log buffer per project, open/close state, disk hydration

### Communication

- **Commands:** Frontend → Backend via REST (`POST /api/projects/:id/start`, etc.)
- **State updates:** Backend → Frontend via SSE. No WebSocket, no polling on the client side.

## File Organization

```
src/
  server/           # Hono routes + services
    index.ts        # Server entry, graceful shutdown
    routes.ts       # REST API endpoints
    scanner.ts      # Project discovery
    listener-scanner.ts  # OS TCP listener enumeration
    process-manager.ts   # Spawn/stop/lifecycle
    config-store.ts      # Config read/write/cache
    log-store.ts         # Log persistence + rotation
    port-probe.ts        # HTTP HEAD port type detection + cache
    sse.ts              # SSE broadcaster
    background-poller.ts # Periodic scan/health/resources
    health-checker.ts    # Per-project HTTP probes
  client/           # Lit components + stores
    components/     # lh-* web components
    stores/         # Reactive stores
    sse-client.ts   # EventSource wrapper
  shared/           # Types used by both
    types.ts
```

## Conventions

- **No synchronous I/O.** All filesystem, child_process, and shell calls must be async. Zero `*Sync` functions in production code.
- **Process groups.** All spawned processes use `detached: true`. Stop via `kill(-pgid)`, never positive-PID signals.
- **PID verification.** Before signaling any PID: verify it's alive AND its cwd matches the expected project path.
- **Component naming.** All Lit components use the `lh-` prefix.
- **Light DOM only.** No shadow DOM. Components render to light DOM for global Tailwind styling.
- **Design tokens.** Semantic token classes (`text-primary`, `surface-elevated`), not raw utilities. If a token doesn't exist, add one.
- **Stores.** One reactive store per domain. Stores don't import other stores. Components subscribe on `connectedCallback`, unsubscribe on `disconnectedCallback`.
- **SSE only.** No WebSocket or polling on the client. All state push via SSE.
- **No permanent deletion.** Projects can be hidden or ignored, never deleted from config.
- **Config writes.** Always go through `updateConfig()` which serializes access. Never read-modify-write outside the queue.
- **Tests.** Co-located — `scanner.test.ts` next to `scanner.ts`.
- **Code style.** Single quotes, 2-space indent, semicolons as needed, 100-char line width (Biome).

## Key Decisions (ADRs)

ADRs live in `docs/adrs/`. Enforcement rules in `.claude/rules/`.

| # | Decision | Enforcement |
|---|----------|-------------|
| 001 | Lit only (React migration deferred) | No React/Preact/Solid imports |
| 002 | Tailwind design tokens | No raw Tailwind utilities in components |
| 003 | Light DOM | No shadow DOM, no `static styles` |
| 004 | Reactive stores | One store per domain, no external state libs |
| 005 | SSE for state updates | No WebSocket, no client-side polling |
| 006 | Listener enumeration | Process state from lsof, not stored PIDs |
| 007 | No permanent deletion | Hide/ignore only, both reversible |
| 008 | Process console logs | Ring buffer + disk persistence |
| 009 | Process group lifecycle | Detached spawn, group signal, PID verify, decoupled lifecycle |
| 010 | Project type registry | Config-driven detection, not hardcoded |
| 011 | Log persistence | Disk files, size rotation, hydration fix |
| 012 | Background polling | 5s main loop, staggered tasks, per-project health timers |

## Config

`~/.localhost/config.json` — single JSON file, no per-project dotfiles. New fields get defaults in `readConfig` for backward compatibility.

`~/.localhost/logs/` — per-project log files with size-based rotation.

## Development Roadmap

See `docs/plans/backlog.md` for the ordered task queue. Current: retrofit plan in `docs/plans/retrofit/`.

## Planning Docs

Full retrofit spec is in `docs/spec/retrofit/` (phase-1 through phase-3). Original MVP spec in `docs/spec/` (phase-1 through phase-3). Consult retrofit spec for current requirements, architecture, and data flows.

## Git Workflow

Feature branches → PR → merge to main. Branch naming: `feat/`, `fix/`, `refactor/`, `chore/`.

## Forge Plugin

This project uses the Forge development lifecycle plugin. Key workflow skills:

- `/forge:next` — Find next task, create branch, implement
- `/forge:ship` — Test → review → commit → push → PR
- `/forge:review` — Self-review against ADRs and conventions
- `/forge:retro` — End-of-session retrospective

See `plugins/forge/README.md` for the full list.
