import type { LocalhostConfig } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockConfig: LocalhostConfig = {
  scanRoot: '/tmp/Code',
  projectTypes: {
    'package.json': { name: 'node', detectManager: true, processNames: ['node', 'bun', 'deno'] },
    'Cargo.toml': { name: 'rust', defaultCommand: 'cargo run', processNames: ['cargo'] },
  },
  projects: {},
  pids: {},
  overrides: {},
  hidden: [],
  ignored: [],
  sort: { field: 'name', order: 'asc' },
  customOrder: [],
  groupConfig: { groups: [], assignments: {} },
  crashes: {},
}

vi.mock('./config-store', () => ({
  readConfig: async () => mockConfig,
  writeConfig: vi.fn(async () => {}),
  updateConfig: vi.fn(async (fn: (c: LocalhostConfig) => void) => {
    fn(mockConfig)
    return mockConfig
  }),
}))

let mockListenerMap: Record<string, { pid: number; port: number }[]> = {}

vi.mock('./process-manager', () => ({
  detectAllListeners: vi.fn(async () => mockListenerMap),
  startProject: vi.fn(async () => ({})),
  stopProject: vi.fn(async () => {}),
  stopListener: vi.fn(async () => {}),
  getLogs: vi.fn(() => []),
  hasLogs: vi.fn(() => false),
}))

vi.mock('./scanner', () => ({
  scanAndPersist: async () => new Map(),
}))

vi.mock('./sse', () => ({
  broadcast: vi.fn(),
  handleSSE: vi.fn(),
}))

const { default: app } = await import('./index')
const { startProject } = await import('./process-manager')

function resetConfig(overrides: Partial<LocalhostConfig> = {}) {
  mockListenerMap = {}
  mockConfig = {
    scanRoot: '/tmp/Code',
    projectTypes: {
      'package.json': { name: 'node', detectManager: true, processNames: ['node', 'bun', 'deno'] },
      'Cargo.toml': { name: 'rust', defaultCommand: 'cargo run', processNames: ['cargo'] },
    },
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
    sort: { field: 'name', order: 'asc' },
    customOrder: [],
    groupConfig: { groups: [], assignments: {} },
    crashes: {},
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

  it('GET /api/projects returns projects with listeners and state', async () => {
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
    expect(body[0].listeners).toEqual([])
    expect(body[0].processState).toBe('stopped')
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

  describe('port override', () => {
    const projectConfig = {
      projects: {
        '/tmp/my-app': {
          name: 'my-app',
          path: '/tmp/my-app',
          packageManager: 'pnpm' as const,
          devScript: 'dev',
          githubUrl: null,
        },
      },
    }

    beforeEach(() => {
      resetConfig(projectConfig)
      vi.mocked(startProject).mockClear()
    })

    it('passes portOverride to startProject when config has port override', async () => {
      resetConfig({
        ...projectConfig,
        overrides: { '/tmp/my-app': { port: 4000 } },
      })
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app/start', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(startProject).toHaveBeenCalledWith(
        '/tmp/my-app',
        '/tmp/my-app',
        'pnpm',
        'dev',
        expect.any(Function),
        expect.any(Function),
        4000,
      )
    })

    it('passes undefined portOverride when no override configured', async () => {
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app/start', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(startProject).toHaveBeenCalledWith(
        '/tmp/my-app',
        '/tmp/my-app',
        'pnpm',
        'dev',
        expect.any(Function),
        expect.any(Function),
        undefined,
      )
    })

    it('returns 409 when override port is occupied by another project', async () => {
      resetConfig({
        ...projectConfig,
        overrides: { '/tmp/my-app': { port: 3000 } },
      })
      mockListenerMap = {
        '/tmp/other-app': [{ pid: 999, port: 3000 }],
      }
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app/start', { method: 'POST' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body).toEqual({
        error: 'Port 3000 is already in use',
        conflictingProject: '/tmp/other-app',
        port: 3000,
      })
      expect(startProject).not.toHaveBeenCalled()
    })

    it('skips self-conflict when project already listens on its override port', async () => {
      resetConfig({
        ...projectConfig,
        overrides: { '/tmp/my-app': { port: 3000 } },
      })
      mockListenerMap = {
        '/tmp/my-app': [{ pid: 111, port: 3000 }],
      }
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app/start', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(startProject).toHaveBeenCalled()
    })

    it('proceeds when override port is free', async () => {
      resetConfig({
        ...projectConfig,
        overrides: { '/tmp/my-app': { port: 5000 } },
      })
      mockListenerMap = {
        '/tmp/other-app': [{ pid: 999, port: 3000 }],
      }
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app/start', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(startProject).toHaveBeenCalled()
    })
  })
})
