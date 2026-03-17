import { type ChildProcess, execSync, spawn } from 'node:child_process'
import type { PackageManager, ProcessState } from '@shared/types'
import { readConfig, updateConfig } from './config-store'

const activeProcesses = new Map<string, ChildProcess>()

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
      // Try to kill via stored PID
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
    const port = override?.port ?? null
    states[projectId] = reconcileProcess(projectId, port)
  }

  return states
}

export function getActiveProcesses(): Map<string, ChildProcess> {
  return activeProcesses
}
