import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageManager, ProjectCache } from '@shared/types'
import { readConfig, updateConfig } from './config-store'

const MAX_DEPTH = 4

function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function detectDevScript(projectPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
    const scripts = pkg.scripts || {}
    for (const name of ['dev', 'start', 'serve']) {
      if (scripts[name]) return name
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

function detectGithubUrl(projectPath: string): string | null {
  const gitConfigPath = join(projectPath, '.git', 'config')
  if (!existsSync(gitConfigPath)) return null

  try {
    const content = readFileSync(gitConfigPath, 'utf-8')
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

function walk(dir: string, ignoredPaths: string[], depth: number): Map<string, ProjectCache> {
  const results = new Map<string, ProjectCache>()

  if (depth > MAX_DEPTH) return results
  if (isIgnored(dir, ignoredPaths)) return results

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }

  if (entries.includes('package.json') && depth > 0) {
    const pkgPath = join(dir, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const id = dir // Use absolute path as ID
      results.set(id, {
        name: pkg.name || dir.split('/').pop() || 'unknown',
        path: dir,
        packageManager: detectPackageManager(dir),
        devScript: detectDevScript(dir),
        githubUrl: detectGithubUrl(dir),
      })
    } catch {
      // Skip unparseable package.json
    }
    // Don't descend into node_modules of found projects, but allow nested packages
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
      if (statSync(fullPath).isDirectory()) {
        const nested = walk(fullPath, ignoredPaths, depth + 1)
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

export function scan(): Map<string, ProjectCache> {
  const config = readConfig()
  return walk(config.scanRoot, config.ignored, 0)
}

export function scanAndPersist(): Map<string, ProjectCache> {
  const projects = scan()
  updateConfig((config) => {
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
