# Session Context

## What's next
- Task 3.7: Integration tests for process group lifecycle — group kill, PID verification, shutdown cleanup, stale PID pruning.

## Key constraints (carried forward)
- `startProject` spawns with `detached: true`, `stdio: ['ignore', 'pipe', 'pipe']`. PGID = child PID via setsid().
- `stopProject` sends group signals with PID verification on stored-PID path. Active-child path skips verification (holds ChildProcess reference directly).
- Single exit handler per child — registered in `startProject`, handles log flushing, activeProcesses cleanup, and config.pids removal. `stopProject` only adds timeout + resolve handler.
- `verifyPid(pid, expectedPath)` exported from process-manager.ts — alive check + cwd match via lsof.
- `cleanupStalePids()` exported from process-manager.ts — iterates config.pids on startup, removes stale entries.
- Shutdown handlers in index.ts: SIGTERM/SIGINT → gracefulShutdown, exit → sync SIGKILL sweep.
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.

## Judgment calls this session
- Task 3.6 fix was minimal: removed duplicate cleanup (activeProcesses.delete + updateConfig) from stopProject's exit handler, leaving only clearTimeout + resolve. startProject's handler already covers cleanup.

## Watch for
- Task 3.7: integration tests need to cover the single-exit-handler guarantee — verify updateConfig called exactly once on stop.
- Fire-and-forget promises need `.catch()` — project rule (behavior-catch-fire-and-forget.md).
- readConfig mocks must use structuredClone (behavior-cache-clone-boundaries.md).
- EPERM vs ESRCH: cover both error codes as distinct test scenarios.
