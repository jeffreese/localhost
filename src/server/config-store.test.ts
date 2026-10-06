import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We need to mock the config path before importing the module

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

  it('creates default config when none exists', async () => {
    const config = await readConfig()
    expect(config.scanRoot).toContain('Code')
    expect(config.projects).toEqual({})
    expect(config.pids).toEqual({})
    expect(config.overrides).toEqual({})
    expect(config.hidden).toEqual([])
    expect(config.ignored).toEqual([])
    expect(config.customOrder).toEqual([])
  })

  it('reads existing config', async () => {
    // First create default
    await readConfig()
    const config = await readConfig()
    expect(config.scanRoot).toContain('Code')
  })

  it('recovers from corrupt JSON', async () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), '{not valid json')

    const config = await readConfig()
    expect(config.projects).toEqual({})
    // Backup should exist
    const files = readdirSync(configDir)
    expect(files.some((f: string) => f.includes('.backup.'))).toBe(true)
  })

  it('repairs partial config with missing fields', async () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ scanRoot: '/custom/path' }))

    const config = await readConfig()
    expect(config.scanRoot).toBe('/custom/path')
    expect(config.projects).toEqual({})
    expect(config.hidden).toEqual([])
    expect(config.customOrder).toEqual([])
  })

  it('writes and reads back config', async () => {
    const config = await readConfig()
    config.hidden.push('/some/path')
    await writeConfig(config)

    const reloaded = await readConfig()
    expect(reloaded.hidden).toEqual(['/some/path'])
  })

  it('updateConfig applies mutation and persists', async () => {
    await readConfig() // ensure exists
    const result = await updateConfig((c) => {
      c.ignored.push('/ignore/me')
    })
    expect(result.ignored).toEqual(['/ignore/me'])

    const reloaded = await readConfig()
    expect(reloaded.ignored).toEqual(['/ignore/me'])
  })

  it('writeConfig uses atomic temp+rename (no lingering .tmp file)', async () => {
    const configDir = join(tmpdir(), '.localhost')
    const configPath = join(configDir, 'config.json')
    const tmpPath = `${configPath}.tmp`

    const config = await readConfig()
    config.hidden.push('/atomic/test')
    await writeConfig(config)

    expect(existsSync(tmpPath)).toBe(false)
    const written = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(written.hidden).toContain('/atomic/test')
  })

  it('readConfig recovery paths use atomic writes (no .tmp lingers)', async () => {
    const configDir = join(tmpdir(), '.localhost')
    const configPath = join(configDir, 'config.json')
    const tmpPath = `${configPath}.tmp`

    mkdirSync(configDir, { recursive: true })
    writeFileSync(configPath, '{not valid json')

    await readConfig()

    expect(existsSync(tmpPath)).toBe(false)
    const written = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(written.projects).toEqual({})
  })
})
