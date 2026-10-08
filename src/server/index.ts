import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { BackgroundPoller, broadcastDiff } from './background-poller'
import { closeAll as closeAllLogs } from './log-store'
import { cleanupStalePids, getActiveProcesses } from './process-manager'
import api from './routes'
import { broadcast } from './sse'

const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api', api)

export const port = 7769

const poller = new BackgroundPoller()
poller.setOnDiff((diff) => {
  broadcastDiff(diff, broadcast)
})

function killAllProcessGroups(signal: NodeJS.Signals) {
  for (const child of getActiveProcesses().values()) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal)
      } catch {
        // Process group already dead
      }
    }
  }
}

let shuttingDown = false

async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true

  poller.stop()
  await closeAllLogs()
  killAllProcessGroups('SIGTERM')

  await new Promise((resolve) => setTimeout(resolve, 3000))

  killAllProcessGroups('SIGKILL')

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
  process.on('exit', () => {
    killAllProcessGroups('SIGKILL')
  })
}

/** Test-only: reset the shutdown guard flag. */
export function __resetShutdownState() {
  shuttingDown = false
}

export { gracefulShutdown, killAllProcessGroups, poller }

export default app
