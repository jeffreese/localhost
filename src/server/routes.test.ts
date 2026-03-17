import type { LocalhostConfig } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

let mockConfig: LocalhostConfig = {
  scanRoot: '/tmp/Code',
  projects: {},
  pids: {},
  overrides: {},
  hidden: [],
  ignored: [],
}

vi.mock('./config-store', () => ({
  readConfig: () => mockConfig,
  writeConfig: vi.fn(),
  updateConfig: vi.fn((fn: (c: LocalhostConfig) => void) => {
    fn(mockConfig)
    return mockConfig
  }),
}))

vi.mock('./process-manager', () => ({
  reconcileAll: () => ({}),
  startProject: vi.fn(),
  stopProject: vi.fn(() => Promise.resolve()),
}))

vi.mock('./scanner', () => ({
  scanAndPersist: () => new Map(),
}))

vi.mock('./sse', () => ({
  broadcast: vi.fn(),
  handleSSE: vi.fn(),
}))

const { default: app } = await import('./index')

function resetConfig(overrides: Partial<LocalhostConfig> = {}) {
  mockConfig = {
    scanRoot: '/tmp/Code',
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
    ...overrides,
  }
}

describe('routes', () => {
  it('GET /api/projects returns empty list', async () => {
    resetConfig()
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('GET /api/projects returns projects with state', async () => {
    resetConfig({
      projects: {
        '/tmp/my-app': {
          name: 'my-app',
          path: '/tmp/my-app',
          packageManager: 'pnpm',
          devScript: 'dev',
          githubUrl: null,
        },
      },
    })
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('my-app')
    expect(body[0].visibility).toBe('visible')
  })

  it('POST /api/scan returns results', async () => {
    resetConfig()
    const res = await app.request('/api/scan', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('POST /api/projects/:id/start returns 404 for unknown project', async () => {
    resetConfig()
    const res = await app.request('/api/projects/unknown/start', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST /api/projects/:id/stop returns success', async () => {
    resetConfig()
    const res = await app.request('/api/projects/some-project/stop', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('PATCH /api/projects/:id updates visibility', async () => {
    resetConfig({
      projects: {
        '/tmp/my-app': {
          name: 'my-app',
          path: '/tmp/my-app',
          packageManager: 'npm',
          devScript: 'dev',
          githubUrl: null,
        },
      },
    })
    const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'hidden' }),
    })
    expect(res.status).toBe(200)
    expect(mockConfig.hidden).toContain('/tmp/my-app')
  })
})
