import { type FileHandle, mkdir, open, readFile, rename, stat } from 'node:fs/promises'
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

export { LOG_DIR }

export function __resetLogStore(): void {
  fileHandles.clear()
  writeLocks.clear()
}

export function __setHandle(projectName: string, handle: FileHandle): void {
  fileHandles.set(projectName, handle)
}

export { rotateIfNeeded as __rotateIfNeeded }
