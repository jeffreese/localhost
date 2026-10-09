# Process Group Lifecycle

All process spawning and stopping goes through process groups with PID verification. (ADR-009)

## Spawning

Use `detached: true` in `child_process.spawn` to create a new process group. Explicitly pipe stdout/stderr — detached processes don't inherit parent stdio.

## Stopping

Send signals to the process group (`process.kill(-pid, 'SIGTERM')`), not the individual PID. SIGKILL escalation after 5s targets the group. Flag any `process.kill(pid, ...)` with a positive PID as suspicious.

Before signaling any PID:
1. Verify the PID is alive (`kill(pid, 0)`)
2. Verify the PID's cwd matches the expected project path (via lsof)
3. If either check fails: remove the stale entry from `config.pids`, do not signal

## Shutdown

Spawned processes are decoupled from the server lifecycle — they survive server restarts and shutdowns. The server cleans up only its own resources (poller, health checker, log handles) on exit. Spawned processes are only killed on explicit user request via the stop API.

## Stale PID Cleanup

On server startup, iterate `config.pids` and verify each entry. Remove dead or mismatched PIDs before the first background poll tick.
