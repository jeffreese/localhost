# Session Context

## What's next
- Task 3.5: Startup PID cleanup — iterate `config.pids` on server start, verify each with `verifyPid`, remove dead/stale.
- Tasks 3.6-3.7 remain in Epic 3 (Process Group Lifecycle).

## Key constraints (carried forward)
- `startProject` spawns with `detached: true`, `stdio: ['ignore', 'pipe', 'pipe']`. PGID = child PID via setsid().
- `stopProject` sends group signals with PID verification: checks alive (`kill(pid, 0)`) and cwd match before signaling.
- `verifyPid(pid, expectedPath)` exported from process-manager.ts — reuses `parseCwdOutput` from listener-scanner.ts.
- Shutdown handlers in index.ts: SIGTERM/SIGINT → gracefulShutdown (SIGTERM all groups, 3s grace, SIGKILL survivors, exit). Exit handler does synchronous SIGKILL sweep.
- `shuttingDown` guard prevents double invocation on rapid SIGINT+SIGTERM.
- `getActiveProcesses()` returns the live Map — shutdown iterates it directly.

## Watch for
- Task 3.5 reuses `verifyPid` — iterate `config.pids`, verify each, remove stale on startup. Runs before the first background poll tick.
- Task 3.6 (double exit handler) — stopProject registers a second `child.on('exit')` alongside startProject's. Don't fix before 3.6.
- Task 5.5 depends on 3.4 — poller start/stop wired to server lifecycle.
- The `mutable-cache-reference` pattern hit again in PR #21 (2nd occurrence). readConfig mock in process-manager tests now uses structuredClone. Watch for this in new test files.
