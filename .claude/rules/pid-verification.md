# Listener Enumeration — OS as Source of Truth

Process state is determined by enumerating OS TCP listeners and matching their working directories to known project paths. Never rely on stored PIDs for determining running state.

Detection flow:
1. `lsof -iTCP -sTCP:LISTEN` → all listening processes with PIDs
2. `lsof -p PID -d cwd` → resolve each listener's working directory
3. Match cwd to project paths → attribute listeners to projects

A project is "running" if it has one or more matched listeners. Projects can have multiple listeners (e.g., backend + frontend dev servers).

`config.pids` is only used for process management (stopping processes localhost spawned), never for detection.

**Source:** ADR-006
