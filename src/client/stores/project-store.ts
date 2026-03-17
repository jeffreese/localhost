import type { Project, Visibility } from '@shared/types'
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
    p.id === projectId ? { ...p, processState: 'running' as const } : p,
  )
  notify()
}

function handleProcessStopped(data: unknown) {
  const { projectId } = data as { projectId: string }
  projects = projects.map((p) =>
    p.id === projectId ? { ...p, processState: 'stopped' as const, pid: null, port: null } : p,
  )
  notify()
}

function handlePortDetected(data: unknown) {
  const { projectId, port } = data as { projectId: string; port: number }
  projects = projects.map((p) => (p.id === projectId ? { ...p, port } : p))
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
