import type { LogLine } from '@shared/types'
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

const { ConsoleStore } = await import('./console-store')

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout', ts = 0): LogLine {
  return { text, stream, ts }
}

describe('ConsoleStore', () => {
  beforeEach(() => {
    ConsoleStore.__reset()
    sseHandlers.clear()
    ConsoleStore.init()
    vi.unstubAllGlobals()
  })

  it('skips SSE log events for projects not yet hydrated', () => {
    dispatchSSE('log', { projectId: 'p1', lines: [line('x')] })
    expect(ConsoleStore.getLines('p1')).toEqual([])
  })

  it('hydrates from /api/projects/:id/logs and sets open project', async () => {
    const fetched = { lines: [line('hello'), line('world')], hasMore: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => fetched })),
    )

    await ConsoleStore.open('p1')

    expect(ConsoleStore.isOpen()).toBe(true)
    expect(ConsoleStore.getOpenProjectId()).toBe('p1')
    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['hello', 'world'])
  })

  it('appends SSE log events after hydration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ lines: [line('hydrated')], hasMore: false }),
      })),
    )

    await ConsoleStore.open('p1')
    dispatchSSE('log', { projectId: 'p1', lines: [line('live-1'), line('live-2')] })

    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['hydrated', 'live-1', 'live-2'])
  })

  it('caps the client-side buffer at 500 lines', async () => {
    const initial = Array.from({ length: 450 }, (_, i) => line(`init-${i}`))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ lines: initial, hasMore: false }) })),
    )

    await ConsoleStore.open('p1')

    const incoming = Array.from({ length: 100 }, (_, i) => line(`new-${i}`))
    dispatchSSE('log', { projectId: 'p1', lines: incoming })

    const lines = ConsoleStore.getLines('p1')
    expect(lines).toHaveLength(500)
    expect(lines[0].text).toBe('init-50')
    expect(lines[lines.length - 1].text).toBe('new-99')
  })

  it('clears buffer on process-started (mirrors server-side reset)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ lines: [line('old run')], hasMore: false }),
      })),
    )

    await ConsoleStore.open('p1')
    dispatchSSE('process-started', { projectId: 'p1' })

    expect(ConsoleStore.getLines('p1')).toEqual([])
  })

  it('ignores log events for closed (non-hydrated) projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ lines: [line('p1 hello')], hasMore: false }),
      })),
    )
    await ConsoleStore.open('p1')

    dispatchSSE('log', { projectId: 'p2', lines: [line('orphan')] })

    expect(ConsoleStore.getLines('p2')).toEqual([])
    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['p1 hello'])
  })

  it('close() clears the open project but keeps cached lines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ lines: [line('cached')], hasMore: false }),
      })),
    )
    await ConsoleStore.open('p1')

    ConsoleStore.close()

    expect(ConsoleStore.isOpen()).toBe(false)
    expect(ConsoleStore.getOpenProjectId()).toBeNull()
    // Cached buffer remains so reopening is instant.
    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['cached'])
  })

  it('notifies subscribers on state changes', async () => {
    const listener = vi.fn()
    ConsoleStore.subscribe(listener)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ lines: [line('x')], hasMore: false }) })),
    )
    await ConsoleStore.open('p1')
    dispatchSSE('log', { projectId: 'p1', lines: [line('y')] })
    ConsoleStore.close()

    expect(listener).toHaveBeenCalled()
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('falls back to empty array when fetch returns non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    await ConsoleStore.open('err-proj')

    expect(ConsoleStore.getLines('err-proj')).toEqual([])
  })

  describe('hydration race fix', () => {
    function deferredFetch(data: { lines: LogLine[] }) {
      let resolve!: () => void
      const fetchPromise = new Promise<void>((r) => {
        resolve = r
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          fetchPromise.then(() => ({
            ok: true,
            json: async () => data,
          })),
        ),
      )
      return resolve
    }

    it('buffers SSE events during fetch and merges after', async () => {
      const resolve = deferredFetch({ lines: [line('disk-1'), line('disk-2')] })

      const openPromise = ConsoleStore.open('p1')

      dispatchSSE('log', { projectId: 'p1', lines: [line('live-1')] })
      dispatchSSE('log', { projectId: 'p1', lines: [line('live-2')] })

      resolve()
      await openPromise

      expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual([
        'disk-1',
        'disk-2',
        'live-1',
        'live-2',
      ])
    })

    it('process-started during hydration discards stale history', async () => {
      const resolve = deferredFetch({ lines: [line('old-run-output')] })

      const openPromise = ConsoleStore.open('p1')

      dispatchSSE('process-started', { projectId: 'p1' })
      dispatchSSE('log', { projectId: 'p1', lines: [line('new-run-line')] })

      resolve()
      await openPromise

      expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['new-run-line'])
    })

    it('superseded open() discards stale result without corrupting second open', async () => {
      let resolveFirst!: () => void
      let resolveSecond!: () => void
      const firstFetch = new Promise<void>((r) => {
        resolveFirst = r
      })
      const secondFetch = new Promise<void>((r) => {
        resolveSecond = r
      })

      let callCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          callCount++
          const p = callCount === 1 ? firstFetch : secondFetch
          const data = callCount === 1 ? { lines: [line('p1-data')] } : { lines: [line('p2-data')] }
          return p.then(() => ({ ok: true, json: async () => data }))
        }),
      )

      const open1 = ConsoleStore.open('p1')
      const open2 = ConsoleStore.open('p2')

      dispatchSSE('log', { projectId: 'p2', lines: [line('p2-live')] })

      resolveFirst()
      await open1

      expect(ConsoleStore.getLines('p1')).toEqual([])

      resolveSecond()
      await open2

      expect(ConsoleStore.getLines('p2').map((l) => l.text)).toEqual(['p2-data', 'p2-live'])
    })

    it('fetch failure still applies buffered SSE events', async () => {
      let resolve!: () => void
      const fetchPromise = new Promise<void>((r) => {
        resolve = r
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => fetchPromise.then(() => ({ ok: false, status: 500 }))),
      )

      const openPromise = ConsoleStore.open('p1')

      dispatchSSE('log', { projectId: 'p1', lines: [line('buffered-1')] })

      resolve()
      await openPromise

      expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['buffered-1'])
    })

    it('truncates merged result to MAX_LINES', async () => {
      const history = Array.from({ length: 480 }, (_, i) => line(`h-${i}`))
      const resolve = deferredFetch({ lines: history })

      const openPromise = ConsoleStore.open('p1')

      const liveLines = Array.from({ length: 40 }, (_, i) => line(`l-${i}`))
      dispatchSSE('log', { projectId: 'p1', lines: liveLines })

      resolve()
      await openPromise

      const result = ConsoleStore.getLines('p1')
      expect(result).toHaveLength(500)
      expect(result[0].text).toBe('h-20')
      expect(result[result.length - 1].text).toBe('l-39')
    })

    it('ignores SSE events for other projects during hydration', async () => {
      const resolve = deferredFetch({ lines: [line('p1-disk')] })

      const openPromise = ConsoleStore.open('p1')

      dispatchSSE('log', { projectId: 'p2', lines: [line('p2-noise')] })

      resolve()
      await openPromise

      expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['p1-disk'])
      expect(ConsoleStore.getLines('p2')).toEqual([])
    })
  })
})
