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

## 2026-10-08 — feat/crash-detection-poller
**Friction:** Crucible required 2 rounds — R1: markStopping unnecessarily exported (unnecessary-export-after-internal-wiring), stop flag leak on stored-PID path when poller never observed the project.
**Root cause:** New flag functions defaulted to exported. Stored-PID path relied on poller to clear the flag, but the poller only generates diff entries for projects it previously tracked — an external process killed before the poller's first tick leaks the flag.
**Category:** crucible-rework

## 2026-10-08 — feat/crash-exit-code-capture
**Friction:** Crucible required 2 rounds — R1: CrashEvent duplicated CrashInfo fields (convention), stale isStopping flag suppresses onCrash after stop-then-restart (deferred-cleanup-unreachable-consumer again).
**Root cause:** New interface mirrored existing shared type instead of composing it. Stop flag lifecycle from 8.1 had a new consumer (onCrash guard) that exposed the gap between stopProject setting the flag and poller clearing it — a restart in that window inherits the stale flag.
**Category:** crucible-rework

## 2026-10-08 — feat/crash-config-storage
**Friction:** Crucible required 2 rounds — R1: handleProcessStarted doesn't clear crashInfo on restart (api-shape-change-missing-consumer-update, 3rd occurrence).
**Root cause:** Added crashInfo to Project type and backend response, but the client's optimistic SSE handler for process-started didn't include the new field. Same pattern as PRs #40 and #44 — shape change without full consumer sweep.
**Category:** crucible-rework

## 2026-10-08 — feat/health-checker
**Friction:** Crucible required 2 rounds — R1: redirect responses falsely marked unhealthy (redirect:manual + res.ok mismatch), concurrent check overlap without guard, test name contradicting its assertion.
**Root cause:** Used `res.ok` to check health after adding `redirect: 'manual'` for SSRF prevention — didn't account for res.ok being 2xx-only while 3xx is a valid "alive" response. Overlap guard was missed despite the background poller already having the pattern documented in ADR-012.
**Category:** crucible-rework

## 2026-10-08 — feat/health-check-lifecycle
**Friction:** Crucible required 3 rounds — R1: port change not handled (portsRemoved didn't stop health checker), missing portsAdded test, undocumented export. R2: poller hasChanges gate excluded portsRemoved (onDiff never fires for port-only-removed ticks), port-change test only verified stop half.
**Root cause:** Added a portsRemoved consumer in onDiff without checking that the poller's hasChanges gate actually delivers portsRemoved-only events — a pre-existing gap made material by the new consumer. Port-change test used a mock that didn't simulate real stopChecking behavior (clearing isChecking state), so the restart assertion was silently skipped.
**Category:** crucible-rework

## 2026-10-08 — feat/health-changed-sse
**Friction:** Crucible required 2 rounds — R1: SSE client relay missing health-changed addEventListener (api-shape-change-missing-consumer-update, 4th occurrence).
**Root cause:** Added server-side SSE event type and broadcast wiring but didn't grep for client SSE consumers. The sse-client.ts uses explicit addEventListener per type, so new events need manual registration. Same pattern as PRs #40, #44, #47.
**Category:** crucible-rework

## 2026-10-08 — feat/health-indicator-dot
**Friction:** Crucible required 3 rounds — R1: handleProcessCrashed and handleProcessStarted missing healthStatus clear, missing test for crash clearing, routes.test.ts missing healthStatus assertions. R2: missing test for healthStatus cleared on process-started.
**Root cause:** Added healthStatus to Project type and updated several consumers but missed 2 of 4 SSE handlers that spread Project objects. Despite the api-shape-change-missing-consumer-update rule and pre-implementation watch list flagging this exact pattern, the sweep was incomplete — stopped was updated but crashed and started were missed. 5th occurrence.
**Category:** crucible-rework

## 2026-10-08 — feat/health-check-interval-override
**Friction:** Crucible required 3 rounds — R1: stale health indicator in UI after disabling via PATCH (no SSE event to clear dot), DiffCallback type not reflecting async contract. R2: missing test for health-changed with null status in project-store.
**Root cause:** R1 findings were genuine omissions in the new disable path (broadcasting the state change to the client) and a type that drifted when the callback became async. R2 was the 6th occurrence of api-shape-change-missing-consumer-update — type updated to accept null but no test validated it.
**Category:** crucible-rework

## 2026-10-08 — feat/resource-sampling
**Friction:** Crucible required 2 rounds — R1: N+1 structuredClone in buildProjectResponse (getResourceUsage() called per project inside .map()), missing test for populated /api/resources response.
**Root cause:** The getResourceUsage() call was placed inside buildProjectResponse following the same pattern as healthChecker.getStatus() — but getStatus does a cheap shallow spread while getResourceUsage does a full structuredClone. The pattern match was wrong. The missing test is the 7th occurrence of the api-shape-change-missing-consumer-update pattern family — new endpoint with only an empty-state test.
**Category:** crucible-rework

## 2026-10-08 — fix/decouple-process-lifecycle
**Friction:** Crucible required 2 rounds — R1: documentation claimed spawned processes "survive restarts" but piped stdio means children get SIGPIPE/EPIPE when parent exits; dead getActiveProcesses export left behind.
**Root cause:** The documentation was written for the intent (full decoupling) rather than the actual mechanism (pipes still create a dependency). The dead export was missed during removal of killAllProcessGroups — the function was in a different file than the one being edited.
**Category:** crucible-rework

## 2026-10-09 — feat/project-groups
**Friction:** Crucible required 2 rounds — R1: PATCH /groups/:id missing duplicate-name check (create/update validation parity), group deletion without confirmation (destructive action), rename only via double-click (WCAG keyboard a11y), fire-and-forget promise without catch, missing test.
**Root cause:** The PATCH endpoint mirrored the POST handler's structure but not its validation constraints. The destructive action was a one-click delete with cascading unassignment. The rename discoverability was mouse-only.
**Category:** crucible-rework

## 2026-10-09 — feat/project-type-registry
**Friction:** Crucible required 2 rounds — R1: stale cached entries missing projectType rendered "undefined", detectProject return null on parse failure prevented fallback to other registry entries, Rust target/ not in skipDirs, ../. bypassed marker validation, no endpoint tests.
**Root cause:** Data migration gap (new required field on persisted type without fallback), loop exit semantics (return vs continue), incomplete skip list for new project type, and insufficient input validation coverage.
**Category:** crucible-rework

## 2026-10-08 — fix/file-based-stdio
**Friction:** Crucible review required 3 rounds (5 fix-now R1, 1 fix-now R2, LGTM R3)
**Root cause:** New module-level state maps (activeRawPaths, activeTails) weren't reset in test helpers; closeLogs/appendToLogFile async ordering wasn't preserved from the old pipe-based code; single fd for both stdout/stderr lost stream differentiation
**Category:** crucible-rework
