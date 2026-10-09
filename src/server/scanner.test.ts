import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectCache } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testRoot = join(tmpdir(), `localhost-scan-test-${Date.now()}`)

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => tmpdir() }
})

vi.mock('./config-store', async () => {
  const actual = await vi.importActual<typeof import('./config-store')>('./config-store')
  return {
    ...actual,
    readConfig: async () => ({
      scanRoot: testRoot,
      projectTypes: {
        'package.json': {
          name: 'node',
          detectManager: true,
          processNames: ['node', 'bun', 'deno'],
        },
        'Cargo.toml': {
          name: 'rust',
          defaultCommand: 'cargo run',
          processNames: ['cargo'],
        },
      },
      projects: {},
      pids: {},
      overrides: {},
      hidden: [],
      ignored: [],
    }),
    updateConfig: vi.fn(),
  }
})

const { scan } = await import('./scanner')

function makeNodeProject(
  name: string,
  opts: { lockFile?: string; scripts?: Record<string, string> } = {},
) {
  const dir = join(testRoot, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, scripts: opts.scripts || { dev: 'vite' } }),
  )
  if (opts.lockFile) {
    writeFileSync(join(dir, opts.lockFile), '')
  }
}

function makeRustProject(name: string) {
  const dir = join(testRoot, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\n`)
}

function firstProject(results: Map<string, ProjectCache>): ProjectCache {
  const value = results.values().next().value
  if (!value) throw new Error('Expected at least one project')
  return value
}

describe('scanner', () => {
  beforeEach(() => {
    mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('discovers projects with package.json', async () => {
    makeNodeProject('my-app')
    const results = await scan()
    expect(results.size).toBe(1)
    const project = firstProject(results)
    expect(project.name).toBe('my-app')
    expect(project.devScript).toBe('dev')
    expect(project.projectType).toBe('node')
  })

  it('detects pnpm from lock file', async () => {
    makeNodeProject('pnpm-app', { lockFile: 'pnpm-lock.yaml' })
    const results = await scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('pnpm')
  })

  it('detects yarn from lock file', async () => {
    makeNodeProject('yarn-app', { lockFile: 'yarn.lock' })
    const results = await scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('yarn')
  })

  it('defaults to npm when no lock file', async () => {
    makeNodeProject('npm-app')
    const results = await scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('npm')
  })

  it('detects start script when dev is missing', async () => {
    makeNodeProject('start-app', { scripts: { start: 'node index.js' } })
    const results = await scan()
    const project = firstProject(results)
    expect(project.devScript).toBe('start')
  })

  it('returns null devScript when none found', async () => {
    makeNodeProject('no-script-app', { scripts: { build: 'tsc' } })
    const results = await scan()
    const project = firstProject(results)
    expect(project.devScript).toBeNull()
  })

  it('discovers multiple projects', async () => {
    makeNodeProject('app-a')
    makeNodeProject('app-b')
    const results = await scan()
    expect(results.size).toBe(2)
  })

  it('discovers Rust projects via Cargo.toml', async () => {
    makeRustProject('my-rust-app')
    const results = await scan()
    expect(results.size).toBe(1)
    const project = firstProject(results)
    expect(project.name).toBe('my-rust-app')
    expect(project.projectType).toBe('rust')
    expect(project.devScript).toBe('cargo run')
    expect(project.packageManager).toBe('npm')
  })

  it('first-match-wins for polyglot projects', async () => {
    const dir = join(testRoot, 'polyglot')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'polyglot', scripts: { dev: 'vite' } }),
    )
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "polyglot"\n')
    const results = await scan()
    expect(results.size).toBe(1)
    const project = firstProject(results)
    expect(project.projectType).toBe('node')
  })

  it('discovers mixed Node and Rust projects', async () => {
    makeNodeProject('web-app')
    makeRustProject('cli-tool')
    const results = await scan()
    expect(results.size).toBe(2)
    const types = [...results.values()].map((p) => p.projectType).sort()
    expect(types).toEqual(['node', 'rust'])
  })
})
