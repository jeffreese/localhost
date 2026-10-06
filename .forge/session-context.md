# Session Context

## What's next
- Epic 2 (Config Store Hardening) is complete after task 2.5.
- Next: Epic 3 (Process Group Lifecycle) — task 3.1: spawn with `detached: true`, pipe stdout/stderr.

## Key constraints (carried forward)
- Config store is fully hardened: atomic writes, serialized queue, cached with structuredClone on all boundaries, backward-compat defaults for new fields.
- 81 tests cover the config store: unit, clone boundaries, backward compat, concurrent updates (10 rapid-fire), crash-during-write recovery, cache invalidation.
- `isValidConfig` validates core fields only — new fields may be absent on disk. `applyDefaults()` fills them. Documented coupling.

## Watch for
- Epic 3 touches process-manager.ts heavily. The process manager reads/writes config via `updateConfig` — serialization is solid.
- `renameOverride` mock pattern in config-store.test.ts is established for simulating write failures.
- Process group signals on macOS need prototype validation (risk flag from retrofit spec).
