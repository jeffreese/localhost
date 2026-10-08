import type { PortType, Project, Visibility } from '@shared/types'
import { off, on } from '../sse-client'

type Listener = () => void

const listeners = new Set<Listener>()
let projects: Project[] = []

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function handleScanComplete(data: unknown) {
  projects = data as Project[]
  notify()
}

function handleProcessStarted(data: unknown) {
  const { projectId } = data as { projectId: string }
  projects = projects.map((p) =>
    p.id === projectId
      ? { ...p, processState: 'running' as const, spawnedByUs: true, crashInfo: null }
      : p,
  )
  notify()
}

function handleProcessStopped(data: unknown) {
  const { projectId } = data as { projectId: string }
  projects = projects.map((p) =>
    p.id === projectId ? { ...p, processState: 'stopped' as const, listeners: [] } : p,
  )
  notify()
}

function handlePortDetected(data: unknown) {
  const { projectId, port, portType } = data as {
    projectId: string
    port: number
    portType?: PortType
  }
  projects = projects.map((p) => {
    if (p.id !== projectId) return p
    const existing = p.listeners.find((l) => l.port === port)
    if (existing) {
      if (portType && existing.portType !== portType) {
        return {
          ...p,
          listeners: p.listeners.map((l) => (l.port === port ? { ...l, portType } : l)),
        }
      }
      return p
    }
    return {
      ...p,
      listeners: [...p.listeners, { pid: 0, port, portType }],
      processState: 'running' as const,
    }
  })
  notify()
}

function handleProjectUpdated(_data: unknown) {
  // Refetch on next getAll — for now just notify to trigger re-render
  notify()
}

export const ProjectStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  init() {
    on('scan-complete', handleScanComplete)
    on('process-started', handleProcessStarted)
    on('process-stopped', handleProcessStopped)
    on('port-detected', handlePortDetected)
    on('project-updated', handleProjectUpdated)
  },

  destroy() {
    off('scan-complete', handleScanComplete)
    off('process-started', handleProcessStarted)
    off('process-stopped', handleProcessStopped)
    off('port-detected', handlePortDetected)
    off('project-updated', handleProjectUpdated)
  },

  getAll(): Project[] {
    return projects
  },

  getVisible(): Project[] {
    return projects.filter((p) => p.visibility === 'visible')
  },

  getByVisibility(visibility: Visibility): Project[] {
    return projects.filter((p) => p.visibility === visibility)
  },

  setProjects(data: Project[]) {
    projects = data
    notify()
  },

  updateVisibility(projectId: string, visibility: Visibility) {
    projects = projects.map((p) => (p.id === projectId ? { ...p, visibility } : p))
    notify()
  },
}
