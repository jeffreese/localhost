import { type FileHandle, mkdir, open, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LogLine } from '@shared/types'

const LOG_DIR = join(homedir(), '.localhost', 'logs')

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024 // 10MB

const fileHandles = new Map<string, FileHandle>()

function validateProjectName(name: string): void {
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.length === 0) {
    throw new Error(`Invalid project name: ${name}`)
  }
}

function logPath(projectName: string): string {
  validateProjectName(projectName)
  return join(LOG_DIR, `${projectName}.log`)
}

function rotatedPath(projectName: string): string {
  return join(LOG_DIR, `${projectName}.log.1`)
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

export async function appendLines(projectName: string, lines: LogLine[]): Promise<void> {
  if (lines.length === 0) return
  const handle = await getHandle(projectName)
  const data = lines.map(formatLine).join('')
  await handle.write(data)
}

export async function rotateIfNeeded(
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
}

export function __setHandle(projectName: string, handle: FileHandle): void {
  fileHandles.set(projectName, handle)
}
