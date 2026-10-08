import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probePort } from './port-probe'

describe('probePort', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('returns http when fetch succeeds with 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const result = await probePort(3000)
    expect(result).toBe('http')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000',
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it('returns http on non-2xx HTTP responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    const result = await probePort(8080)
    expect(result).toBe('http')
  })

  it('returns tcp on connection refused (fetch rejects)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const result = await probePort(5432)
    expect(result).toBe('tcp')
  })

  it('returns tcp on abort (timeout)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    const promise = probePort(9999, 500)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise
    expect(result).toBe('tcp')
  })

  it('uses custom timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    const promise = probePort(9999, 100)
    await vi.advanceTimersByTimeAsync(99)
    // Should still be pending at 99ms
    let resolved = false
    promise.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await promise
    expect(result).toBe('tcp')
  })

  it('clears timeout after successful probe', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await probePort(3000)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
