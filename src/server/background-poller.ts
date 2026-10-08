import type { Listener, PortType } from '@shared/types'
import { deletePortType, getPortType, probePort, setPortType } from './port-probe'
import { clearStopping, detectAllListeners, isStopping } from './process-manager'

export type ListenerMap = Record<string, Listener[]>

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

export type DiffCallback = (diff: ListenerDiff, currentListeners: ListenerMap) => void

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
  setOnDiff(callback: DiffCallback) {
    this.onDiff = callback
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
    } finally {
      this.tickRunning = false
    }
  }
}
