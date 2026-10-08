import type { LogLine } from '@shared/types'
import { off, on } from '../sse-client'

type Listener = () => void

const listeners = new Set<Listener>()
const logsByProject = new Map<string, LogLine[]>()
let openProjectId: string | null = null
let hydrationBuffer: LogLine[] | null = null
let hydrationProjectId: string | null = null
let hydrationHistoryInvalidated = false

const MAX_LINES = 500

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function truncate(lines: LogLine[]): LogLine[] {
  if (lines.length > MAX_LINES) {
    return lines.slice(lines.length - MAX_LINES)
  }
  return lines
}

function appendLines(projectId: string, lines: LogLine[]) {
  const existing = logsByProject.get(projectId) ?? []
  logsByProject.set(projectId, truncate(existing.concat(lines)))
}

function handleLogEvent(data: unknown) {
  const { projectId, lines } = data as { projectId: string; lines: LogLine[] }

  if (hydrationBuffer !== null && projectId === hydrationProjectId) {
    hydrationBuffer.push(...lines)
    return
  }

  if (!logsByProject.has(projectId)) {
    return
  }
  appendLines(projectId, lines)
  notify()
}

function handleProcessStarted(data: unknown) {
  const { projectId } = data as { projectId: string }

  if (hydrationBuffer !== null && projectId === hydrationProjectId) {
    hydrationBuffer.length = 0
    hydrationHistoryInvalidated = true
    return
  }

  if (logsByProject.has(projectId)) {
    logsByProject.set(projectId, [])
    notify()
  }
}

export const ConsoleStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  init() {
    on('log', handleLogEvent)
    on('process-started', handleProcessStarted)
  },

  destroy() {
    off('log', handleLogEvent)
    off('process-started', handleProcessStarted)
  },

  async open(projectId: string) {
    openProjectId = projectId

    hydrationBuffer = []
    hydrationProjectId = projectId
    hydrationHistoryInvalidated = false

    let history: LogLine[] = []
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/logs`)
      if (!res.ok) throw new Error(`Log fetch failed: ${res.status}`)
      const data: { lines: LogLine[] } = await res.json()
      history = data.lines
    } catch {
      // Fetch failed — start with empty history; buffered SSE events still apply.
    }

    if (openProjectId !== projectId) {
      if (hydrationProjectId === projectId) {
        hydrationBuffer = null
        hydrationProjectId = null
        hydrationHistoryInvalidated = false
      }
      return
    }

    if (hydrationBuffer === null) {
      return
    }

    if (hydrationHistoryInvalidated) {
      history = []
      hydrationHistoryInvalidated = false
    }

    const merged = truncate(history.concat(hydrationBuffer))
    hydrationBuffer = null
    hydrationProjectId = null

    logsByProject.set(projectId, merged)
    notify()
  },

  close() {
    openProjectId = null
    notify()
  },

  isOpen(): boolean {
    return openProjectId !== null
  },

  getOpenProjectId(): string | null {
    return openProjectId
  },

  getLines(projectId: string): LogLine[] {
    return logsByProject.get(projectId) ?? []
  },

  /** Test-only: reset all module state between runs. */
  __reset() {
    logsByProject.clear()
    openProjectId = null
    hydrationBuffer = null
    hydrationProjectId = null
    hydrationHistoryInvalidated = false
    listeners.clear()
  },
}
