import { EventEmitter } from 'node:events'
import type { LocalhostConfig, LogLine } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let storedConfig: LocalhostConfig = {
  scanRoot: '/tmp/Code',
  projectTypes: {
    'package.json': { name: 'node', detectManager: true, processNames: ['node', 'bun', 'deno'] },
    'Cargo.toml': { name: 'rust', defaultCommand: 'cargo run', processNames: ['cargo'] },
  },
  projects: {},
  pids: {},
  overrides: {},
  hidden: [],
  ignored: [],
  sort: { field: 'name', order: 'asc' },
  customOrder: [],
  groupConfig: { groups: [], assignments: {} },
  crashes: {},
}

vi.mock('./config-store', () => ({
  readConfig: async () => storedConfig,
  writeConfig: vi.fn(async () => {}),
  updateConfig: vi.fn(async (fn: (c: LocalhostConfig) => void) => {
    fn(storedConfig)
    return storedConfig
  }),
}))

vi.mock('./listener-scanner', () => ({
  enumerateListeners: async () => ({ listeners: [], cwdByPid: new Map() }),
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
}))

const {
  detectAllListeners,
  assembleLines,
  startProject,
  stopProject,
  getLogs,
  hasLogs,
  __resetLogBuffers,
  __resetActiveProcesses,
} = await import('./process-manager')

function resetConfig(overrides: Partial<LocalhostConfig> = {}) {
  storedConfig = {
    scanRoot: '/tmp/Code',
    projectTypes: {
      'package.json': { name: 'node', detectManager: true, processNames: ['node', 'bun', 'deno'] },
      'Cargo.toml': { name: 'rust', defaultCommand: 'cargo run', processNames: ['cargo'] },
    },
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
    sort: { field: 'name', order: 'asc' },
    customOrder: [],
    groupConfig: { groups: [], assignments: {} },
    crashes: {},
    ...overrides,
  }
}

describe('process-manager', () => {
  describe('detectAllListeners', () => {
    it('returns empty object when no projects exist', async () => {
      resetConfig()
      const result = await detectAllListeners()
      expect(result).toEqual({})
    })

    it('returns empty object when no listeners match', async () => {
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
      const result = await detectAllListeners()
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

    it('spawns with detached: true and explicit stdio pipes', async () => {
      await startProject('p1', '/tmp/p1', 'pnpm', 'dev')

      expect(spawnMock).toHaveBeenCalledWith('pnpm', ['dev'], {
        cwd: '/tmp/p1',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: expect.objectContaining({ FORCE_COLOR: '1' }),
      })
    })

    it('captures stdout lines into the project buffer', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('line one\nline two\n'))

      const logs = getLogs('p1')
      expect(logs.map((l) => l.text)).toEqual(['line one', 'line two'])
      expect(logs.every((l) => l.stream === 'stdout')).toBe(true)
      expect(hasLogs('p1')).toBe(true)
    })

    it('caps the buffer at 500 lines, dropping the oldest', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      const chunk = `${Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n')}\n`
      fakeChild.stdout.emit('data', Buffer.from(chunk))

      const logs = getLogs('p1')
      expect(logs).toHaveLength(500)
      expect(logs[0].text).toBe('line 100')
      expect(logs[logs.length - 1].text).toBe('line 599')
    })

    it('flushes a partial-line tail on process exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('complete\nno-newline-tail'))
      fakeChild.emit('exit', 0, null)

      const logs = getLogs('p1')
      expect(logs.map((l) => l.text)).toEqual(['complete', 'no-newline-tail'])
    })

    it('retains the buffer after the process exits', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('hello\n'))
      fakeChild.emit('exit', 0, null)

      expect(hasLogs('p1')).toBe(true)
      expect(getLogs('p1').map((l) => l.text)).toEqual(['hello'])
    })

    it('clears the buffer when a project is restarted', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.stdout.emit('data', Buffer.from('first run\n'))
      fakeChild.emit('exit', 0, null)

      // Fresh fake for the second run so the original's listeners don't fire.
      fakeChild = new FakeChild()
      spawnMock.mockReturnValue(fakeChild)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const logs = getLogs('p1')
      expect(logs).toEqual([])
    })

    it('batches new lines and invokes onLogs after the debounce window', async () => {
      const onLogs = vi.fn()
      await startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, onLogs)
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

  describe('stopProject', () => {
    beforeEach(() => {
      __resetLogBuffers()
      __resetActiveProcesses()
      fakeChild = new FakeChild()
      spawnMock.mockReset()
      spawnMock.mockReturnValue(fakeChild)
      resetConfig()
    })

    it('returns cleanly when no active child and no stored PID', async () => {
      resetConfig({ pids: {} })
      await stopProject('p1')
    })

    it('kills stored PID and cleans config when no active child', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      resetConfig({ pids: { p1: 9999 } })

      await stopProject('p1')

      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('sends SIGTERM to active child and resolves on exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')

      fakeChild.emit('exit', 0, null)
      await stopPromise
    })
  })
})
