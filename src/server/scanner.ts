import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager, ProjectCache, ProjectTypeEntry } from '@shared/types'
import { readConfig, updateConfig } from './config-store'

const MAX_DEPTH = 4

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  if (await fileExists(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await fileExists(join(projectPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function detectDevScript(pkg: Record<string, unknown>): string | null {
  const scripts = (pkg.scripts || {}) as Record<string, string>
  for (const name of ['dev', 'start', 'serve']) {
    if (scripts[name]) return name
  }
  return null
}

async function detectGithubUrl(projectPath: string): Promise<string | null> {
  const gitConfigPath = join(projectPath, '.git', 'config')
  if (!(await fileExists(gitConfigPath))) return null

  try {
    const content = await readFile(gitConfigPath, 'utf-8')
    const match = content.match(/url\s*=\s*.*github\.com[:/](.+?)(?:\.git)?\s*$/m)
    if (match) {
      return `https://github.com/${match[1]}`
    }
  } catch {
    // Ignore read errors
  }
  return null
}

function isIgnored(path: string, ignoredPaths: string[]): boolean {
  return ignoredPaths.some((ignored) => path === ignored || path.startsWith(`${ignored}/`))
}

async function detectProject(
  dir: string,
  registry: Record<string, ProjectTypeEntry>,
): Promise<ProjectCache | null> {
  for (const [markerFile, typeEntry] of Object.entries(registry)) {
    if (!(await fileExists(join(dir, markerFile)))) continue

    let name = dir.split('/').pop() || 'unknown'
    let packageManager: PackageManager = 'npm'
    let devScript: string | null = typeEntry.defaultCommand ?? null

    if (typeEntry.detectManager) {
      try {
        const content = await readFile(join(dir, markerFile), 'utf-8')
        const parsed = JSON.parse(content) as Record<string, unknown>
        if (parsed.name && typeof parsed.name === 'string') name = parsed.name
        devScript = detectDevScript(parsed)
      } catch {
        return null
      }
      packageManager = await detectPackageManager(dir)
    }

    const githubUrl = await detectGithubUrl(dir)

    return {
      name,
      path: dir,
      projectType: typeEntry.name,
      packageManager,
      devScript,
      githubUrl,
    }
  }
  return null
}

async function walk(
  dir: string,
  ignoredPaths: string[],
  registry: Record<string, ProjectTypeEntry>,
  depth: number,
): Promise<Map<string, ProjectCache>> {
  const results = new Map<string, ProjectCache>()

  if (depth > MAX_DEPTH) return results
  if (isIgnored(dir, ignoredPaths)) return results

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return results
  }

  if (depth > 0) {
    const project = await detectProject(dir, registry)
    if (project) {
      results.set(dir, project)
    }
  }

  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.claude',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
  ])

  for (const entry of entries) {
    if (skipDirs.has(entry)) continue
    const fullPath = join(dir, entry)
    try {
      if ((await stat(fullPath)).isDirectory()) {
        const nested = await walk(fullPath, ignoredPaths, registry, depth + 1)
        for (const [k, v] of nested) {
          results.set(k, v)
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return results
}

export async function scan(): Promise<Map<string, ProjectCache>> {
  const config = await readConfig()
  return walk(config.scanRoot, config.ignored, config.projectTypes, 0)
}

export async function scanAndPersist(): Promise<Map<string, ProjectCache>> {
  const projects = await scan()
  await updateConfig((config) => {
    config.projects = Object.fromEntries(projects)
    for (const id of Object.keys(config.projects)) {
      if (id.includes('/.claude/')) {
        delete config.projects[id]
      }
    }
  })
  return projects
}
