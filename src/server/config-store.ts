import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LocalhostConfig } from '@shared/types'

const CONFIG_DIR = join(homedir(), '.localhost')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function defaultConfig(): LocalhostConfig {
  return {
    scanRoot: join(homedir(), 'Code'),
    projects: {},
    pids: {},
    overrides: {},
    hidden: [],
    ignored: [],
  }
}

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function isValidConfig(data: unknown): data is LocalhostConfig {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.scanRoot === 'string' &&
    typeof obj.projects === 'object' &&
    obj.projects !== null &&
    typeof obj.pids === 'object' &&
    obj.pids !== null &&
    typeof obj.overrides === 'object' &&
    obj.overrides !== null &&
    Array.isArray(obj.hidden) &&
    Array.isArray(obj.ignored)
  )
}

function repairConfig(data: Record<string, unknown>): LocalhostConfig {
  const defaults = defaultConfig()
  return {
    scanRoot: typeof data.scanRoot === 'string' ? data.scanRoot : defaults.scanRoot,
    projects:
      typeof data.projects === 'object' && data.projects !== null
        ? (data.projects as LocalhostConfig['projects'])
        : defaults.projects,
    pids:
      typeof data.pids === 'object' && data.pids !== null
        ? (data.pids as LocalhostConfig['pids'])
        : defaults.pids,
    overrides:
      typeof data.overrides === 'object' && data.overrides !== null
        ? (data.overrides as LocalhostConfig['overrides'])
        : defaults.overrides,
    hidden: Array.isArray(data.hidden) ? data.hidden : defaults.hidden,
    ignored: Array.isArray(data.ignored) ? data.ignored : defaults.ignored,
  }
}

export function readConfig(): LocalhostConfig {
  ensureDir()

  if (!existsSync(CONFIG_PATH)) {
    const config = defaultConfig()
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }

  let raw: string
  try {
    raw = readFileSync(CONFIG_PATH, 'utf-8')
  } catch {
    const config = defaultConfig()
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt JSON — backup and recreate
    const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`
    renameSync(CONFIG_PATH, backupPath)
    console.warn(`Corrupt config backed up to ${backupPath}`)
    const config = defaultConfig()
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }

  if (isValidConfig(parsed)) {
    return parsed
  }

  // Partially valid — repair missing fields
  if (typeof parsed === 'object' && parsed !== null) {
    const config = repairConfig(parsed as Record<string, unknown>)
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return config
  }

  // Unrecoverable — backup and recreate
  const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`
  renameSync(CONFIG_PATH, backupPath)
  console.warn(`Invalid config backed up to ${backupPath}`)
  const config = defaultConfig()
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  return config
}

export function writeConfig(config: LocalhostConfig): void {
  ensureDir()
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function updateConfig(updater: (config: LocalhostConfig) => void): LocalhostConfig {
  const config = readConfig()
  updater(config)
  writeConfig(config)
  return config
}

export { CONFIG_DIR, CONFIG_PATH }
