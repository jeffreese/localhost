import { execSync } from 'node:child_process'
import type { Listener } from '@shared/types'

interface RawListener {
  pid: number
  port: number
}

/**
 * Run a command and return stdout even if the process exits non-zero.
 * lsof exits 1 when some -c filters have no matches, but still outputs valid data.
 */
function execSyncSafe(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', timeout: 5000 })
  } catch (err: unknown) {
    // execSync throws on non-zero exit, but stdout may still have valid data
    if (err && typeof err === 'object' && 'stdout' in err && typeof err.stdout === 'string') {
      return err.stdout
    }
    return ''
  }
}

/** Commands that commonly run dev servers */
const DEV_SERVER_COMMANDS = ['node', 'bun', 'deno']

/**
 * Build the lsof -c flags to filter by command name.
 * Multiple -c flags are OR'd together by lsof.
 */
const COMMAND_FLAGS = DEV_SERVER_COMMANDS.map((c) => `-c ${c}`).join(' ')

/**
 * Enumerate TCP listeners for dev-server processes and resolve their cwds
 * in two efficient batched lsof calls:
 * 1. lsof -c node -c bun -c deno -iTCP -sTCP:LISTEN → pid+port for dev servers only
 * 2. lsof -c node -c bun -c deno -a -d cwd → pid+cwd for all dev server processes
 */
export function enumerateListeners(): { listeners: RawListener[]; cwdByPid: Map<number, string> } {
  const listenerOutput = execSyncSafe(`lsof ${COMMAND_FLAGS} -a -iTCP -sTCP:LISTEN -P -n -F pn`)
  const listeners = parseListenerOutput(listenerOutput)
  if (listeners.length === 0) {
    return { listeners, cwdByPid: new Map() }
  }

  const cwdOutput = execSyncSafe(`lsof ${COMMAND_FLAGS} -a -d cwd -F pn`)
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
      // Only store filesystem paths (skip socket descriptors, etc.)
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

  // Deduplicate listeners by pid+port
  const unique = new Map<string, RawListener>()
  for (const l of listeners) {
    unique.set(`${l.pid}:${l.port}`, l)
  }

  // Sort project paths longest-first so nested projects match before parents
  const sortedProjects = Object.entries(projectPaths).sort(([, a], [, b]) => b.length - a.length)

  // Match listeners to projects
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
        break // First (most specific) project wins
      }
    }
  }

  // Sort listeners by port within each project
  for (const listeners of Object.values(result)) {
    listeners.sort((a, b) => a.port - b.port)
  }

  return result
}
