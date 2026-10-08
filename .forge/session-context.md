# Session Context

## What's next
- Epic 8: Crash Detection & Notifications — task 8.1: Add crash detection to poller diff (disappeared listener + no user stop = crash, track stop flag)
- Epic 8 is 6 tasks: crash detection, exit code capture, crash config storage, SSE event, card indicator, desktop notification

## Key constraints (carried forward)
- Config store fully hardened (Epic 2): atomic writes, serialized queue, cached with structuredClone boundaries.
- Process group lifecycle complete (Epic 3). Port override complete (Epic 13).
- Background polling complete (Epic 5): 5s interval, overlap guard, listener diff → SSE broadcast, monotonic event IDs.
- Log persistence complete (Epic 6): appendLines with per-project write lock, rotateIfNeeded (10MB), readLines with pagination, console hydration race fix.
- Port type detection complete (Epic 7): probePort (HTTP HEAD, 2s timeout), shared module-level cache in port-probe.ts (setPortType/getPortType/deletePortType/clearPortTypeCache), poller probes new ports in parallel and invalidates on removal/stop, portType field on Listener type (optional), SSE port-detected event includes portType, project card and port table render based on portType.
- Fire-and-forget promises need `.catch()` — project rule.
- Cache clone boundaries: all getters/callbacks returning internal state must use structuredClone.

## Architecture decisions from Epic 7
- Port type cache lives in port-probe.ts as module-level state (not on the poller instance) — avoids circular imports between routes.ts and index.ts.
- PortType defined in shared/types.ts, re-exported from port-probe.ts for convenience.
- Probes run in parallel within a tick via Promise.all, with per-probe try/catch so one failure doesn't kill the batch.
- diffListeners `started` array doesn't populate `portsAdded` — poller manually collects ports from newly started projects for probing.
- `portType` is optional on Listener — undefined treated same as http for clickability (only `tcp` is explicitly non-clickable).

## Watch for
- `shared-module-state-across-await` — any async function storing intermediate state in module-level vars across an await.
- `concurrent-state-mutation-no-lock` — 2 occurrences; watch for it in Epic 8 (crash detection updates config.crashes which needs serialized access via updateConfig).
- Epic 8 crash detection requires distinguishing "user stopped" from "process disappeared" — need a flag set by stopProject before the listener disappears from the next poller tick.
- Health checker (Epic 9) shares architecture with port probes — the probePort function or a variant will be reused.
