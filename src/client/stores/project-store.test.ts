import type { Project } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type SSEHandler = (data: unknown) => void
const sseHandlers = new Map<string, Set<SSEHandler>>()

function dispatchSSE(event: string, data: unknown) {
  const set = sseHandlers.get(event)
  if (!set) return
  for (const handler of set) handler(data)
}

vi.mock('../sse-client', () => ({
  on: (event: string, handler: SSEHandler) => {
    if (!sseHandlers.has(event)) sseHandlers.set(event, new Set())
    sseHandlers.get(event)?.add(handler)
  },
  off: (event: string, handler: SSEHandler) => {
    sseHandlers.get(event)?.delete(handler)
  },
}))

const { ProjectStore } = await import('./project-store')

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'test-project',
    name: 'Test Project',
    path: '/tmp/test-project',
    packageManager: 'npm',
    devScript: 'dev',
    githubUrl: null,
    visibility: 'visible',
    listeners: [],
    processState: 'stopped',
    spawnedByUs: false,
    crashInfo: null,
    healthStatus: null,
    resourceUsage: null,
    ...overrides,
  }
}

function createNotificationMock(permission: NotificationPermission) {
  const ctor = vi.fn()
  const requestPermission = vi.fn().mockResolvedValue('granted')
  Object.defineProperty(ctor, 'permission', {
    get: () => permission,
    configurable: true,
  })
  Object.defineProperty(ctor, 'requestPermission', {
    value: requestPermission,
    configurable: true,
  })
  return { ctor, requestPermission }
}

describe('ProjectStore crash notifications', () => {
  let mock: ReturnType<typeof createNotificationMock>

  beforeEach(() => {
    sseHandlers.clear()
    mock = createNotificationMock('granted')
    vi.stubGlobal('Notification', mock.ctor)
  })

  it('fires a desktop notification on crash with project name and exit info', () => {
    ProjectStore.init()
    dispatchSSE('scan-complete', [
      makeProject({ id: 'my-app', name: 'My App', processState: 'running' }),
    ])

    dispatchSSE('process-crashed', {
      projectId: 'my-app',
      exitCode: 1,
      signal: 'SIGTERM',
      timestamp: new Date().toISOString(),
    })

    expect(mock.ctor).toHaveBeenCalledWith('My App crashed', {
      body: 'exit 1 · SIGTERM',
      tag: 'crash-my-app',
    })
    ProjectStore.destroy()
  })

  it('does not fire notification when permission is not granted', () => {
    mock = createNotificationMock('denied')
    vi.stubGlobal('Notification', mock.ctor)
    ProjectStore.init()
    dispatchSSE('scan-complete', [makeProject({ id: 'my-app', processState: 'running' })])

    dispatchSSE('process-crashed', {
      projectId: 'my-app',
      exitCode: 1,
      signal: null,
      timestamp: new Date().toISOString(),
    })

    expect(mock.ctor).not.toHaveBeenCalled()
    ProjectStore.destroy()
  })

  it('falls back to projectId when project not in store', () => {
    ProjectStore.init()

    dispatchSSE('process-crashed', {
      projectId: 'unknown-project',
      exitCode: null,
      signal: 'SIGKILL',
      timestamp: new Date().toISOString(),
    })

    expect(mock.ctor).toHaveBeenCalledWith('unknown-project crashed', {
      body: 'SIGKILL',
      tag: 'crash-unknown-project',
    })
    ProjectStore.destroy()
  })

  it('shows fallback body when both exitCode and signal are null', () => {
    ProjectStore.init()
    dispatchSSE('scan-complete', [
      makeProject({ id: 'my-app', name: 'My App', processState: 'running' }),
    ])

    dispatchSSE('process-crashed', {
      projectId: 'my-app',
      exitCode: null,
      signal: null,
      timestamp: new Date().toISOString(),
    })

    expect(mock.ctor).toHaveBeenCalledWith('My App crashed', {
      body: 'Process exited unexpectedly',
      tag: 'crash-my-app',
    })
    ProjectStore.destroy()
  })

  it('requests permission on init when permission is default', () => {
    mock = createNotificationMock('default')
    vi.stubGlobal('Notification', mock.ctor)
    ProjectStore.init()

    expect(mock.requestPermission).toHaveBeenCalled()
    ProjectStore.destroy()
  })

  it('does not request permission on init when already granted', () => {
    ProjectStore.init()

    expect(mock.requestPermission).not.toHaveBeenCalled()
    ProjectStore.destroy()
  })
})

describe('ProjectStore health status', () => {
  beforeEach(() => {
    sseHandlers.clear()
  })

  it('updates healthStatus on health-changed SSE event', () => {
    ProjectStore.init()
    ProjectStore.setProjects([makeProject({ id: 'app', processState: 'running' })])

    dispatchSSE('health-changed', { projectId: 'app', status: 'healthy' })

    const updated = ProjectStore.getAll()
    expect(updated[0].healthStatus).toBe('healthy')
    ProjectStore.destroy()
  })

  it('transitions from healthy to unhealthy', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app', processState: 'running', healthStatus: 'healthy' }),
    ])

    dispatchSSE('health-changed', { projectId: 'app', status: 'unhealthy' })

    expect(ProjectStore.getAll()[0].healthStatus).toBe('unhealthy')
    ProjectStore.destroy()
  })

  it('clears healthStatus on health-changed with null status', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app', processState: 'running', healthStatus: 'healthy' }),
    ])

    dispatchSSE('health-changed', { projectId: 'app', status: null })

    expect(ProjectStore.getAll()[0].healthStatus).toBeNull()
    ProjectStore.destroy()
  })

  it('clears healthStatus on process-stopped', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app', processState: 'running', healthStatus: 'healthy' }),
    ])

    dispatchSSE('process-stopped', { projectId: 'app' })

    const stopped = ProjectStore.getAll()[0]
    expect(stopped.healthStatus).toBeNull()
    expect(stopped.processState).toBe('stopped')
    ProjectStore.destroy()
  })

  it('clears healthStatus on process-crashed', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app', processState: 'running', healthStatus: 'healthy' }),
    ])

    dispatchSSE('process-crashed', {
      projectId: 'app',
      exitCode: 1,
      signal: null,
      timestamp: new Date().toISOString(),
    })

    const crashed = ProjectStore.getAll()[0]
    expect(crashed.healthStatus).toBeNull()
    expect(crashed.processState).toBe('stopped')
    ProjectStore.destroy()
  })

  it('clears healthStatus on process-started', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app', processState: 'stopped', healthStatus: 'healthy' }),
    ])

    dispatchSSE('process-started', { projectId: 'app' })

    const started = ProjectStore.getAll()[0]
    expect(started.healthStatus).toBeNull()
    expect(started.processState).toBe('running')
    ProjectStore.destroy()
  })

  it('does not affect other projects on health-changed', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app1', processState: 'running' }),
      makeProject({ id: 'app2', processState: 'running', healthStatus: 'healthy' }),
    ])

    dispatchSSE('health-changed', { projectId: 'app1', status: 'unhealthy' })

    const projects = ProjectStore.getAll()
    expect(projects[0].healthStatus).toBe('unhealthy')
    expect(projects[1].healthStatus).toBe('healthy')
    ProjectStore.destroy()
  })

  it('updates resourceUsage on resource-update event', () => {
    ProjectStore.init()
    ProjectStore.setProjects([makeProject({ id: 'app1', processState: 'running' })])

    dispatchSSE('resource-update', { projectId: 'app1', cpu: 12.5, memory: 51200 * 1024 })

    const projects = ProjectStore.getAll()
    expect(projects[0].resourceUsage).not.toBeNull()
    expect(projects[0].resourceUsage?.cpu).toBe(12.5)
    expect(projects[0].resourceUsage?.memory).toBe(51200 * 1024)
    ProjectStore.destroy()
  })

  it('clears resourceUsage on process-stopped', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({
        id: 'app1',
        processState: 'running',
        resourceUsage: { cpu: 5, memory: 1024, pids: [100], sampledAt: new Date().toISOString() },
      }),
    ])

    dispatchSSE('process-stopped', { projectId: 'app1' })

    expect(ProjectStore.getAll()[0].resourceUsage).toBeNull()
    ProjectStore.destroy()
  })

  it('clears resourceUsage on process-crashed', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({
        id: 'app1',
        processState: 'running',
        resourceUsage: { cpu: 5, memory: 1024, pids: [100], sampledAt: new Date().toISOString() },
      }),
    ])

    dispatchSSE('process-crashed', {
      projectId: 'app1',
      exitCode: 1,
      signal: null,
      timestamp: new Date().toISOString(),
    })

    expect(ProjectStore.getAll()[0].resourceUsage).toBeNull()
    ProjectStore.destroy()
  })

  it('clears resourceUsage on process-started', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({
        id: 'app1',
        processState: 'stopped',
        resourceUsage: { cpu: 5, memory: 1024, pids: [100], sampledAt: new Date().toISOString() },
      }),
    ])

    dispatchSSE('process-started', { projectId: 'app1' })

    expect(ProjectStore.getAll()[0].resourceUsage).toBeNull()
    ProjectStore.destroy()
  })

  it('does not affect other projects on resource-update', () => {
    ProjectStore.init()
    ProjectStore.setProjects([
      makeProject({ id: 'app1', processState: 'running' }),
      makeProject({
        id: 'app2',
        processState: 'running',
        resourceUsage: { cpu: 3, memory: 512, pids: [200], sampledAt: new Date().toISOString() },
      }),
    ])

    dispatchSSE('resource-update', { projectId: 'app1', cpu: 10, memory: 2048 })

    const projects = ProjectStore.getAll()
    expect(projects[0].resourceUsage?.cpu).toBe(10)
    expect(projects[1].resourceUsage?.cpu).toBe(3)
    ProjectStore.destroy()
  })
})
