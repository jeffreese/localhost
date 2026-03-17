import type { LocalhostConfig } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('./listener-scanner', () => ({
  enumerateListeners: () => ({ listeners: [], cwdByPid: new Map() }),
  matchListenersToProjects: () => ({}),
}))

const { detectAllListeners } = await import('./process-manager')

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
})
