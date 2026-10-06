# Session Context

## What's next
- Task 3.2: Modify `stopProject` to use `process.kill(-pid, 'SIGTERM')` (process group signal). SIGKILL escalation targets the group.
- Tasks 3.3-3.7 continue the Process Group Lifecycle epic.

## Key constraints (carried forward)
- `startProject` now spawns with `detached: true` and `stdio: ['ignore', 'pipe', 'pipe']`. Verified that macOS setsid() creates a process group with PGID = child PID.
- Process group signal `kill(-pid)` works on macOS — validated with a prototype.
- `stopProject` still uses positive-PID signals and `child.kill()` — task 3.2 will change this to group signals.
- Task 3.6 (double exit handler fix) is a separate task — don't fix the double exit handler registration in stopProject yet.

## Watch for
- `stopProject` registers a second `child.on('exit')` listener alongside the one from `startProject`. Task 3.6 addresses this.
- `stopProject`'s fallback path (no active child, kill via stored PID) still sends positive-PID signals — task 3.2 will address this.
- The `child.kill('SIGTERM')` call in `stopProject` sends SIGTERM to the child process only, not the group. With detached=true, this may leave grandchildren running. Task 3.2 fixes this.
