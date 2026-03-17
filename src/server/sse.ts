import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

export type SSEEvent =
  | { type: 'scan-complete'; data: unknown }
  | { type: 'process-started'; data: { projectId: string } }
  | { type: 'process-stopped'; data: { projectId: string } }
  | { type: 'project-updated'; data: { projectId: string } }

type SSEClient = {
  send: (event: SSEEvent) => void
  close: () => void
}

const clients = new Set<SSEClient>()

export function broadcast(event: SSEEvent): void {
  for (const client of clients) {
    client.send(event)
  }
}

export function getClientCount(): number {
  return clients.size
}

export function handleSSE(c: Context) {
  return streamSSE(c, async (stream) => {
    let closed = false

    const client: SSEClient = {
      send: (event) => {
        if (closed) return
        stream
          .writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
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
