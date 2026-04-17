import type { LogLine } from '@shared/types'
import { off, on } from '../sse-client'

type Listener = () => void

const listeners = new Set<Listener>()
const logsByProject = new Map<string, LogLine[]>()
let openProjectId: string | null = null

const MAX_LINES = 500

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function appendLines(projectId: string, lines: LogLine[]) {
  const existing = logsByProject.get(projectId) ?? []
  const merged = existing.concat(lines)
  if (merged.length > MAX_LINES) {
    merged.splice(0, merged.length - MAX_LINES)
  }
  logsByProject.set(projectId, merged)
}

function handleLogEvent(data: unknown) {
  const { projectId, lines } = data as { projectId: string; lines: LogLine[] }
  if (!logsByProject.has(projectId)) {
    // Drawer hasn't hydrated yet; skip so we don't duplicate what the fetch will return.
    return
  }
  appendLines(projectId, lines)
  notify()
}

function handleProcessStarted(data: unknown) {
  const { projectId } = data as { projectId: string }
  // A fresh run clears the retained buffer server-side; mirror that on the client.
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
    // Hydrate from server before attaching to SSE deltas.
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/logs`)
      const data: LogLine[] = await res.json()
      logsByProject.set(projectId, data)
    } catch {
      logsByProject.set(projectId, [])
    }
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
    listeners.clear()
  },
}
