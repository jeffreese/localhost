# Friction Log

## 2026-10-08 — feat/log-rotation
**Friction:** Crucible required 2 rounds — round 1 caught TOCTOU race in concurrent fire-and-forget appendLines calls, unnecessary export, and missing concurrent test.
**Root cause:** Wired rotateIfNeeded into appendLines without considering that process-manager calls it fire-and-forget from data event handlers, creating concurrent calls for the same project. The serialization need wasn't obvious from the sequential call site in log-store.ts alone.
**Category:** crucible-rework

## 2026-10-08 — feat/log-disk-pagination
**Friction:** Crucible required 4 rounds — R1: client not updated for new response shape, negative limit loop, sequential reads. R2: path-based project IDs rejected by validateProjectName, missing res.ok check, dead mock. R3: dots-only IDs sanitize to empty, NaN timestamps, missing error test.
**Root cause:** Changed a server API response shape without updating the client consumer. Then replaced path validation (reject) with sanitization but didn't trace all edge cases in the sanitizer. Each round revealed the next layer of integration issues.
**Category:** crucible-rework

## 2026-10-08 — fix/console-hydration-race
**Friction:** Crucible required 3 rounds — R1: concurrent open() corrupts shared module-level buffer, process-started doesn't invalidate stale history, no tests. R2: same-project double-open hits null buffer via concat(null).
**Root cause:** Used module-level state (hydrationBuffer/hydrationProjectId) for per-call context across an await boundary. Single-caller mental model missed that the same async function can be in-flight twice. Each round found the next interleaving.
**Category:** crucible-rework
