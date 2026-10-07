import type { Listener } from '@shared/types'
import { detectAllListeners } from './process-manager'

export type ListenerMap = Record<string, Listener[]>

export class BackgroundPoller {
  private interval: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private tickRunning = false
  private previousListeners: ListenerMap = {}

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

  private async tick() {
    if (this.tickRunning) return
    this.tickRunning = true
    try {
      this.tickCount++
      const current = await detectAllListeners()
      this.previousListeners = current
    } finally {
      this.tickRunning = false
    }
  }
}
