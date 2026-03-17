import { type ChildProcess, execSync, spawn } from 'node:child_process'
import type { Listener, PackageManager } from '@shared/types'
import { readConfig, updateConfig } from './config-store'
import { enumerateListeners, matchListenersToProjects } from './listener-scanner'

const activeProcesses = new Map<string, ChildProcess>()

/** Strip ANSI escape codes so colored output doesn't break matching */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g

/** Regex to match common dev server port announcements */
const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/,
  /(?:port|Port|PORT)\s*(?::|=)?\s*(\d+)/,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
]

function detectPort(line: string): number | null {
  const clean = line.replace(ANSI_RE, '')
  for (const pattern of PORT_PATTERNS) {
    const match = clean.match(pattern)
    if (match) {
      const port = Number.parseInt(match[1], 10)
      if (port > 0 && port < 65536) return port
    }
  }
  return null
}

function buildCommand(packageManager: PackageManager, script: string): [string, string[]] {
  switch (packageManager) {
    case 'pnpm':
      return ['pnpm', [script]]
    case 'yarn':
      return ['yarn', [script]]
    default:
      return ['npm', ['run', script]]
  }
}

export function startProject(
  projectId: string,
  projectPath: string,
  packageManager: PackageManager,
  devScript: string,
  onPortDetected?: (projectId: string, port: number) => void,
): ChildProcess {
  if (activeProcesses.has(projectId)) {
    throw new Error(`Project ${projectId} is already running`)
  }

  const [cmd, args] = buildCommand(packageManager, devScript)
  const child = spawn(cmd, args, {
    cwd: projectPath,
    stdio: 'pipe',
    detached: false,
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  activeProcesses.set(projectId, child)

  if (child.pid !== undefined) {
    const pid = child.pid
    updateConfig((config) => {
      config.pids[projectId] = pid
    })
  }

  // Watch stdout/stderr for port announcements
  let portFound = false
  const handleOutput = (data: Buffer) => {
    if (portFound) return
    const port = detectPort(data.toString())
    if (port) {
      portFound = true
      onPortDetected?.(projectId, port)
    }
  }
  child.stdout?.on('data', handleOutput)
  child.stderr?.on('data', handleOutput)

  child.on('exit', () => {
    activeProcesses.delete(projectId)
    updateConfig((config) => {
      delete config.pids[projectId]
    })
  })

  return child
}

export function stopProject(projectId: string): Promise<void> {
  return new Promise((resolve) => {
    const child = activeProcesses.get(projectId)

    if (!child) {
      // Not spawned by us — kill via stored PID
      const config = readConfig()
      const pid = config.pids[projectId]
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Process already dead
        }
        updateConfig((c) => {
          delete c.pids[projectId]
        })
      }
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, 5000)

    child.on('exit', () => {
      clearTimeout(timeout)
      activeProcesses.delete(projectId)
      updateConfig((c) => {
        delete c.pids[projectId]
      })
      resolve()
    })

    child.kill('SIGTERM')
  })
}

/**
 * Stop a specific listener by PID.
 * Used for granular control over individual processes within a project.
 */
export function stopListener(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process already dead
  }
}

function getPortOwner(port: number): number | null {
  try {
    const output = execSync(`lsof -i :${port} -t`, { encoding: 'utf-8', timeout: 3000 })
    const pids = output
      .trim()
      .split('\n')
      .map((p) => Number.parseInt(p, 10))
      .filter((p) => !Number.isNaN(p))
    return pids[0] ?? null
  } catch {
    return null
  }
}

/**
 * Detect all running projects by enumerating OS TCP listeners
 * and matching their working directories to known project paths.
 */
export function detectAllListeners(): Record<string, Listener[]> {
  const config = readConfig()
  const projectPaths: Record<string, string> = {}
  for (const [id, cached] of Object.entries(config.projects)) {
    projectPaths[id] = cached.path
  }
  const { listeners, cwdByPid } = enumerateListeners()
  return matchListenersToProjects(listeners, cwdByPid, projectPaths)
}

export function getActiveProcesses(): Map<string, ChildProcess> {
  return activeProcesses
}
