import type { Listener } from '@shared/types'
import { detectAllListeners } from './process-manager'

export type ListenerMap = Record<string, Listener[]>

export interface ListenerDiff {
  started: string[]
  stopped: string[]
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

  return { started, stopped, portsAdded, portsRemoved }
}

export type DiffCallback = (diff: ListenerDiff) => void

export function broadcastDiff(
  diff: ListenerDiff,
  emit: (event: { type: string; data: unknown }) => void,
) {
  for (const projectId of diff.started) {
    emit({ type: 'process-started', data: { projectId } })
  }
  for (const projectId of diff.stopped) {
    emit({ type: 'process-stopped', data: { projectId } })
  }
  for (const { projectId, port } of diff.portsAdded) {
    emit({ type: 'port-detected', data: { projectId, port } })
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
      const diff = diffListeners(this.previousListeners, current)
      this.lastDiff = diff
      this.previousListeners = current
      const hasChanges =
        diff.started.length > 0 || diff.stopped.length > 0 || diff.portsAdded.length > 0
      if (this.onDiff && hasChanges) {
        try {
          const result: unknown = this.onDiff(structuredClone(diff))
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
