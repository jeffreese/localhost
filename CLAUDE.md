# Localhost

Local web dashboard for discovering and managing JavaScript dev servers. Scans `~/Code/` for npm/pnpm/yarn projects, shows their run status, and provides start/stop/port management from a browser UI at `localhost:7770`.

## Quick Reference

```
pnpm dev          # Start Hono backend + Vite frontend concurrently
pnpm build        # Production build
pnpm lint         # Biome lint + format check
pnpm test         # Vitest unit/integration tests
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Hono (port 7769) |
| Frontend | Lit web components + Tailwind CSS |
| Build | Vite |
| Package manager | pnpm |
| Lint/format | Biome |
| Tests | Vitest |

## Architecture

Two-layer local application — no database, no external APIs.

- **Backend:** Five services — Scanner (finds projects in `~/Code/`), Listener Scanner (enumerates OS TCP listeners + matches to projects by cwd), Process Manager (spawns/kills dev servers), Config Store (reads/writes `~/.localhost/config.json`), SSE Broadcaster (pushes state changes to frontend)
- **Frontend:** Four Lit components (`<lh-dashboard>`, `<lh-project-card>`, `<lh-port-table>`, `<lh-config-panel>`) + three reactive stores (ProjectStore, ProcessStore, UIStore)
- **Communication:** REST for commands → backend. SSE for state updates → frontend. No WebSocket, no polling.
- **Process detection:** OS listener enumeration via `lsof` — enumerates all TCP listeners, resolves their cwds, matches to project paths. Detects all running servers regardless of how they were started. Two states: running, stopped. Projects can have multiple listeners.
- **Config:** `~/.localhost/config.json` persists project cache, PID mappings (for stop capability only), per-project overrides, hidden/ignored lists.

## File Organization

```
src/
  server/        # Hono routes + services (scanner, process manager, config store, SSE)
  client/        # Lit components + stores
  shared/        # Types/interfaces used by both
```

## Conventions

- **Component naming:** All Lit components use the `lh-` prefix
- **Light DOM only:** No shadow DOM. Components render to light DOM for global Tailwind styling.
- **Styling:** Tailwind via design tokens — use semantic token classes (`text-primary`, `surface-elevated`), not raw utilities (`text-blue-500`). If a token doesn't exist, add one.
- **Stores:** One reactive store per domain (ProjectStore, ProcessStore, UIStore). Stores don't import other stores. Components subscribe on `connectedCallback`, unsubscribe on `disconnectedCallback`.
- **Tests:** Co-located — `scanner.test.ts` next to `scanner.ts`. Written alongside implementation.
- **Code style:** Single quotes, 2-space indent, semicolons as needed, 100-char line width (enforced by Biome)

## Git Workflow

Feature branches → PR → merge to main. Branch naming: `feat/`, `fix/`, `refactor/`, `chore/`.

## Key Decisions (ADRs)

All ADRs are in `docs/adrs/`. Key constraints enforced by rules:

1. **Lit only** — No React/Preact/Solid imports (ADR-001)
2. **Design tokens** — No raw Tailwind utilities in components (ADR-002)
3. **Light DOM** — No shadow DOM anywhere (ADR-003)
4. **Reactive stores** — No external state libraries; one store per domain (ADR-004)
5. **SSE only** — No WebSocket or polling for real-time updates (ADR-005)
6. **Listener enumeration** — Process state from OS TCP listeners + cwd matching, not stored PIDs (ADR-006)
7. **No permanent deletion** — Projects can be hidden/ignored, never deleted from config (ADR-007)

## Development Roadmap

See `docs/plans/backlog.md` for the ordered plan queue. Current: MVP plan in `docs/plans/mvp/`.

## Planning Docs

Full project spec is in `docs/spec/` (phase-1 through phase-3). Consult for detailed requirements, architecture, and data flows.

## Forge Plugin

This project uses the Forge development lifecycle plugin. Key workflow skills:

- `/forge:next` — Find next task, create branch, implement
- `/forge:ship` — Test → review → commit → push → PR
- `/forge:review` — Self-review against ADRs and conventions
- `/forge:retro` — End-of-session retrospective

See `plugins/forge/README.md` for the full list.
