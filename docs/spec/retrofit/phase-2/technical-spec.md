---
title: "Technical Specification"
phase: 2
project: localhost
date: 2026-10-05
status: draft
---

# Technical Specification

## System Overview

Localhost is a two-layer local application — Hono backend (:7769) and Lit/Tailwind frontend (:7770) — for managing dev servers on macOS. The backend owns all system interactions: scanning the filesystem for projects, enumerating OS TCP listeners, spawning/killing processes, reading/writing config, and pushing state via SSE. The frontend subscribes to SSE for live updates and dispatches commands via REST.

This retrofit addresses five categories of technical debt and adds six new capabilities. The server-side is the focus — every blocking I/O call becomes async, process management gets safe lifecycle handling, the config store gets concurrency protection, and background polling enables true reactivity. New features (groups, health checks, resource monitoring, log persistence, broader detection, crash notifications) layer on top of the stabilized foundation.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│                    Browser (:7770)                    │
│                                                      │
│  ┌──────────────┐ ┌───────────┐ ┌──────────────────┐ │
│  │ ProjectStore  │ │  UIStore  │ │  ConsoleStore    │ │
│  └──────┬───────┘ └─────┬─────┘ └────────┬─────────┘ │
│         └───────────────┼────────────────┘           │
│                    SSE Client                         │
│                         │                            │
└─────────────────────────┼────────────────────────────┘
                          │ SSE (state push)
                          │ REST (commands)
┌─────────────────────────┼────────────────────────────┐
│                  Hono API (:7769)                     │
│                         │                            │
│  ┌──────────┐  ┌────────┴───────┐  ┌──────────────┐ │
│  │ Scanner   │  │ SSE Broadcaster│  │ Config Store │ │
│  └────┬─────┘  └────────────────┘  └──────┬───────┘ │
│       │                                    │         │
│  ┌────┴──────────┐  ┌──────────────────┐   │         │
│  │Listener Scanner│  │ Process Manager  │───┘         │
│  └───────────────┘  └──────────────────┘             │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Background Poll Loop (NEW)            │ │
│  │  • Listener scan (5-10s)                        │ │
│  │  • Health checks (30s, per running service)     │ │
│  │  • Resource sampling (10-15s)                   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │  ~/.localhost/         │
              │    config.json        │
              │    logs/<project>/    │
              └───────────────────────┘
```

## Component Breakdown

### Scanner (src/server/scanner.ts)

**Current state:** Synchronous filesystem walk using `readdirSync`/`statSync`/`readFileSync`. Hardcoded to `package.json` detection only. Blocks the event loop for the entire scan.

**Changes:**
- Replace all `*Sync` calls with `fs.promises` equivalents (`readdir`, `stat`, `readFile`)
- Replace hardcoded `package.json` detection with **project type registry** lookup — iterate registered marker files, match the first one found in each directory
- `scanAndPersist` must merge with existing config (not replace wholesale) to preserve hidden/ignored/group assignments for projects whose directories were deleted

**Project Type Registry:**

The registry lives in `~/.localhost/config.json` under a `projectTypes` key. Each entry maps a marker filename to project metadata:

```typescript
interface ProjectTypeEntry {
  name: string           // "node", "rust"
  defaultCommand?: string // "cargo run" — null means detect from marker file
  detectManager?: boolean // true for package.json (npm/pnpm/yarn detection)
}

// In config:
projectTypes: Record<string, ProjectTypeEntry>
```

Built-in defaults (applied if `projectTypes` is absent or empty):

```json
{
  "package.json": { "name": "node", "detectManager": true },
  "Cargo.toml": { "name": "rust", "defaultCommand": "cargo run" }
}
```

The scanner walks each directory and checks for registered marker files in registry order. First match wins (a directory with both `package.json` and `Cargo.toml` is treated as whatever comes first in the registry — Node by default).

---

### Listener Scanner (src/server/listener-scanner.ts)

**Current state:** Two `execSync` calls — one for TCP listeners, one for cwds. Hardcoded command filter to `node,bun,deno`. 5s timeout per call. Blocks the event loop.

**Changes:**
- Replace `execSync` with `execFile` (async, callback-based, streams stdout)
- Extend command filter to include `cargo` (and any future process names registered via project types)
- The command filter should be derived from the project type registry — each type can optionally declare process names to match in lsof

**Process name mapping extension:**

```typescript
interface ProjectTypeEntry {
  name: string
  defaultCommand?: string
  detectManager?: boolean
  processNames?: string[]  // lsof command filter, e.g. ["cargo"]
}
```

Built-in defaults become:

```json
{
  "package.json": {
    "name": "node",
    "detectManager": true,
    "processNames": ["node", "bun", "deno"]
  },
  "Cargo.toml": {
    "name": "rust",
    "defaultCommand": "cargo run",
    "processNames": ["cargo"]
  }
}
```

The listener scanner builds its `lsof` command filter dynamically from all registered types' `processNames` arrays, deduplicated.

---

### Process Manager (src/server/process-manager.ts)

**Current state:** Spawns with `detached: false`, stores PIDs without verification, no shutdown handlers, double exit handlers on stop, `getPortOwner` dead code, SIGKILL escalation only for current-session children.

**Changes — Process Groups:**

Spawn with `detached: true` to create a new process group:

```typescript
const child = spawn(command, args, {
  cwd: projectPath,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ...(portOverride ? { PORT: String(portOverride) } : {})
  }
})
```

On macOS, `detached: true` in Node.js calls `setsid()`, which creates a new session and process group. The PGID equals the child's PID.

**Stop sequence:**

```
1. Read config.pids[projectPath] → pid
2. Verify pid is alive AND belongs to expected project:
   - Check /proc/<pid> or `kill(pid, 0)` for existence
   - Check cwd via lsof matches project path
   - If mismatch: remove stale PID from config, report error, do not signal
3. Send SIGTERM to process group: process.kill(-pid, 'SIGTERM')
4. Start 5s timer
5. If still alive after 5s: process.kill(-pid, 'SIGKILL')
6. Remove from activeProcesses map
7. Remove PID from config.pids
8. Broadcast 'process-stopped' via SSE
```

**Shutdown handlers:**

Register on server startup in `index.ts`:

```typescript
function shutdown() {
  for (const [path, child] of activeProcesses) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
  }
  // Brief grace period, then SIGKILL survivors
  setTimeout(() => {
    for (const [path, child] of activeProcesses) {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
    process.exit(0)
  }, 3000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('exit', shutdown)
```

**Port override wiring:**

When starting a project, read `config.overrides[projectId]?.port`. If set:
1. Check if port is already occupied (via listener scanner)
2. If occupied: return error, don't start
3. If free: pass as `PORT` env var to spawned process

**Stale PID cleanup:**

On server startup, iterate `config.pids`:
- For each PID, check if alive and cwd matches project path
- Remove dead or mismatched entries
- Run this before the first background poll tick

**Dead code removal:**
- Delete `getPortOwner` function
- Consolidate exit handler registration (single handler per child, not re-registered on stop)

---

### Config Store (src/server/config-store.ts)

**Current state:** `readFileSync`/`writeFileSync` directly to config path. Read-modify-write without locking. No caching.

**Changes — Atomic Writes:**

```typescript
async function writeConfig(config: LocalhostConfig): Promise<void> {
  const tmpPath = CONFIG_PATH + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2))
  await fs.rename(tmpPath, CONFIG_PATH)  // atomic on same filesystem
}
```

**Changes — Write Serialization:**

A simple async queue — config writes go through a single-entry lock:

```typescript
let writeQueue: Promise<void> = Promise.resolve()

async function updateConfig(
  mutator: (config: LocalhostConfig) => void
): Promise<LocalhostConfig> {
  return new Promise((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      const config = await readConfig()
      mutator(config)
      await writeConfig(config)
      cachedConfig = config
      resolve(config)
    }).catch(reject)
  })
}
```

This serializes all read-modify-write cycles. No concurrent mutation, no lost writes.

**Changes — Read Caching:**

```typescript
let cachedConfig: LocalhostConfig | null = null

async function readConfig(): Promise<LocalhostConfig> {
  if (cachedConfig) return cachedConfig
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
  cachedConfig = JSON.parse(raw)
  return cachedConfig
}
```

Cache invalidated only by `writeConfig` (which updates `cachedConfig` directly). No filesystem reads on hot paths.

---

### SSE Broadcaster (src/server/sse.ts)

**Current state:** Clean implementation. 30s keepalive. No event ID tracking.

**Changes — minimal:**
- Add event IDs (monotonic counter) to enable future replay on reconnect
- Add new event types: `health-changed`, `resource-update`, `process-crashed`, `groups-changed`
- Log client disconnections (currently silent)

**New SSE Event Schema:**

```typescript
// Existing events (unchanged)
type SSEEvent =
  | { type: 'scan-complete'; data: Project[] }
  | { type: 'process-started'; data: { projectId: string; pid: number } }
  | { type: 'process-stopped'; data: { projectId: string } }
  | { type: 'port-detected'; data: { projectId: string; port: number } }
  | { type: 'project-updated'; data: { projectId: string } }
  | { type: 'log'; data: { projectId: string; line: string; stream: 'stdout' | 'stderr' } }
  | { type: 'preferences-updated'; data: { sort?: SortConfig } }
  // New events
  | { type: 'process-crashed'; data: { projectId: string; exitCode: number | null; signal: string | null; timestamp: string } }
  | { type: 'health-changed'; data: { projectId: string; status: 'healthy' | 'unhealthy' | 'unknown'; responseTime?: number } }
  | { type: 'resource-update'; data: { projectId: string; cpu: number; memory: number } }
  | { type: 'groups-changed'; data: { groups: GroupConfig } }
```

---

### Background Poll Loop (NEW)

A single `setInterval`-driven loop that coordinates three periodic tasks. Runs in the server process, not a separate worker.

**Design:**

```typescript
class BackgroundPoller {
  private interval: NodeJS.Timeout | null = null
  private tickCount = 0

  start(intervalMs = 5000) {
    this.interval = setInterval(() => this.tick(), intervalMs)
  }

  private async tick() {
    this.tickCount++

    // Every tick (5s): listener scan
    await this.scanListeners()

    // Every 3rd tick (15s): resource sampling
    if (this.tickCount % 3 === 0) {
      await this.sampleResources()
    }

    // Health checks run on their own per-project timers (see below)
  }
}
```

**Listener scan (every 5s):**
1. Call async `enumerateListeners()` + `matchListenersToProjects()`
2. Diff against previous state
3. For each new listener: broadcast `process-started` (or `port-detected` if project already running)
4. For each removed listener: broadcast `process-stopped`
5. For listeners that disappeared unexpectedly (project had active process): broadcast `process-crashed` with available info

**Resource sampling (every 15s):**
1. For each running project, collect PIDs from listener data
2. Run `ps -o pid,pcpu,rss -p <pids>` (single async call for all PIDs)
3. Aggregate CPU and memory per project (sum across process group)
4. Broadcast `resource-update` for each project with changed values

**Health checks (per-project, 30s default):**
Health checks are per-project timers, not part of the main poll loop. Started when a service starts, stopped when it stops.

```typescript
class HealthChecker {
  private timers = new Map<string, NodeJS.Timeout>()

  startChecking(projectId: string, port: number, intervalMs = 30000) {
    const timer = setInterval(async () => {
      const status = await this.probe(port)
      // broadcast if changed from previous
    }, intervalMs)
    this.timers.set(projectId, timer)
  }

  stopChecking(projectId: string) {
    const timer = this.timers.get(projectId)
    if (timer) clearInterval(timer)
    this.timers.delete(projectId)
  }

  private async probe(port: number): Promise<'healthy' | 'unhealthy'> {
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`http://localhost:${port}`, {
        method: 'HEAD',
        signal: controller.signal
      })
      return res.ok ? 'healthy' : 'unhealthy'
    } catch {
      return 'unhealthy'
    }
  }
}
```

Health checks only apply to ports identified as HTTP by the port type detection (F13). Non-HTTP ports get `unknown` status and are never probed.

---

### Log Persistence (NEW — src/server/log-store.ts)

**Design:**

A new module that handles writing process output to disk and reading it back.

**Write path:**
- When a process is spawned, create/open `~/.localhost/logs/<project-name>.log` (append mode)
- Pipe stdout and stderr to both the in-memory ring buffer (for SSE broadcast) and the file
- Each line prepended with ISO timestamp and stream identifier: `[2026-10-05T12:34:56.789Z stdout] <line>`

**Rotation:**
- Before each write, check file size via `fstat` on the open fd
- When file exceeds 10MB: rename current to `.log.1`, open new `.log`
- Keep only `.log` and `.log.1` (20MB max per project)
- Size limit configurable per project via `config.overrides[projectId].maxLogSize`

**Read path (hydration):**
- `GET /api/projects/:id/logs` reads from disk (tail of file, last N lines)
- Fix the race condition: initialize the log buffer from disk BEFORE starting SSE subscription, so events arriving during fetch aren't dropped:

```typescript
async function openConsole(projectId: string): Promise<LogLine[]> {
  // 1. Register for SSE events (buffered)
  const buffer: LogLine[] = []
  const unsub = sseClient.on('log', (data) => {
    if (data.projectId === projectId) buffer.push(data)
  })

  // 2. Fetch historical logs from server
  const history = await fetch(`/api/projects/${projectId}/logs`).then(r => r.json())

  // 3. Merge: history + any SSE events that arrived during fetch
  const merged = [...history, ...buffer]
  unsub()

  // 4. Now subscribe normally
  return merged
}
```

---

### Crash Detection (integrated with Background Poll Loop)

Not a separate module — crash detection is a function of the listener scan diff:

1. Previous tick: project X had listeners on ports 3000, 3001
2. Current tick: no listeners for project X
3. Check: was this a user-initiated stop? (Check if `stopProject` was called recently — a flag in the process manager)
4. If not user-initiated: this is a crash
5. Broadcast `process-crashed` with last known exit code (from child process `exit` event if spawned by us, or null if external)
6. Store crash info in config: `config.crashes[projectId] = { timestamp, exitCode, signal }`
7. Crash indicator clears when the project is next started

---

### Port Type Detection (integrated with Listener Scanner)

When a new listener is detected:

1. Attempt `fetch('http://localhost:<port>', { method: 'HEAD' })` with 2s timeout
2. If success (any HTTP response): mark as `http`
3. If connection refused, timeout, or non-HTTP response: mark as `tcp`
4. Cache the result: `portTypeCache.set(port, type)`
5. Invalidate cache entry when the port's listener disappears and reappears

Frontend uses the `type` field to decide clickability — `http` ports link, `tcp` ports display as plain text.

---

### Project Groups (config extension)

**Config schema addition:**

```typescript
interface GroupConfig {
  groups: Array<{
    id: string        // uuid
    name: string
    collapsed: boolean
  }>
  assignments: Record<string, string>  // projectPath → groupId
}
```

Added to `LocalhostConfig` as `groupConfig`. Default: `{ groups: [], assignments: {} }`.

**API endpoints:**

```
POST   /api/groups              — Create group { name }
PATCH  /api/groups/:id          — Update group { name?, collapsed? }
DELETE /api/groups/:id          — Delete group (unassigns all projects)
PATCH  /api/projects/:id/group  — Assign { groupId } or unassign { groupId: null }
```

All group mutations broadcast `groups-changed` via SSE.

**Drag-and-drop:** Custom order (`config.customOrder`) continues to work within groups. The order array is flat — group display is a UI-layer grouping of the ordered list, not a reordering of the underlying data.

---

## Data Flow

### Start a Project

```
1. User clicks Start on project card
2. POST /api/projects/:id/start
3. Route handler reads config → checks overrides.port → checks for conflicts
4. processManager.startProject(path, command, env)
   a. spawn(command, { detached: true, env: { PORT: override } })
   b. Store child in activeProcesses map
   c. Write PID to config.pids
   d. Pipe stdout/stderr → ring buffer + log file
   e. Start health check timer for this project
5. Broadcast 'process-started' via SSE
6. Background poller picks up new listener on next tick → confirms state
7. Frontend ProjectStore receives SSE → updates UI reactively
```

### External Process Detected

```
1. Background poller runs listener scan (every 5s)
2. New listener found → lsof returns pid, port, cwd
3. Match cwd to a known project path
4. Diff against previous state → this is new
5. Probe port type (HTTP HEAD)
6. Broadcast 'process-started' + 'port-detected' via SSE
7. Frontend updates without page refresh
```

### Process Crash Detected

```
1. For Localhost-spawned processes: child 'exit' event fires
   a. Check if user-initiated (stopProject flag)
   b. If not: broadcast 'process-crashed', store crash info
2. For external processes: background poller detects missing listener
   a. Previous tick had listener, this tick doesn't
   b. No stop was initiated → crash
   c. Broadcast 'process-crashed'
3. Frontend shows crash indicator with timestamp and exit info
4. Crash clears on next successful start
```

## Integration Points

No external services. All integrations are local OS facilities:

| Integration | Method | Failure Mode |
|-------------|--------|-------------|
| `lsof` | `execFile` (async) | Empty result → no listeners detected. Timeout → skip tick. |
| `ps` | `execFile` (async) | Empty result → no metrics. Timeout → skip sampling. |
| `child_process.spawn` | Node built-in | Spawn failure → return error to client. |
| `~/.localhost/config.json` | `fs.promises` | Corrupted → repair from backup + defaults. Missing → create defaults. |
| `~/.localhost/logs/` | `fs.promises` | Missing dir → create on first write. Write failure → log to stderr, don't crash. |
| Filesystem walk | `fs.promises` | Permission denied → skip directory. Missing → skip. |

## Config Schema (Updated)

```typescript
interface LocalhostConfig {
  scanRoot: string
  projectTypes: Record<string, ProjectTypeEntry>  // NEW
  projects: Record<string, ProjectCache>
  pids: Record<string, number>
  overrides: Record<string, ProjectOverride>
  hidden: string[]
  ignored: string[]
  sort: SortConfig
  customOrder: string[]
  groupConfig: GroupConfig  // NEW
  crashes: Record<string, CrashInfo>  // NEW
}

interface ProjectTypeEntry {
  name: string
  defaultCommand?: string
  detectManager?: boolean
  processNames?: string[]
}

interface ProjectOverride {
  port?: number
  devScript?: string
  healthCheckInterval?: number  // ms, 0 to disable
  maxLogSize?: number           // bytes, default 10MB
}

interface CrashInfo {
  timestamp: string
  exitCode: number | null
  signal: string | null
}

interface GroupConfig {
  groups: Array<{ id: string; name: string; collapsed: boolean }>
  assignments: Record<string, string>
}
```

All new fields have defaults, so existing configs work without migration. `projectTypes` defaults are applied in `readConfig` if the field is absent.

## Migration Strategy

### Async I/O Migration Sequence

The sync → async conversion must be sequenced to avoid half-migrated states where some callers expect sync returns and others use promises.

**Order:**
1. **Config store first.** Everything reads config. Convert `readConfig`/`writeConfig`/`updateConfig` to async. This breaks all callers — fix them in the same pass.
2. **Scanner second.** `scan()` and `scanAndPersist()` become async. Only called from route handlers (already in async context).
3. **Listener scanner third.** `enumerateListeners()` and `matchListenersToProjects()` become async. Called from routes and the new background poller.
4. **Process manager last.** `startProject`/`stopProject`/`stopListener` become async. Most complex due to child process lifecycle.

Each step is a single commit that converts the module AND all its callers. No intermediate state where sync and async versions coexist.

### Config Backward Compatibility

New fields (`projectTypes`, `groupConfig`, `crashes`) are added with defaults in `readConfig`:

```typescript
if (!config.projectTypes) {
  config.projectTypes = DEFAULT_PROJECT_TYPES
}
if (!config.groupConfig) {
  config.groupConfig = { groups: [], assignments: {} }
}
if (!config.crashes) {
  config.crashes = {}
}
```

Existing fields are never removed or renamed. The repair logic in config-store already handles missing fields gracefully.
