import { type FSWatcher, watch } from 'node:fs'
import { type FileHandle, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LogLine } from '@shared/types'

const LOG_DIR = join(homedir(), '.localhost', 'logs')

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024 // 10MB

const fileHandles = new Map<string, FileHandle>()

const writeLocks = new Map<string, Promise<void>>()

function safeFilename(projectId: string): string {
  const result = projectId.replace(/[/\\]/g, '_').replace(/^\.+/, '')
  if (result.length === 0) throw new Error('Empty project ID')
  return result
}

function logPath(projectId: string): string {
  return join(LOG_DIR, `${safeFilename(projectId)}.log`)
}

function rotatedPath(projectId: string): string {
  return join(LOG_DIR, `${safeFilename(projectId)}.log.1`)
}

async function getHandle(projectName: string): Promise<FileHandle> {
  const existing = fileHandles.get(projectName)
  if (existing) return existing
  await mkdir(LOG_DIR, { recursive: true })
  const handle = await open(logPath(projectName), 'a')
  fileHandles.set(projectName, handle)
  return handle
}

function formatLine(line: LogLine): string {
  const ts = new Date(line.ts).toISOString()
  return `[${ts} ${line.stream}] ${line.text}\n`
}

export async function appendLines(
  projectName: string,
  lines: LogLine[],
  maxSize: number = DEFAULT_MAX_SIZE,
): Promise<void> {
  if (lines.length === 0) return
  const prev = writeLocks.get(projectName) ?? Promise.resolve()
  const next = prev.then(async () => {
    await rotateIfNeeded(projectName, maxSize)
    const handle = await getHandle(projectName)
    const data = lines.map(formatLine).join('')
    await handle.write(data)
  })
  writeLocks.set(
    projectName,
    next.catch(() => {}),
  )
  return next
}

async function rotateIfNeeded(
  projectName: string,
  maxSize: number = DEFAULT_MAX_SIZE,
): Promise<boolean> {
  const path = logPath(projectName)
  let size: number
  try {
    const s = await stat(path)
    size = s.size
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return false
    throw err
  }
  if (size < maxSize) return false

  await closeLogs(projectName)
  await rename(path, rotatedPath(projectName))
  return true
}

const LINE_PATTERN = /^\[(\S+) (stdout|stderr)] (.*)$/

function parseLine(raw: string): LogLine | null {
  const match = LINE_PATTERN.exec(raw)
  if (!match) return null
  const ts = new Date(match[1]).getTime()
  if (Number.isNaN(ts)) return null
  return {
    ts,
    stream: match[2] as 'stdout' | 'stderr',
    text: match[3],
  }
}

async function readFileLines(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    if (content.length === 0) return []
    const lines = content.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    return lines
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return []
    throw err
  }
}

export async function readLines(
  projectName: string,
  limit = 500,
  offset = 0,
): Promise<{ lines: LogLine[]; hasMore: boolean }> {
  const [current, rotated] = await Promise.all([
    readFileLines(logPath(projectName)),
    readFileLines(rotatedPath(projectName)),
  ])
  const all = [...rotated, ...current]

  const end = all.length - offset
  const start = Math.max(0, end - limit)
  if (end <= 0) return { lines: [], hasMore: false }

  const slice = all.slice(start, end)
  const parsed = slice.reduce<LogLine[]>((acc, raw) => {
    const line = parseLine(raw)
    if (line) acc.push(line)
    return acc
  }, [])

  return { lines: parsed, hasMore: start > 0 }
}

export async function closeLogs(projectName: string): Promise<void> {
  const handle = fileHandles.get(projectName)
  if (!handle) return
  fileHandles.delete(projectName)
  await handle.close()
}

export async function closeAll(): Promise<void> {
  const entries = [...fileHandles.entries()]
  fileHandles.clear()
  for (const [, handle] of entries) {
    try {
      await handle.close()
    } catch (err) {
      console.error('Failed to close log handle:', err)
    }
  }
}

const activeRawPaths = new Map<string, string>()

function rawOutputPath(projectId: string, runId: string): string {
  return join(LOG_DIR, `${safeFilename(projectId)}.${runId}.out`)
}

/**
 * Open a raw output file for stdio redirection. Returns a FileHandle
 * whose .fd property is suitable for spawn()'s stdio array, plus the
 * file path for the tailer. Uses a unique run ID to prevent races
 * between overlapping start/stop cycles. The caller must close the
 * handle after spawn returns — the child inherits the fd.
 */
export async function openRawOutputFile(
  projectName: string,
): Promise<{ handle: FileHandle; rawPath: string }> {
  await mkdir(LOG_DIR, { recursive: true })
  const runId = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  const path = rawOutputPath(projectName, runId)
  activeRawPaths.set(projectName, path)
  const handle = await open(path, 'w')
  return { handle, rawPath: path }
}

export async function removeRawOutputFile(projectName: string): Promise<void> {
  const path = activeRawPaths.get(projectName)
  if (!path) return
  activeRawPaths.delete(projectName)
  try {
    await unlink(path)
  } catch {
    // Already gone or never created
  }
}

export interface TailHandle {
  stop: () => void
}

const MAX_READ_CHUNK = 512 * 1024 // 512KB per tail read
const MAX_PARTIAL_LEN = 16 * 1024 // 16KB partial line cap

/**
 * Tail the raw output file, calling onLines for each batch of new lines.
 * Uses fs.watch for change notifications + incremental reads from the
 * last known offset.
 */
export function tailRawOutput(
  projectName: string,
  onLines: (lines: LogLine[]) => void,
  rawPath?: string,
): TailHandle {
  const resolvedPath = rawPath ?? activeRawPaths.get(projectName)
  if (!resolvedPath) {
    return { stop() {} }
  }
  const filePath = resolvedPath
  let offset = 0
  let reading = false
  let stopped = false
  let watcher: FSWatcher | null = null
  let pendingRead = false
  let partial = ''

  async function readNewContent() {
    if (reading || stopped) {
      pendingRead = true
      return
    }
    reading = true
    try {
      let fileSize: number
      try {
        const s = await stat(filePath)
        fileSize = s.size
      } catch {
        return
      }

      if (fileSize <= offset) {
        if (fileSize < offset) offset = 0
        return
      }

      const readSize = Math.min(fileSize - offset, MAX_READ_CHUNK)
      const handle = await open(filePath, 'r')
      try {
        const buf = Buffer.alloc(readSize)
        const { bytesRead } = await handle.read(buf, 0, readSize, offset)
        offset += bytesRead
        if (bytesRead === 0) return

        const text = partial + buf.toString('utf-8', 0, bytesRead)
        const parts = text.split('\n')
        partial = parts.pop() ?? ''
        if (partial.length > MAX_PARTIAL_LEN) {
          parts.push(partial)
          partial = ''
        }

        const ts = Date.now()
        const lines: LogLine[] = parts.map((line) => ({
          stream: 'stdout' as const,
          ts,
          text: line,
        }))
        if (lines.length > 0) onLines(lines)
      } finally {
        await handle.close()
      }

      // More data to read — schedule another pass
      if (readSize < fileSize - (offset - readSize)) {
        pendingRead = true
      }
    } catch (err) {
      console.error(`Tail read failed for ${projectName}:`, err)
    } finally {
      reading = false
      if (pendingRead && !stopped) {
        pendingRead = false
        readNewContent().catch((err) =>
          console.error(`Tail re-read failed for ${projectName}:`, err),
        )
      }
    }
  }

  function onFileChange() {
    readNewContent().catch((err) =>
      console.error(`Tail watch callback failed for ${projectName}:`, err),
    )
  }

  function startWatcher() {
    try {
      watcher = watch(filePath, onFileChange)
      watcher.on('error', () => {})
      return true
    } catch {
      return false
    }
  }

  if (!startWatcher()) {
    const pollInterval = setInterval(() => {
      if (stopped) {
        clearInterval(pollInterval)
        return
      }
      if (startWatcher()) {
        clearInterval(pollInterval)
        onFileChange()
      }
    }, 200)
  }

  return {
    stop() {
      stopped = true
      if (watcher) {
        watcher.close()
        watcher = null
      }
      if (partial.length > 0) {
        onLines([{ stream: 'stdout', ts: Date.now(), text: partial }])
        partial = ''
      }
    },
  }
}

export { LOG_DIR }

export function __resetLogStore(): void {
  fileHandles.clear()
  writeLocks.clear()
}

export function __setHandle(projectName: string, handle: FileHandle): void {
  fileHandles.set(projectName, handle)
}

export { rotateIfNeeded as __rotateIfNeeded }
