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
  hasLogs: vi.fn(() => false),
}))

vi.mock('./log-store', () => ({
  readLines: vi.fn(async () => ({ lines: [], hasMore: false })),
}))

vi.mock('./scanner', () => ({
  scanAndPersist: async () => new Map(),
}))

vi.mock('./port-probe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./port-probe')>()
  return {
    ...actual,
    probePort: vi.fn().mockResolvedValue('http'),
  }
})

vi.mock('./sse', () => ({
  broadcast: vi.fn(),
  handleSSE: vi.fn(),
}))

const { mockGetAllStatuses } = vi.hoisted(() => {
  const mockGetAllStatuses = vi.fn().mockReturnValue({})
  return { mockGetAllStatuses }
})
vi.mock('./health-checker', () => ({
  HealthChecker: vi.fn().mockReturnValue({
    startChecking: vi.fn(),
    stopChecking: vi.fn(),
    stopAll: vi.fn(),
    isChecking: vi.fn().mockReturnValue(false),
    setOnChange: vi.fn(),
    getStatus: vi.fn().mockReturnValue(null),
    getAllStatuses: mockGetAllStatuses,
  }),
}))

const { default: app, healthChecker, poller } = await import('./index')
const { startProject } = await import('./process-manager')
const { clearPortTypeCache, setPortType } = await import('./port-probe')
const { broadcast } = await import('./sse')

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
    expect(body[0].healthStatus).toBeNull()
  })

  it('GET /api/projects includes healthStatus for running projects', async () => {
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
    mockListenerMap = {
      '/tmp/my-app': [{ pid: 1, port: 3000 }],
    }
    mockGetAllStatuses.mockReturnValue({})

    const { healthChecker } = await import('./index')
    vi.mocked(healthChecker.getStatus).mockReturnValue({
      status: 'healthy',
      consecutiveFailures: 0,
      lastCheck: Date.now(),
      responseTime: 15,
    })

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].healthStatus).toBe('healthy')
    expect(body[0].processState).toBe('running')

    vi.mocked(healthChecker.getStatus).mockReturnValue(null)
  })

  it('POST /api/scan returns results', async () => {
    resetConfig()
    const res = await app.request('/api/scan', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('GET /api/projects/:id/logs returns disk logs with pagination', async () => {
    resetConfig()
    const { readLines } = await import('./log-store')
    const mockReadLines = vi.mocked(readLines)
    mockReadLines.mockResolvedValueOnce({
      lines: [{ stream: 'stdout', ts: 1000, text: 'hello' }],
      hasMore: false,
    })

    const res = await app.request('/api/projects/my-app/logs?limit=100&offset=5')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lines).toHaveLength(1)
    expect(body.hasMore).toBe(false)
    expect(mockReadLines).toHaveBeenCalledWith('my-app', 100, 5)
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
        expect.any(Function),
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
        expect.any(Function),
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

  it('GET /api/projects includes portType from cache on listeners', async () => {
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
    mockListenerMap = {
      '/tmp/my-app': [
        { pid: 1, port: 3000 },
        { pid: 1, port: 5432 },
      ],
    }
    clearPortTypeCache()
    setPortType(3000, 'http')
    setPortType(5432, 'tcp')

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{
      listeners: Array<{ port: number; portType?: string }>
    }>
    const project = body[0]
    const httpListener = project.listeners.find((l) => l.port === 3000)
    const tcpListener = project.listeners.find((l) => l.port === 5432)
    expect(httpListener?.portType).toBe('http')
    expect(tcpListener?.portType).toBe('tcp')
  })

  it('GET /api/projects returns undefined portType when not cached', async () => {
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
    mockListenerMap = {
      '/tmp/my-app': [{ pid: 1, port: 8080 }],
    }
    clearPortTypeCache()

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{
      listeners: Array<{ port: number; portType?: string }>
    }>
    const project = body[0]
    expect(project.listeners[0].portType).toBeUndefined()
  })

  describe('GET /api/health', () => {
    it('returns empty statuses when no projects are being checked', async () => {
      mockGetAllStatuses.mockReturnValue({})
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ statuses: {} })
    })

    it('returns per-project health with ISO timestamps', async () => {
      mockGetAllStatuses.mockReturnValue({
        '/tmp/my-app': {
          status: 'healthy',
          consecutiveFailures: 0,
          lastCheck: 1696780000000,
          responseTime: 42,
        },
        '/tmp/other-app': {
          status: 'unhealthy',
          consecutiveFailures: 3,
          lastCheck: 1696780001000,
          responseTime: null,
        },
      })

      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.statuses['/tmp/my-app']).toEqual({
        status: 'healthy',
        lastCheck: new Date(1696780000000).toISOString(),
        responseTime: 42,
        consecutiveFailures: 0,
      })
      expect(body.statuses['/tmp/other-app']).toEqual({
        status: 'unhealthy',
        lastCheck: new Date(1696780001000).toISOString(),
        consecutiveFailures: 3,
      })
    })

    it('returns null lastCheck for projects that have not been probed yet', async () => {
      mockGetAllStatuses.mockReturnValue({
        '/tmp/new-app': {
          status: 'unknown',
          consecutiveFailures: 0,
          lastCheck: null,
          responseTime: null,
        },
      })

      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.statuses['/tmp/new-app']).toEqual({
        status: 'unknown',
        lastCheck: null,
        consecutiveFailures: 0,
      })
    })

    it('omits responseTime when null', async () => {
      mockGetAllStatuses.mockReturnValue({
        '/tmp/app': {
          status: 'unhealthy',
          consecutiveFailures: 5,
          lastCheck: 1696780000000,
          responseTime: null,
        },
      })

      const res = await app.request('/api/health')
      const body = await res.json()

      expect(body.statuses['/tmp/app']).not.toHaveProperty('responseTime')
    })
  })

  describe('GET /api/resources', () => {
    it('returns empty usage when no resources sampled', async () => {
      const res = await app.request('/api/resources')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ usage: {} })
    })

    it('returns populated resource usage from poller', async () => {
      const mockUsage = {
        '/tmp/my-app': {
          cpu: 12.5,
          memory: 52428800,
          pids: [100, 101],
          sampledAt: '2026-10-08T20:00:00.000Z',
        },
      }
      const spy = vi.spyOn(poller, 'getResourceUsage').mockReturnValue(mockUsage)

      const res = await app.request('/api/resources')
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.usage['/tmp/my-app']).toEqual({
        cpu: 12.5,
        memory: 52428800,
        pids: [100, 101],
        sampledAt: '2026-10-08T20:00:00.000Z',
      })

      spy.mockRestore()
    })
  })

  describe('healthCheckInterval override', () => {
    beforeEach(() => {
      resetConfig()
      vi.mocked(healthChecker.startChecking).mockClear()
      vi.mocked(healthChecker.stopChecking).mockClear()
      vi.mocked(healthChecker.isChecking).mockReturnValue(false)
    })

    it('PATCH /api/projects/:id persists healthCheckInterval to config', async () => {
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 10000 }),
      })
      expect(res.status).toBe(200)
      expect(mockConfig.overrides['/tmp/my-app']?.healthCheckInterval).toBe(10000)
    })

    it('PATCH healthCheckInterval=0 stops health checking and broadcasts cleared status', async () => {
      vi.mocked(healthChecker.isChecking).mockReturnValue(true)
      vi.mocked(broadcast).mockClear()
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 0 }),
      })
      expect(res.status).toBe(200)
      expect(healthChecker.stopChecking).toHaveBeenCalledWith('/tmp/my-app')
      expect(broadcast).toHaveBeenCalledWith({
        type: 'health-changed',
        data: { projectId: '/tmp/my-app', status: null, responseTime: null },
      })
    })

    it('PATCH healthCheckInterval restarts health checker with new interval', async () => {
      vi.mocked(healthChecker.isChecking).mockReturnValue(true)
      mockListenerMap = {
        '/tmp/my-app': [{ pid: 1, port: 3000 }],
      }
      setPortType(3000, 'http')

      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 15000 }),
      })
      expect(res.status).toBe(200)
      expect(healthChecker.startChecking).toHaveBeenCalledWith('/tmp/my-app', 3000, 15000)
    })

    it('PATCH healthCheckInterval does not restart if not currently checking', async () => {
      vi.mocked(healthChecker.isChecking).mockReturnValue(false)
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 15000 }),
      })
      expect(res.status).toBe(200)
      expect(healthChecker.startChecking).not.toHaveBeenCalled()
    })

    it('PATCH rejects negative healthCheckInterval', async () => {
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: -1 }),
      })
      expect(res.status).toBe(400)
    })

    it('PATCH rejects non-integer healthCheckInterval', async () => {
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 1.5 }),
      })
      expect(res.status).toBe(400)
    })

    it('PATCH healthCheckInterval unchanged does not trigger restart', async () => {
      resetConfig({
        overrides: { '/tmp/my-app': { healthCheckInterval: 5000 } },
      })
      vi.mocked(healthChecker.isChecking).mockReturnValue(true)

      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheckInterval: 5000 }),
      })
      expect(res.status).toBe(200)
      expect(healthChecker.startChecking).not.toHaveBeenCalled()
      expect(healthChecker.stopChecking).not.toHaveBeenCalled()
    })
  })

  describe('project groups', () => {
    beforeEach(() => {
      resetConfig()
      vi.mocked(broadcast).mockClear()
    })

    it('GET /api/groups returns empty group config', async () => {
      const res = await app.request('/api/groups')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ groups: [], assignments: {} })
    })

    it('POST /api/groups creates a group', async () => {
      const res = await app.request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Frontend' }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.name).toBe('Frontend')
      expect(body.collapsed).toBe(false)
      expect(body.id).toBeDefined()
      expect(mockConfig.groupConfig.groups).toHaveLength(1)
      expect(broadcast).toHaveBeenCalledWith({
        type: 'groups-changed',
        data: { groups: mockConfig.groupConfig },
      })
    })

    it('POST /api/groups rejects empty name', async () => {
      const res = await app.request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/groups rejects duplicate name', async () => {
      mockConfig.groupConfig.groups = [{ id: 'g1', name: 'Frontend', collapsed: false }]
      const res = await app.request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Frontend' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already exists')
    })

    it('PATCH /api/groups/:id updates group name and collapsed', async () => {
      mockConfig.groupConfig.groups = [{ id: 'g1', name: 'Frontend', collapsed: false }]
      const res = await app.request('/api/groups/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'UI', collapsed: true }),
      })
      expect(res.status).toBe(200)
      expect(mockConfig.groupConfig.groups[0].name).toBe('UI')
      expect(mockConfig.groupConfig.groups[0].collapsed).toBe(true)
      expect(broadcast).toHaveBeenCalledWith({
        type: 'groups-changed',
        data: { groups: mockConfig.groupConfig },
      })
    })

    it('PATCH /api/groups/:id returns 404 for unknown group', async () => {
      const res = await app.request('/api/groups/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      expect(res.status).toBe(404)
    })

    it('DELETE /api/groups/:id removes group and unassigns projects', async () => {
      mockConfig.groupConfig.groups = [{ id: 'g1', name: 'Frontend', collapsed: false }]
      mockConfig.groupConfig.assignments = {
        '/tmp/app-a': 'g1',
        '/tmp/app-b': 'g1',
        '/tmp/app-c': 'g2',
      }
      const res = await app.request('/api/groups/g1', { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.deleted).toBe(true)
      expect(body.unassignedCount).toBe(2)
      expect(mockConfig.groupConfig.groups).toHaveLength(0)
      expect(mockConfig.groupConfig.assignments['/tmp/app-a']).toBeUndefined()
      expect(mockConfig.groupConfig.assignments['/tmp/app-b']).toBeUndefined()
      expect(mockConfig.groupConfig.assignments['/tmp/app-c']).toBe('g2')
    })

    it('DELETE /api/groups/:id returns 404 for unknown group', async () => {
      const res = await app.request('/api/groups/nonexistent', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })

    it('PATCH /api/projects/:id assigns group', async () => {
      mockConfig.groupConfig.groups = [{ id: 'g1', name: 'Frontend', collapsed: false }]
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: 'g1' }),
      })
      expect(res.status).toBe(200)
      expect(mockConfig.groupConfig.assignments['/tmp/my-app']).toBe('g1')
      expect(broadcast).toHaveBeenCalledWith({
        type: 'groups-changed',
        data: { groups: mockConfig.groupConfig },
      })
    })

    it('PATCH /api/projects/:id unassigns group with null', async () => {
      mockConfig.groupConfig.assignments = { '/tmp/my-app': 'g1' }
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: null }),
      })
      expect(res.status).toBe(200)
      expect(mockConfig.groupConfig.assignments['/tmp/my-app']).toBeUndefined()
    })

    it('PATCH /api/projects/:id ignores assignment to nonexistent group', async () => {
      const res = await app.request('/api/projects/%2Ftmp%2Fmy-app', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: 'nonexistent' }),
      })
      expect(res.status).toBe(200)
      expect(mockConfig.groupConfig.assignments['/tmp/my-app']).toBeUndefined()
    })

    it('GET /api/projects includes group field from assignments', async () => {
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
        groupConfig: {
          groups: [{ id: 'g1', name: 'Frontend', collapsed: false }],
          assignments: { '/tmp/my-app': 'g1' },
        },
      })
      const res = await app.request('/api/projects')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body[0].group).toBe('g1')
    })

    it('GET /api/projects returns null group for unassigned project', async () => {
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
      expect(body[0].group).toBeNull()
    })
  })
})
