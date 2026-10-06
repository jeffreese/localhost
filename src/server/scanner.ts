import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager, ProjectCache } from '@shared/types'
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

async function detectDevScript(projectPath: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'))
    const scripts = pkg.scripts || {}
    for (const name of ['dev', 'start', 'serve']) {
      if (scripts[name]) return name
    }
  } catch {
    // Ignore parse errors
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

async function walk(
  dir: string,
  ignoredPaths: string[],
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

  if (entries.includes('package.json') && depth > 0) {
    const pkgPath = join(dir, 'package.json')
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      const id = dir // Use absolute path as ID
      results.set(id, {
        name: pkg.name || dir.split('/').pop() || 'unknown',
        path: dir,
        packageManager: await detectPackageManager(dir),
        devScript: await detectDevScript(dir),
        githubUrl: await detectGithubUrl(dir),
      })
    } catch {
      // Skip unparseable package.json
    }
  }

  // Skip common non-project directories
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
        const nested = await walk(fullPath, ignoredPaths, depth + 1)
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
  return walk(config.scanRoot, config.ignored, 0)
}

export async function scanAndPersist(): Promise<Map<string, ProjectCache>> {
  const projects = await scan()
  await updateConfig((config) => {
    config.projects = Object.fromEntries(projects)
    // Clean up stale entries from previously scanned skip directories
    for (const id of Object.keys(config.projects)) {
      if (id.includes('/.claude/')) {
        delete config.projects[id]
      }
    }
  })
  return projects
}
