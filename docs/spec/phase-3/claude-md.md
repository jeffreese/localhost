---
title: "CLAUDE.md"
phase: 3
project: localhost
date: 2026-03-16
status: draft
---

# CLAUDE.md

## Project Overview

Localhost is a local web dashboard for discovering and managing JavaScript dev servers. It scans `~/Code/` for npm/pnpm/yarn projects, shows their run status via TCP port checks, and lets you start/stop servers, manage ports, and configure project visibility — all from a single browser UI at `localhost:7770`. Backend is Node.js + Hono; frontend is Lit web components + Tailwind. No database — config persists at `~/.localhost/config.json`.

## Key Commands

```
pnpm dev          # Start Hono backend + Vite frontend concurrently
pnpm build        # Production build
pnpm lint         # Biome lint + format check
pnpm test         # Vitest unit/integration tests
```

## Architecture Overview

Two-layer architecture:

- **Backend (Hono on Node.js):** Four services — Scanner (finds projects in `~/Code/`), Process Manager (spawns/kills dev servers, tracks PIDs), Config Store (reads/writes `~/.localhost/config.json`), SSE Broadcaster (pushes state changes to frontend)
- **Frontend (Lit + Tailwind):** Four components — `<lh-dashboard>`, `<lh-project-card>`, `<lh-port-table>`, `<lh-config-panel>`. Three reactive stores: ProjectStore, ProcessStore, UIStore.
- **Communication:** REST for commands (start, stop, scan, config updates), SSE for real-time state pushes. No WebSocket, no polling.
- **Startup:** Two-step PID/port reconciliation — verify PID is alive, then verify it owns the expected port. Three states: running, stopped, port conflict.

## Conventions

- **Component naming:** All Lit components use the `lh-` prefix (e.g., `<lh-project-card>`)
- **Light DOM only:** No shadow DOM — components render to light DOM for global Tailwind styling
- **Styling:** Tailwind via design tokens — use semantic token classes, not raw Tailwind utilities (e.g., `text-primary` not `text-blue-500`)
- **Stores:** One reactive store per domain — ProjectStore, ProcessStore, UIStore. Don't merge or cross-subscribe.
- **File organization:**
  ```
  src/
    server/        # Hono routes + services
    client/        # Lit components + stores
    shared/        # Types/interfaces used by both
  ```

## Behavioral Notes

- **No shadow DOM.** Every Lit component must use `static shadowRootOptions` or `createRenderRoot()` returning `this`. Never use `this.shadowRoot`.
- **No raw Tailwind utilities.** Use design token classes only. If a token doesn't exist for what you need, add one — don't reach for `bg-blue-500`.
- **SSE for all real-time updates.** Never add polling or WebSocket connections. REST for commands, SSE for state pushes.
- **PID verification required.** Never assume a process is running from PID alone. Always verify PID is alive AND owns the expected port before reporting "running" status.
- **No permanent project deletion.** Projects can be hidden or ignored, never deleted from config. Both are reversible.
- **Lit imports only.** No React, Preact, or other framework imports. If a library requires React as a peer dependency, find an alternative.
- **Store boundaries.** Each store owns its domain. Components subscribe to stores, never modify store internals directly. Stores don't import other stores.
- **Colocate tests.** Test files live next to the source files they test (e.g., `scanner.ts` → `scanner.test.ts` in the same directory).
