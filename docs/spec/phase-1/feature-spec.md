---
title: "Feature Spec"
phase: 1
project: localhost
date: 2026-03-16
status: draft
---

# Feature Spec

## Overview

Localhost is a local web app for managing dev servers running on your machine. Point it at `~/Code/`, it discovers JS projects, shows what's running and on what ports, and lets you start/stop servers from a dashboard. Scoped to npm/pnpm/yarn projects only.

Built as a Node backend + Lit/Tailwind frontend, running on a fixed local port.

## Features

### Project Discovery

**Description:** Recursively scans a configurable root directory (default `~/Code/`) for projects with a `package.json` containing runnable dev scripts. Detects package manager (npm, pnpm, yarn) from lock files.

**Acceptance Criteria:**
- [ ] Scans recursively on demand and finds all projects with `package.json`
- [ ] Detects available dev scripts (e.g., `dev`, `start`, `serve`)
- [ ] Identifies package manager from lock file (package-lock.json, pnpm-lock.yaml, yarn.lock)
- [ ] Auto-detects the likely dev script with user confirmation on first run
- [ ] Supports manual override via central config

### Start/Stop Dev Servers

**Description:** Spawn and kill dev server processes directly from the dashboard. Tracks PIDs and associates them with projects.

**Acceptance Criteria:**
- [ ] Start a project's dev server with one click
- [ ] Stop a running server with one click
- [ ] Runs the correct package manager command (`npm run dev`, `pnpm dev`, etc.)
- [ ] Tracks spawned PIDs for reliable process management
- [ ] Handles orphaned processes gracefully (e.g., server started outside localhost)

### Status Dashboard

**Description:** At-a-glance view of all discovered projects and their state — running, stopped, or errored. Shows port assignments and basic health indicators.

**Acceptance Criteria:**
- [ ] Lists all discovered projects with current status (running/stopped/error)
- [ ] Shows assigned port for each project
- [ ] Indicates health (process alive, port responding)
- [ ] Updates status in near-real-time (polling or process event-driven)
- [ ] Survives localhost server restarts — detects already-running servers by checking known ports

### One-Click Open

**Description:** Launch the running app in your default browser directly from the dashboard.

**Acceptance Criteria:**
- [ ] "Open" button appears for running servers
- [ ] Opens `http://localhost:<port>` in the default browser
- [ ] Disabled/hidden when server is not running

### GitHub Repo Link

**Description:** Each project in the dashboard links to its GitHub repository for quick access.

**Acceptance Criteria:**
- [ ] Detects GitHub remote from `.git/config` in the project directory
- [ ] Displays a link to the repo on the dashboard
- [ ] Gracefully handles projects without a git remote (no link shown)

### Port Management

**Description:** Shows what's running on which port, detects conflicts, and respects locked port assignments per project.

**Acceptance Criteria:**
- [ ] Displays port-to-project mapping
- [ ] Detects port conflicts before starting a server
- [ ] Supports locked/fixed port assignments per project
- [ ] Warns if a port is occupied by an unknown process

## Scope Boundaries

### In Scope

- Local JS project discovery and management (npm, pnpm, yarn)
- Process spawning, tracking, and termination
- Web-based dashboard UI
- Port conflict detection
- Per-project configuration (dev script, port assignment)

### Out of Scope

- Docker/container management
- Remote server management
- Log viewing/streaming [TODO: Evaluate for v2]
- Environment variable management
- Non-JS projects (Python, Ruby, Go, etc.) [TODO: Evaluate for v2]
- TUI client [Future: post-MVP milestone]

## Open Questions

- **Health check method** — TCP port check (simple, universal, sufficient for local dev)
