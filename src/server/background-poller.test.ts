import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundPoller } from './background-poller'

vi.mock('./process-manager', () => ({
  detectAllListeners: vi.fn().mockResolvedValue({}),
}))

import { detectAllListeners } from './process-manager'

const mockDetect = vi.mocked(detectAllListeners)

describe('BackgroundPoller', () => {
  let poller: BackgroundPoller

  beforeEach(() => {
    vi.useFakeTimers()
    poller = new BackgroundPoller()
    mockDetect.mockReset().mockResolvedValue({})
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
})
