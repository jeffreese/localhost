import type { LocalhostConfig } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { isPidAlive, reconcileProcess } from './process-manager'

let storedConfig: LocalhostConfig = {
  scanRoot: '/tmp/Code',
  projects: {},
  pids: {},
  overrides: {},
  hidden: [],
  ignored: [],
}

vi.mock('./config-store', () => ({
  readConfig: () => storedConfig,
  writeConfig: vi.fn(),
  updateConfig: vi.fn((fn: (c: LocalhostConfig) => void) => {
    fn(storedConfig)
    return storedConfig
  }),
}))

function resetConfig(overrides: Partial<LocalhostConfig> = {}) {
  storedConfig = {
    scanRoot: '/tmp/Code',
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
    ...overrides,
  }
}

describe('process-manager', () => {
  describe('isPidAlive', () => {
    it('returns true for current process', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it('returns false for non-existent PID', () => {
      expect(isPidAlive(999999)).toBe(false)
    })
  })

  describe('reconcileProcess', () => {
    it('returns stopped when no PID stored', () => {
      resetConfig()
      const state = reconcileProcess('test-project', null)
      expect(state).toBe('stopped')
    })

    it('cleans up dead PID and returns stopped', () => {
      resetConfig({ pids: { 'test-project': 999999 } })
      const state = reconcileProcess('test-project', null)
      expect(state).toBe('stopped')
      expect(storedConfig.pids['test-project']).toBeUndefined()
    })
  })
})
