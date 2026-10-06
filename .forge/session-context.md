# Session Context

## What's next
- Task 2.5: Integration tests for concurrent updates, crash-during-write recovery, cache invalidation. This completes Epic 2.
- After Epic 2 completes, Epic 3 (Process Group Lifecycle) is next.

## Key constraints (carried forward)
- Config store now has three new optional fields: `projectTypes`, `groupConfig`, `crashes`. Old configs without them pass `isValidConfig` and get defaults via `applyDefaults`.
- `applyDefaults` only fills missing fields — it never overwrites existing user-customized values.
- `repairConfig` also handles all three new fields (for configs that fail `isValidConfig` but are still objects).
- Cache clone boundaries remain solid: `applyDefaults` runs before `structuredClone` on the valid-config path.
- All mutations must go through `updateConfig`. Direct `readConfig` → mutate → `writeConfig` bypasses the serialization queue.
- `__resetCache()` is test-only (follows `__reset*` naming convention).

## Watch for
- Task 2.5 should test backward-compat defaults under concurrent access — e.g., old config loaded, defaults applied, then concurrent updateConfig calls.
- `vi.mock('node:fs/promises')` pattern in config-store.test.ts uses `renameOverride` for write-failure simulation.
- Async mock consistency — every mock for an async function must use `async () =>` returns.
