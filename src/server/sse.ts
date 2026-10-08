import type { LogLine, PortType } from '@shared/types'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

export type SSEEvent =
  | { type: 'scan-complete'; data: unknown }
  | { type: 'process-started'; data: { projectId: string } }
  | { type: 'process-stopped'; data: { projectId: string } }
  | { type: 'process-crashed'; data: { projectId: string } }
  | { type: 'project-updated'; data: { projectId: string } }
  | { type: 'port-detected'; data: { projectId: string; port: number; portType?: PortType } }
  | { type: 'preferences-updated'; data: unknown }
  | { type: 'log'; data: { projectId: string; lines: LogLine[] } }

type SSEClient = {
  send: (event: SSEEvent, id: number) => void
  close: () => void
}

const clients = new Set<SSEClient>()

let eventId = 0

export function broadcast(event: SSEEvent): void {
  eventId++
  for (const client of clients) {
    client.send(event, eventId)
  }
}

export function getEventId(): number {
  return eventId
}

/** Test-only: reset the event ID counter. */
export function __resetEventId() {
  eventId = 0
}

/** Test-only: remove all clients from the broadcast set. */
export function __clearClients() {
  clients.clear()
}

/** Test-only: add a client to the broadcast set. Returns a remove function. */
export function __addClient(client: { send: (event: SSEEvent, id: number) => void }) {
  const wrapped: SSEClient = { send: client.send, close: () => clients.delete(wrapped) }
  clients.add(wrapped)
  return () => clients.delete(wrapped)
}

export function getClientCount(): number {
  return clients.size
}

export function handleSSE(c: Context) {
  return streamSSE(c, async (stream) => {
    let closed = false

    const client: SSEClient = {
      send: (event, id) => {
        if (closed) return
        stream
          .writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
            id: String(id),
          })
          .catch(() => {
            closed = true
            clients.delete(client)
          })
      },
      close: () => {
        closed = true
        clients.delete(client)
      },
    }

    clients.add(client)

    // Keep connection alive
    const keepAlive = setInterval(() => {
      if (closed) {
        clearInterval(keepAlive)
        return
      }
      stream.writeSSE({ event: 'ping', data: '' }).catch(() => {
        closed = true
        clients.delete(client)
        clearInterval(keepAlive)
      })
    }, 30000)

    stream.onAbort(() => {
      closed = true
      clients.delete(client)
      clearInterval(keepAlive)
    })

    // Block until aborted
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve())
    })
  })
}
