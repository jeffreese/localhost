import type { PortType } from '@shared/types'

export type { PortType }

const DEFAULT_TIMEOUT_MS = 2000

export async function probePort(port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PortType> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: controller.signal,
    })
    return 'http'
  } catch {
    return 'tcp'
  } finally {
    clearTimeout(timer)
  }
}

const portTypeCache = new Map<number, PortType>()

export function setPortType(port: number, type: PortType): void {
  portTypeCache.set(port, type)
}

export function getPortType(port: number): PortType | undefined {
  return portTypeCache.get(port)
}

export function deletePortType(port: number): void {
  portTypeCache.delete(port)
}

export function clearPortTypeCache(): void {
  portTypeCache.clear()
}
