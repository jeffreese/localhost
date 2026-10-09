import { execFile } from 'node:child_process'
import type { Listener, ProjectTypeEntry } from '@shared/types'
import { readConfig } from './config-store'

interface RawListener {
  pid: number
  port: number
}

function execAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf-8', timeout: 5000 }, (_err, stdout) => {
      resolve(stdout ?? '')
    })
  })
}

/**
 * Build -c flags from registry processNames.
 * Multiple -c flags are OR'd together by lsof.
 */
export function buildCommandFlags(registry: Record<string, ProjectTypeEntry>): string[] {
  const names = new Set<string>()
  for (const entry of Object.values(registry)) {
    if (entry.processNames) {
      for (const name of entry.processNames) {
        names.add(name)
      }
    }
  }
  return [...names].flatMap((c) => ['-c', c])
}

/**
 * Enumerate TCP listeners for dev-server processes and resolve their cwds
 * in two efficient batched lsof calls:
 * 1. lsof -c <...> -iTCP -sTCP:LISTEN → pid+port for dev servers only
 * 2. lsof -c <...> -a -d cwd → pid+cwd for all dev server processes
 */
export async function enumerateListeners(): Promise<{
  listeners: RawListener[]
  cwdByPid: Map<number, string>
}> {
  const config = await readConfig()
  const commandFlags = buildCommandFlags(config.projectTypes)

  if (commandFlags.length === 0) {
    return { listeners: [], cwdByPid: new Map() }
  }

  const listenerOutput = await execAsync('lsof', [
    ...commandFlags,
    '-a',
    '-iTCP',
    '-sTCP:LISTEN',
    '-P',
    '-n',
    '-F',
    'pn',
  ])
  const listeners = parseListenerOutput(listenerOutput)
  if (listeners.length === 0) {
    return { listeners, cwdByPid: new Map() }
  }

  const cwdOutput = await execAsync('lsof', [...commandFlags, '-a', '-d', 'cwd', '-F', 'pn'])
  const cwdByPid = parseCwdOutput(cwdOutput)
  return { listeners, cwdByPid }
}

/**
 * Parse lsof -F pn output (listener query) into pid+port pairs.
 */
export function parseListenerOutput(output: string): RawListener[] {
  const results: RawListener[] = []
  let currentPid: number | null = null

  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      currentPid = Number.parseInt(line.slice(1), 10)
    } else if (line.startsWith('n') && currentPid !== null) {
      const portMatch = line.match(/:(\d+)$/)
      if (portMatch) {
        const port = Number.parseInt(portMatch[1], 10)
        if (port > 0 && port < 65536) {
          results.push({ pid: currentPid, port })
        }
      }
    }
  }

  return results
}

/**
 * Parse lsof -d cwd -F pn output into a pid -> cwd map.
 */
export function parseCwdOutput(output: string): Map<number, string> {
  const result = new Map<number, string>()
  let currentPid: number | null = null

  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      currentPid = Number.parseInt(line.slice(1), 10)
    } else if (line.startsWith('n') && currentPid !== null && line.length > 1) {
      const path = line.slice(1)
      if (path.startsWith('/')) {
        result.set(currentPid, path)
      }
    }
  }

  return result
}

/**
 * Match TCP listeners to projects by comparing listener cwds to project paths.
 * Returns a map of projectId -> matched listeners.
 */
export function matchListenersToProjects(
  listeners: RawListener[],
  cwdByPid: Map<number, string>,
  projectPaths: Record<string, string>,
): Record<string, Listener[]> {
  const result: Record<string, Listener[]> = {}

  const unique = new Map<string, RawListener>()
  for (const l of listeners) {
    unique.set(`${l.pid}:${l.port}`, l)
  }

  const sortedProjects = Object.entries(projectPaths).sort(([, a], [, b]) => b.length - a.length)

  const claimed = new Set<string>()
  for (const listener of unique.values()) {
    const cwd = cwdByPid.get(listener.pid)
    if (!cwd) continue

    for (const [projectId, projectPath] of sortedProjects) {
      if (cwd === projectPath || cwd.startsWith(`${projectPath}/`)) {
        if (!result[projectId]) {
          result[projectId] = []
        }
        const key = `${listener.pid}:${listener.port}`
        if (!claimed.has(key)) {
          result[projectId].push({ pid: listener.pid, port: listener.port })
          claimed.add(key)
        }
        break
      }
    }
  }

  for (const listeners of Object.values(result)) {
    listeners.sort((a, b) => a.port - b.port)
  }

  return result
}
