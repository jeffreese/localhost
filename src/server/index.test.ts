import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from './index'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid: number | undefined = 12345
  kill = vi.fn()
}

const mockActiveProcesses = new Map<string, FakeChild>()

vi.mock('./process-manager', () => ({
  getActiveProcesses: () => mockActiveProcesses,
  detectAllListeners: vi.fn().mockResolvedValue({}),
}))

vi.mock('./sse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sse')>()
  return {
    ...actual,
    broadcast: vi.fn(),
  }
})

const { gracefulShutdown, killAllProcessGroups, __resetShutdownState, poller } = await import(
  './index'
)
import { broadcast } from './sse'

const mockBroadcast = vi.mocked(broadcast)

describe('server', () => {
  it('responds to health check', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
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
  beforeEach(() => {
    mockActiveProcesses.clear()
    __resetShutdownState()
    poller.stop()
    mockBroadcast.mockReset()
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
})
