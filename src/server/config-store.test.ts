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

const { readConfig, writeConfig, updateConfig, resetCache } = await import('./config-store')

describe('config-store', () => {
  beforeEach(() => {
    resetCache()
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

  it('concurrent updateConfig calls are serialized (no lost writes)', async () => {
    await readConfig() // ensure exists

    const results = await Promise.all([
      updateConfig((c) => {
        c.hidden.push('/path-a')
      }),
      updateConfig((c) => {
        c.hidden.push('/path-b')
      }),
      updateConfig((c) => {
        c.hidden.push('/path-c')
      }),
    ])

    // Each result should reflect its own write plus all prior writes
    expect(results[0].hidden).toContain('/path-a')
    expect(results[1].hidden).toContain('/path-a')
    expect(results[1].hidden).toContain('/path-b')
    expect(results[2].hidden).toContain('/path-a')
    expect(results[2].hidden).toContain('/path-b')
    expect(results[2].hidden).toContain('/path-c')

    // Final state on disk should have all three
    const final = await readConfig()
    expect(final.hidden).toContain('/path-a')
    expect(final.hidden).toContain('/path-b')
    expect(final.hidden).toContain('/path-c')
  })

  it('updateConfig queue survives a failed updater', async () => {
    await readConfig() // ensure exists

    const failing = updateConfig(() => {
      throw new Error('updater boom')
    })
    await expect(failing).rejects.toThrow('updater boom')

    // Queue should still work after the failure
    const result = await updateConfig((c) => {
      c.ignored.push('/after-failure')
    })
    expect(result.ignored).toContain('/after-failure')
  })

  it('readConfig returns cached value on second call (no disk read)', async () => {
    const config = await readConfig()
    config.hidden.push('/cached-test')
    await writeConfig(config)

    // Overwrite the file on disk with different content
    const configDir = join(tmpdir(), '.localhost')
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ ...config, hidden: ['/disk-only'] }, null, 2),
    )

    // readConfig should return the cached version, not the disk version
    const cached = await readConfig()
    expect(cached.hidden).toContain('/cached-test')
    expect(cached.hidden).not.toContain('/disk-only')
  })

  it('writeConfig updates the cache', async () => {
    const config = await readConfig()
    config.ignored.push('/write-cache-test')
    await writeConfig(config)

    // Next read should reflect the write without hitting disk
    const cached = await readConfig()
    expect(cached.ignored).toContain('/write-cache-test')
  })

  it('resetCache forces next readConfig to hit disk', async () => {
    const config = await readConfig()
    config.hidden.push('/before-reset')
    await writeConfig(config)

    // Write different content to disk behind the cache
    const configDir = join(tmpdir(), '.localhost')
    const diskConfig = { ...config, hidden: ['/after-reset'] }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(diskConfig, null, 2))

    // Cache still returns old value
    const cached = await readConfig()
    expect(cached.hidden).toContain('/before-reset')

    // After reset, reads from disk
    resetCache()
    const fresh = await readConfig()
    expect(fresh.hidden).toContain('/after-reset')
    expect(fresh.hidden).not.toContain('/before-reset')
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
