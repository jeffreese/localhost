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

let tailCallback: ((lines: LogLine[]) => void) | null = null
const mockTailStop = vi.fn()

vi.mock('./log-store', () => ({
  appendLines: vi.fn().mockResolvedValue(undefined),
  closeLogs: vi.fn().mockResolvedValue(undefined),
  openRawOutputFile: vi
    .fn()
    .mockResolvedValue({ fd: 42, close: vi.fn().mockResolvedValue(undefined) }),
  removeRawOutputFile: vi.fn().mockResolvedValue(undefined),
  tailRawOutput: vi.fn((_projectName: string, onLines: (lines: LogLine[]) => void) => {
    tailCallback = onLines
    return { stop: mockTailStop }
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
  startProject,
  stopProject,
  verifyPid,
  cleanupStalePids,
  getLogs,
  hasLogs,
  __resetLogBuffers,
  __resetActiveProcesses,
  __resetStoppingProjects,
} = await import('./process-manager')

const {
  appendLines: mockAppendLines,
  closeLogs: mockCloseLogs,
  openRawOutputFile: mockOpenRawOutputFile,
  removeRawOutputFile: mockRemoveRawOutputFile,
  tailRawOutput: mockTailRawOutput,
} = await import('./log-store')

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
            projectType: 'node',
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
      tailCallback = null
      mockTailStop.mockClear()
      fakeChild = new FakeChild()
      spawnMock.mockReset()
      spawnMock.mockReturnValue(fakeChild)
      vi.mocked(mockOpenRawOutputFile).mockClear()
      vi.mocked(mockRemoveRawOutputFile).mockClear()
      vi.mocked(mockTailRawOutput).mockClear()
      resetConfig()
    })

    it('spawns with detached: true and fd-based stdio', async () => {
      await startProject('p1', '/tmp/p1', 'pnpm', 'dev')

      expect(mockOpenRawOutputFile).toHaveBeenCalledWith('p1')
      expect(spawnMock).toHaveBeenCalledWith('pnpm', ['dev'], {
        cwd: '/tmp/p1',
        stdio: ['ignore', 42, 42],
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
        stdio: ['ignore', 42, 42],
        detached: true,
        env: expect.objectContaining({ FORCE_COLOR: '1', PORT: '4000' }),
      })
    })

    it('does not add PORT env var when portOverride is undefined', async () => {
      const savedPort = process.env.PORT
      Reflect.deleteProperty(process.env, 'PORT')
      try {
        await startProject('p1', '/tmp/p1', 'pnpm', 'dev')
        const spawnEnv = spawnMock.mock.calls[0][2].env
        expect(spawnEnv).not.toHaveProperty('PORT')
      } finally {
        if (savedPort !== undefined) process.env.PORT = savedPort
      }
    })

    it('calls onCrash with exit code and signal when process exits unexpectedly', async () => {
      const onCrash = vi.fn()
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, undefined, undefined, onCrash)
      fakeChild.emit('exit', 1, null)

      expect(onCrash).toHaveBeenCalledWith({
        projectId: 'p1',
        exitCode: 1,
        signal: null,
        timestamp: expect.any(String),
      })
    })

    it('calls onCrash with signal when process is killed externally', async () => {
      const onCrash = vi.fn()
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, undefined, undefined, onCrash)
      fakeChild.emit('exit', null, 'SIGKILL')

      expect(onCrash).toHaveBeenCalledWith({
        projectId: 'p1',
        exitCode: null,
        signal: 'SIGKILL',
        timestamp: expect.any(String),
      })
    })

    it('does not call onCrash when process is user-stopped', async () => {
      const onCrash = vi.fn()
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, undefined, undefined, onCrash)

      const stopPromise = stopProject('p1')
      fakeChild.emit('exit', 0, null)
      await stopPromise

      expect(onCrash).not.toHaveBeenCalled()
    })

    it('does not call onCrash when no callback is provided', async () => {
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      expect(() => fakeChild.emit('exit', 1, null)).not.toThrow()
    })

    it('stores crash info in config on unexpected exit', async () => {
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.emit('exit', 1, 'SIGTERM')

      await vi.waitFor(() => {
        expect(storedConfig.crashes.p1).toEqual({
          timestamp: expect.any(String),
          exitCode: 1,
          signal: 'SIGTERM',
        })
      })
    })

    it('does not store crash info on user-initiated stop', async () => {
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const stopPromise = stopProject('p1')
      fakeChild.emit('exit', 0, null)
      await stopPromise

      await vi.waitFor(() => {
        expect(storedConfig.pids.p1).toBeUndefined()
      })
      expect(storedConfig.crashes.p1).toBeUndefined()
    })

    it('clears crash info on next start', async () => {
      storedConfig.crashes.p1 = {
        timestamp: '2026-10-07T00:00:00Z',
        exitCode: 1,
        signal: null,
      }
      __resetStoppingProjects()
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      expect(storedConfig.crashes.p1).toBeUndefined()
    })
  })

  describe('ring buffer', () => {
    beforeEach(() => {
      __resetLogBuffers()
      __resetActiveProcesses()
      tailCallback = null
      mockTailStop.mockClear()
      fakeChild = new FakeChild()
      spawnMock.mockReset()
      spawnMock.mockReturnValue(fakeChild)
      vi.mocked(mockAppendLines).mockClear()
      vi.mocked(mockCloseLogs).mockClear()
      vi.mocked(mockRemoveRawOutputFile).mockClear()
      vi.mocked(mockTailRawOutput).mockClear()
      resetConfig()
    })

    function emitTailLines(texts: string[]) {
      expect(tailCallback).not.toBeNull()
      const lines: LogLine[] = texts.map((text) => ({
        stream: 'stdout' as const,
        ts: Date.now(),
        text,
      }))
      tailCallback?.(lines)
    }

    it('captures lines from tail callback into the project buffer', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      emitTailLines(['line one', 'line two'])

      const logs = getLogs('p1')
      expect(logs.map((l) => l.text)).toEqual(['line one', 'line two'])
      expect(logs.every((l) => l.stream === 'stdout')).toBe(true)
      expect(hasLogs('p1')).toBe(true)
      expect(mockAppendLines).toHaveBeenCalledWith(
        'p1',
        expect.arrayContaining([
          expect.objectContaining({ stream: 'stdout', text: 'line one' }),
          expect.objectContaining({ stream: 'stdout', text: 'line two' }),
        ]),
      )
    })

    it('caps the buffer at 500 lines, dropping the oldest', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      const texts = Array.from({ length: 600 }, (_, i) => `line ${i}`)
      emitTailLines(texts)

      const logs = getLogs('p1')
      expect(logs).toHaveLength(500)
      expect(logs[0].text).toBe('line 100')
      expect(logs[logs.length - 1].text).toBe('line 599')
    })

    it('stops tail and closes log file on process exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      emitTailLines(['output'])
      fakeChild.emit('exit', 0, null)

      expect(mockTailStop).toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(mockCloseLogs).toHaveBeenCalledWith('p1')
      })
    })

    it('cleans up raw output file on process exit', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      fakeChild.emit('exit', 0, null)

      await vi.waitFor(() => {
        expect(mockRemoveRawOutputFile).toHaveBeenCalledWith('p1')
      })
    })

    it('retains the buffer after the process exits', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      emitTailLines(['hello'])
      fakeChild.emit('exit', 0, null)

      expect(hasLogs('p1')).toBe(true)
      expect(getLogs('p1').map((l) => l.text)).toEqual(['hello'])
    })

    it('clears the buffer when a project is restarted', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      emitTailLines(['first run'])
      fakeChild.emit('exit', 0, null)

      fakeChild = new FakeChild()
      spawnMock.mockReturnValue(fakeChild)
      await startProject('p1', '/tmp/p1', 'npm', 'dev')

      const logs = getLogs('p1')
      expect(logs).toEqual([])
    })

    it('batches new lines and invokes onLogs after the debounce window', async () => {
      const onLogs = vi.fn()
      await startProject('p1', '/tmp/p1', 'npm', 'dev', undefined, onLogs)
      emitTailLines(['one', 'two'])
      emitTailLines(['three'])

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(onLogs).toHaveBeenCalledTimes(1)
      const [pid, lines] = onLogs.mock.calls[0]
      expect(pid).toBe('p1')
      expect((lines as LogLine[]).map((l) => l.text)).toEqual(['one', 'two', 'three'])
    })

    it('starts tailRawOutput for log capture', async () => {
      await startProject('p1', '/tmp/p1', 'npm', 'dev')
      expect(mockTailRawOutput).toHaveBeenCalledWith('p1', expect.any(Function))
    })
  })

  describe('stopProject', () => {
    beforeEach(() => {
      __resetLogBuffers()
      __resetActiveProcesses()
      tailCallback = null
      mockTailStop.mockClear()
      fakeChild = new FakeChild()
      spawnMock.mockReset()
      spawnMock.mockReturnValue(fakeChild)
      vi.mocked(mockOpenRawOutputFile).mockClear()
      vi.mocked(mockTailRawOutput).mockClear()
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
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
            projectType: 'node',
            packageManager: 'npm',
            devScript: 'dev',
            githubUrl: null,
          },
          p2: {
            name: 'p2',
            path: '/tmp/p2',
            projectType: 'node',
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
