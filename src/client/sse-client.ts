type SSEHandler = (data: unknown) => void

const handlers = new Map<string, Set<SSEHandler>>()
let eventSource: EventSource | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

export function connect(url = '/api/events'): void {
  if (eventSource) return

  eventSource = new EventSource(url)

  eventSource.addEventListener('scan-complete', (e) => emit('scan-complete', JSON.parse(e.data)))
  eventSource.addEventListener('process-started', (e) =>
    emit('process-started', JSON.parse(e.data)),
  )
  eventSource.addEventListener('process-stopped', (e) =>
    emit('process-stopped', JSON.parse(e.data)),
  )
  eventSource.addEventListener('port-detected', (e) => emit('port-detected', JSON.parse(e.data)))
  eventSource.addEventListener('project-updated', (e) =>
    emit('project-updated', JSON.parse(e.data)),
  )
  eventSource.addEventListener('preferences-updated', (e) =>
    emit('preferences-updated', JSON.parse(e.data)),
  )

  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
    // Auto-reconnect after 3 seconds
    reconnectTimeout = setTimeout(() => connect(url), 3000)
  }
}

export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  eventSource?.close()
  eventSource = null
}

export function on(event: string, handler: SSEHandler): void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set())
  }
  handlers.get(event)?.add(handler)
}

export function off(event: string, handler: SSEHandler): void {
  handlers.get(event)?.delete(handler)
}

function emit(event: string, data: unknown): void {
  const eventHandlers = handlers.get(event)
  if (eventHandlers) {
    for (const handler of eventHandlers) {
      handler(data)
    }
  }
}
