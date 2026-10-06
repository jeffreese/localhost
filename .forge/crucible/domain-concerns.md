# Domain Concerns — localhost

Project-specific concerns the reviewer should always check for. Richer than the short tags in `pr-review.json` `domain_concerns`.

## Format

```
## <concern name>
- **What:** <one paragraph — the concern>
- **Where it usually shows up:** <files / patterns>
- **What to look for:** <specific signals>
- **Reference:** <ADR / PR / docs link if applicable>
```

---

## Synchronous I/O

- **What:** The server was originally built with synchronous I/O throughout — `execSync`, `readFileSync`, etc. All sync calls must be replaced with async equivalents. Any new sync I/O is a regression.
- **Where it usually shows up:** `src/server/` — scanner, listener-scanner, config-store, process-manager
- **What to look for:** Any `*Sync` function call in server code. `execSync`, `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `spawnSync`.
- **Reference:** ADR-012, behavior-async-io rule

## Process Signal Safety

- **What:** Sending signals to stale PIDs can kill unrelated processes. All PID signals must go through process groups (negative PID) with verification first.
- **Where it usually shows up:** `src/server/process-manager.ts`, any code calling `process.kill()`
- **What to look for:** Positive-PID signals (`process.kill(pid, ...)`), missing PID verification before signaling, direct writes to `config.pids` without verification.
- **Reference:** ADR-009, behavior-process-groups rule

## Config Race Conditions

- **What:** The config store serializes writes through an async queue. Bypassing `updateConfig()` with direct read-modify-write creates race conditions. Non-atomic writes can corrupt the config file.
- **Where it usually shows up:** Any code that reads config, mutates it, and writes it back
- **What to look for:** Direct `fs.writeFile` to the config path outside `updateConfig()`, `readConfig()` followed by `writeConfig()` without going through the serialized queue.
- **Reference:** behavior-config-serialization rule

## Console Hydration Race

- **What:** SSE log events arriving during the initial fetch in `ConsoleStore.open()` are dropped if the buffer doesn't exist yet. The fix requires buffering events during the fetch and merging after.
- **Where it usually shows up:** `src/client/stores/console-store.ts`
- **What to look for:** Any `open()` implementation that subscribes to SSE events after the fetch completes rather than before.
- **Reference:** ADR-011
