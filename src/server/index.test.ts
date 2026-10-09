import { EventEmitter } from 'node:events'
import type { LocalhostConfig } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from './index'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid: number | undefined = 12345
  kill = vi.fn()
}

const mockActiveProcesses = new Map<string, FakeChild>()

const { mockExecFileRef } = vi.hoisted(() => {
  const mockExecFileRef: {
    current: (
      cmd: string,
      args: string[],
      opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => void
  } = {
    current: (_cmd, _args, _opts, cb) => cb(null, '', ''),
  }
  return { mockExecFileRef }
})
vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      cmd: string,
      args: string[],
      opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => mockExecFileRef.current(cmd, args, opts, cb),
  ),
  spawn: vi.fn(),
}))

vi.mock('./log-store', () => ({
  closeAll: vi.fn().mockResolvedValue(undefined),
}))

const { mockConfigRef } = vi.hoisted(() => {
  const mockConfigRef: { current: LocalhostConfig } = {
    current: {
      scanRoot: '/tmp/Code',
      projectTypes: {},
      projects: {},
      pids: {},
      overrides: {},
      hidden: [],
      ignored: [],
      sort: { field: 'name', order: 'asc' },
      customOrder: [],
      groupConfig: { groups: [], assignments: {} },
      crashes: {},
    },
  }
  return { mockConfigRef }
})
vi.mock('./config-store', () => ({
  readConfig: vi.fn(async () => structuredClone(mockConfigRef.current)),
  updateConfig: vi.fn(),
}))

vi.mock('./process-manager', () => ({
  getActiveProcesses: () => mockActiveProcesses,
  detectAllListeners: vi.fn().mockResolvedValue({}),
  isStopping: vi.fn().mockReturnValue(false),
  clearStopping: vi.fn(),
  cleanupStalePids: vi.fn().mockResolvedValue(0),
}))

const mockPortTypeCache = new Map<number, string>()
vi.mock('./port-probe', () => ({
  probePort: vi.fn().mockResolvedValue('http'),
  getPortType: vi.fn((port: number) => mockPortTypeCache.get(port)),
  setPortType: vi.fn((port: number, type: string) => mockPortTypeCache.set(port, type)),
  deletePortType: vi.fn((port: number) => mockPortTypeCache.delete(port)),
  clearPortTypeCache: vi.fn(() => mockPortTypeCache.clear()),
}))

vi.mock('./sse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sse')>()
  return {
    ...actual,
    broadcast: vi.fn(),
  }
})

const { capturedOnChangeRef } = vi.hoisted(() => {
  const capturedOnChangeRef: { current: ((...args: unknown[]) => void) | null } = { current: null }
  return { capturedOnChangeRef }
})
vi.mock('./health-checker', () => {
  const mockChecker = {
    startChecking: vi.fn(),
    stopChecking: vi.fn(),
    stopAll: vi.fn(),
    isChecking: vi.fn().mockReturnValue(false),
    setOnChange: vi.fn((cb: (...args: unknown[]) => void) => {
      capturedOnChangeRef.current = cb
    }),
    getStatus: vi.fn().mockReturnValue(null),
    getAllStatuses: vi.fn().mockReturnValue({}),
  }
  return {
    HealthChecker: vi.fn().mockReturnValue(mockChecker),
  }
})

const { gracefulShutdown, healthChecker, killAllProcessGroups, __resetShutdownState, poller } =
  await import('./index')
import { closeAll as mockCloseAll } from './log-store'
import { broadcast } from './sse'

const mockBroadcast = vi.mocked(broadcast)

describe('server', () => {
  it('responds to health check with empty statuses', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ statuses: {} })
  })
})

describe('killAllProcessGroups', () => {
  beforeEach(() => {
    mockActiveProcesses.clear()
  })

  it('sends the specified signal to all active process groups', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child1 = new FakeChild()
    child1.pid = 1001
    const child2 = new FakeChild()
    child2.pid = 2002
    mockActiveProcesses.set('p1', child1 as never)
    mockActiveProcesses.set('p2', child2 as never)

    killAllProcessGroups('SIGTERM')

    expect(killSpy).toHaveBeenCalledWith(-1001, 'SIGTERM')
    expect(killSpy).toHaveBeenCalledWith(-2002, 'SIGTERM')
    killSpy.mockRestore()
  })

  it('skips children with undefined pid', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = new FakeChild()
    child.pid = undefined
    mockActiveProcesses.set('p1', child as never)

    killAllProcessGroups('SIGTERM')

    expect(killSpy).not.toHaveBeenCalled()
    killSpy.mockRestore()
  })

  it('catches errors from dead process groups', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const child = new FakeChild()
    child.pid = 9999
    mockActiveProcesses.set('p1', child as never)

    expect(() => killAllProcessGroups('SIGTERM')).not.toThrow()
    killSpy.mockRestore()
  })

  it('does nothing when no active processes', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    killAllProcessGroups('SIGKILL')

    expect(killSpy).not.toHaveBeenCalled()
    killSpy.mockRestore()
  })
})

describe('gracefulShutdown', () => {
  beforeEach(() => {
    mockActiveProcesses.clear()
    __resetShutdownState()
  })

  it('sends SIGTERM then SIGKILL after grace period', async () => {
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const child = new FakeChild()
    child.pid = 5555
    mockActiveProcesses.set('p1', child as never)

    const shutdownPromise = gracefulShutdown()

    await vi.advanceTimersByTimeAsync(0)

    expect(mockCloseAll).toHaveBeenCalledTimes(1)
    expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGTERM')
    expect(killSpy).not.toHaveBeenCalledWith(-5555, 'SIGKILL')

    await vi.advanceTimersByTimeAsync(3000)
    await shutdownPromise

    expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGKILL')
    expect(exitSpy).toHaveBeenCalledWith(0)

    killSpy.mockRestore()
    exitSpy.mockRestore()
    vi.useRealTimers()
  })

  it('guards against double invocation', async () => {
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const child = new FakeChild()
    child.pid = 7777
    mockActiveProcesses.set('p1', child as never)

    const first = gracefulShutdown()
    const second = gracefulShutdown()

    await vi.advanceTimersByTimeAsync(3000)
    await first
    await second

    const termCalls = killSpy.mock.calls.filter(([, sig]) => sig === 'SIGTERM')
    expect(termCalls).toHaveLength(1)

    killSpy.mockRestore()
    exitSpy.mockRestore()
    vi.useRealTimers()
  })
})

describe('poller lifecycle', () => {
  beforeEach(async () => {
    mockActiveProcesses.clear()
    __resetShutdownState()
    poller.stop()
    mockBroadcast.mockReset()
    mockPortTypeCache.clear()
    mockConfigRef.current = {
      ...mockConfigRef.current,
      overrides: {},
    }
    const { probePort } = await import('./port-probe')
    vi.mocked(probePort).mockResolvedValue('http' as import('@shared/types').PortType)
  })

  it('exports a BackgroundPoller instance', () => {
    expect(poller).toBeDefined()
    expect(typeof poller.start).toBe('function')
    expect(typeof poller.stop).toBe('function')
    expect(typeof poller.isRunning).toBe('function')
  })

  it('gracefulShutdown stops the poller', async () => {
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(process, 'kill').mockImplementation(() => true)

    poller.start(100)
    expect(poller.isRunning()).toBe(true)

    const shutdownPromise = gracefulShutdown()
    expect(poller.isRunning()).toBe(false)

    await vi.advanceTimersByTimeAsync(3000)
    await shutdownPromise

    exitSpy.mockRestore()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('onDiff callback wires broadcastDiff to SSE broadcast', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockDetect.mockResolvedValueOnce({ testProject: [{ pid: 1, port: 3000 }] })

    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'process-started', data: { projectId: 'testProject' } }),
    )

    poller.stop()
    vi.useRealTimers()
  })

  it('starts health checking on HTTP port when project starts', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    vi.mocked(healthChecker.startChecking).mockClear()
    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.startChecking).toHaveBeenCalledWith('myApp', 4000, undefined)

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('starts health checking when a running project gains an HTTP port', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    const { probePort } = await import('./port-probe')
    const mockProbe = vi.mocked(probePort)
    mockPortTypeCache.clear()

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockProbe.mockResolvedValue('tcp' as import('@shared/types').PortType)
    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 5432 }] })
    await vi.advanceTimersByTimeAsync(100)
    vi.mocked(healthChecker.startChecking).mockClear()

    mockProbe.mockResolvedValue('http' as import('@shared/types').PortType)
    mockDetect.mockResolvedValueOnce({
      myApp: [
        { pid: 1, port: 5432 },
        { pid: 2, port: 3000 },
      ],
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.startChecking).toHaveBeenCalledWith('myApp', 3000, undefined)

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('restarts health checking when port changes', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 3000 }] })
    await vi.advanceTimersByTimeAsync(100)
    vi.mocked(healthChecker.startChecking).mockClear()
    vi.mocked(healthChecker.stopChecking).mockClear()
    vi.mocked(healthChecker.isChecking).mockReturnValue(true)
    vi.mocked(healthChecker.stopChecking).mockImplementation(() => {
      vi.mocked(healthChecker.isChecking).mockReturnValue(false)
    })

    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.stopChecking).toHaveBeenCalledWith('myApp')
    expect(healthChecker.startChecking).toHaveBeenCalledWith('myApp', 4000, undefined)

    vi.mocked(healthChecker.stopChecking).mockReset()
    vi.mocked(healthChecker.isChecking).mockReturnValue(false)

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('stops health checking when project stops', async () => {
    vi.useFakeTimers()
    const { detectAllListeners, isStopping } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    const mockIsStopping = vi.mocked(isStopping)
    mockPortTypeCache.clear()

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)
    vi.mocked(healthChecker.stopChecking).mockClear()

    mockIsStopping.mockReturnValue(true)
    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.stopChecking).toHaveBeenCalledWith('myApp')

    poller.stop()
    mockIsStopping.mockReturnValue(false)
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('stops health checking when project crashes', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)
    vi.mocked(healthChecker.stopChecking).mockClear()

    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.stopChecking).toHaveBeenCalledWith('myApp')

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('passes custom healthCheckInterval from config overrides', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockConfigRef.current = {
      ...mockConfigRef.current,
      overrides: { myApp: { healthCheckInterval: 10_000 } },
    }

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    vi.mocked(healthChecker.startChecking).mockClear()
    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.startChecking).toHaveBeenCalledWith('myApp', 4000, 10_000)

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('skips health checking when healthCheckInterval is 0 (process-started)', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockConfigRef.current = {
      ...mockConfigRef.current,
      overrides: { myApp: { healthCheckInterval: 0 } },
    }

    mockDetect.mockResolvedValueOnce({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    vi.mocked(healthChecker.startChecking).mockClear()
    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 4000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.startChecking).not.toHaveBeenCalled()

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('skips health checking when healthCheckInterval is 0 (port-added)', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockConfigRef.current = {
      ...mockConfigRef.current,
      overrides: { myApp: { healthCheckInterval: 0 } },
    }

    mockDetect.mockResolvedValueOnce({ myApp: [{ pid: 1, port: 5432 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    vi.mocked(healthChecker.startChecking).mockClear()
    mockDetect.mockResolvedValueOnce({
      myApp: [
        { pid: 1, port: 5432 },
        { pid: 2, port: 3000 },
      ],
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(healthChecker.startChecking).not.toHaveBeenCalled()

    poller.stop()
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })

  it('stops all health checks on graceful shutdown', async () => {
    vi.useFakeTimers()
    __resetShutdownState()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    const shutdownPromise = gracefulShutdown()
    await vi.advanceTimersByTimeAsync(3000)
    await shutdownPromise

    expect(healthChecker.stopAll).toHaveBeenCalled()

    exitSpy.mockRestore()
    vi.useRealTimers()
  })

  it('broadcasts health-changed SSE event on status transition', () => {
    expect(capturedOnChangeRef.current).not.toBeNull()
    mockBroadcast.mockClear()

    capturedOnChangeRef.current?.('myApp', 'healthy', 42)

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'health-changed',
      data: { projectId: 'myApp', status: 'healthy', responseTime: 42 },
    })
  })

  it('broadcasts health-changed with null responseTime', () => {
    mockBroadcast.mockClear()

    capturedOnChangeRef.current?.('myApp', 'unhealthy', null)

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'health-changed',
      data: { projectId: 'myApp', status: 'unhealthy', responseTime: null },
    })
  })

  it('broadcasts resource-update SSE events on 3rd tick', async () => {
    vi.useFakeTimers()
    const { detectAllListeners } = await import('./process-manager')
    const mockDetect = vi.mocked(detectAllListeners)
    mockPortTypeCache.clear()

    mockExecFileRef.current = (_cmd, _args, _opts, cb) => {
      cb(null, '  PID  %CPU   RSS\n  100   12.5 51200', '')
    }

    mockDetect.mockResolvedValue({ myApp: [{ pid: 100, port: 3000 }] })
    mockBroadcast.mockClear()

    poller.start(100)
    await vi.advanceTimersByTimeAsync(300) // tick 3 triggers sampling

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'resource-update',
      data: { projectId: 'myApp', cpu: 12.5, memory: 51200 * 1024 },
    })

    poller.stop()
    mockExecFileRef.current = (_cmd, _args, _opts, cb) => cb(null, '', '')
    mockPortTypeCache.clear()
    vi.useRealTimers()
  })
})
