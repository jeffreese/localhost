# Session Context

## What's next
- Task 3.3: PID verification before signaling — check PID alive and cwd matches project path.
- Tasks 3.4-3.7 continue the Process Group Lifecycle epic.

## Key constraints (carried forward)
- `startProject` spawns with `detached: true` — process group created via setsid().
- `stopProject` now sends group signals: `process.kill(-pid, 'SIGTERM')` with `process.kill(-pid, 'SIGKILL')` escalation after 5s.
- When `child.pid` is undefined (spawn failure), falls back to `child.kill()` — safe degradation.
- Stored PID fallback path also uses group signal (`kill(-pid, 'SIGTERM')`).
- `stopListener` still uses positive-PID signals — intentional, it targets individual listeners not process groups.

## Watch for
- Task 3.3 adds PID verification (alive + cwd match) before signaling. The `process.kill(-pid, 0)` check verifies group existence.
- Task 3.6 (double exit handler) is still pending — `stopProject` registers a second `child.on('exit')`.
- The `child.pid` undefined guard was added for robustness but the undefined case is unlikely in practice (spawn fails before returning a ChildProcess).
