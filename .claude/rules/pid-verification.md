# PID Verification Required — Two-Step Reconciliation

Never mark a project as "running" based on port check alone. On startup, verify:

1. Stored PID is alive (`process.kill(pid, 0)`)
2. PID owns the expected port (`lsof -i :port -t`)

If `lsof` is unavailable, fall back to port-only check with a logged warning. Stale PIDs must be cleared from config when the process is confirmed dead.

Three valid states: running (PID alive + owns port), stopped (PID dead + port free), port conflict (port occupied by unknown process).

**Source:** ADR-006
