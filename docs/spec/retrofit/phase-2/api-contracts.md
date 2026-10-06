---
title: "API Contracts"
phase: 2
project: localhost
date: 2026-10-05
status: draft
---

# API Contracts

All endpoints are served from the Hono backend on `:7769` under the `/api` prefix. Responses are JSON. Errors return `{ error: string }` with appropriate HTTP status codes.

## Existing Endpoints (Modified)

### GET /api/projects

Returns all projects with enriched runtime state.

**Changes:** Add `projectType`, `healthStatus`, `resourceUsage`, `crashInfo`, and `group` fields to each project object.

**Response:**

```typescript
{
  projects: Array<{
    id: string              // absolute path, used as unique ID
    name: string
    path: string
    packageManager: string  // "pnpm" | "npm" | "yarn" | null (non-JS)
    projectType: string     // "node" | "rust" | etc. (NEW)
    devScript: string | null
    githubUrl: string | null
    processState: "running" | "stopped"
    listeners: Array<{ port: number; pid: number; portType: "http" | "tcp" }>  // portType NEW
    spawnedByUs: boolean
    visibility: "visible" | "hidden" | "ignored"
    group: string | null    // group ID or null if ungrouped (NEW)
    healthStatus: "healthy" | "unhealthy" | "unknown" | null  // null if not running (NEW)
    resourceUsage: { cpu: number; memory: number } | null     // null if not running (NEW)
    crashInfo: { timestamp: string; exitCode: number | null; signal: string | null } | null  // (NEW)
  }>
}
```

---

### POST /api/projects/:id/start

Start a project's dev server.

**Changes:** Read `overrides.port` and pass as `PORT` env var. Return error if port is occupied. Start health check timer after successful start.

**Request body (unchanged):**

```typescript
{ devScript?: string }  // optional override
```

**Response:**

```typescript
// 200
{ pid: number; port?: number }

// 409 — port conflict
{ error: string; conflictingProject?: string; port: number }
```

**Side effects:**
- Broadcasts `process-started` via SSE
- Starts health check timer for this project
- Writes PID to `config.pids`
- Opens log file for writing

---

### POST /api/projects/:id/stop

Stop a project's dev server.

**Changes:** Uses process group signal (`kill(-pgid)`). Verifies PID ownership before signaling.

**Response:**

```typescript
// 200
{ stopped: true }

// 404 — project not found or not running
{ error: string }

// 409 — PID verification failed (stale PID, wrong process)
{ error: string; stalePid: number }
```

**Side effects:**
- Broadcasts `process-stopped` via SSE
- Stops health check timer
- Removes PID from `config.pids`
- Closes log file

---

### POST /api/projects/:id/stop/:pid

Stop a specific listener by PID.

**Changes:** PID verification before signaling.

**Response:**

```typescript
// 200
{ stopped: true }

// 409 — PID verification failed
{ error: string }
```

---

### POST /api/scan

Trigger a project scan.

**Changes:** Async filesystem walk. Uses project type registry instead of hardcoded `package.json`. Merges with existing config instead of replacing.

**Response:**

```typescript
{
  projects: Array<{...}>  // same shape as GET /api/projects
  newCount: number        // projects discovered this scan that weren't in config
  removedCount: number    // projects in config whose directories no longer exist
}
```

**Side effects:**
- Broadcasts `scan-complete` via SSE
- Updates `config.projects` (merge, not replace)

---

### PATCH /api/projects/:id

Update project settings.

**Changes:** Add `group` assignment and `healthCheckInterval` to accepted fields.

**Request body:**

```typescript
{
  visibility?: "visible" | "hidden" | "ignored"
  devScript?: string
  port?: number           // locked port assignment
  group?: string | null   // group ID or null to unassign
  healthCheckInterval?: number  // ms, 0 to disable
  maxLogSize?: number     // bytes
}
```

**Response:**

```typescript
// 200
{ updated: true }
```

**Side effects:**
- Broadcasts `project-updated` via SSE
- If `group` changed: broadcasts `groups-changed` via SSE
- If `healthCheckInterval` changed: restarts health check timer

---

### PATCH /api/preferences

Update UI preferences (sort, etc.).

**Unchanged.** Exists for completeness.

**Request body:**

```typescript
{
  sort?: { field: string; order: "asc" | "desc" | "custom" }
  customOrder?: string[]
}
```

---

### GET /api/projects/:id/logs

Fetch historical logs for a project.

**Changes:** Now reads from disk (`~/.localhost/logs/<project-name>.log`) instead of only the in-memory ring buffer. Supports pagination.

**Query params:**

```
?lines=500    // number of lines to return (default: 500, max: 5000)
&offset=0     // line offset from end of file (0 = most recent)
```

**Response:**

```typescript
{
  lines: Array<{
    timestamp: string
    stream: "stdout" | "stderr"
    content: string
  }>
  totalLines: number    // total lines available in log file
  hasMore: boolean      // true if more lines exist before offset
}
```

---

### GET /api/sse

SSE event stream.

**Changes:** New event types added. Event IDs included for future replay support.

**Event types:**

| Event | Data | When |
|-------|------|------|
| `scan-complete` | `Project[]` | After scan finishes |
| `process-started` | `{ projectId, pid }` | Process spawned or detected by poller |
| `process-stopped` | `{ projectId }` | Process stopped (user-initiated) |
| `process-crashed` | `{ projectId, exitCode, signal, timestamp }` | Process exited unexpectedly **(NEW)** |
| `port-detected` | `{ projectId, port, portType }` | New port listener found. `portType` is NEW |
| `project-updated` | `{ projectId }` | Project settings changed |
| `log` | `{ projectId, line, stream }` | Log line from running process |
| `preferences-updated` | `{ sort? }` | UI preferences changed |
| `health-changed` | `{ projectId, status, responseTime? }` | Health check result changed **(NEW)** |
| `resource-update` | `{ projectId, cpu, memory }` | Resource metrics updated **(NEW)** |
| `groups-changed` | `{ groups: GroupConfig }` | Group created/updated/deleted **(NEW)** |
| `ping` | `{}` | 30s keepalive |

---

## New Endpoints

### POST /api/groups

Create a project group.

**Request body:**

```typescript
{ name: string }
```

**Response:**

```typescript
// 201
{ id: string; name: string; collapsed: false }

// 400 — empty name or duplicate name
{ error: string }
```

**Side effects:**
- Broadcasts `groups-changed` via SSE
- Writes to `config.groupConfig.groups`

---

### PATCH /api/groups/:id

Update a group.

**Request body:**

```typescript
{
  name?: string
  collapsed?: boolean
}
```

**Response:**

```typescript
// 200
{ updated: true }

// 404 — group not found
{ error: string }
```

**Side effects:**
- Broadcasts `groups-changed` via SSE

---

### DELETE /api/groups/:id

Delete a group. All projects in the group become ungrouped.

**Response:**

```typescript
// 200
{ deleted: true; unassignedCount: number }

// 404 — group not found
{ error: string }
```

**Side effects:**
- Removes all assignments referencing this group
- Broadcasts `groups-changed` via SSE

---

### GET /api/health

Health status summary for all running projects.

**Response:**

```typescript
{
  statuses: Record<string, {
    status: "healthy" | "unhealthy" | "unknown"
    lastCheck: string        // ISO timestamp
    responseTime?: number    // ms, only for HTTP probes
    consecutiveFailures: number
  }>
}
```

---

### GET /api/resources

Resource usage for all running projects.

**Response:**

```typescript
{
  usage: Record<string, {
    cpu: number      // percentage (0-100+, can exceed 100 on multi-core)
    memory: number   // bytes (RSS)
    pids: number[]   // all PIDs in this project's process group
    sampledAt: string
  }>
}
```

---

### GET /api/config/project-types

Returns the current project type registry.

**Response:**

```typescript
{
  projectTypes: Record<string, {
    name: string
    defaultCommand?: string
    detectManager?: boolean
    processNames?: string[]
  }>
}
```

---

### PUT /api/config/project-types

Replace the project type registry.

**Request body:**

```typescript
{
  projectTypes: Record<string, ProjectTypeEntry>
}
```

**Response:**

```typescript
// 200
{ updated: true }

// 400 — validation error (missing required fields, invalid structure)
{ error: string }
```

**Side effects:**
- Updates `config.projectTypes`
- Rebuilds listener scanner command filter on next poll tick

---

## Error Handling

All endpoints follow consistent error conventions:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request — invalid input, validation failure |
| 404 | Not found — project, group, or resource doesn't exist |
| 409 | Conflict — port conflict, PID verification failure |
| 500 | Internal error — unexpected failure |

Error response shape is always `{ error: string }` with an optional additional field for context (e.g., `conflictingProject`, `stalePid`).

## Authentication

None. This is a local-only application on localhost. No auth required.
