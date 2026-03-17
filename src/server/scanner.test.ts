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
    readConfig: () => ({
      scanRoot: testRoot,
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

function makeProject(
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

  it('discovers projects with package.json', () => {
    makeProject('my-app')
    const results = scan()
    expect(results.size).toBe(1)
    const project = firstProject(results)
    expect(project.name).toBe('my-app')
    expect(project.devScript).toBe('dev')
  })

  it('detects pnpm from lock file', () => {
    makeProject('pnpm-app', { lockFile: 'pnpm-lock.yaml' })
    const results = scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('pnpm')
  })

  it('detects yarn from lock file', () => {
    makeProject('yarn-app', { lockFile: 'yarn.lock' })
    const results = scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('yarn')
  })

  it('defaults to npm when no lock file', () => {
    makeProject('npm-app')
    const results = scan()
    const project = firstProject(results)
    expect(project.packageManager).toBe('npm')
  })

  it('detects start script when dev is missing', () => {
    makeProject('start-app', { scripts: { start: 'node index.js' } })
    const results = scan()
    const project = firstProject(results)
    expect(project.devScript).toBe('start')
  })

  it('returns null devScript when none found', () => {
    makeProject('no-script-app', { scripts: { build: 'tsc' } })
    const results = scan()
    const project = firstProject(results)
    expect(project.devScript).toBeNull()
  })

  it('discovers multiple projects', () => {
    makeProject('app-a')
    makeProject('app-b')
    const results = scan()
    expect(results.size).toBe(2)
  })
})
