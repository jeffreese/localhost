import { execFile } from 'node:child_process'
import type { Listener, PortType, ResourceUsage } from '@shared/types'
import { deletePortType, getPortType, probePort, setPortType } from './port-probe'
import { clearStopping, detectAllListeners, isStopping } from './process-manager'

export type ListenerMap = Record<string, Listener[]>
export type ResourceMap = Record<string, ResourceUsage>

interface PsEntry {
  pid: number
  cpu: number
  rss: number
}

function execPsAsync(pids: number[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-o', 'pid,pcpu,rss', '-p', pids.join(',')],
      { encoding: 'utf-8', timeout: 5000 },
      (_err, stdout) => {
        resolve(stdout ?? '')
      },
    )
  })
}

export function parsePsOutput(output: string): PsEntry[] {
  const lines = output.trim().split('\n')
  const entries: PsEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length < 3) continue
    const pid = Number.parseInt(parts[0], 10)
    const cpu = Number.parseFloat(parts[1])
    const rss = Number.parseInt(parts[2], 10)
    if (Number.isNaN(pid) || Number.isNaN(cpu) || Number.isNaN(rss)) continue
    entries.push({ pid, cpu, rss: rss * 1024 })
  }
  return entries
}

export function aggregateByProject(listeners: ListenerMap, psEntries: PsEntry[]): ResourceMap {
  const pidLookup = new Map<number, PsEntry>()
  for (const entry of psEntries) {
    pidLookup.set(entry.pid, entry)
  }

  const result: ResourceMap = {}
  const now = new Date().toISOString()

  for (const [projectId, projectListeners] of Object.entries(listeners)) {
    const pids = [...new Set(projectListeners.map((l) => l.pid))]
    let cpu = 0
    let memory = 0
    let matched = false

    for (const pid of pids) {
      const entry = pidLookup.get(pid)
      if (entry) {
        cpu += entry.cpu
        memory += entry.rss
        matched = true
      }
    }

    if (matched) {
      result[projectId] = { cpu, memory, pids, sampledAt: now }
    }
  }

  return result
}

export interface ListenerDiff {
  started: string[]
  stopped: string[]
  crashed: string[]
  portsAdded: Array<{ projectId: string; port: number }>
  portsRemoved: Array<{ projectId: string; port: number }>
}

export function diffListeners(previous: ListenerMap, current: ListenerMap): ListenerDiff {
  const started: string[] = []
  const stopped: string[] = []
  const portsAdded: ListenerDiff['portsAdded'] = []
  const portsRemoved: ListenerDiff['portsRemoved'] = []

  const prevPorts = (listeners: Listener[]) => new Set(listeners.map((l) => l.port))

  for (const projectId of Object.keys(current)) {
    const prev = previous[projectId]
    if (!prev) {
      started.push(projectId)
      continue
    }
    const prevSet = prevPorts(prev)
    const currSet = prevPorts(current[projectId])
    for (const port of currSet) {
      if (!prevSet.has(port)) {
        portsAdded.push({ projectId, port })
      }
    }
    for (const port of prevSet) {
      if (!currSet.has(port)) {
        portsRemoved.push({ projectId, port })
      }
    }
  }

  for (const projectId of Object.keys(previous)) {
    if (!current[projectId]) {
      stopped.push(projectId)
    }
  }

  return { started, stopped, crashed: [], portsAdded, portsRemoved }
}

export type DiffCallback = (
  diff: ListenerDiff,
  currentListeners: ListenerMap,
) => void | Promise<void>

export type ResourceUpdateCallback = (resources: ResourceMap) => void | Promise<void>

export type PollerEvent =
  | { type: 'process-started'; data: { projectId: string } }
  | { type: 'process-stopped'; data: { projectId: string } }
  | {
      type: 'process-crashed'
      data: {
        projectId: string
        exitCode: number | null
        signal: string | null
        timestamp: string
      }
    }
  | { type: 'port-detected'; data: { projectId: string; port: number; portType?: PortType } }

export function broadcastDiff(diff: ListenerDiff, emit: (event: PollerEvent) => void) {
  for (const projectId of diff.started) {
    emit({ type: 'process-started', data: { projectId } })
  }
  for (const projectId of diff.stopped) {
    emit({ type: 'process-stopped', data: { projectId } })
  }
  for (const projectId of diff.crashed) {
    emit({
      type: 'process-crashed',
      data: {
        projectId,
        exitCode: null,
        signal: null,
        timestamp: new Date().toISOString(),
      },
    })
  }
  for (const { projectId, port } of diff.portsAdded) {
    emit({ type: 'port-detected', data: { projectId, port, portType: getPortType(port) } })
  }
}

export class BackgroundPoller {
  private interval: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private tickRunning = false
  private previousListeners: ListenerMap = {}
  private lastDiff: ListenerDiff | null = null
  private onDiff: DiffCallback | null = null
  private resourceUsage: ResourceMap = {}
  private onResourceUpdate: ResourceUpdateCallback | null = null
  setOnDiff(callback: DiffCallback) {
    this.onDiff = callback
  }

  setOnResourceUpdate(callback: ResourceUpdateCallback) {
    this.onResourceUpdate = callback
  }

  getResourceUsage(): ResourceMap {
    return structuredClone(this.resourceUsage)
  }

  start(intervalMs = 5000) {
    if (this.interval) return
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[BackgroundPoller] tick error:', err)
      })
    }, intervalMs)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  isRunning(): boolean {
    return this.interval !== null
  }

  getTickCount(): number {
    return this.tickCount
  }

  getPreviousListeners(): ListenerMap {
    return structuredClone(this.previousListeners)
  }

  getLastDiff(): ListenerDiff | null {
    return this.lastDiff ? structuredClone(this.lastDiff) : null
  }

  private async tick() {
    if (this.tickRunning) return
    this.tickRunning = true
    try {
      this.tickCount++
      const current = await detectAllListeners()
      const previous = this.previousListeners
      const diff = diffListeners(previous, current)

      const userStopped: string[] = []
      for (const projectId of diff.stopped) {
        if (isStopping(projectId)) {
          userStopped.push(projectId)
          clearStopping(projectId)
        } else {
          diff.crashed.push(projectId)
        }
      }
      diff.stopped = userStopped

      this.lastDiff = diff
      this.previousListeners = current
      for (const { port } of diff.portsRemoved) {
        deletePortType(port)
      }
      for (const projectId of [...diff.stopped, ...diff.crashed]) {
        const prevListeners = previous[projectId]
        if (prevListeners) {
          for (const { port } of prevListeners) {
            deletePortType(port)
          }
        }
      }

      const newPorts: Array<{ port: number }> = []
      for (const { port } of diff.portsAdded) {
        newPorts.push({ port })
      }
      for (const projectId of diff.started) {
        const listeners = current[projectId]
        if (listeners) {
          for (const { port } of listeners) {
            newPorts.push({ port })
          }
        }
      }
      const portsToProbe = newPorts.filter(({ port }) => !getPortType(port))
      if (portsToProbe.length > 0) {
        const probes = portsToProbe.map(async ({ port }) => {
          try {
            const type = await probePort(port)
            setPortType(port, type)
          } catch (err) {
            console.error(`[BackgroundPoller] probe port ${port} error:`, err)
          }
        })
        await Promise.all(probes)
      }

      const hasChanges =
        diff.started.length > 0 ||
        diff.stopped.length > 0 ||
        diff.crashed.length > 0 ||
        diff.portsAdded.length > 0 ||
        diff.portsRemoved.length > 0
      if (this.onDiff && hasChanges) {
        try {
          const result: unknown = this.onDiff(structuredClone(diff), structuredClone(current))
          if (result && typeof (result as { catch?: unknown }).catch === 'function') {
            ;(result as Promise<unknown>).catch((err) => {
              console.error('[BackgroundPoller] onDiff error:', err)
            })
          }
        } catch (err) {
          console.error('[BackgroundPoller] onDiff error:', err)
        }
      }

      if (this.tickCount % 3 === 0) {
        await this.sampleResources(current)
      }
    } finally {
      this.tickRunning = false
    }
  }

  private async sampleResources(currentListeners: ListenerMap) {
    const allPids = new Set<number>()
    for (const listeners of Object.values(currentListeners)) {
      for (const { pid } of listeners) {
        allPids.add(pid)
      }
    }

    if (allPids.size === 0) {
      this.resourceUsage = {}
      return
    }

    try {
      const output = await execPsAsync([...allPids])
      const entries = parsePsOutput(output)
      const resources = aggregateByProject(currentListeners, entries)
      this.resourceUsage = resources

      if (this.onResourceUpdate) {
        try {
          const result: unknown = this.onResourceUpdate(structuredClone(resources))
          if (result && typeof (result as { catch?: unknown }).catch === 'function') {
            ;(result as Promise<unknown>).catch((err) => {
              console.error('[BackgroundPoller] onResourceUpdate error:', err)
            })
          }
        } catch (err) {
          console.error('[BackgroundPoller] onResourceUpdate error:', err)
        }
      }
    } catch (err) {
      console.error('[BackgroundPoller] resource sampling error:', err)
    }
  }
}
