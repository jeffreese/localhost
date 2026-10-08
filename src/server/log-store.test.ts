import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LogLine } from '@shared/types'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testHome = mkdtempSync(join(tmpdir(), 'log-store-test-'))

let statOverride: ((...args: unknown[]) => Promise<unknown>) | null = null

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => testHome,
  }
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    stat: (...args: unknown[]) =>
      statOverride
        ? statOverride(...args)
        : (actual.stat as (...a: unknown[]) => Promise<unknown>)(...args),
  }
})

const {
  appendLines,
  readLines,
  __rotateIfNeeded: rotateIfNeeded,
  closeLogs,
  closeAll,
  LOG_DIR,
  __resetLogStore,
  __setHandle,
} = await import('./log-store')

const logsDir = join(testHome, '.localhost', 'logs')

describe('log-store', () => {
  beforeEach(async () => {
    await closeAll()
    __resetLogStore()
    statOverride = null
    if (existsSync(logsDir)) {
      rmSync(logsDir, { recursive: true })
    }
  })

  afterEach(async () => {
    await closeAll()
    __resetLogStore()
  })

  afterAll(() => {
    rmSync(testHome, { recursive: true, force: true })
  })

  it('exports LOG_DIR under ~/.localhost/logs', () => {
    expect(LOG_DIR).toBe(logsDir)
  })

  it('creates the logs directory on first write', async () => {
    expect(existsSync(logsDir)).toBe(false)
    const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'hello' }]
    await appendLines('test-project', lines)
    expect(existsSync(logsDir)).toBe(true)
  })

  it('appends formatted lines to the log file', async () => {
    const ts = new Date('2026-10-05T12:34:56.789Z').getTime()
    const lines: LogLine[] = [
      { stream: 'stdout', ts, text: 'line one' },
      { stream: 'stderr', ts, text: 'line two' },
    ]
    await appendLines('my-app', lines)
    await closeLogs('my-app')

    const content = readFileSync(join(logsDir, 'my-app.log'), 'utf-8')
    expect(content).toBe(
      '[2026-10-05T12:34:56.789Z stdout] line one\n' +
        '[2026-10-05T12:34:56.789Z stderr] line two\n',
    )
  })

  it('appends across multiple calls', async () => {
    const lines1: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'first' }]
    const lines2: LogLine[] = [{ stream: 'stderr', ts: 2000, text: 'second' }]
    await appendLines('multi', lines1)
    await appendLines('multi', lines2)
    await closeLogs('multi')

    const content = readFileSync(join(logsDir, 'multi.log'), 'utf-8')
    const lineCount = content.trim().split('\n').length
    expect(lineCount).toBe(2)
    expect(content).toContain('first')
    expect(content).toContain('second')
  })

  it('rejects empty project ID', async () => {
    const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'hi' }]
    await expect(appendLines('', lines)).rejects.toThrow('Empty project ID')
  })

  it('rejects dots-only project IDs that sanitize to empty', async () => {
    const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'hi' }]
    await expect(appendLines('..', lines)).rejects.toThrow('Empty project ID')
    await expect(appendLines('...', lines)).rejects.toThrow('Empty project ID')
  })

  it('sanitizes path-based project IDs into safe filenames', async () => {
    const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'hi' }]
    await appendLines('/Users/jeff/Code/my-app', lines)
    await closeLogs('/Users/jeff/Code/my-app')

    expect(existsSync(join(logsDir, '_Users_jeff_Code_my-app.log'))).toBe(true)
  })

  it('skips write for empty lines array', async () => {
    await appendLines('empty', [])
    expect(existsSync(join(logsDir, 'empty.log'))).toBe(false)
  })

  it('rotates the log file when it exceeds maxSize during appendLines', async () => {
    const big: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'x'.repeat(100) }]
    await appendLines('rotate-test', big, 50)

    const fresh: LogLine[] = [{ stream: 'stdout', ts: 2000, text: 'after-rotate' }]
    await appendLines('rotate-test', fresh, 50)
    await closeLogs('rotate-test')

    expect(existsSync(join(logsDir, 'rotate-test.log.1'))).toBe(true)
    const rotatedContent = readFileSync(join(logsDir, 'rotate-test.log.1'), 'utf-8')
    expect(rotatedContent).toContain('x'.repeat(100))

    const freshContent = readFileSync(join(logsDir, 'rotate-test.log'), 'utf-8')
    expect(freshContent).toContain('after-rotate')
    expect(freshContent).not.toContain('x'.repeat(100))
  })

  it('does not rotate when file is under maxSize during appendLines', async () => {
    const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'small' }]
    await appendLines('no-rotate', lines, 10000)
    await closeLogs('no-rotate')

    expect(existsSync(join(logsDir, 'no-rotate.log.1'))).toBe(false)
    const content = readFileSync(join(logsDir, 'no-rotate.log'), 'utf-8')
    expect(content).toContain('small')
  })

  it('serializes concurrent appendLines calls to prevent double rotation', async () => {
    const big: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'x'.repeat(100) }]
    await appendLines('concurrent', big, 200)

    const a: LogLine[] = [{ stream: 'stdout', ts: 2000, text: 'aaa' }]
    const b: LogLine[] = [{ stream: 'stdout', ts: 3000, text: 'bbb' }]
    await Promise.all([appendLines('concurrent', a, 50), appendLines('concurrent', b, 50)])
    await closeLogs('concurrent')

    const rotated = readFileSync(join(logsDir, 'concurrent.log.1'), 'utf-8')
    const current = readFileSync(join(logsDir, 'concurrent.log'), 'utf-8')

    expect(rotated).toContain('x'.repeat(100))
    expect(current).toContain('aaa')
    expect(current).toContain('bbb')
  })

  describe('rotateIfNeeded', () => {
    it('returns false when file is under the limit', async () => {
      const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'small' }]
      await appendLines('small-proj', lines)
      await closeLogs('small-proj')

      const rotated = await rotateIfNeeded('small-proj')
      expect(rotated).toBe(false)
    })

    it('rotates when file exceeds the limit', async () => {
      mkdirSync(logsDir, { recursive: true })
      const logFile = join(logsDir, 'big-proj.log')
      const bigContent = 'x'.repeat(100)
      const { writeFile } = await import('node:fs/promises')
      await writeFile(logFile, bigContent)

      const rotated = await rotateIfNeeded('big-proj', 50)
      expect(rotated).toBe(true)
      expect(existsSync(join(logsDir, 'big-proj.log.1'))).toBe(true)
      expect(readFileSync(join(logsDir, 'big-proj.log.1'), 'utf-8')).toBe(bigContent)
    })

    it('returns false when log file does not exist', async () => {
      const rotated = await rotateIfNeeded('no-file')
      expect(rotated).toBe(false)
    })

    it('closes the file handle before rotating', async () => {
      const lines: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'x'.repeat(100) }]
      await appendLines('handle-test', lines)

      const rotated = await rotateIfNeeded('handle-test', 10)
      expect(rotated).toBe(true)

      await appendLines('handle-test', [{ stream: 'stdout', ts: 2000, text: 'fresh' }])
      await closeLogs('handle-test')

      const freshContent = readFileSync(join(logsDir, 'handle-test.log'), 'utf-8')
      expect(freshContent).toContain('fresh')
      expect(freshContent).not.toContain('x'.repeat(50))
    })
  })

  describe('closeLogs', () => {
    it('closes the handle and removes it from the map', async () => {
      await appendLines('close-test', [{ stream: 'stdout', ts: 1000, text: 'hi' }])
      await closeLogs('close-test')

      await closeLogs('close-test')
    })

    it('is a no-op for unknown project', async () => {
      await closeLogs('never-opened')
    })
  })

  describe('closeAll', () => {
    it('closes all open handles', async () => {
      await appendLines('proj-a', [{ stream: 'stdout', ts: 1000, text: 'a' }])
      await appendLines('proj-b', [{ stream: 'stderr', ts: 2000, text: 'b' }])
      await closeAll()

      await appendLines('proj-a', [{ stream: 'stdout', ts: 3000, text: 'a2' }])
      await closeLogs('proj-a')

      const content = readFileSync(join(logsDir, 'proj-a.log'), 'utf-8')
      expect(content).toContain('a2')
    })

    it('closes remaining handles when one close throws', async () => {
      const goodClose = vi.fn()
      const badHandle = { close: vi.fn().mockRejectedValue(new Error('fd already closed')) }
      const goodHandle = { close: goodClose }

      __resetLogStore()
      __setHandle('bad-proj', badHandle as never)
      __setHandle('good-proj', goodHandle as never)

      await closeAll()

      expect(badHandle.close).toHaveBeenCalled()
      expect(goodClose).toHaveBeenCalled()
    })
  })

  describe('rotateIfNeeded error handling', () => {
    it('re-throws non-ENOENT stat errors', async () => {
      const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      statOverride = () => Promise.reject(eacces)

      await expect(rotateIfNeeded('stat-error', 1)).rejects.toThrow('permission denied')
    })
  })

  describe('readLines', () => {
    it('returns empty for a project with no log file', async () => {
      const result = await readLines('nonexistent')
      expect(result).toEqual({ lines: [], hasMore: false })
    })

    it('parses log lines from disk', async () => {
      const ts = new Date('2026-10-05T12:00:00.000Z').getTime()
      const lines: LogLine[] = [
        { stream: 'stdout', ts, text: 'hello world' },
        { stream: 'stderr', ts, text: 'an error' },
      ]
      await appendLines('read-test', lines)
      await closeLogs('read-test')

      const result = await readLines('read-test')
      expect(result.lines).toHaveLength(2)
      expect(result.lines[0]).toEqual({ stream: 'stdout', ts, text: 'hello world' })
      expect(result.lines[1]).toEqual({ stream: 'stderr', ts, text: 'an error' })
      expect(result.hasMore).toBe(false)
    })

    it('respects limit and reports hasMore', async () => {
      const lines: LogLine[] = Array.from({ length: 10 }, (_, i) => ({
        stream: 'stdout' as const,
        ts: 1000 + i,
        text: `line-${i}`,
      }))
      await appendLines('limit-test', lines)
      await closeLogs('limit-test')

      const result = await readLines('limit-test', 3)
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].text).toBe('line-7')
      expect(result.lines[2].text).toBe('line-9')
      expect(result.hasMore).toBe(true)
    })

    it('supports offset for pagination', async () => {
      const lines: LogLine[] = Array.from({ length: 10 }, (_, i) => ({
        stream: 'stdout' as const,
        ts: 1000 + i,
        text: `line-${i}`,
      }))
      await appendLines('offset-test', lines)
      await closeLogs('offset-test')

      const result = await readLines('offset-test', 3, 3)
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].text).toBe('line-4')
      expect(result.lines[2].text).toBe('line-6')
      expect(result.hasMore).toBe(true)
    })

    it('includes lines from the rotated file', async () => {
      const old: LogLine[] = [{ stream: 'stdout', ts: 1000, text: 'old-line' }]
      await appendLines('rotated-read', old, 10)

      const newer: LogLine[] = [{ stream: 'stdout', ts: 2000, text: 'new-line' }]
      await appendLines('rotated-read', newer, 10)
      await closeLogs('rotated-read')

      const result = await readLines('rotated-read', 500)
      expect(result.lines).toHaveLength(2)
      expect(result.lines[0].text).toBe('old-line')
      expect(result.lines[1].text).toBe('new-line')
    })
  })
})
