---
title: "Scope & Constraints"
phase: 1
project: localhost
date: 2026-03-16
status: draft
---

# Scope & Constraints

## Project Scope

- Web-based dashboard for discovering and managing local JS dev servers
- Recursive project scanning from a configurable root directory
- Start/stop dev servers, track process state across restarts
- Port assignment display, conflict detection, and locked port support
- One-click browser launch for running servers
- GitHub repo links per project (detected from git remote)
- Central config file managed by the app (project overrides, port locks, script selection)
- macOS primary target (user's dev environment)

## Non-Goals

- Not a deployment tool — no CI/CD, no remote servers
- Not a container orchestrator — no Docker, docker-compose, or Kubernetes
- Not a log viewer — server output is not captured or displayed in MVP
- Not a general process manager — scoped to JS dev servers only
- No TUI in MVP — planned as a post-MVP milestone

## Technical Constraints

### Chosen Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Backend** | Node.js + Hono | Lightweight, fast, familiar JS ecosystem |
| **Frontend framework** | Lit (web components) | Aligns with sonicforge; ~5KB, no virtual DOM overhead, native custom elements |
| **Styling** | Tailwind CSS + design token abstraction | Semantic tokens in `tailwind.config.ts`, typed style maps in `components.ts`, theme via CSS custom properties |
| **DOM strategy** | Light DOM (no Shadow DOM) | Global Tailwind stylesheet reaches all components; simpler mental model |
| **State management** | Observable reactive stores | Small typed store classes per domain; components subscribe/unsubscribe on connect/disconnect |
| **Package manager** | pnpm | User preference (see `docs/tech-preferences.md`) |
| **Build tool** | Vite | Fast dev server, good Lit support |

### View Layer Rules (borrowed from sonicforge ADRs)

These architectural decisions carry over directly:

1. **Lit over React** — No virtual DOM. Native custom elements. ~5KB footprint. Lifecycle maps cleanly to component needs.
2. **Tailwind + design token abstraction** — Components reference semantic names (`btn.primary`, `surface.elevated`) from typed style maps, never raw utility classes. Theme switching changes CSS custom properties only.
3. **Light DOM everywhere** — No shadow DOM. Tailwind's global stylesheet reaches all components. Disciplined class naming via Tailwind's utility approach.
4. **Reactive stores** — One store per domain (e.g., `ProjectStore`, `ProcessStore`, `UIStore`). Plain TypeScript classes with subscriber lifecycle. No external state library.

### Platform Constraints

- macOS primary (user's machine) — no Windows/Linux concerns for MVP
- Node.js runtime (LTS)
- Must coexist with whatever's already running on the user's machine — no port conflicts with localhost itself

## Timeline & Milestones

| Milestone | What "done" means |
|-----------|-------------------|
| **MVP** | Dashboard discovers projects, shows status, start/stop works, port management functional |
| **Post-MVP: TUI** | Terminal UI client that talks to the same backend |

No hard deadline — personal dev tool, ship when ready.

## Dependencies

| Dependency | Provides | Risk |
|------------|----------|------|
| Node.js child_process API | Process spawning and PID tracking | Stable, built-in |
| Lit | Component framework | Stable, well-maintained |
| Tailwind CSS | Utility styling | Stable |
| Vite | Build and dev server | Stable |
| Hono | Backend HTTP framework | Lightweight, stable |

No external APIs or services. Everything runs locally.

## Risk Factors

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Orphaned processes after unclean shutdown | Medium | Medium | Detect running servers by port check on startup; reconcile with known PID list |
| Port detection unreliable across OS versions | Low | Medium | Use `lsof` or `net` module; test on current macOS |
| Package manager detection edge cases (monorepos, workspaces) | Medium | Low | Start simple (lock file detection), handle monorepos as a follow-up |
