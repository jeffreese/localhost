import type { HealthStatus } from '@shared/types'

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 3000
const UNHEALTHY_THRESHOLD = 3

export interface HealthState {
  status: HealthStatus
  consecutiveFailures: number
  lastCheck: number | null
  responseTime: number | null
}

export type HealthChangeCallback = (
  projectId: string,
  status: HealthStatus,
  responseTime: number | null,
) => void

export class HealthChecker {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private state = new Map<string, HealthState>()
  private checking = new Set<string>()
  private onChange: HealthChangeCallback | null = null

  setOnChange(callback: HealthChangeCallback): void {
    this.onChange = callback
  }

  startChecking(projectId: string, port: number, intervalMs = DEFAULT_INTERVAL_MS): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${port}`)
    }
    this.stopChecking(projectId)

    this.state.set(projectId, {
      status: 'unknown',
      consecutiveFailures: 0,
      lastCheck: null,
      responseTime: null,
    })

    this.check(projectId, port).catch((err) => {
      console.error('[HealthChecker] initial check failed for %s:', projectId, err)
    })

    const timer = setInterval(() => {
      this.check(projectId, port).catch((err) => {
        console.error('[HealthChecker] check failed for %s:', projectId, err)
      })
    }, intervalMs)
    this.timers.set(projectId, timer)
  }

  stopChecking(projectId: string): void {
    const timer = this.timers.get(projectId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(projectId)
    }
    this.state.delete(projectId)
    this.checking.delete(projectId)
  }

  stopAll(): void {
    for (const [projectId, timer] of this.timers) {
      clearInterval(timer)
      this.timers.delete(projectId)
    }
    this.state.clear()
    this.checking.clear()
  }

  getStatus(projectId: string): HealthState | null {
    const s = this.state.get(projectId)
    return s ? { ...s } : null
  }

  getAllStatuses(): Record<string, HealthState> {
    const result: Record<string, HealthState> = {}
    for (const [id, s] of this.state) {
      result[id] = { ...s }
    }
    return result
  }

  isChecking(projectId: string): boolean {
    return this.timers.has(projectId)
  }

  private async check(projectId: string, port: number): Promise<void> {
    const current = this.state.get(projectId)
    if (!current) return
    if (this.checking.has(projectId)) return
    this.checking.add(projectId)

    try {
      const { status: newStatus, responseTime } = await probe(port)
      const stillCurrent = this.state.get(projectId)
      if (!stillCurrent) return
      const previousStatus = stillCurrent.status

      if (newStatus === 'healthy') {
        stillCurrent.consecutiveFailures = 0
        stillCurrent.status = 'healthy'
      } else {
        stillCurrent.consecutiveFailures++
        if (stillCurrent.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
          stillCurrent.status = 'unhealthy'
        }
      }

      stillCurrent.lastCheck = Date.now()
      stillCurrent.responseTime = responseTime

      if (stillCurrent.status !== previousStatus) {
        this.onChange?.(projectId, stillCurrent.status, responseTime)
      }
    } finally {
      this.checking.delete(projectId)
    }
  }
}

export async function probe(
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { status: 'unhealthy', responseTime: 0 }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    })
    const responseTime = Date.now() - start
    return { status: res.status < 500 ? 'healthy' : 'unhealthy', responseTime }
  } catch {
    return { status: 'unhealthy', responseTime: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}
