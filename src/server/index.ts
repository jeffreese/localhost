import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import api from './routes'

const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api', api)

export const port = 7770

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Localhost server running on http://localhost:${port}`)
  })
}

export default app
