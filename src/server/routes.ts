import { Hono } from 'hono'
import { readConfig, updateConfig } from './config-store'
import { getDetectedPort, reconcileAll, startProject, stopProject } from './process-manager'
import { scanAndPersist } from './scanner'
import { broadcast, handleSSE } from './sse'

const api = new Hono()

// GET /api/projects — list all projects with current state
api.get('/projects', (c) => {
  const config = readConfig()
  const states = reconcileAll()

  const projects = Object.entries(config.projects).map(([id, cached]) => ({
    id,
    ...cached,
    visibility: config.ignored.includes(id)
      ? 'ignored'
      : config.hidden.includes(id)
        ? 'hidden'
        : 'visible',
    processState: states[id] ?? 'stopped',
    pid: config.pids[id] ?? null,
    port: config.overrides[id]?.port ?? getDetectedPort(id),
  }))

  return c.json(projects)
})

// POST /api/scan — trigger a rescan
api.post('/scan', (c) => {
  const projects = scanAndPersist()
  const config = readConfig()
  const states = reconcileAll()

  const result = Array.from(projects.entries()).map(([id, cached]) => ({
    id,
    ...cached,
    visibility: config.ignored.includes(id)
      ? 'ignored'
      : config.hidden.includes(id)
        ? 'hidden'
        : 'visible',
    processState: states[id] ?? 'stopped',
    pid: config.pids[id] ?? null,
    port: config.overrides[id]?.port ?? getDetectedPort(id),
  }))

  broadcast({ type: 'scan-complete', data: result })
  return c.json(result)
})

// POST /api/projects/:id/start — start a project's dev server
api.post('/projects/:id/start', (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  const config = readConfig()
  const cached = config.projects[projectId]

  if (!cached) {
    return c.json({ error: 'Project not found' }, 404)
  }

  if (!cached.devScript) {
    return c.json({ error: 'No dev script found for this project' }, 400)
  }

  const override = config.overrides[projectId]
  const devScript = override?.devScript ?? cached.devScript

  try {
    startProject(projectId, cached.path, cached.packageManager, devScript, (id, port) => {
      broadcast({ type: 'port-detected', data: { projectId: id, port } })
    })
    broadcast({ type: 'process-started', data: { projectId } })
    return c.json({ status: 'started', projectId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start'
    return c.json({ error: message }, 400)
  }
})

// POST /api/projects/:id/stop — stop a project's dev server
api.post('/projects/:id/stop', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  await stopProject(projectId)
  broadcast({ type: 'process-stopped', data: { projectId } })
  return c.json({ status: 'stopped', projectId })
})

// PATCH /api/projects/:id — update visibility or config overrides
api.patch('/projects/:id', async (c) => {
  const projectId = decodeURIComponent(c.req.param('id'))
  const body = await c.req.json<{
    visibility?: 'visible' | 'hidden' | 'ignored'
    port?: number
    devScript?: string
  }>()

  updateConfig((config) => {
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

// GET /api/events — SSE stream
api.get('/events', handleSSE)

export default api
