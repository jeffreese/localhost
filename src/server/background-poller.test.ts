import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundPoller, broadcastDiff, diffListeners } from './background-poller'

vi.mock('./process-manager', () => ({
  detectAllListeners: vi.fn().mockResolvedValue({}),
  isStopping: vi.fn().mockReturnValue(false),
  clearStopping: vi.fn(),
}))

vi.mock('./port-probe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./port-probe')>()
  return {
    ...actual,
    probePort: vi.fn().mockResolvedValue('http'),
  }
})

import { clearPortTypeCache, getPortType, probePort } from './port-probe'
import { clearStopping, detectAllListeners, isStopping } from './process-manager'

const mockDetect = vi.mocked(detectAllListeners)
const mockProbe = vi.mocked(probePort)
const mockIsStopping = vi.mocked(isStopping)
const mockClearStopping = vi.mocked(clearStopping)

describe('BackgroundPoller', () => {
  let poller: BackgroundPoller

  beforeEach(() => {
    vi.useFakeTimers()
    poller = new BackgroundPoller()
    mockDetect.mockReset().mockResolvedValue({})
    mockProbe.mockReset().mockResolvedValue('http')
    mockIsStopping.mockReset().mockReturnValue(false)
    mockClearStopping.mockReset()
    clearPortTypeCache()
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('starts and stops the interval', () => {
    expect(poller.isRunning()).toBe(false)
    poller.start()
    expect(poller.isRunning()).toBe(true)
    poller.stop()
    expect(poller.isRunning()).toBe(false)
  })

  it('does not create duplicate intervals on double start', () => {
    poller.start()
    poller.start()
    poller.stop()
    expect(poller.isRunning()).toBe(false)
  })

  it('calls detectAllListeners on each tick', async () => {
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(2)
  })

  it('increments tick count', async () => {
    poller.start(100)
    expect(poller.getTickCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(poller.getTickCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(poller.getTickCount()).toBe(2)
  })

  it('stores listener results as previous state', async () => {
    const listeners = { myProject: [{ pid: 123, port: 3000 }] }
    mockDetect.mockResolvedValue(listeners)
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(poller.getPreviousListeners()).toEqual(listeners)
  })

  it('skips tick when previous tick is still running', async () => {
    let resolveFirst!: () => void
    mockDetect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({})
        }),
    )

    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(1)

    resolveFirst()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(2)
  })

  it('recovers from tick errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockDetect.mockRejectedValueOnce(new Error('lsof failed'))

    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(consoleSpy).toHaveBeenCalledWith('[BackgroundPoller] tick error:', expect.any(Error))

    mockDetect.mockResolvedValue({ p: [{ pid: 1, port: 3000 }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(2)
    expect(poller.getPreviousListeners()).toEqual({ p: [{ pid: 1, port: 3000 }] })

    consoleSpy.mockRestore()
  })

  it('stop is safe to call when not running', () => {
    expect(() => poller.stop()).not.toThrow()
  })

  it('cleans up interval on stop so no further ticks fire', async () => {
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(1)
    poller.stop()
    await vi.advanceTimersByTimeAsync(300)
    expect(mockDetect).toHaveBeenCalledTimes(1)
  })

  it('computes diff between ticks', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockDetect.mockResolvedValueOnce({
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
      ],
      b: [{ pid: 2, port: 4000 }],
    })
    await vi.advanceTimersByTimeAsync(100)

    const diff = poller.getLastDiff()
    if (!diff) throw new Error('expected diff')
    expect(diff.started).toEqual(['b'])
    expect(diff.stopped).toEqual([])
    expect(diff.portsAdded).toEqual([{ projectId: 'a', port: 3001 }])
    expect(diff.portsRemoved).toEqual([])
  })

  it('returns null diff before first tick', () => {
    expect(poller.getLastDiff()).toBeNull()
  })

  it('getPreviousListeners returns a clone that does not affect internal state', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    const returned = poller.getPreviousListeners()
    returned.a.push({ pid: 99, port: 9999 })

    expect(poller.getPreviousListeners()).toEqual({ a: [{ pid: 1, port: 3000 }] })
  })

  it('getLastDiff returns a clone that does not affect internal state', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    const returned = poller.getLastDiff()
    if (!returned) throw new Error('expected diff')
    returned.started.push('injected')

    expect(poller.getLastDiff()?.started).toEqual(['a'])
  })

  it('classifies disappeared project as crashed when no stop flag', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    const diff1 = poller.getLastDiff()
    if (!diff1) throw new Error('expected diff')
    expect(diff1.started).toEqual(['a'])

    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    const diff2 = poller.getLastDiff()
    if (!diff2) throw new Error('expected diff')
    expect(diff2.crashed).toEqual(['a'])
    expect(diff2.stopped).toEqual([])
  })

  it('classifies disappeared project as stopped when stop flag is set', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockIsStopping.mockReturnValue(true)
    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    const diff = poller.getLastDiff()
    if (!diff) throw new Error('expected diff')
    expect(diff.stopped).toEqual(['a'])
    expect(diff.crashed).toEqual([])
    expect(mockClearStopping).toHaveBeenCalledWith('a')
  })

  it('overlap guard clears after multiple skipped ticks', async () => {
    let resolveFirst!: () => void
    mockDetect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({})
        }),
    )

    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(1)

    resolveFirst()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(mockDetect).toHaveBeenCalledTimes(2)
  })
})

describe('diffListeners', () => {
  it('returns empty diff for identical states', () => {
    const state = { a: [{ pid: 1, port: 3000 }] }
    const diff = diffListeners(state, state)
    expect(diff.started).toEqual([])
    expect(diff.stopped).toEqual([])
    expect(diff.crashed).toEqual([])
    expect(diff.portsAdded).toEqual([])
    expect(diff.portsRemoved).toEqual([])
  })

  it('detects new projects as started', () => {
    const diff = diffListeners({}, { a: [{ pid: 1, port: 3000 }] })
    expect(diff.started).toEqual(['a'])
    expect(diff.crashed).toEqual([])
    expect(diff.portsAdded).toEqual([])
  })

  it('detects removed projects as stopped (not crashed — classification is poller responsibility)', () => {
    const diff = diffListeners({ a: [{ pid: 1, port: 3000 }] }, {})
    expect(diff.stopped).toEqual(['a'])
    expect(diff.crashed).toEqual([])
    expect(diff.portsRemoved).toEqual([])
  })

  it('detects added ports on existing projects', () => {
    const diff = diffListeners(
      { a: [{ pid: 1, port: 3000 }] },
      {
        a: [
          { pid: 1, port: 3000 },
          { pid: 1, port: 3001 },
        ],
      },
    )
    expect(diff.started).toEqual([])
    expect(diff.portsAdded).toEqual([{ projectId: 'a', port: 3001 }])
  })

  it('detects removed ports on existing projects', () => {
    const diff = diffListeners(
      {
        a: [
          { pid: 1, port: 3000 },
          { pid: 1, port: 3001 },
        ],
      },
      { a: [{ pid: 1, port: 3000 }] },
    )
    expect(diff.stopped).toEqual([])
    expect(diff.portsRemoved).toEqual([{ projectId: 'a', port: 3001 }])
  })

  it('handles simultaneous started, stopped, and port changes', () => {
    const prev = {
      a: [{ pid: 1, port: 3000 }],
      b: [
        { pid: 2, port: 4000 },
        { pid: 2, port: 4001 },
      ],
    }
    const curr = {
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
      ],
      c: [{ pid: 3, port: 5000 }],
    }
    const diff = diffListeners(prev, curr)
    expect(diff.started).toEqual(['c'])
    expect(diff.stopped).toEqual(['b'])
    expect(diff.portsAdded).toEqual([{ projectId: 'a', port: 3001 }])
    expect(diff.portsRemoved).toEqual([])
  })

  it('returns empty diff for two empty states', () => {
    const diff = diffListeners({}, {})
    expect(diff.started).toEqual([])
    expect(diff.stopped).toEqual([])
    expect(diff.portsAdded).toEqual([])
    expect(diff.portsRemoved).toEqual([])
  })

  it('handles project with all ports replaced', () => {
    const diff = diffListeners({ a: [{ pid: 1, port: 3000 }] }, { a: [{ pid: 2, port: 4000 }] })
    expect(diff.started).toEqual([])
    expect(diff.stopped).toEqual([])
    expect(diff.portsAdded).toEqual([{ projectId: 'a', port: 4000 }])
    expect(diff.portsRemoved).toEqual([{ projectId: 'a', port: 3000 }])
  })

  it('treats project with empty listeners as present (not started/stopped)', () => {
    const diff = diffListeners({ a: [] }, { a: [] })
    expect(diff.started).toEqual([])
    expect(diff.stopped).toEqual([])
    expect(diff.portsAdded).toEqual([])
    expect(diff.portsRemoved).toEqual([])
  })

  it('detects ports added to previously empty project', () => {
    const diff = diffListeners({ a: [] }, { a: [{ pid: 1, port: 3000 }] })
    expect(diff.started).toEqual([])
    expect(diff.portsAdded).toEqual([{ projectId: 'a', port: 3000 }])
  })

  it('detects all ports removed from existing project', () => {
    const diff = diffListeners({ a: [{ pid: 1, port: 3000 }] }, { a: [] })
    expect(diff.stopped).toEqual([])
    expect(diff.portsRemoved).toEqual([{ projectId: 'a', port: 3000 }])
  })
})

describe('broadcastDiff', () => {
  it('emits process-started for new projects', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      { started: ['a', 'b'], stopped: [], crashed: [], portsAdded: [], portsRemoved: [] },
      (e) => events.push(e),
    )
    expect(events).toEqual([
      { type: 'process-started', data: { projectId: 'a' } },
      { type: 'process-started', data: { projectId: 'b' } },
    ])
  })

  it('emits process-stopped for removed projects', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      { started: [], stopped: ['x'], crashed: [], portsAdded: [], portsRemoved: [] },
      (e) => events.push(e),
    )
    expect(events).toEqual([{ type: 'process-stopped', data: { projectId: 'x' } }])
  })

  it('emits process-crashed for crashed projects', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      { started: [], stopped: [], crashed: ['y'], portsAdded: [], portsRemoved: [] },
      (e) => events.push(e),
    )
    expect(events).toEqual([{ type: 'process-crashed', data: { projectId: 'y' } }])
  })

  it('emits port-detected for added ports', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      {
        started: [],
        stopped: [],
        crashed: [],
        portsAdded: [{ projectId: 'a', port: 3001 }],
        portsRemoved: [],
      },
      (e) => events.push(e),
    )
    expect(events).toEqual([{ type: 'port-detected', data: { projectId: 'a', port: 3001 } }])
  })

  it('emits nothing for empty diff', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      { started: [], stopped: [], crashed: [], portsAdded: [], portsRemoved: [] },
      (e) => events.push(e),
    )
    expect(events).toEqual([])
  })

  it('emits events in order: started, stopped, crashed, port-detected', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      {
        started: ['new'],
        stopped: ['old'],
        crashed: ['dead'],
        portsAdded: [{ projectId: 'existing', port: 4000 }],
        portsRemoved: [{ projectId: 'existing', port: 3000 }],
      },
      (e) => events.push(e),
    )
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.type)).toEqual([
      'process-started',
      'process-stopped',
      'process-crashed',
      'port-detected',
    ])
  })

  it('does not emit events for portsRemoved', () => {
    const events: Array<{ type: string; data: unknown }> = []
    broadcastDiff(
      {
        started: [],
        stopped: [],
        crashed: [],
        portsAdded: [],
        portsRemoved: [{ projectId: 'a', port: 3000 }],
      },
      (e) => events.push(e),
    )
    expect(events).toHaveLength(0)
  })
})

describe('BackgroundPoller onDiff callback', () => {
  let poller: BackgroundPoller

  beforeEach(() => {
    vi.useFakeTimers()
    poller = new BackgroundPoller()
    mockDetect.mockReset().mockResolvedValue({})
    mockProbe.mockReset().mockResolvedValue('http')
    mockIsStopping.mockReset().mockReturnValue(false)
    mockClearStopping.mockReset()
    clearPortTypeCache()
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('calls onDiff when diff has changes', async () => {
    const diffs: Array<unknown> = []
    poller.setOnDiff((diff) => diffs.push(diff))

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toEqual(expect.objectContaining({ started: ['a'] }))
  })

  it('does not call onDiff when diff is empty', async () => {
    const diffs: Array<unknown> = []
    poller.setOnDiff((diff) => diffs.push(diff))

    mockDetect.mockResolvedValue({})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(diffs).toHaveLength(0)
  })

  it('does not call onDiff when no callback is set', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(poller.getLastDiff()).not.toBeNull()
  })

  it('passes a cloned diff to onDiff callback', async () => {
    let received: unknown = null
    poller.setOnDiff((diff) => {
      received = diff
    })

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    const cached = poller.getLastDiff()
    expect(received).toEqual(cached)
    expect(received).not.toBe(poller.getLastDiff())
  })

  it('catches synchronous onDiff errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    poller.setOnDiff(() => {
      throw new Error('sync boom')
    })

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(consoleSpy).toHaveBeenCalledWith('[BackgroundPoller] onDiff error:', expect.any(Error))
    expect(poller.getTickCount()).toBe(1)
    consoleSpy.mockRestore()
  })

  it('catches async onDiff errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    poller.setOnDiff((() => Promise.reject(new Error('async boom'))) as () => void)

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0)

    expect(consoleSpy).toHaveBeenCalledWith('[BackgroundPoller] onDiff error:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('does not call onDiff for portsRemoved-only changes', async () => {
    const diffs: Array<unknown> = []
    poller.setOnDiff((diff) => diffs.push(diff))

    mockDetect.mockResolvedValueOnce({
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
      ],
    })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    diffs.length = 0

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(diffs).toHaveLength(0)
  })

  it('calls onDiff with crashed projects when stop flag is not set', async () => {
    const diffs: Array<unknown> = []
    poller.setOnDiff((diff) => diffs.push(diff))

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    diffs.length = 0

    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toEqual(expect.objectContaining({ crashed: ['a'], stopped: [] }))
  })

  it('calls onDiff with stopped projects when stop flag is set', async () => {
    const diffs: Array<unknown> = []
    poller.setOnDiff((diff) => diffs.push(diff))

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    diffs.length = 0

    mockIsStopping.mockReturnValue(true)
    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toEqual(expect.objectContaining({ stopped: ['a'], crashed: [] }))
  })
})

describe('BackgroundPoller port type cache', () => {
  let poller: BackgroundPoller

  beforeEach(() => {
    vi.useFakeTimers()
    poller = new BackgroundPoller()
    mockDetect.mockReset().mockResolvedValue({})
    mockProbe.mockReset().mockResolvedValue('http')
    mockIsStopping.mockReset().mockReturnValue(false)
    mockClearStopping.mockReset()
    clearPortTypeCache()
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('probes new ports on portsAdded and caches result', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    mockDetect.mockResolvedValueOnce({
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
      ],
    })
    mockProbe.mockResolvedValueOnce('tcp')
    await vi.advanceTimersByTimeAsync(100)

    expect(mockProbe).toHaveBeenCalledWith(3001)
    expect(getPortType(3001)).toBe('tcp')
  })

  it('probes ports from newly started projects', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockProbe).toHaveBeenCalledWith(3000)
    expect(getPortType(3000)).toBe('http')
  })

  it('invalidates cache on port removal', async () => {
    mockDetect.mockResolvedValueOnce({
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
      ],
    })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(getPortType(3001)).toBe('http')

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    await vi.advanceTimersByTimeAsync(100)

    expect(getPortType(3001)).toBeUndefined()
    expect(getPortType(3000)).toBe('http')
  })

  it('invalidates cache when project stops', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(getPortType(3000)).toBe('http')

    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)

    expect(getPortType(3000)).toBeUndefined()
  })

  it('re-probes port after disappearance and reappearance', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    mockProbe.mockResolvedValueOnce('tcp')
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(getPortType(3000)).toBe('tcp')

    mockDetect.mockResolvedValueOnce({})
    await vi.advanceTimersByTimeAsync(100)
    expect(getPortType(3000)).toBeUndefined()

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 2, port: 3000 }] })
    mockProbe.mockResolvedValueOnce('http')
    await vi.advanceTimersByTimeAsync(100)
    expect(getPortType(3000)).toBe('http')
  })

  it('probes multiple new ports in parallel', async () => {
    mockDetect.mockResolvedValueOnce({
      a: [
        { pid: 1, port: 3000 },
        { pid: 1, port: 3001 },
        { pid: 1, port: 3002 },
      ],
    })
    mockProbe.mockImplementation(async (port) => (port === 3001 ? 'tcp' : 'http'))
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockProbe).toHaveBeenCalledTimes(3)
    expect(getPortType(3000)).toBe('http')
    expect(getPortType(3001)).toBe('tcp')
    expect(getPortType(3002)).toBe('http')
  })

  it('does not re-probe cached ports', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockProbe).toHaveBeenCalledTimes(1)

    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(mockProbe).toHaveBeenCalledTimes(1)
  })

  it('handles probe errors gracefully', async () => {
    mockDetect.mockResolvedValueOnce({ a: [{ pid: 1, port: 3000 }] })
    mockProbe.mockRejectedValueOnce(new Error('probe failed'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    poller.start(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(getPortType(3000)).toBeUndefined()
    consoleSpy.mockRestore()
  })
})
