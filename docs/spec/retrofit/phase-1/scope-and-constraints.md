---
title: "Scope & Constraints"
phase: 1
project: localhost
date: 2026-10-05
status: draft
---

# Scope & Constraints

## Project Scope

Retrofit of an existing, running dev server dashboard. The app works and is in daily use — this project stabilizes the foundation (server-side correctness, process safety, reactivity) and adds operational features (project groups, health checks, resource monitoring, log persistence, broader language support, crash notifications).

### Deliverables

- Server-side stability fixes: async I/O, process group management, PID verification, shutdown handlers, config atomicity
- Proactive SSE state push with background polling
- Six new features: project groups, health checks, resource usage, log persistence, broader project detection, crash notifications
- Port type detection (HTTP vs. non-HTTP)
- Dead code removal and route consolidation
- Updated ADRs and CLAUDE.md reflecting new architecture decisions
- Forge plugin integration for structured development workflow

## Non-Goals

- **Frontend framework migration.** Lit → React is deferred to a separate project. The Lit components are functional; the problems are server-side. Evaluate after server stabilization.
- **Quick-launch profiles.** Named project sets ("start these 5 together"). Groups cover the organizational need; launch profiles are additive.
- **Startup dependency ordering.** "Start A, wait for port, then start B." Significant complexity for a narrow use case.
- **TUI mode.** Terminal interface to the same backend. Existing backlog item, not prioritized.
- **Auto-scan via file watcher.** Filesystem event-driven project discovery. Background polling (5-10s) partially addresses freshness; a dedicated watcher is future work.
- **Multiple scan roots.** Scanning beyond `~/Code/`. Low priority — single root covers the real use case.
- **Cross-platform.** macOS-only is acceptable. `lsof` dependency makes this inherently platform-specific.
- **Full process adoption.** Re-attaching stdout to externally-started processes for live log viewing. Detection (via lsof) and log persistence (on disk) partially address this; full adoption (piping stdout from an already-running process) is not feasible without ptrace-level intervention.

## Technical Constraints

### Existing Stack (Preserved)

| Layer | Choice | Status |
|-------|--------|--------|
| Backend | Node.js + Hono | Keep — lightweight, appropriate |
| Frontend | Lit web components + Tailwind CSS | Keep for now — migration deferred |
| Build | Vite | Keep |
| Package manager | pnpm | Keep |
| Lint/format | Biome | Keep |
| Tests | Vitest | Keep |
| Real-time | SSE (server → client) | Keep — no WebSocket |
| Config | `~/.localhost/config.json` | Keep — harden, don't replace |

### Platform

- macOS only (Darwin). `lsof` for TCP listener enumeration, `ps` for resource metrics.
- Node.js LTS runtime.
- Must coexist with any running dev servers — Localhost itself runs on fixed ports :7769 (API) and :7770 (UI).

### Backward Compatibility

- `~/.localhost/config.json` schema changes must be additive — migrate existing fields, don't break them.
- New config fields get sensible defaults so existing configs work without manual editing.
- Hidden/ignored lists and custom sort order must be preserved across the upgrade.

## Timeline & Milestones

No hard deadline — personal dev tool, ship when stable.

| Milestone | Scope | Definition of Done |
|-----------|-------|-------------------|
| **M1: Server Stability** | F1 (async I/O), F2 (process groups), F3 (PID verification), F4 (shutdown handlers), F6 (config hardening) | No blocking I/O in production code. Clean process lifecycle. Safe PID handling. Atomic config writes. |
| **M2: Reactivity** | F5 (proactive SSE push) | UI updates without page refresh for all process state changes, including externally-started/stopped processes. |
| **M3: Operational Features** | F7 (groups), F8 (health checks), F9 (resource usage), F10 (log persistence), F12 (crash notifications), F13 (port type detection) | New features functional and wired to SSE for live updates. |
| **M4: Broader Detection** | F11 (non-JS projects) | Rust, Go, Python, Docker projects detected and manageable. |
| **M5: Cleanup** | F14 (dead code removal) | No unused code. Consolidated route logic. |

## Dependencies

All local. No external APIs or services.

| Dependency | Provides | Stability |
|------------|----------|-----------|
| Node.js `child_process` | Process spawning, groups, signals | Stable, built-in |
| `lsof` (macOS) | TCP listener enumeration | Stable, system utility |
| `ps` (macOS) | CPU/memory sampling | Stable, system utility |
| Hono | HTTP server, routing | Stable |
| Lit | Frontend components | Stable (migration deferred) |
| Vite | Build tooling | Stable |

## Risk Factors

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Process group spawning behaves differently than expected on macOS | Low | High | Prototype `detached: true` + `setsid` before committing to the approach. Test with pnpm → concurrently → tsx chains. |
| Async migration introduces concurrency bugs in config store | Medium | Medium | Serialize config writes behind a queue. Write thorough tests for concurrent operations. |
| Background polling (5-10s lsof) creates noticeable CPU overhead | Low | Low | Measure baseline. Adjust interval. Consider debouncing when no state changes detected. |
| Non-JS project dev commands are unpredictable | Medium | Low | Default to known commands (cargo run, go run .), allow per-project override in config. |
| Health check HTTP pings interfere with dev servers (rate limiting, side effects) | Low | Low | Use HEAD requests. Default off. Allow per-project opt-out. |
