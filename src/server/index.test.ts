import { describe, expect, it } from 'vitest'
import app from './index'

describe('server', () => {
  it('responds to health check', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
