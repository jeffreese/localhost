# Session Context

## What's next
- Task 3.4: Shutdown handlers in index.ts — SIGTERM/SIGINT/exit → kill all active process groups with grace period.
- Tasks 3.5-3.7 remain in Epic 3 (Process Group Lifecycle).

## Key constraints (carried forward)
- `startProject` spawns with `detached: true`, `stdio: ['ignore', 'pipe', 'pipe']`. PGID = child PID via setsid().
- `stopProject` sends group signals with PID verification: checks alive (`kill(pid, 0)`) and cwd match (via lsof) before signaling. Stale PIDs cleaned from config without signal.
- `stopListener` retains positive-PID signals — targets individual listeners, not process groups.
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries, backward-compat defaults.
- `verifyPid(pid, expectedPath)` exported from process-manager.ts — reuses `parseCwdOutput` from listener-scanner.ts. Returns false for dead PIDs and cwd mismatches.

## Watch for
- Task 3.4 needs `getActiveProcesses()` to iterate all running process groups for shutdown cleanup.
- Task 3.5 will reuse `verifyPid` for startup PID cleanup — iterate `config.pids`, verify each, remove stale.
- Task 3.6 (double exit handler) — stopProject registers a second `child.on('exit')` alongside startProject's. Don't fix before 3.6.
- The `incomplete-test-config-after-schema-change` pattern — grep for `as <Type>` casts in tests after extending shared types.
- Every PR this session needed 2 Crucible rounds due to test coverage gaps on edge cases. Write defensive path tests upfront.
