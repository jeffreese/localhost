import { type ChildProcess, execFile, spawn } from 'node:child_process'
import type { CrashInfo, Listener, LogLine, PackageManager } from '@shared/types'
import { readConfig, updateConfig } from './config-store'
import { enumerateListeners, matchListenersToProjects, parseCwdOutput } from './listener-scanner'
import { appendLines as appendToLogFile, closeLogs } from './log-store'

const activeProcesses = new Map<string, ChildProcess>()

const stoppingProjects = new Set<string>()

function markStopping(projectId: string): void {
  stoppingProjects.add(projectId)
}

export function clearStopping(projectId: string): void {
  stoppingProjects.delete(projectId)
}

export function isStopping(projectId: string): boolean {
  return stoppingProjects.has(projectId)
}

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

export type CrashEvent = CrashInfo & { projectId: string }

export async function startProject(
  projectId: string,
  projectPath: string,
  packageManager: PackageManager,
  devScript: string,
  onPortDetected?: (projectId: string, port: number) => void,
  onLogs?: (projectId: string, lines: LogLine[]) => void,
  portOverride?: number,
  onCrash?: (event: CrashEvent) => void,
): Promise<ChildProcess> {
  if (activeProcesses.has(projectId)) {
    throw new Error(`Project ${projectId} is already running`)
  }

  clearStopping(projectId)

  // Fresh start = fresh console. Clear any retained buffer from a prior run.
  logBuffers.delete(projectId)

  const env: Record<string, string | undefined> = {
    ...process.env,
    FORCE_COLOR: '1',
  }
  if (portOverride !== undefined) {
    env.PORT = String(portOverride)
  }

  const [cmd, args] = buildCommand(packageManager, devScript)
  const child = spawn(cmd, args, {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env,
  })

  activeProcesses.set(projectId, child)

  if (child.pid !== undefined) {
    const pid = child.pid
    await updateConfig((config) => {
      config.pids[projectId] = pid
      delete config.crashes[projectId]
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
      appendToLogFile(projectId, newLines).catch((err) =>
        console.error(`Log file write failed for ${projectId}:`, err),
      )
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

  child.on('exit', (code, signal) => {
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

    const closeLogFile = () =>
      closeLogs(projectId).catch((err) =>
        console.error(`Log file close failed for ${projectId}:`, err),
      )

    if (tailLines.length > 0) {
      appendToLogFile(projectId, tailLines)
        .catch((err) => console.error(`Log file write failed for ${projectId}:`, err))
        .finally(closeLogFile)
    } else {
      closeLogFile()
    }

    const crashed = !isStopping(projectId)
    const crashTimestamp = new Date().toISOString()

    if (crashed && onCrash) {
      onCrash({
        projectId,
        exitCode: code,
        signal: signal ?? null,
        timestamp: crashTimestamp,
      })
    }

    activeProcesses.delete(projectId)
    updateConfig((config) => {
      delete config.pids[projectId]
      if (crashed) {
        config.crashes[projectId] = {
          timestamp: crashTimestamp,
          exitCode: code,
          signal: signal ?? null,
        }
      }
    }).catch(() => {})
  })

  return child
}

function execAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf-8', timeout: 5000 }, (_err, stdout) => {
      resolve(stdout ?? '')
    })
  })
}

/**
 * Verify a PID is alive and its cwd matches the expected project path.
 * Returns true if safe to signal, false if stale.
 */
export async function verifyPid(pid: number, expectedPath: string): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    // ESRCH = dead, EPERM = not ours — either way, unsafe to signal
    return false
  }

  const output = await execAsync('lsof', ['-p', String(pid), '-d', 'cwd', '-F', 'pn'])
  const cwdByPid = parseCwdOutput(output)
  const cwd = cwdByPid.get(pid)
  if (!cwd) return false

  return cwd === expectedPath || cwd.startsWith(`${expectedPath}/`)
}

export async function stopProject(projectId: string): Promise<void> {
  markStopping(projectId)

  const child = activeProcesses.get(projectId)

  if (!child) {
    const config = await readConfig()
    const pid = config.pids[projectId]
    if (!pid) {
      clearStopping(projectId)
      return
    }
    const projectPath = config.projects[projectId]?.path
    if (!projectPath || !(await verifyPid(pid, projectPath))) {
      await updateConfig((c) => {
        delete c.pids[projectId]
      })
      clearStopping(projectId)
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // Process group already dead
    }
    await updateConfig((c) => {
      delete c.pids[projectId]
    })
    clearStopping(projectId)
    return
  }

  const pid = child.pid
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // Process group already dead
        }
      } else {
        child.kill('SIGKILL')
      }
    }, 5000)

    child.on('exit', () => {
      clearTimeout(timeout)
      resolve()
    })

    if (pid !== undefined) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // Process group already dead
      }
    } else {
      child.kill('SIGTERM')
    }
  })
}

/**
 * Stop a specific listener by PID.
 * Used for granular control over individual processes within a project.
 */
export async function stopListener(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process already dead
  }
}

/**
 * Detect all running projects by enumerating OS TCP listeners
 * and matching their working directories to known project paths.
 */
export async function detectAllListeners(): Promise<Record<string, Listener[]>> {
  const config = await readConfig()
  const projectPaths: Record<string, string> = {}
  for (const [id, cached] of Object.entries(config.projects)) {
    projectPaths[id] = cached.path
  }
  const { listeners, cwdByPid } = await enumerateListeners()
  return matchListenersToProjects(listeners, cwdByPid, projectPaths)
}

/**
 * Remove dead or mismatched PIDs from config.pids on startup.
 * Must run before the first background poll tick.
 */
export async function cleanupStalePids(): Promise<number> {
  const config = await readConfig()
  const entries = Object.entries(config.pids)
  if (entries.length === 0) return 0

  const staleIds: string[] = []
  for (const [projectId, pid] of entries) {
    const projectPath = config.projects[projectId]?.path
    if (!projectPath || !(await verifyPid(pid, projectPath))) {
      staleIds.push(projectId)
    }
  }

  if (staleIds.length > 0) {
    await updateConfig((c) => {
      for (const id of staleIds) {
        delete c.pids[id]
      }
    })
  }

  return staleIds.length
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

/** Test-only: clear all stop flags. */
export function __resetStoppingProjects(): void {
  stoppingProjects.clear()
}
