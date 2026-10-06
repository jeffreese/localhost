import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpdir(),
  }
})

let renameOverride: ((...args: unknown[]) => Promise<void>) | null = null

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    rename: (...args: unknown[]) =>
      renameOverride
        ? renameOverride(...args)
        : actual.rename(args[0] as string, args[1] as string),
  }
})

const { readConfig, writeConfig, updateConfig, __resetCache } = await import('./config-store')

describe('config-store', () => {
  beforeEach(() => {
    __resetCache()
    renameOverride = null
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
    expect(config.projectTypes).toEqual({
      'package.json': { name: 'node', detectManager: true, processNames: ['node', 'bun', 'deno'] },
      'Cargo.toml': { name: 'rust', defaultCommand: 'cargo run', processNames: ['cargo'] },
    })
    expect(config.groupConfig).toEqual({ groups: [], assignments: {} })
    expect(config.crashes).toEqual({})
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

  it('__resetCache forces next readConfig to hit disk', async () => {
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
    __resetCache()
    const fresh = await readConfig()
    expect(fresh.hidden).toContain('/after-reset')
    expect(fresh.hidden).not.toContain('/before-reset')
  })

  it('cache is not corrupted when writeConfig fails during updateConfig', async () => {
    await readConfig() // populate cache with defaults

    renameOverride = async () => {
      throw new Error('disk full')
    }

    const failing = updateConfig((c) => {
      c.hidden.push('/should-not-persist')
    })
    await expect(failing).rejects.toThrow('disk full')

    renameOverride = null

    // Cache should still return the pre-mutation state
    const config = await readConfig()
    expect(config.hidden).not.toContain('/should-not-persist')
  })

  it('mutating cold-read return does not corrupt cache (isValidConfig path)', async () => {
    // Prime a valid config on disk, then clear cache to force a cold read
    // through the isValidConfig branch (line 99 of config-store.ts)
    const config = await readConfig()
    config.hidden.push('/seed-value')
    await writeConfig(config)
    __resetCache()

    // Cold read hits disk → isValidConfig → cachedConfig = structuredClone(parsed)
    const first = await readConfig()
    expect(first.hidden).toContain('/seed-value')
    first.hidden.push('/mutated-by-caller')

    // Second read should return the original, not the mutated version
    const second = await readConfig()
    expect(second.hidden).toContain('/seed-value')
    expect(second.hidden).not.toContain('/mutated-by-caller')
  })

  it('mutating object after writeConfig does not corrupt cache', async () => {
    const config = await readConfig()
    config.hidden.push('/before-write')
    await writeConfig(config)

    // Mutate the object that was passed to writeConfig
    config.hidden.push('/after-write-mutation')

    // Cache should not see the post-write mutation
    const cached = await readConfig()
    expect(cached.hidden).toContain('/before-write')
    expect(cached.hidden).not.toContain('/after-write-mutation')
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

  it('old config without new fields gets defaults applied (backward compat)', async () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    const oldConfig = {
      scanRoot: '/Users/test/Code',
      projects: {},
      pids: {},
      overrides: {},
      hidden: ['/some/hidden'],
      ignored: [],
      sort: { field: 'name', order: 'asc' },
      customOrder: [],
    }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(oldConfig))

    const config = await readConfig()
    expect(config.scanRoot).toBe('/Users/test/Code')
    expect(config.hidden).toEqual(['/some/hidden'])
    expect(config.projectTypes['package.json']).toEqual({
      name: 'node',
      detectManager: true,
      processNames: ['node', 'bun', 'deno'],
    })
    expect(config.projectTypes['Cargo.toml']).toEqual({
      name: 'rust',
      defaultCommand: 'cargo run',
      processNames: ['cargo'],
    })
    expect(config.groupConfig).toEqual({ groups: [], assignments: {} })
    expect(config.crashes).toEqual({})
  })

  it('config with existing new fields preserves them (no overwrite)', async () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    const existingConfig = {
      scanRoot: '/Users/test/Code',
      projectTypes: {
        'pyproject.toml': { name: 'python', processNames: ['python3'] },
      },
      projects: {},
      pids: {},
      overrides: {},
      hidden: [],
      ignored: [],
      sort: { field: 'name', order: 'asc' },
      customOrder: [],
      groupConfig: {
        groups: [{ id: 'g1', name: 'Frontend', collapsed: false }],
        assignments: { '/proj/a': 'g1' },
      },
      crashes: {
        '/proj/a': { timestamp: '2026-01-01T00:00:00Z', exitCode: 1, signal: null },
      },
    }
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(existingConfig))

    const config = await readConfig()
    expect(config.projectTypes['pyproject.toml']).toEqual({
      name: 'python',
      processNames: ['python3'],
    })
    expect(config.projectTypes['package.json']).toBeUndefined()
    expect(config.groupConfig.groups).toHaveLength(1)
    expect(config.groupConfig.groups[0].name).toBe('Frontend')
    expect(config.crashes['/proj/a'].exitCode).toBe(1)
  })

  it('repairConfig populates all new fields from partial config', async () => {
    const configDir = join(tmpdir(), '.localhost')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ scanRoot: '/custom' }))

    const config = await readConfig()
    expect(config.scanRoot).toBe('/custom')
    expect(config.projectTypes['package.json'].name).toBe('node')
    expect(config.groupConfig).toEqual({ groups: [], assignments: {} })
    expect(config.crashes).toEqual({})
  })

  describe('integration: concurrent updates', () => {
    it('10 rapid-fire updateConfig calls produce correct final state', async () => {
      await readConfig()

      const promises = Array.from({ length: 10 }, (_, i) =>
        updateConfig((c) => {
          c.hidden.push(`/path-${i}`)
        }),
      )
      const results = await Promise.all(promises)

      const final = results[results.length - 1]
      for (let i = 0; i < 10; i++) {
        expect(final.hidden).toContain(`/path-${i}`)
      }
      expect(final.hidden).toHaveLength(10)

      const fromDisk = await readConfig()
      expect(fromDisk.hidden).toHaveLength(10)
    })

    it('interleaved reads and writes maintain consistency', async () => {
      await readConfig()

      await updateConfig((c) => {
        c.ignored.push('/first')
      })
      const mid = await readConfig()
      expect(mid.ignored).toEqual(['/first'])

      await updateConfig((c) => {
        c.ignored.push('/second')
      })
      const final = await readConfig()
      expect(final.ignored).toEqual(['/first', '/second'])
    })

    it('concurrent updates to different fields do not interfere', async () => {
      await readConfig()

      const results = await Promise.all([
        updateConfig((c) => {
          c.hidden.push('/hidden-path')
        }),
        updateConfig((c) => {
          c.ignored.push('/ignored-path')
        }),
        updateConfig((c) => {
          c.customOrder.push('proj-1')
        }),
      ])

      const final = results[results.length - 1]
      expect(final.hidden).toContain('/hidden-path')
      expect(final.ignored).toContain('/ignored-path')
      expect(final.customOrder).toContain('proj-1')
    })
  })

  describe('integration: crash-during-write recovery', () => {
    it('failed rename leaves original config intact on disk', async () => {
      const configDir = join(tmpdir(), '.localhost')
      const configPath = join(configDir, 'config.json')

      await readConfig()
      await updateConfig((c) => {
        c.hidden.push('/before-crash')
      })

      renameOverride = async () => {
        throw new Error('disk full')
      }

      const failing = updateConfig((c) => {
        c.hidden.push('/during-crash')
      })
      await expect(failing).rejects.toThrow('disk full')

      renameOverride = null

      const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(onDisk.hidden).toContain('/before-crash')
      expect(onDisk.hidden).not.toContain('/during-crash')
    })

    it('cache recovers after write failure — subsequent writes succeed', async () => {
      await readConfig()
      await updateConfig((c) => {
        c.hidden.push('/stable')
      })

      renameOverride = async () => {
        throw new Error('disk full')
      }
      const failing = updateConfig((c) => {
        c.hidden.push('/lost')
      })
      await expect(failing).rejects.toThrow('disk full')

      renameOverride = null

      const recovered = await updateConfig((c) => {
        c.hidden.push('/after-recovery')
      })
      expect(recovered.hidden).toContain('/stable')
      expect(recovered.hidden).not.toContain('/lost')
      expect(recovered.hidden).toContain('/after-recovery')
    })

    it('multiple consecutive write failures do not break the queue', async () => {
      await readConfig()

      renameOverride = async () => {
        throw new Error('disk full')
      }

      await expect(
        updateConfig((c) => {
          c.hidden.push('/fail-1')
        }),
      ).rejects.toThrow('disk full')
      await expect(
        updateConfig((c) => {
          c.hidden.push('/fail-2')
        }),
      ).rejects.toThrow('disk full')

      renameOverride = null

      const result = await updateConfig((c) => {
        c.hidden.push('/success')
      })
      expect(result.hidden).toContain('/success')
      expect(result.hidden).not.toContain('/fail-1')
      expect(result.hidden).not.toContain('/fail-2')
    })
  })

  describe('integration: cache invalidation', () => {
    it('writeConfig updates cache — no stale reads after direct write', async () => {
      const config = await readConfig()
      config.ignored.push('/direct-write')
      await writeConfig(config)

      const cached = await readConfig()
      expect(cached.ignored).toContain('/direct-write')
    })

    it('__resetCache followed by readConfig returns disk state', async () => {
      const configDir = join(tmpdir(), '.localhost')
      const configPath = join(configDir, 'config.json')

      const config = await readConfig()
      config.hidden.push('/in-memory')
      await writeConfig(config)

      const diskConfig = { ...config, hidden: ['/on-disk-only'] }
      writeFileSync(configPath, JSON.stringify(diskConfig, null, 2))

      const stale = await readConfig()
      expect(stale.hidden).toContain('/in-memory')

      __resetCache()
      const fresh = await readConfig()
      expect(fresh.hidden).toContain('/on-disk-only')
      expect(fresh.hidden).not.toContain('/in-memory')
    })

    it('backward-compat defaults persist through concurrent updates', async () => {
      const configDir = join(tmpdir(), '.localhost')
      mkdirSync(configDir, { recursive: true })
      const oldConfig = {
        scanRoot: '/Users/test/Code',
        projects: {},
        pids: {},
        overrides: {},
        hidden: [],
        ignored: [],
        sort: { field: 'name', order: 'asc' },
        customOrder: [],
      }
      writeFileSync(join(configDir, 'config.json'), JSON.stringify(oldConfig))

      const results = await Promise.all([
        updateConfig((c) => {
          c.hidden.push('/path-a')
        }),
        updateConfig((c) => {
          c.hidden.push('/path-b')
        }),
      ])

      const final = results[results.length - 1]
      expect(final.projectTypes['package.json'].name).toBe('node')
      expect(final.groupConfig).toEqual({ groups: [], assignments: {} })
      expect(final.crashes).toEqual({})
      expect(final.hidden).toContain('/path-a')
      expect(final.hidden).toContain('/path-b')
    })

    it('cache is independent across reset cycles', async () => {
      const config1 = await readConfig()
      config1.hidden.push('/cycle-1')
      await writeConfig(config1)

      __resetCache()

      const config2 = await readConfig()
      config2.ignored.push('/cycle-2')
      await writeConfig(config2)

      const final = await readConfig()
      expect(final.hidden).toContain('/cycle-1')
      expect(final.ignored).toContain('/cycle-2')
    })
  })
})
