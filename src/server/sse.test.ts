import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __addClient, __resetEventId, broadcast, getEventId } from './sse'

describe('SSE event IDs', () => {
  beforeEach(() => {
    __resetEventId()
  })

  it('starts at zero', () => {
    expect(getEventId()).toBe(0)
  })

  it('increments on each broadcast', () => {
    broadcast({ type: 'process-started', data: { projectId: 'a' } })
    expect(getEventId()).toBe(1)

    broadcast({ type: 'process-stopped', data: { projectId: 'b' } })
    expect(getEventId()).toBe(2)
  })

  it('increments monotonically across different event types', () => {
    broadcast({ type: 'scan-complete', data: {} })
    broadcast({ type: 'process-started', data: { projectId: 'a' } })
    broadcast({ type: 'port-detected', data: { projectId: 'a', port: 3000 } })

    expect(getEventId()).toBe(3)
  })

  it('resets to zero with __resetEventId', () => {
    broadcast({ type: 'process-started', data: { projectId: 'a' } })
    broadcast({ type: 'process-started', data: { projectId: 'b' } })
    expect(getEventId()).toBe(2)

    __resetEventId()
    expect(getEventId()).toBe(0)
  })

  it('delivers event ID to connected clients', () => {
    const send = vi.fn()
    const remove = __addClient({ send })

    broadcast({ type: 'process-started', data: { projectId: 'a' } })
    expect(send).toHaveBeenCalledWith({ type: 'process-started', data: { projectId: 'a' } }, 1)

    broadcast({ type: 'process-stopped', data: { projectId: 'b' } })
    expect(send).toHaveBeenCalledWith({ type: 'process-stopped', data: { projectId: 'b' } }, 2)

    remove()
  })

  it('delivers same event ID to all connected clients', () => {
    const send1 = vi.fn()
    const send2 = vi.fn()
    const remove1 = __addClient({ send: send1 })
    const remove2 = __addClient({ send: send2 })

    broadcast({ type: 'scan-complete', data: {} })

    expect(send1).toHaveBeenCalledWith({ type: 'scan-complete', data: {} }, 1)
    expect(send2).toHaveBeenCalledWith({ type: 'scan-complete', data: {} }, 1)

    remove1()
    remove2()
  })
})
