import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { BackgroundPoller, broadcastDiff } from './background-poller'
import { readConfig } from './config-store'
import { HealthChecker } from './health-checker'
import { closeAll as closeAllLogs } from './log-store'
import { getPortType } from './port-probe'
import { cleanupStalePids } from './process-manager'
import { createApi } from './routes'
import { broadcast } from './sse'

const app = new Hono()

export const port = 7769

const poller = new BackgroundPoller()
const healthChecker = new HealthChecker()
app.route('/api', createApi(healthChecker, poller))

healthChecker.setOnChange((projectId, status, responseTime) => {
  broadcast({ type: 'health-changed', data: { projectId, status, responseTime } })
})

poller.setOnResourceUpdate((resources) => {
  for (const [projectId, usage] of Object.entries(resources)) {
    broadcast({
      type: 'resource-update',
      data: { projectId, cpu: usage.cpu, memory: usage.memory },
    })
  }
})

poller.setOnDiff(async (diff, currentListeners) => {
  broadcastDiff(diff, broadcast)

  const config = await readConfig()

  for (const projectId of diff.started) {
    const interval = config.overrides[projectId]?.healthCheckInterval
    if (interval === 0) continue
    const listeners = currentListeners[projectId]
    if (listeners) {
      const httpPort = listeners.find((l) => getPortType(l.port) === 'http')?.port
      if (httpPort) {
        healthChecker.startChecking(projectId, httpPort, interval)
      }
    }
  }

  for (const { projectId } of diff.portsRemoved) {
    if (healthChecker.isChecking(projectId)) {
      healthChecker.stopChecking(projectId)
    }
  }

  for (const { projectId, port: addedPort } of diff.portsAdded) {
    const interval = config.overrides[projectId]?.healthCheckInterval
    if (interval === 0) continue
    if (getPortType(addedPort) === 'http' && !healthChecker.isChecking(projectId)) {
      healthChecker.startChecking(projectId, addedPort, interval)
    }
  }

  for (const projectId of [...diff.stopped, ...diff.crashed]) {
    healthChecker.stopChecking(projectId)
  }
})

let shuttingDown = false

async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true

  poller.stop()
  healthChecker.stopAll()
  await closeAllLogs()

  process.exit(0)
}

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Localhost server running on http://localhost:${port}`)
    cleanupStalePids()
      .then((removed) => {
        if (removed > 0) console.log(`Cleaned up ${removed} stale PID(s)`)
      })
      .catch((err) => console.error('Startup PID cleanup failed:', err))
    poller.start()
  })

  process.on('SIGTERM', gracefulShutdown)
  process.on('SIGINT', gracefulShutdown)
}

/** Test-only: reset the shutdown guard flag. */
export function __resetShutdownState() {
  shuttingDown = false
}

export { gracefulShutdown, healthChecker, poller }

export default app
