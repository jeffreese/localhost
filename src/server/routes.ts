import type {
  GroupConfig,
  Listener,
  LocalhostConfig,
  Project,
  ProjectCache,
  ResourceUsage,
  Visibility,
} from '@shared/types'
import { Hono } from 'hono'
import { readConfig, updateConfig } from './config-store'
import type { HealthChecker } from './health-checker'
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

export interface ResourceGetter {
  getResourceUsage(): Record<string, ResourceUsage>
}

export function createApi(healthChecker: HealthChecker, resourceGetter?: ResourceGetter) {
  function buildProjectResponse(
    id: string,
    cached: ProjectCache,
    listeners: Listener[],
    config: LocalhostConfig,
    resourceMap: Record<string, ResourceUsage>,
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
    const isRunning = listeners.length > 0
    return {
      id,
      ...cached,
      visibility,
      listeners: enrichedListeners,
      processState: isRunning ? 'running' : 'stopped',
      spawnedByUs: hasLogs(id),
      crashInfo: config.crashes[id] ?? null,
      healthStatus: isRunning ? (healthChecker.getStatus(id)?.status ?? null) : null,
      resourceUsage: isRunning ? (resourceMap[id] ?? null) : null,
      group: config.groupConfig.assignments[id] ?? null,
    }
  }
  const api = new Hono()

  // GET /api/health — per-project health status summary
  api.get('/health', (c) => {
    const all = healthChecker.getAllStatuses()
    const statuses: Record<
      string,
      {
        status: string
        lastCheck: string | null
        responseTime?: number
        consecutiveFailures: number
      }
    > = {}
    for (const [id, state] of Object.entries(all)) {
      statuses[id] = {
        status: state.status,
        lastCheck: state.lastCheck ? new Date(state.lastCheck).toISOString() : null,
        consecutiveFailures: state.consecutiveFailures,
        ...(state.responseTime !== null ? { responseTime: state.responseTime } : {}),
      }
    }
    return c.json({ statuses })
  })

  // GET /api/resources — resource usage for all running projects
  api.get('/resources', (c) => {
    const usage = resourceGetter?.getResourceUsage() ?? {}
    return c.json({ usage })
  })

  // GET /api/projects — list all projects with current state
  api.get('/projects', async (c) => {
    const config = await readConfig()
    const listenerMap = await detectAllListeners()
    const resourceMap = resourceGetter?.getResourceUsage() ?? {}

    const projects = Object.entries(config.projects).map(([id, cached]) =>
      buildProjectResponse(id, cached, listenerMap[id] ?? [], config, resourceMap),
    )

    return c.json(projects)
  })

  // POST /api/scan — trigger a rescan
  api.post('/scan', async (c) => {
    const projects = await scanAndPersist()
    const config = await readConfig()
    const listenerMap = await detectAllListeners()
    const resourceMap = resourceGetter?.getResourceUsage() ?? {}

    const result = Array.from(projects.entries()).map(([id, cached]) =>
      buildProjectResponse(id, cached, listenerMap[id] ?? [], config, resourceMap),
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
      healthCheckInterval?: number
      group?: string | null
    }>()

    if (body.healthCheckInterval !== undefined) {
      if (
        typeof body.healthCheckInterval !== 'number' ||
        !Number.isInteger(body.healthCheckInterval) ||
        body.healthCheckInterval < 0
      ) {
        return c.json({ error: 'healthCheckInterval must be a non-negative integer (ms)' }, 400)
      }
    }

    let healthCheckIntervalChanged = false
    let newInterval: number | undefined
    let groupChanged = false

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

      if (body.group !== undefined) {
        if (body.group === null) {
          delete config.groupConfig.assignments[projectId]
        } else {
          const groupExists = config.groupConfig.groups.some((g) => g.id === body.group)
          if (groupExists) {
            config.groupConfig.assignments[projectId] = body.group
          }
        }
        groupChanged = true
      }

      if (
        body.port !== undefined ||
        body.devScript !== undefined ||
        body.healthCheckInterval !== undefined
      ) {
        if (!config.overrides[projectId]) {
          config.overrides[projectId] = {}
        }
        if (body.port !== undefined) {
          config.overrides[projectId].port = body.port
        }
        if (body.devScript !== undefined) {
          config.overrides[projectId].devScript = body.devScript
        }
        if (body.healthCheckInterval !== undefined) {
          const prev = config.overrides[projectId].healthCheckInterval
          config.overrides[projectId].healthCheckInterval = body.healthCheckInterval
          if (prev !== body.healthCheckInterval) {
            healthCheckIntervalChanged = true
            newInterval = body.healthCheckInterval
          }
        }
      }
    })

    if (healthCheckIntervalChanged) {
      if (newInterval === 0) {
        healthChecker.stopChecking(projectId)
        broadcast({
          type: 'health-changed',
          data: { projectId, status: null, responseTime: null },
        })
      } else if (healthChecker.isChecking(projectId)) {
        const listenerMap = await detectAllListeners()
        const listeners = listenerMap[projectId]
        if (listeners) {
          const httpPort = listeners.find((l) => getPortType(l.port) === 'http')?.port
          if (httpPort) {
            healthChecker.startChecking(projectId, httpPort, newInterval)
          }
        }
      }
    }

    if (groupChanged) {
      const config = await readConfig()
      broadcast({ type: 'groups-changed', data: { groups: config.groupConfig } })
    }

    broadcast({ type: 'project-updated', data: { projectId } })
    return c.json({ status: 'updated', projectId })
  })

  // POST /api/groups — create a project group
  api.post('/groups', async (c) => {
    const body = await c.req.json<{ name: string }>()

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'Group name is required' }, 400)
    }

    const name = body.name.trim()
    let created: GroupConfig['groups'][number] | null = null

    await updateConfig((config) => {
      if (config.groupConfig.groups.some((g) => g.name === name)) {
        created = null
        return
      }
      const id = crypto.randomUUID()
      const group = { id, name, collapsed: false }
      config.groupConfig.groups.push(group)
      created = group
    })

    if (!created) {
      return c.json({ error: 'A group with that name already exists' }, 400)
    }

    const config = await readConfig()
    broadcast({ type: 'groups-changed', data: { groups: config.groupConfig } })
    return c.json(created, 201)
  })

  // PATCH /api/groups/:id — update a group
  api.patch('/groups/:id', async (c) => {
    const groupId = c.req.param('id')
    const body = await c.req.json<{ name?: string; collapsed?: boolean }>()

    let found = false
    let duplicateName = false

    await updateConfig((config) => {
      const group = config.groupConfig.groups.find((g) => g.id === groupId)
      if (!group) return

      found = true
      if (body.name !== undefined && typeof body.name === 'string' && body.name.trim()) {
        const trimmed = body.name.trim()
        if (config.groupConfig.groups.some((g) => g.id !== groupId && g.name === trimmed)) {
          duplicateName = true
          return
        }
        group.name = trimmed
      }
      if (body.collapsed !== undefined && typeof body.collapsed === 'boolean') {
        group.collapsed = body.collapsed
      }
    })

    if (!found) {
      return c.json({ error: 'Group not found' }, 404)
    }
    if (duplicateName) {
      return c.json({ error: 'A group with that name already exists' }, 400)
    }

    const config = await readConfig()
    broadcast({ type: 'groups-changed', data: { groups: config.groupConfig } })
    return c.json({ updated: true })
  })

  // DELETE /api/groups/:id — delete a group
  api.delete('/groups/:id', async (c) => {
    const groupId = c.req.param('id')

    let found = false
    let unassignedCount = 0

    await updateConfig((config) => {
      const idx = config.groupConfig.groups.findIndex((g) => g.id === groupId)
      if (idx === -1) return

      found = true
      config.groupConfig.groups.splice(idx, 1)

      for (const [projectId, assignedGroupId] of Object.entries(config.groupConfig.assignments)) {
        if (assignedGroupId === groupId) {
          delete config.groupConfig.assignments[projectId]
          unassignedCount++
        }
      }
    })

    if (!found) {
      return c.json({ error: 'Group not found' }, 404)
    }

    const config = await readConfig()
    broadcast({ type: 'groups-changed', data: { groups: config.groupConfig } })
    return c.json({ deleted: true, unassignedCount })
  })

  // GET /api/groups — list all groups with their config
  api.get('/groups', async (c) => {
    const config = await readConfig()
    return c.json(config.groupConfig)
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

  return api
}
