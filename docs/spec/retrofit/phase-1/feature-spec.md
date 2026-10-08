---
title: "Feature Spec"
phase: 1
project: localhost
date: 2026-10-05
status: draft
---

# Feature Spec

## Overview

Localhost is a local dev server dashboard at `localhost:7770` that scans `~/Code/` for projects, detects running dev servers via OS TCP listener enumeration, and provides a browser UI to start/stop/monitor them. Hono backend on :7769, Lit web components + Tailwind frontend. REST for commands, SSE for state push, config at `~/.localhost/config.json`.

The app has been running in daily use since March 2026. It works, but the internals are fragile — blocking I/O throughout the server, dangerous process management (stale PIDs, orphaned children, no shutdown cleanup), half-built reactivity (SSE plumbing exists but state changes aren't pushed), and JS-only project detection. This retrofit stabilizes the foundation, adds missing operational features, and extends detection beyond JavaScript projects.

## Features

### F1: Async I/O Throughout the Server

**Description:** Replace all synchronous I/O (execSync for lsof, readdirSync for scanning, readFileSync/writeFileSync for config) with async equivalents. The server is single-threaded Node — synchronous calls block all HTTP handling, including SSE keepalives.

**Acceptance Criteria:**
- [ ] `lsof` calls use `execFile` (async) instead of `execSync`
- [ ] Filesystem scanning uses `fs.promises.readdir`/`stat`/`readFile`
- [ ] Config store uses `fs.promises.readFile`/`writeFile`
- [ ] No `*Sync` filesystem or child_process calls remain in production code
- [ ] SSE keepalives are never blocked by scanning or config operations

---

### F2: Process Group Management & Port Override

**Description:** Spawn dev servers into their own process groups so the entire process tree (pnpm wrapper → concurrently → tsx → vite → node) can be killed cleanly with `kill(-pgid)`. Currently, stopping a project only kills the wrapper — intermediate processes survive as orphans. Also finish wiring up the `overrides.port` feature — the config schema and PATCH endpoint exist but the value is never read at start time.

**Acceptance Criteria:**
- [ ] `child_process.spawn` uses `detached: true` + `setsid` to create a new process group
- [ ] Stop sends `SIGTERM` to the entire process group (`kill(-pgid)`)
- [ ] SIGKILL escalation (5s timeout) applies to the process group, not just the root PID
- [ ] No orphaned processes after stopping a project
- [ ] `overrides.port` read at start time and passed as `PORT` env var to the spawned process
- [ ] Port conflict warning if a locked port is already occupied before starting

---

### F3: PID Verification & Stale Cleanup

**Description:** Before sending any signal to a stored PID, verify it still belongs to the expected process. Prune dead PIDs from `config.pids` on startup and periodically.

**Acceptance Criteria:**
- [ ] Before SIGTERM, verify PID ownership (check process name/cwd matches expected project)
- [ ] Stale PIDs pruned from config on server startup
- [ ] Stale PIDs pruned when detected during normal operations (stop, scan)
- [ ] Zero risk of signaling an unrelated process

---

### F4: Shutdown Handlers

**Description:** When Localhost itself exits (nodemon restart, Ctrl-C, crash), clean up all spawned child processes. Currently, a restart orphans everything with broken stdout pipes.

**Acceptance Criteria:**
- [ ] `process.on('SIGTERM'/'SIGINT'/'exit')` handlers kill all active process groups
- [ ] After nodemon restart, no orphaned children from the previous session
- [ ] Graceful shutdown: SIGTERM process groups, wait up to 5s, SIGKILL survivors

---

### F5: Proactive SSE State Push

**Description:** The SSE plumbing exists but state changes aren't pushed proactively. Add a periodic listener scan (every 5-10s) to detect externally-started/stopped processes, and broadcast state changes when processes started by Localhost change state.

**Acceptance Criteria:**
- [ ] Background polling loop detects new/removed TCP listeners every 5-10s
- [ ] SSE broadcasts `process-started`/`process-stopped` when external processes appear/disappear
- [ ] SSE broadcasts immediately when Localhost-spawned processes change state (not just on API response)
- [ ] UI updates without page refresh for all process state changes
- [ ] SSE event includes enough data for the client to update without refetching

---

### F6: Config Store Hardening

**Description:** Fix read-modify-write race conditions and non-atomic writes in the config store. A crash mid-write currently corrupts `~/.localhost/config.json`.

**Acceptance Criteria:**
- [ ] Writes use temp-file + `rename` for atomicity
- [ ] Read-modify-write operations are serialized (queue or lock)
- [ ] Config reads are cached in memory, invalidated on write
- [ ] Concurrent rapid operations (multiple start/stop) don't lose writes

---

### F7: Project Groups

**Description:** Projects can be organized into named groups (by technology, activity, client, or any user-defined category). Replaces the flat list with a collapsible grouped view. A project can belong to one group. Ungrouped projects appear in a default section.

**Acceptance Criteria:**
- [ ] User can create, rename, and delete groups
- [ ] User can assign/unassign projects to groups via the UI
- [ ] Groups are collapsible in the dashboard
- [ ] Group membership persisted in `~/.localhost/config.json`
- [ ] Drag-and-drop ordering works within and across groups
- [ ] Filter/search works across all groups
- [ ] Groups survive scan — new projects appear ungrouped, existing assignments preserved

---

### F8: Health Checks

**Description:** Periodic HTTP pings to running services to detect crashed-but-still-listening servers, slow startups, or services that bound a port but aren't actually serving. Enabled automatically when a service is started, applies only to ports identified as HTTP services.

**Acceptance Criteria:**
- [ ] Health checks start automatically when a service is started, stop when it stops
- [ ] Configurable interval per project (default: 30s), can be disabled per project
- [ ] HTTP HEAD request to the project's primary port
- [ ] Health states: healthy, unhealthy (HTTP error or timeout), unknown (non-HTTP port)
- [ ] Health status visible on project card (visual indicator)
- [ ] SSE broadcasts health state changes
- [ ] Health check failures don't kill/restart the process — informational only

---

### F9: Resource Usage Monitoring

**Description:** Lightweight CPU and memory metrics per running project. The PIDs are already known from listener enumeration — use them to sample resource usage.

**Acceptance Criteria:**
- [ ] CPU and memory usage displayed on project cards for running projects
- [ ] Metrics sampled periodically (every 10-15s) via `ps` or `/proc`
- [ ] Aggregated across all PIDs in a project's process group
- [ ] No significant overhead — sampling is cheap and non-blocking

---

### F10: Log Persistence

**Description:** Write process stdout/stderr to disk so logs survive Localhost restarts. Currently, the in-memory ring buffer is lost on every nodemon restart.

**Acceptance Criteria:**
- [ ] Logs written to `~/.localhost/logs/<project-name>/` as timestamped files
- [ ] Size-based log rotation — cap per-project log size (default: 10MB, configurable)
- [ ] On restart, console drawer can load logs from disk for processes that are still running
- [x] Log hydration race condition fixed — SSE events arriving during fetch are buffered, not dropped

---

### F11: Project Type Registry & Broader Detection

**Description:** Replace hardcoded JS-only scanning with a configurable project type registry. The registry maps marker files to project type metadata (name, default dev command). Ships with `package.json` (Node) and `Cargo.toml` (Rust) built in. Users can add more types via config. Scanner walks the registry — any registered marker file makes a directory a project.

**Acceptance Criteria:**
- [ ] Project type registry in config: map of marker file → `{ name, defaultCommand, detectManager? }`
- [ ] Built-in types: `package.json` (Node, existing behavior) and `Cargo.toml` (Rust, `cargo run`)
- [ ] Scanner uses the registry instead of hardcoded `package.json` detection
- [ ] Per-project dev command override still works (existing `overrides.devScript`)
- [ ] Listener scanner filter extended beyond node/bun/deno to also match cargo processes
- [ ] Non-JS projects display correctly in the UI with appropriate metadata
- [ ] Users can add new project types by editing config (e.g., `go.mod` → `go run .`)

---

### F12: Crash Notifications

**Description:** When a running process exits unexpectedly (not stopped by the user), surface a visible notification in the UI with the time of death and exit code/signal.

**Acceptance Criteria:**
- [ ] Distinguish between user-initiated stop and unexpected exit
- [ ] Crash indicator on the project card showing time of last crash and exit code/signal
- [ ] SSE event `process-crashed` with crash details
- [ ] Crash state persists across page refreshes (stored in config or separate state file)
- [ ] Crash indicator clears when the project is restarted
- [ ] Desktop notification via Notification API [Nice-to-have]

---

### F13: Port Type Detection

**Description:** Determine whether a port is serving HTTP traffic. Only HTTP ports should be clickable links in the UI. Non-HTTP ports (databases, litestream, etc.) display but don't link.

**Acceptance Criteria:**
- [ ] HTTP HEAD probe on detected ports to classify as HTTP vs. non-HTTP
- [ ] HTTP ports render as clickable links (open in browser)
- [ ] Non-HTTP ports render as plain text badges
- [ ] Probe is non-blocking and tolerates timeouts/connection refused
- [ ] Port type cached — don't re-probe on every render

---

### F14: Dead Code Removal

**Description:** Remove unused code identified in the codebase audit.

**Acceptance Criteria:**
- [ ] `getPortOwner` function removed from process-manager.ts
- [ ] `ProcessStore` removed (never initialized, duplicates ProjectStore state)
- [ ] `overrides.port` wiring moved to F2 (implement, not remove)
- [ ] Duplicate project-mapping logic in routes.ts consolidated into a shared function

---

## Scope Boundaries

### In Scope

- Server-side stability and correctness fixes (F1–F6)
- New operational features (F7–F13)
- Dead code cleanup (F14)
- Forge plugin integration for development workflow
- Updated ADRs reflecting new decisions

### Out of Scope

- **Frontend framework migration (Lit → React):** Deferred. The Lit components work. Fix the server first, then evaluate whether a React migration is warranted as a separate project.
- **Quick-launch profiles:** Named sets of projects to start together. Good idea, not urgent — groups (F7) cover the organizational need.
- **Startup dependency ordering:** "Start A, wait for port, then start B." Useful for microservice stacks but adds significant complexity. Future consideration.
- **TUI mode:** Terminal-based interface. Existing backlog item, not prioritized.
- **Auto-scan via file watcher:** Watch `~/Code/` for new/removed project directories. Existing backlog item — periodic re-scan (F5's polling loop) partially addresses this.
- **Multiple scan roots:** Support scanning directories beyond `~/Code/`. Existing backlog item, low priority.
- **Cross-platform support:** macOS-only is acceptable. Windows/Linux support is a future concern.
- **Process adoption after restart:** Re-adopting externally-started processes for log viewing and clean stop. Partially addressed by F5 (detection) and F10 (log persistence) but full adoption (re-attaching stdout) is complex and deferred.

## Resolved Decisions

- **`overrides.port`** — Implement. Wire up the existing config field to pass `PORT` env var at start time. Folded into F2.
- **Health check default** — On when a service is started, automatically. Can be disabled per project.
- **Resource usage display** — Current values only (CPU %, memory MB). No sparklines or time-series storage.
- **Log rotation** — Size-based. 10MB cap per project, oldest lines trimmed.
- **Non-JS project detection** — Project type registry in config. Ship with Node + Rust built in. Users add more types via config. Per-project dev command override still available.
