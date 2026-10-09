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

The server does not kill spawned processes on exit — it cleans up only its own resources (poller, health checker, log handles). Spawned processes are only killed on explicit user request via the stop API.

Note: spawned processes use piped stdio for real-time log capture. When the server exits, the pipe read ends close. Node.js dev servers typically handle the resulting EPIPE gracefully, but non-Node.js processes may receive SIGPIPE. A future improvement could write logs to file descriptors instead of pipes.

## Stale PID Cleanup

On server startup, iterate `config.pids` and verify each entry. Remove dead or mismatched PIDs before the first background poll tick.
