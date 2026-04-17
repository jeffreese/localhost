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
    const fetched = [line('hello'), line('world')]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => fetched })),
    )

    await ConsoleStore.open('p1')

    expect(ConsoleStore.isOpen()).toBe(true)
    expect(ConsoleStore.getOpenProjectId()).toBe('p1')
    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['hello', 'world'])
  })

  it('appends SSE log events after hydration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => [line('hydrated')] })),
    )

    await ConsoleStore.open('p1')
    dispatchSSE('log', { projectId: 'p1', lines: [line('live-1'), line('live-2')] })

    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['hydrated', 'live-1', 'live-2'])
  })

  it('caps the client-side buffer at 500 lines', async () => {
    const initial = Array.from({ length: 450 }, (_, i) => line(`init-${i}`))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => initial })),
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
      vi.fn(async () => ({ json: async () => [line('old run')] })),
    )

    await ConsoleStore.open('p1')
    dispatchSSE('process-started', { projectId: 'p1' })

    expect(ConsoleStore.getLines('p1')).toEqual([])
  })

  it('ignores log events for closed (non-hydrated) projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => [line('p1 hello')] })),
    )
    await ConsoleStore.open('p1')

    dispatchSSE('log', { projectId: 'p2', lines: [line('orphan')] })

    expect(ConsoleStore.getLines('p2')).toEqual([])
    expect(ConsoleStore.getLines('p1').map((l) => l.text)).toEqual(['p1 hello'])
  })

  it('close() clears the open project but keeps cached lines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => [line('cached')] })),
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
      vi.fn(async () => ({ json: async () => [line('x')] })),
    )
    await ConsoleStore.open('p1')
    dispatchSSE('log', { projectId: 'p1', lines: [line('y')] })
    ConsoleStore.close()

    expect(listener).toHaveBeenCalled()
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
