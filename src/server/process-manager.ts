import { type ChildProcess, execSync, spawn } from 'node:child_process'
import type { PackageManager, ProcessState } from '@shared/types'
import { readConfig, updateConfig } from './config-store'

const activeProcesses = new Map<string, ChildProcess>()
const detectedPorts = new Map<string, number>()

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

export function getDetectedPort(projectId: string): number | null {
  return detectedPorts.get(projectId) ?? null
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
      detectedPorts.set(projectId, port)
      // Update stored PID to the actual port owner (grandchild process)
      const owner = getPortOwner(port)
      if (owner) {
        updateConfig((config) => {
          config.pids[projectId] = owner
        })
      }
      onPortDetected?.(projectId, port)
    }
  }
  child.stdout?.on('data', handleOutput)
  child.stderr?.on('data', handleOutput)

  child.on('exit', () => {
    activeProcesses.delete(projectId)
    // Only clear PID/port if the detected port is no longer active
    const detectedPort = detectedPorts.get(projectId)
    if (detectedPort) {
      const owner = getPortOwner(detectedPort)
      if (owner) {
        // Grandchild still running — update PID to the survivor
        updateConfig((config) => {
          config.pids[projectId] = owner
        })
        return
      }
    }
    detectedPorts.delete(projectId)
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
      // Try to kill via stored PID
      const config = readConfig()
      const pid = config.pids[projectId]
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Process already dead
        }
      }
      // Also kill port owner if we know the port (handles grandchild processes)
      const detectedPort = detectedPorts.get(projectId)
      if (detectedPort) {
        const owner = getPortOwner(detectedPort)
        if (owner && owner !== pid) {
          try {
            process.kill(owner, 'SIGTERM')
          } catch {
            // Process already dead
          }
        }
        detectedPorts.delete(projectId)
      }
      updateConfig((c) => {
        delete c.pids[projectId]
      })
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

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function getPortOwner(port: number): number | null {
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

export function reconcileProcess(projectId: string, expectedPort: number | null): ProcessState {
  const config = readConfig()
  const storedPid = config.pids[projectId]

  if (!storedPid) {
    // No stored PID — check if port is occupied by something else
    if (expectedPort) {
      const owner = getPortOwner(expectedPort)
      if (owner) return 'port-conflict'
    }
    return 'stopped'
  }

  if (!isPidAlive(storedPid)) {
    // PID is dead — clean up
    updateConfig((c) => {
      delete c.pids[projectId]
    })
    if (expectedPort) {
      const owner = getPortOwner(expectedPort)
      if (owner) return 'port-conflict'
    }
    return 'stopped'
  }

  // PID is alive — verify it owns the expected port
  if (expectedPort) {
    const owner = getPortOwner(expectedPort)
    if (owner === storedPid) return 'running'
    if (owner && owner !== storedPid) return 'port-conflict'
    // lsof failed or port not yet bound — trust PID alive as running
  }

  return 'running'
}

export function reconcileAll(): Record<string, ProcessState> {
  const config = readConfig()
  const states: Record<string, ProcessState> = {}

  for (const [projectId, cached] of Object.entries(config.projects)) {
    const override = config.overrides[projectId]
    const port = override?.port ?? detectedPorts.get(projectId) ?? null
    states[projectId] = reconcileProcess(projectId, port)
  }

  return states
}

export function getActiveProcesses(): Map<string, ChildProcess> {
  return activeProcesses
}
