import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthChecker, probe } from './health-checker'

describe('probe', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('returns healthy with response time on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const result = await probe(3000)
    expect(result.status).toBe('healthy')
    expect(result.responseTime).toBeGreaterThanOrEqual(0)
  })

  it('returns unhealthy on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    const result = await probe(3000)
    expect(result.status).toBe('unhealthy')
    expect(result.responseTime).toBeGreaterThanOrEqual(0)
  })

  it('returns unhealthy on fetch rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const result = await probe(5432)
    expect(result.status).toBe('unhealthy')
  })

  it('returns unhealthy on timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    const promise = probe(9999, 500)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise
    expect(result.status).toBe('unhealthy')
  })

  it('clears timeout after successful probe', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await probe(3000)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('sends HEAD request to localhost on the given port', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await probe(8080)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    )
  })

  it('returns unhealthy for invalid port without making a request', async () => {
    globalThis.fetch = vi.fn()
    const result = await probe(-1)
    expect(result.status).toBe('unhealthy')
    expect(result.responseTime).toBe(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns unhealthy for non-integer port', async () => {
    globalThis.fetch = vi.fn()
    const result = await probe(3.5)
    expect(result.status).toBe('unhealthy')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('treats redirect responses as healthy', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 301 }))
    const result = await probe(3000)
    expect(result.status).toBe('unhealthy')
  })
})

describe('HealthChecker', () => {
  const originalFetch = globalThis.fetch
  let checker: HealthChecker

  beforeEach(() => {
    vi.useFakeTimers()
    checker = new HealthChecker()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    checker.stopAll()
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  describe('startChecking', () => {
    it('runs an immediate check on start', async () => {
      checker.startChecking('proj-a', 3000, 30000)
      await vi.advanceTimersByTimeAsync(0)
      const state = checker.getStatus('proj-a')
      expect(state).not.toBeNull()
      expect(state?.status).toBe('healthy')
      expect(state?.lastCheck).not.toBeNull()
    })

    it('sets initial state to unknown before first check resolves', () => {
      globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
      checker.startChecking('proj-a', 3000, 30000)
      const state = checker.getStatus('proj-a')
      expect(state?.status).toBe('unknown')
    })

    it('runs periodic checks at the given interval', async () => {
      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1000)
      expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    })

    it('throws on invalid port', () => {
      expect(() => checker.startChecking('proj-a', -1)).toThrow('Invalid port')
      expect(() => checker.startChecking('proj-a', 70000)).toThrow('Invalid port')
      expect(() => checker.startChecking('proj-a', 3.5)).toThrow('Invalid port')
    })

    it('stops previous timer when called again for the same project', async () => {
      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)

      checker.startChecking('proj-a', 4000, 1000)
      await vi.advanceTimersByTimeAsync(0)

      // Only 2 initial checks (one per startChecking call)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
      // The second call should target port 4000
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        'http://localhost:4000',
        expect.objectContaining({ method: 'HEAD' }),
      )
    })
  })

  describe('stopChecking', () => {
    it('clears the timer and removes state', async () => {
      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)

      checker.stopChecking('proj-a')
      expect(checker.getStatus('proj-a')).toBeNull()
      expect(checker.isChecking('proj-a')).toBe(false)

      await vi.advanceTimersByTimeAsync(5000)
      // No more fetches after the initial one
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('is safe to call for a project not being checked', () => {
      expect(() => checker.stopChecking('nonexistent')).not.toThrow()
    })
  })

  describe('stopAll', () => {
    it('stops all active timers and clears state', async () => {
      checker.startChecking('proj-a', 3000, 1000)
      checker.startChecking('proj-b', 4000, 1000)
      await vi.advanceTimersByTimeAsync(0)

      checker.stopAll()
      expect(checker.getStatus('proj-a')).toBeNull()
      expect(checker.getStatus('proj-b')).toBeNull()

      await vi.advanceTimersByTimeAsync(5000)
      // Only the 2 initial checks
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('consecutive failure tracking', () => {
    it('stays unknown until threshold consecutive failures', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        return Promise.reject(new TypeError('fetch failed'))
      })

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      // 1 failure — still unknown (threshold is 3)
      expect(checker.getStatus('proj-a')?.status).toBe('unknown')
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(1)

      await vi.advanceTimersByTimeAsync(1000)
      // 2 failures — still unknown
      expect(checker.getStatus('proj-a')?.status).toBe('unknown')
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(2)

      await vi.advanceTimersByTimeAsync(1000)
      // 3 failures — now unhealthy
      expect(checker.getStatus('proj-a')?.status).toBe('unhealthy')
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(3)
    })

    it('resets consecutive failures on success', async () => {
      let shouldFail = true
      globalThis.fetch = vi.fn().mockImplementation(() => {
        if (shouldFail) return Promise.reject(new TypeError('fetch failed'))
        return Promise.resolve(new Response(null, { status: 200 }))
      })

      checker.startChecking('proj-a', 3000, 1000)
      // 1st check: fail
      await vi.advanceTimersByTimeAsync(0)
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(1)

      // 2nd check: fail
      await vi.advanceTimersByTimeAsync(1000)
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(2)

      // 3rd check: success
      shouldFail = false
      await vi.advanceTimersByTimeAsync(1000)
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(0)
      expect(checker.getStatus('proj-a')?.status).toBe('healthy')
    })

    it('transitions from healthy to unhealthy after threshold failures', async () => {
      const changes: Array<{ projectId: string; status: string }> = []
      checker.setOnChange((projectId, status) => {
        changes.push({ projectId, status })
      })

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      // unknown → healthy
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({ projectId: 'proj-a', status: 'healthy' })

      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      // 3 failures needed to transition
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(changes).toHaveLength(1) // still healthy (only 2 failures)

      await vi.advanceTimersByTimeAsync(1000)
      // Now unhealthy
      expect(changes).toHaveLength(2)
      expect(changes[1]).toEqual({ projectId: 'proj-a', status: 'unhealthy' })
    })
  })

  describe('onChange callback', () => {
    it('fires on status transition', async () => {
      const changes: Array<{ projectId: string; status: string; responseTime: number | null }> = []
      checker.setOnChange((projectId, status, responseTime) => {
        changes.push({ projectId, status, responseTime })
      })

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      // unknown → healthy
      expect(changes).toHaveLength(1)
      expect(changes[0].status).toBe('healthy')
      expect(changes[0].responseTime).toBeGreaterThanOrEqual(0)
    })

    it('does not fire when status stays the same', async () => {
      const changes: string[] = []
      checker.setOnChange((_projectId, status) => {
        changes.push(status)
      })

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      // unknown → healthy (fires)
      expect(changes).toHaveLength(1)

      // Another success — still healthy (no fire)
      await vi.advanceTimersByTimeAsync(1000)
      expect(changes).toHaveLength(1)
    })

    it('does not fire during failure accumulation before threshold', async () => {
      const changes: string[] = []
      checker.setOnChange((_projectId, status) => {
        changes.push(status)
      })

      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
      checker.startChecking('proj-a', 3000, 1000)

      // 1st and 2nd failure — status stays 'unknown', no change from initial
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(changes).toHaveLength(0)
    })
  })

  describe('getStatus', () => {
    it('returns null for unknown project', () => {
      expect(checker.getStatus('nonexistent')).toBeNull()
    })

    it('returns a copy, not a reference to internal state', async () => {
      checker.startChecking('proj-a', 3000, 30000)
      await vi.advanceTimersByTimeAsync(0)

      const state1 = checker.getStatus('proj-a')
      if (state1) state1.consecutiveFailures = 999
      const state2 = checker.getStatus('proj-a')
      expect(state2?.consecutiveFailures).toBe(0)
    })
  })

  describe('getAllStatuses', () => {
    it('returns statuses for all checked projects', async () => {
      checker.startChecking('proj-a', 3000, 30000)
      checker.startChecking('proj-b', 4000, 30000)
      await vi.advanceTimersByTimeAsync(0)

      const all = checker.getAllStatuses()
      expect(Object.keys(all)).toEqual(['proj-a', 'proj-b'])
      expect(all['proj-a'].status).toBe('healthy')
      expect(all['proj-b'].status).toBe('healthy')
    })

    it('returns copies, not references', async () => {
      checker.startChecking('proj-a', 3000, 30000)
      await vi.advanceTimersByTimeAsync(0)

      const all = checker.getAllStatuses()
      all['proj-a'].consecutiveFailures = 999
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(0)
    })

    it('returns empty object when nothing is checked', () => {
      expect(checker.getAllStatuses()).toEqual({})
    })
  })

  describe('isChecking', () => {
    it('returns true for active project', () => {
      checker.startChecking('proj-a', 3000, 30000)
      expect(checker.isChecking('proj-a')).toBe(true)
    })

    it('returns false after stop', async () => {
      checker.startChecking('proj-a', 3000, 30000)
      await vi.advanceTimersByTimeAsync(0)
      checker.stopChecking('proj-a')
      expect(checker.isChecking('proj-a')).toBe(false)
    })

    it('returns false for unknown project', () => {
      expect(checker.isChecking('nonexistent')).toBe(false)
    })
  })

  describe('error handling', () => {
    it('continues checking after probe failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0)
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(1)
      expect(checker.isChecking('proj-a')).toBe(true)

      await vi.advanceTimersByTimeAsync(1000)
      expect(checker.getStatus('proj-a')?.consecutiveFailures).toBe(2)
      expect(checker.isChecking('proj-a')).toBe(true)
    })

    it('logs error but continues periodic checks on interval failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) throw new Error('Unexpected error')
        return Promise.resolve(new Response(null, { status: 200 }))
      })

      checker.startChecking('proj-a', 3000, 1000)
      await vi.advanceTimersByTimeAsync(0) // call 1: ok
      await vi.advanceTimersByTimeAsync(1000) // call 2: throws
      await vi.advanceTimersByTimeAsync(1000) // call 3: ok

      expect(callCount).toBe(3)
      expect(checker.isChecking('proj-a')).toBe(true)
      consoleSpy.mockRestore()
    })

    it('handles stopChecking during an in-flight check gracefully', async () => {
      const pending: { resolve: (() => void) | null } = { resolve: null }
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          pending.resolve = () => resolve(new Response(null, { status: 200 }))
        })
      })

      checker.startChecking('proj-a', 3000, 30000)
      // Check is now in flight
      checker.stopChecking('proj-a')
      expect(checker.getStatus('proj-a')).toBeNull()

      // Resolve the in-flight probe — should not crash
      pending.resolve?.()
      await vi.advanceTimersByTimeAsync(0)
      expect(checker.getStatus('proj-a')).toBeNull()
    })
  })
})
