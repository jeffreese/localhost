import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We need to mock the config path before importing the module
const testDir = join(tmpdir(), `localhost-test-${Date.now()}`)
const testConfigPath = join(testDir, 'config.json')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpdir(),
  }
})

const { readConfig, writeConfig, updateConfig } = await import('./config-store')

describe('config-store', () => {
  beforeEach(() => {
    // Clean up any existing .localhost dir in tmpdir
    const configDir = join(tmpdir(), '.localhost')
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
  })

  afterEach(() => {
    const configDir = join(tmpdir(), '.localhost')
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
  })

  it('creates default config when none exists', () => {
    const config = readConfig()
    expect(config.scanRoot).toContain('Code')
    expect(config.projects).toEqual({})
    expect(config.pids).toEqual({})
    expect(config.overrides).toEqual({})
    expect(config.hidden).toEqual([])
    expect(config.ignored).toEqual([])
    expect(config.customOrder).toEqual([])
  })

  it('reads existing config', () => {
    // First create default
    readConfig()
    const config = readConfig()
    expect(config.scanRoot).toContain('Code')
  })

  it('recovers from corrupt JSON', () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), '{not valid json')

    const config = readConfig()
    expect(config.projects).toEqual({})
    // Backup should exist
    const files = readdirSync(configDir)
    expect(files.some((f: string) => f.includes('.backup.'))).toBe(true)
  })

  it('repairs partial config with missing fields', () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ scanRoot: '/custom/path' }))

    const config = readConfig()
    expect(config.scanRoot).toBe('/custom/path')
    expect(config.projects).toEqual({})
    expect(config.hidden).toEqual([])
    expect(config.customOrder).toEqual([])
  })

  it('writes and reads back config', () => {
    const config = readConfig()
    config.hidden.push('/some/path')
    writeConfig(config)

    const reloaded = readConfig()
    expect(reloaded.hidden).toEqual(['/some/path'])
  })

  it('updateConfig applies mutation and persists', () => {
    readConfig() // ensure exists
    const result = updateConfig((c) => {
      c.ignored.push('/ignore/me')
    })
    expect(result.ignored).toEqual(['/ignore/me'])

    const reloaded = readConfig()
    expect(reloaded.ignored).toEqual(['/ignore/me'])
  })
})
