---
title: "Phase 1 Summary: Feature Definition"
project: localhost
date: 2026-03-16
---

## Key Outcomes

- Localhost is a local web dashboard for managing JS dev servers — discover projects, show status, start/stop, manage ports
- Scoped to npm/pnpm/yarn projects only, scanning `~/Code/` recursively on demand
- Central config file managed by the app (not per-project dotfiles)
- TCP port check for health/status detection — simple and universal
- View layer reuses sonicforge's architectural decisions: Lit, Tailwind + design tokens, Light DOM, reactive stores
- Backend: Node.js + Hono. Build: Vite. Package manager: pnpm.
- TUI planned as post-MVP milestone

## Documents Produced

- **feature-spec.md** — Six features defined with acceptance criteria: project discovery, start/stop, status dashboard, one-click open, GitHub repo links, port management
- **scope-and-constraints.md** — Full tech stack locked, view layer rules borrowed from sonicforge ADRs, risk factors identified

## Open Questions

- Config file format not yet decided (JSON likely, but exact schema TBD for Phase 2)
- Monorepo/workspace handling deferred to post-MVP

## Context for Next Phase

The technical spec should detail:
- **Backend API design** — endpoints for project CRUD, process management, scan triggers, config read/write
- **Reactive store domains** — `ProjectStore` (discovered projects + config), `ProcessStore` (running servers, PIDs, status), `UIStore` (dashboard state)
- **Process management strategy** — child_process spawning, PID tracking, orphan detection via TCP port checks on startup
- **Central config schema** — what gets stored, where, how it's read/written
- **Component breakdown** — Lit components for the dashboard (project cards, status indicators, port table)
- **ADRs to formalize** — carry over sonicforge view-layer ADRs (Lit, Tailwind tokens, Light DOM, reactive stores) plus any new decisions (Hono, process management approach)
