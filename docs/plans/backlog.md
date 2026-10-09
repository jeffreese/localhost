# Backlog

## Active

_(none)_

## Future

- **Frontend migration (Lit → React)** — React 19 + TanStack Router + TanStack Query + Radix UI. Evaluate after server stabilization.
- **Quick-launch profiles** — Named project sets ("start these 5 together")
- **Startup dependency ordering** — "Start A, wait for port, then start B"
- **TUI mode** — Terminal dashboard alternative to the browser UI
- **Auto-scan** — File watcher on `~/Code/` instead of manual scan trigger
- **Multiple scan roots** — Support scanning beyond `~/Code/`
- **SSE replay on reconnect** — Use event IDs to replay missed events
- **Resource sparklines** — Historical CPU/memory trend on project cards

## Shipped

- **[retrofit](retrofit/)** — Server stability (async I/O, process groups, config hardening), reactivity (background polling, SSE push), operational features (groups, health checks, resource monitoring, log persistence, crash notifications, port type detection), broader detection (project type registry, Rust support)
- **[mvp](mvp/)** — Project discovery, start/stop, status dashboard, port management, project visibility
- **Log viewer** — Stream dev server stdout/stderr in a bottom-drawer console (ADR-008)
