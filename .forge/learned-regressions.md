# Learned Regressions

Bug patterns discovered during development. The `/crucible:review` agent checks new code against these patterns. When a pattern recurs 2+ times, consider promoting it to a `.claude/rules/` file.

## async-event-handler-rejection
**Occurrences:** 1 (PR #9)
**Pattern:** Passing an async callback to a Node EventEmitter (`emitter.on('event', async () => { await ... })`) — if the awaited promise rejects, the rejection is unhandled because EventEmitter doesn't catch promise rejections from async listeners.
**Fix:** Use `.catch()` on the promise chain or wrap the body in try/catch. For fire-and-forget cleanup, use `promise.catch(() => {})`.

## mutable-cache-reference
**Occurrences:** 1 (PR #16)
**Pattern:** Returning a cached object by reference from a read function, or storing a caller's object as the cache without cloning. Callers (or the write queue's updater) can mutate the shared reference, corrupting the cache for all subsequent readers. On write failure, the cache retains mutations that were never persisted to disk.
**Fix:** `structuredClone` on every cache boundary — both storage (cache owns its copy) and retrieval (caller owns their copy). Verify all code paths, not just the hot-cache return.
**Status:** promoted to rule (behavior-cache-clone-boundaries.md)

## hanging-promise-no-catch
**Occurrences:** 1 (PR #9)
**Pattern:** `.then(() => resolve())` chains inside `new Promise()` constructors without `.catch()` — if the upstream promise rejects, `resolve()` never runs and the outer promise hangs indefinitely.
**Fix:** Always add `.catch(() => resolve())` or `.catch((err) => reject(err))` to `.then()` chains inside Promise constructors.

## unnecessary-export-after-internal-wiring
**Occurrences:** 2 (PR #39, PR #45)
**Pattern:** A function that was previously the only way to trigger a behavior is exported. When the behavior is wired internally (called automatically by another exported function), the original export creates a double-invocation risk for external callers. The public contract changed but the export didn't.
**Fix:** Un-export functions that became internal implementation details, or clearly document that the behavior is now automatic.

## api-shape-change-missing-consumer-update
**Occurrences:** 7 (PR #40, PR #44, PR #47, PR #53, PR #55, PR #56, PR #57)
**Pattern:** Changing a server API response shape (e.g., LogLine[] → {lines, hasMore}) without updating all client consumers. Mocked tests pass because the mock returns the old shape; the real response shape mismatch only surfaces at runtime. Destructuring the wrong shape yields undefined, which propagates silently.
**Fix:** When changing an API response shape, grep for all fetch/import consumers of that endpoint. Update mocks to return the new shape. Add an integration-style test that uses the real (unmocked) endpoint if possible.
**Status:** promoted to rule (behavior-consumer-update-on-shape-change.md)

## sanitizer-edge-case-empty-result
**Occurrences:** 1 (PR #40)
**Pattern:** Input validation replaced with sanitization (e.g., reject "/" → replace "/" with "_"), but the empty check runs before the sanitization transforms. Inputs that pass the pre-transform check can sanitize to empty (e.g., ".." → strip leading dots → ""), creating collisions or invalid filenames.
**Fix:** Run the empty/validity check after all sanitization transforms, not before.

## shared-module-state-across-await
**Occurrences:** 1 (PR #41)
**Pattern:** An async function stores intermediate state in module-level variables, then reads it after an await. A second call to the same function (same or different arguments) can overwrite the shared variables before the first call resumes, causing the first call to read the second call's state — or null if the second call already consumed it. The function appears correct in isolation; the bug only manifests under concurrent invocation.
**Fix:** Either scope state per-call (local variables + closures) or add null/ownership guards after every await that check whether the module-level state still belongs to the current call.

## redirect-manual-res-ok-mismatch
**Occurrences:** 1 (PR #51)
**Pattern:** Using `redirect: 'manual'` in fetch to prevent SSRF, then checking `res.ok` for health. `res.ok` is only true for 2xx. With `redirect: 'manual'`, 3xx responses are returned raw — a live server responding with a redirect is falsely marked unhealthy. The `redirect` option and the status-check logic must agree on what "alive" means.
**Fix:** Use `res.status < 500` (or similar) instead of `res.ok` when the goal is "is the server responding at all" rather than "did it return 200."

## concurrent-state-mutation-no-lock
**Occurrences:** 3 (PR #39, PR #41, PR #51)
**Pattern:** An async function that reads shared state, acts on it, then mutates it (stat → close → rename) is called fire-and-forget from event handlers. Without per-key serialization, concurrent calls for the same key observe the same pre-mutation state and both execute the mutation, corrupting the result. Classic TOCTOU in async code.
**Fix:** Per-key promise chain or async mutex wrapping the read-act-mutate sequence. The lock must be per-key (e.g., per project name) to avoid unnecessary contention.

## behavior-clone-in-loop
**Occurrences:** 1 (PR #57)
**Pattern:** Calling a function that deep-clones its result (e.g., `structuredClone` on a cache boundary) inside a `.map()` loop. Each iteration pays the full clone cost for data it only needs a single entry from. The pattern is invisible when the cloned function looks cheap (like `getStatus` which does a shallow spread) but expensive when the function clones a full map (like `getResourceUsage` which deep-clones all entries).
**Fix:** Hoist the cloning call outside the loop and pass the pre-fetched result as a parameter, or add a per-key accessor that clones only the requested entry.

## deferred-cleanup-unreachable-consumer
**Occurrences:** 2 (PR #45, PR #46)
**Pattern:** A function sets a flag expecting another component to clear it on a future cycle, but that component may never observe the flagged entity. E.g., `stopProject` sets a stop flag relying on the poller to clear it, but if the poller never had the project in its previous state, no diff entry is generated and the flag leaks permanently. The flag corrupts future classifications.
**Fix:** Clear the flag at the call site as the authoritative path. If the downstream consumer also clears it, that's belt-and-suspenders — the call site must not depend on it.

## convention-create-update-validation-parity
**Occurrences:** 1 (PR #59)
**Pattern:** A CREATE endpoint validates a constraint (e.g., duplicate name check) but the UPDATE/PATCH endpoint for the same resource omits it. The mismatch allows the invariant to be violated through the update path.
**Fix:** When adding validation to a create handler, immediately check whether the update handler enforces the same constraint. Uniqueness, format, and referential integrity checks must be symmetric.

## behavior-destructive-ui-without-confirmation
**Occurrences:** 1 (PR #59)
**Pattern:** A destructive UI action (delete, unassign-all, clear) fires immediately on click without a confirmation dialog. The no-permanent-deletion rule covers data, but group deletion destroys the group entity and all assignments in one unrecoverable click.
**Fix:** Gate destructive actions behind `window.confirm()` or an undo mechanism, especially when the action has cascading side effects (e.g., unassigning all projects from a deleted group).

## behavior-stale-cache-missing-field
**Occurrences:** 1 (PR #60)
**Pattern:** Adding a required field to a persisted type (`ProjectCache`) without providing a migration or fallback in consumers. Entries cached on disk before the migration lack the new field, and `...spread` propagates `undefined` to the UI. The field is always present in fresh scans, so testing never catches the gap — it only manifests on first load before a rescan.
**Fix:** In the consumer that builds the public response, provide a fallback default: `cached.newField ?? defaultValue`. Or trigger a fresh scan on startup to repopulate stale entries.

## behavior-loop-exit-on-partial-failure
**Occurrences:** 1 (PR #60)
**Pattern:** A loop that iterates candidates (registry entries, strategies, fallback options) uses `return` on a single candidate's failure, exiting the entire loop. The remaining candidates are never tried. The intent was to skip the bad entry, but `return null` exits the function, not just the iteration.
**Fix:** Use `continue` to skip to the next iteration, not `return` to exit the loop. Reserve `return` for when the loop found a definitive answer.

## behavior-skip-build-output-dirs
**Occurrences:** 1 (PR #60)
**Pattern:** Adding support for a new project type (Rust) without adding its build output directory (`target/`) to the scanner's skip list. The scanner descends into the build output tree, issuing thousands of unnecessary filesystem calls on every scan.
**Fix:** When adding a new project type to the registry, identify its build artifact directory and add it to `skipDirs`. Common build output directories: `node_modules`, `target`, `build`, `dist`, `__pycache__`, `.gradle`, `bin/obj`.
