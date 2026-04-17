import { EventEmitter } from 'node:events'
import type { LocalhostConfig, LogLine } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let storedConfig: LocalhostConfig = {
  scanRoot: '/tmp/Code',
  projects: {},
  pids: {},
  overrides: {},
  hidden: [],
  ignored: [],
  sort: { field: 'name', order: 'asc' },
  customOrder: [],
}

vi.mock('./config-store', () => ({
  readConfig: () => storedConfig,
  writeConfig: vi.fn(),
  updateConfig: vi.fn((fn: (c: LocalhostConfig) => void) => {
    fn(storedConfig)
    return storedConfig
  }),
}))

vi.mock('./listener-scanner', () => ({
  enumerateListeners: () => ({ listeners: [], cwdByPid: new Map() }),
  matchListenersToProjects: () => ({}),
}))

/** Minimal ChildProcess stand-in driven by tests. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 12345
  kill = vi.fn()
}

let fakeChild: FakeChild
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execSync: vi.fn(() => ''),
}))

const {
  detectAllListeners,
  assembleLines,
  startProject,
  getLogs,
  hasLogs,
  __resetLogBuffers,
  __resetActiveProcesses,
} = await import('./process-manager')

function resetConfig(overrides: Partial<LocalhostConfig> = {}) {
  storedConfig = {
    scanRoot: '/tmp/Code',
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
    sort: { field: 'name', order: 'asc' },
    customOrder: [],
    ...overrides,
  } as LocalhostConfig
}

describe('process-manager', () => {
  describe('detectAllListeners', () => {
    it('returns empty object when no projects exist', () => {
      resetConfig()
      const result = detectAllListeners()
      expect(result).toEqual({})
    })

    it('returns empty object when no listeners match', () => {
      resetConfig({
        projects: {
          '/tmp/my-app': {
            name: 'my-app',
            path: '/tmp/my-app',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })
      const result = detectAllListeners()
      expect(result).toEqual({})
    })
  })

  describe('assembleLines', () => {
    it('splits a chunk ending with newline into complete lines with empty partial', () => {
      const { lines, partial } = assembleLines('', 'one\ntwo\n', 'stdout', 1000)
      expect(lines.map((l) => l.text)).toEqual(['one', 'two'])
      expect(partial).toBe('')
    })

    it('retains a trailing partial line across calls', () => {
      const first = assembleLines('', 'hello wor', 'stdout', 1000)
      expect(first.lines).toEqual([])
      expect(first.partial).toBe('hello wor')

      const second = assembleLines(first.partial, 'ld\nnext', 'stdout', 1001)
      expect(second.lines.map((l) => l.text)).toEqual(['hello world'])
      expect(second.partial).toBe('next')
    })

    it('tags each line with the correct stream and timestamp', () => {
      const { lines } = assembleLines('', 'err!\n', 'stderr', 2000)
      expect(lines).toEqual<LogLine[]>([{ stream: 'stderr', ts: 2000, text: 'err!' }])
    })
  })

  describe('ring buffer', () => {
    beforeEach(() => {
      __resetLogBuffers()
      __resetActiveProcesses()
      fakeChild = new FakeChild()
      spawnMock.mockReset()
      spawnMock.mockReturnValue(fakeChild)
      resetConfig()
    })

    it('captures stdout lines into the project buffer', () => {
      startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('line one\nline two\n'))

      const logs = getLogs('p1')
      expect(logs.map((l) => l.text)).toEqual(['line one', 'line two'])
      expect(logs.every((l) => l.stream === 'stdout')).toBe(true)
      expect(hasLogs('p1')).toBe(true)
    })

    it('caps the buffer at 500 lines, dropping the oldest', () => {
      startProject('p1', '/tmp/p1', 'npm', 'dev')
      const chunk = `${Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n')}\n`
      fakeChild.stdout.emit('data', Buffer.from(chunk))

      const logs = getLogs('p1')
      expect(logs).toHaveLength(500)
      expect(logs[0].text).toBe('line 100')
      expect(logs[logs.length - 1].text).toBe('line 599')
    })

    it('flushes a partial-line tail on process exit', () => {
      startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('complete\nno-newline-tail'))
      fakeChild.emit('exit', 0, null)

      const logs = getLogs('p1')
      expect(logs.map((l) => l.text)).toEqual(['complete', 'no-newline-tail'])
    })

    it('retains the buffer after the process exits', () => {
      startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('hello\n'))
      fakeChild.emit('exit', 0, null)

      expect(hasLogs('p1')).toBe(true)
      expect(getLogs('p1').map((l) => l.text)).toEqual(['hello'])
    })

    it('clears the buffer when a project is restarted', () => {
      startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('first run\n'))
      fakeChild.emit('exit', 0, null)

      // Fresh fake for the second run so the original's listeners don't fire.
      fakeChild = new FakeChild()
      spawnMock.mockReturnValue(fakeChild)
      startProject('p1', '/tmp/p1', 'npm', 'dev')

      const logs = getLogs('p1')
      expect(logs).toEqual([])
    })

    it('batches new lines and invokes onLogs after the debounce window', async () => {
      const onLogs = vi.fn()
      startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, onLogs)
      fakeChild.stdout.emit('data', Buffer.from('one\ntwo\n'))
      fakeChild.stdout.emit('data', Buffer.from('three\n'))

      // Batch window is ~50ms; wait a bit longer to be safe.
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(onLogs).toHaveBeenCalledTimes(1)
      const [pid, lines] = onLogs.mock.calls[0]
      expect(pid).toBe('p1')
      expect((lines as LogLine[]).map((l) => l.text)).toEqual(['one', 'two', 'three'])
    })
  })
})
