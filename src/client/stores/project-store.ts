import type {
  CrashInfo,
  GroupConfig,
  HealthStatus,
  PortType,
  Project,
  Visibility,
} from '@shared/types'
import { off, on } from '../sse-client'

type Listener = () => void

const listeners = new Set<Listener>()
let projects: Project[] = []
let groupConfig: GroupConfig = { groups: [], assignments: {} }

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
      ? {
          ...p,
          processState: 'running' as const,
          spawnedByUs: true,
          crashInfo: null,
          healthStatus: null,
          resourceUsage: null,
        }
      : p,
  )
  notify()
}

function handleProcessStopped(data: unknown) {
  const { projectId } = data as { projectId: string }
  projects = projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          processState: 'stopped' as const,
          listeners: [],
          healthStatus: null,
          resourceUsage: null,
        }
      : p,
  )
  notify()
}

function notifyCrash(projectId: string, exitCode: number | null, signal: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const project = projects.find((p) => p.id === projectId)
  const name = project?.name ?? projectId
  const details: string[] = []
  if (exitCode !== null) details.push(`exit ${exitCode}`)
  if (signal) details.push(signal)
  new Notification(`${name} crashed`, {
    body: details.length > 0 ? details.join(' · ') : 'Process exited unexpectedly',
    tag: `crash-${projectId}`,
  })
}

function handleProcessCrashed(data: unknown) {
  const { projectId, exitCode, signal, timestamp } = data as CrashInfo & { projectId: string }
  projects = projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          processState: 'stopped' as const,
          listeners: [],
          crashInfo: { timestamp, exitCode, signal },
          healthStatus: null,
          resourceUsage: null,
        }
      : p,
  )
  notify()
  notifyCrash(projectId, exitCode, signal)
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

function handleHealthChanged(data: unknown) {
  const { projectId, status } = data as { projectId: string; status: HealthStatus | null }
  projects = projects.map((p) => (p.id === projectId ? { ...p, healthStatus: status } : p))
  notify()
}

function handleResourceUpdate(data: unknown) {
  const { projectId, cpu, memory } = data as { projectId: string; cpu: number; memory: number }
  projects = projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          resourceUsage: {
            cpu,
            memory,
            pids: p.resourceUsage?.pids ?? [],
            sampledAt: new Date().toISOString(),
          },
        }
      : p,
  )
  notify()
}

function handleProjectUpdated(_data: unknown) {
  notify()
}

function handleGroupsChanged(data: unknown) {
  const { groups } = data as { groups: GroupConfig }
  groupConfig = groups
  projects = projects.map((p) => ({
    ...p,
    group: groupConfig.assignments[p.id] ?? null,
  }))
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
    on('process-crashed', handleProcessCrashed)
    on('port-detected', handlePortDetected)
    on('project-updated', handleProjectUpdated)
    on('health-changed', handleHealthChanged)
    on('resource-update', handleResourceUpdate)
    on('groups-changed', handleGroupsChanged)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  },

  destroy() {
    off('scan-complete', handleScanComplete)
    off('process-started', handleProcessStarted)
    off('process-stopped', handleProcessStopped)
    off('process-crashed', handleProcessCrashed)
    off('port-detected', handlePortDetected)
    off('project-updated', handleProjectUpdated)
    off('health-changed', handleHealthChanged)
    off('resource-update', handleResourceUpdate)
    off('groups-changed', handleGroupsChanged)
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

  getGroupConfig(): GroupConfig {
    return groupConfig
  },

  setGroupConfig(config: GroupConfig) {
    groupConfig = config
    notify()
  },
}
