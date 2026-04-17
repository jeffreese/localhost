import { type ChildProcess, execSync, spawn } from 'node:child_process'
import type { Listener, LogLine, PackageManager } from '@shared/types'
import { readConfig, updateConfig } from './config-store'
import { enumerateListeners, matchListenersToProjects } from './listener-scanner'

const activeProcesses = new Map<string, ChildProcess>()

/** Ring buffer of captured stdout/stderr lines per project. Retained across process exit so users can inspect why a process died. */
const logBuffers = new Map<string, LogLine[]>()

const MAX_LOG_LINES = 500
const LOG_BATCH_WINDOW_MS = 50

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

function appendLogLines(projectId: string, lines: LogLine[]) {
  if (lines.length === 0) return
  let buffer = logBuffers.get(projectId)
  if (!buffer) {
    buffer = []
    logBuffers.set(projectId, buffer)
  }
  buffer.push(...lines)
  if (buffer.length > MAX_LOG_LINES) {
    buffer.splice(0, buffer.length - MAX_LOG_LINES)
  }
}

/**
 * Splits a chunk of stream data into complete lines, preserving any trailing
 * partial line as state for the next call. Exported for testing.
 */
export function assembleLines(
  partialIn: string,
  chunk: string,
  stream: 'stdout' | 'stderr',
  ts: number,
): { lines: LogLine[]; partial: string } {
  const text = partialIn + chunk
  const parts = text.split('\n')
  const partial = parts.pop() ?? ''
  const lines: LogLine[] = parts.map((line) => ({ stream, ts, text: line }))
  return { lines, partial }
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
  onLogs?: (projectId: string, lines: LogLine[]) => void,
): ChildProcess {
  if (activeProcesses.has(projectId)) {
    throw new Error(`Project ${projectId} is already running`)
  }

  // Fresh start = fresh console. Clear any retained buffer from a prior run.
  logBuffers.delete(projectId)

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

  let portFound = false
  const partial = { stdout: '', stderr: '' }
  let pendingBatch: LogLine[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  const flushBatch = () => {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    if (pendingBatch.length === 0) return
    const lines = pendingBatch
    pendingBatch = []
    onLogs?.(projectId, lines)
  }

  const scheduleBatchFlush = () => {
    if (batchTimer) return
    batchTimer = setTimeout(flushBatch, LOG_BATCH_WINDOW_MS)
  }

  const handleChunk = (stream: 'stdout' | 'stderr', data: Buffer) => {
    const { lines: newLines, partial: nextPartial } = assembleLines(
      partial[stream],
      data.toString(),
      stream,
      Date.now(),
    )
    partial[stream] = nextPartial

    if (newLines.length > 0) {
      appendLogLines(projectId, newLines)
      pendingBatch.push(...newLines)
      scheduleBatchFlush()
    }

    if (!portFound) {
      for (const { text } of newLines) {
        const port = detectPort(text)
        if (port) {
          portFound = true
          onPortDetected?.(projectId, port)
          break
        }
      }
    }
  }

  child.stdout?.on('data', (d) => handleChunk('stdout', d))
  child.stderr?.on('data', (d) => handleChunk('stderr', d))

  child.on('exit', () => {
    // Flush any partial-line tails so the final line isn't silently lost.
    const tailLines: LogLine[] = []
    for (const stream of ['stdout', 'stderr'] as const) {
      if (partial[stream].length > 0) {
        tailLines.push({ stream, ts: Date.now(), text: partial[stream] })
        partial[stream] = ''
      }
    }
    if (tailLines.length > 0) {
      appendLogLines(projectId, tailLines)
      pendingBatch.push(...tailLines)
    }
    flushBatch()

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

/** Snapshot of the current log ring buffer for a project. */
export function getLogs(projectId: string): LogLine[] {
  return logBuffers.get(projectId)?.slice() ?? []
}

/** True when Localhost has captured any output for this project in the current session. */
export function hasLogs(projectId: string): boolean {
  return logBuffers.has(projectId)
}

/** Test-only: reset captured buffers between runs. */
export function __resetLogBuffers(): void {
  logBuffers.clear()
}

/** Test-only: clear the active process map (does not kill anything). */
export function __resetActiveProcesses(): void {
  activeProcesses.clear()
}
