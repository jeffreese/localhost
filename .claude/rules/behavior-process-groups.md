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

Server entry point must register `process.on('SIGTERM'/'SIGINT'/'exit')` handlers that SIGTERM all active process groups, wait 3s, then SIGKILL survivors.

## Stale PID Cleanup

On server startup, iterate `config.pids` and verify each entry. Remove dead or mismatched PIDs before the first background poll tick.
