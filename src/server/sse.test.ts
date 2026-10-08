import { beforeEach, describe, expect, it } from 'vitest'
import { __resetEventId, broadcast, getEventId } from './sse'

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
})
