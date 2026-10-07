import { EventEmitter } from 'node:events'
import type { LocalhostConfig, LogLine } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  readConfig: async () => structuredClone(storedConfig),
  writeConfig: vi.fn(async () => {}),
  updateConfig: vi.fn(async (fn: (c: LocalhostConfig) => void) => {
    fn(storedConfig)
    return storedConfig
  }),
}))

vi.mock('./listener-scanner', async (importOriginal) => {
  const original = await importOriginal<typeof import('./listener-scanner')>()
  return {
    enumerateListeners: async () => ({ listeners: [], cwdByPid: new Map() }),
    matchListenersToProjects: () => ({}),
    parseCwdOutput: original.parseCwdOutput,
  }
})

/** Minimal ChildProcess stand-in driven by tests. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 12345
  kill = vi.fn()
}

let fakeChild: FakeChild
const spawnMock = vi.fn()
const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const {
  detectAllListeners,
  assembleLines,
  startProject,
  stopProject,
  verifyPid,
  cleanupStalePids,
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

function mockLsofCwd(pid: number, cwd: string) {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(null, `p${pid}\nn${cwd}\n`)
    },
  )
}

function mockLsofEmpty() {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(null, '')
    },
  )
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

  describe('verifyPid', () => {
    afterEach(() => {
      execFileMock.mockReset()
    })

    it('returns true when PID is alive and cwd matches', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofCwd(9999, '/tmp/my-project')

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(9999, 0)
      killSpy.mockRestore()
    })

    it('returns true when cwd is a subdirectory of expected path', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofCwd(9999, '/tmp/my-project/packages/app')

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(true)
      killSpy.mockRestore()
    })

    it('returns false when PID is dead (ESRCH)', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      })

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(false)
      killSpy.mockRestore()
    })

    it('returns false when PID is owned by another user (EPERM)', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(false)
      killSpy.mockRestore()
    })

    it('returns false when cwd does not match', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofCwd(9999, '/tmp/other-project')

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(false)
      killSpy.mockRestore()
    })

    it('returns false when lsof returns no output', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofEmpty()

      const result = await verifyPid(9999, '/tmp/my-project')
      expect(result).toBe(false)
      killSpy.mockRestore()
    })
  })

  describe('startProject', () => {
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

    it('stores the child PID in config on spawn', async () => {
      const { updateConfig: mockUpdateConfig } = await import('./config-store')
      ;(mockUpdateConfig as ReturnType<typeof vi.fn>).mockClear()
      fakeChild.pid = 54321
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      expect(mockUpdateConfig).toHaveBeenCalledTimes(1)
      expect(storedConfig.pids.p1).toBe(54321)
    })

    it('throws when a project is already running', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      await expect(startProject('p1', '/tmp/p1', 'npm', 'dev')).rejects.toThrow(
        'Project p1 is already running',
      )
    })

    it('removes process from activeProcesses on exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.emit('exit', 0, null)

      // After exit, starting the same project should not throw
      fakeChild = new FakeChild()
      spawnMock.mockReturnValue(fakeChild)
      await expect(startProject('p1', '/tmp/p1', 'npm', 'dev')).resolves.toBeDefined()
    })

    it('removes PID from config on exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      storedConfig.pids.p1 = 12345
      fakeChild.emit('exit', 0, null)

      // Wait for the async updateConfig in the exit handler
      await vi.waitFor(() => {
        expect(storedConfig.pids.p1).toBeUndefined()
      })
    })

    it('passes PORT env var when portOverride is provided', async () => {
      await startProject('p1', '/tmp/p1', 'pnpm', 'dev', undefined, undefined, 4000)

      expect(spawnMock).toHaveBeenCalledWith('pnpm', ['dev'], {
        cwd: '/tmp/p1',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: expect.objectContaining({ FORCE_COLOR: '1', PORT: '4000' }),
      })
    })

    it('does not add PORT env var when portOverride is undefined', async () => {
      await startProject('p1', '/tmp/p1', 'pnpm', 'dev')
      const spawnEnv = spawnMock.mock.calls[0][2].env
      expect(spawnEnv.PORT).toBe(process.env.PORT)
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

    it('sends group SIGTERM to stored PID when verification passes', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      resetConfig({
        pids: { p1: 9999 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })
      mockLsofCwd(9999, '/tmp/p1')

      await stopProject('p1')

      expect(killSpy).toHaveBeenCalledWith(9999, 0)
      expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('skips signal and cleans config when stored PID is dead', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((
        _pid: number,
        signal?: string | number,
      ) => {
        if (signal === 0) {
          const err = new Error('ESRCH') as NodeJS.ErrnoException
          err.code = 'ESRCH'
          throw err
        }
        return true
      }) as typeof process.kill)
      resetConfig({
        pids: { p1: 9999 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      await stopProject('p1')

      expect(killSpy).toHaveBeenCalledWith(9999, 0)
      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('skips signal and cleans config when stored PID cwd mismatches', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      resetConfig({
        pids: { p1: 9999 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })
      mockLsofCwd(9999, '/tmp/other-project')

      await stopProject('p1')

      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('skips signal and cleans config when project path is missing from config', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      resetConfig({ pids: { p1: 9999 } })

      await stopProject('p1')

      expect(killSpy).not.toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('sends group SIGTERM to active child process group and resolves on exit', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM')

      fakeChild.emit('exit', 0, null)
      await stopPromise
      killSpy.mockRestore()
    })

    it('escalates to group SIGKILL after 5s timeout', async () => {
      vi.useFakeTimers()
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM')

      vi.advanceTimersByTime(5000)
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL')

      fakeChild.emit('exit', 0, null)
      await stopPromise
      killSpy.mockRestore()
      vi.useRealTimers()
    })

    it('falls back to child.kill when pid is undefined', async () => {
      fakeChild.pid = undefined as unknown as number
      spawnMock.mockReturnValue(fakeChild)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')

      fakeChild.emit('exit', 0, null)
      await stopPromise
    })

    it('calls updateConfig exactly once on exit (no duplicate from stopProject)', async () => {
      const { updateConfig: mockUpdateConfig } = await import('./config-store')
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      ;(mockUpdateConfig as ReturnType<typeof vi.fn>).mockClear()
      const stopPromise = stopProject('p1')
      fakeChild.emit('exit', 0, null)
      await stopPromise

      expect(mockUpdateConfig).toHaveBeenCalledTimes(1)
      killSpy.mockRestore()
    })

    it('falls back to child.kill(SIGKILL) on escalation when pid is undefined', async () => {
      vi.useFakeTimers()
      fakeChild.pid = undefined as unknown as number
      spawnMock.mockReturnValue(fakeChild)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')

      vi.advanceTimersByTime(5000)
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL')

      fakeChild.emit('exit', 0, null)
      await stopPromise
      vi.useRealTimers()
    })

    it('cleans config when stored PID group signal throws (already dead)', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((
        _pid: number,
        signal?: string | number,
      ) => {
        if (signal === 0) return true
        if (signal === 'SIGTERM') throw new Error('ESRCH')
        return true
      }) as typeof process.kill)
      mockLsofCwd(9999, '/tmp/p1')
      resetConfig({
        pids: { p1: 9999 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      await stopProject('p1')

      expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM')
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('stopping one project does not affect another running project', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      const p1Child = fakeChild

      fakeChild = new FakeChild()
      fakeChild.pid = 67890
      spawnMock.mockReturnValue(fakeChild)
      await startProject('p2', '/tmp/p2', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      p1Child.emit('exit', 0, null)
      await stopPromise

      // p2 should still be startable only after we stop it — trying to start again should throw
      await expect(startProject('p2', '/tmp/p2', 'npm', 'dev')).rejects.toThrow(
        'Project p2 is already running',
      )
      killSpy.mockRestore()
    })
  })

  describe('cleanupStalePids', () => {
    afterEach(() => {
      execFileMock.mockReset()
    })

    it('returns 0 when config.pids is empty', async () => {
      resetConfig({ pids: {} })
      const removed = await cleanupStalePids()
      expect(removed).toBe(0)
    })

    it('removes dead PIDs (ESRCH)', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      })
      resetConfig({
        pids: { p1: 1111 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      const removed = await cleanupStalePids()
      expect(removed).toBe(1)
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('removes PIDs owned by another user (EPERM)', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })
      resetConfig({
        pids: { p1: 2222 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      const removed = await cleanupStalePids()
      expect(removed).toBe(1)
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('removes PIDs with mismatched cwd', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofCwd(3333, '/tmp/wrong-project')
      resetConfig({
        pids: { p1: 3333 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      const removed = await cleanupStalePids()
      expect(removed).toBe(1)
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('removes PIDs with no project path in config', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      resetConfig({ pids: { p1: 4444 } })

      const removed = await cleanupStalePids()
      expect(removed).toBe(1)
      expect(storedConfig.pids.p1).toBeUndefined()
      killSpy.mockRestore()
    })

    it('keeps verified PIDs', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      mockLsofCwd(5555, '/tmp/p1')
      resetConfig({
        pids: { p1: 5555 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      const removed = await cleanupStalePids()
      expect(removed).toBe(0)
      expect(storedConfig.pids.p1).toBe(5555)
      killSpy.mockRestore()
    })

    it('handles a mix of stale and valid PIDs', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((
        pid: number,
        signal?: string | number,
      ) => {
        if (signal === 0 && pid === 1111) {
          const err = new Error('ESRCH') as NodeJS.ErrnoException
          err.code = 'ESRCH'
          throw err
        }
        return true
      }) as typeof process.kill)
      execFileMock.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          const pid = Number(args[1])
          if (pid === 2222) {
            cb(null, 'p2222\nn/tmp/p2\n')
          } else {
            cb(null, '')
          }
        },
      )
      resetConfig({
        pids: { p1: 1111, p2: 2222 },
        projects: {
          p1: {
            name: 'p1',
            path: '/tmp/p1',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
          p2: {
            name: 'p2',
            path: '/tmp/p2',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
        },
      })

      const removed = await cleanupStalePids()
      expect(removed).toBe(1)
      expect(storedConfig.pids.p1).toBeUndefined()
      expect(storedConfig.pids.p2).toBe(2222)
      killSpy.mockRestore()
    })
  })
})
