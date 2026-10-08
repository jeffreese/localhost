import type { Listener, LocalhostConfig, Project, ProjectCache, Visibility } from '@shared/types'
import { Hono } from 'hono'
import { readConfig, updateConfig } from './config-store'
import { readLines } from './log-store'
import { getPortType } from './port-probe'
import {
  type CrashEvent,
  detectAllListeners,
  hasLogs,
  startProject,
  stopListener,
  stopProject,
} from './process-manager'
import { scanAndPersist } from './scanner'
import { broadcast, handleSSE } from './sse'

function buildProjectResponse(
  id: string,
  cached: ProjectCache,
  listeners: Listener[],
  config: LocalhostConfig,
): Project {
  const visibility: Visibility = config.ignored.includes(id)
    ? 'ignored'
    : config.hidden.includes(id)
      ? 'hidden'
      : 'visible'
  const enrichedListeners = listeners.map((l) => ({
    ...l,
    portType: getPortType(l.port),
  }))
  return {
    id,
    ...cached,
    visibility,
    listeners: enrichedListeners,
    processState: listeners.length > 0 ? 'running' : 'stopped',
    spawnedByUs: hasLogs(id),
  }
}

const api = new Hono()

// GET /api/projects — list all projects with current state
api.get('/projects', async (c) => {
  const config = await readConfig()
  const listenerMap = await detectAllListeners()

  const projects = Object.entries(config.projects).map(([id, cached]) =>
    buildProjectResponse(id, cached, listenerMap[id] ?? [], config),
  )

  return c.json(projects)
})

// POST /api/scan — trigger a rescan
api.post('/scan', async (c) => {
  const projects = await scanAndPersist()
  const config = await readConfig()
  const listenerMap = await detectAllListeners()

  const result = Array.from(projects.entries()).map(([id, cached]) =>
    buildProjectResponse(id, cached, listenerMap[id] ?? [], config),
  )

  broadcast({ type: 'scan-complete', data: result })
  return c.json(result)
})

// GET /api/projects/:id/logs — read persisted logs from disk
api.get('/projects/:id/logs', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  const limit = Math.max(1, Math.min(Number(c.req.query('limit')) || 500, 5000))
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0)
  const result = await readLines(projectId, limit, offset)
  return c.json(result)
})

// POST /api/projects/:id/start — start a project's dev server
api.post('/projects/:id/start', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  const config = await readConfig()
  const cached = config.projects[projectId]

  if (!cached) {
    return c.json({ error: 'Project not found' }, 404)
  }

  if (!cached.devScript) {
    return c.json({ error: 'No dev script found for this project' }, 400)
  }

  const override = config.overrides[projectId]
  const devScript = override?.devScript ?? cached.devScript
  const portOverride = override?.port

  if (portOverride !== undefined) {
    const listenerMap = await detectAllListeners()
    for (const [ownerProjectId, listeners] of Object.entries(listenerMap)) {
      if (ownerProjectId === projectId) continue
      for (const listener of listeners) {
        if (listener.port === portOverride) {
          return c.json(
            {
              error: `Port ${portOverride} is already in use`,
              conflictingProject: ownerProjectId,
              port: portOverride,
            },
            409,
          )
        }
      }
    }
  }

  try {
    await startProject(
      projectId,
      cached.path,
      cached.packageManager,
      devScript,
      (id, port) => {
        broadcast({ type: 'port-detected', data: { projectId: id, port } })
      },
      (id, lines) => {
        broadcast({ type: 'log', data: { projectId: id, lines } })
      },
      portOverride,
      (event: CrashEvent) => {
        broadcast({ type: 'process-crashed', data: event })
      },
    )
    broadcast({ type: 'process-started', data: { projectId } })
    return c.json({ status: 'started', projectId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start'
    return c.json({ error: message }, 400)
  }
})

// POST /api/projects/:id/stop — stop all listeners for a project
api.post('/projects/:id/stop', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))

  // Kill all detected listeners for this project
  const listenerMap = await detectAllListeners()
  const listeners = listenerMap[projectId] ?? []
  await Promise.all(listeners.map((listener) => stopListener(listener.pid)))

  // Also stop any process we spawned
  await stopProject(projectId)
  broadcast({ type: 'process-stopped', data: { projectId } })
  return c.json({ status: 'stopped', projectId })
})

// POST /api/projects/:id/stop/:pid — stop a specific listener
api.post('/projects/:id/stop/:pid', async (c) => {
  const pid = Number.parseInt(c.req.param('pid'), 10)
  if (Number.isNaN(pid)) {
    return c.json({ error: 'Invalid PID' }, 400)
  }
  await stopListener(pid)
  const projectId = decodeURIComponent(c.req.param('id'))
  broadcast({ type: 'process-stopped', data: { projectId } })
  return c.json({ status: 'stopped', pid })
})

// PATCH /api/projects/:id — update visibility or config overrides
api.patch('/projects/:id', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  const body = await c.req.json<{
    visibility?: 'visible' | 'hidden' | 'ignored'
    port?: number
    devScript?: string
  }>()

  await updateConfig((config) => {
    if (body.visibility) {
      // Remove from both lists first
      config.hidden = config.hidden.filter((p) => p !== projectId)
      config.ignored = config.ignored.filter((p) => p !== projectId)

      if (body.visibility === 'hidden') {
        config.hidden.push(projectId)
      } else if (body.visibility === 'ignored') {
        config.ignored.push(projectId)
      }
    }

    if (body.port !== undefined || body.devScript !== undefined) {
      if (!config.overrides[projectId]) {
        config.overrides[projectId] = {}
      }
      if (body.port !== undefined) {
        config.overrides[projectId].port = body.port
      }
      if (body.devScript !== undefined) {
        config.overrides[projectId].devScript = body.devScript
      }
    }
  })

  broadcast({ type: 'project-updated', data: { projectId } })
  return c.json({ status: 'updated', projectId })
})

// GET /api/preferences — get UI preferences (sort, etc.)
api.get('/preferences', async (c) => {
  const config = await readConfig()
  return c.json({ sort: config.sort, customOrder: config.customOrder })
})

// PATCH /api/preferences — update UI preferences
api.patch('/preferences', async (c) => {
  const body = await c.req.json<{
    sort?: { field: string; order: string }
    customOrder?: string[]
  }>()

  await updateConfig((config) => {
    if (body.sort) {
      const { field, order } = body.sort
      if (
        (field === 'name' || field === 'status' || field === 'custom') &&
        (order === 'asc' || order === 'desc')
      ) {
        config.sort = { field, order }
      }
    }

    if (Array.isArray(body.customOrder)) {
      config.customOrder = body.customOrder
    }
  })

  const config = await readConfig()
  broadcast({
    type: 'preferences-updated',
    data: { sort: config.sort, customOrder: config.customOrder },
  })
  return c.json({ status: 'updated' })
})

// GET /api/events — SSE stream
api.get('/events', handleSSE)

export default api
