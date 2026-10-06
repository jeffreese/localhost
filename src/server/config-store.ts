import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LocalhostConfig } from '@shared/types'

const CONFIG_DIR = join(homedir(), '.localhost')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function defaultConfig(): LocalhostConfig {
  return {
    scanRoot: join(homedir(), 'Code'),
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
    sort: { field: 'name', order: 'asc' },
    customOrder: [],
    groupConfig: { groups: [], assignments: {} },
    crashes: {},
  }
}

async function ensureDir() {
  await mkdir(CONFIG_DIR, { recursive: true })
}

// Validates core fields only — new optional fields (projectTypes, groupConfig, crashes)
// may be absent on disk. Callers must run applyDefaults() to fill them.
function isValidConfig(data: unknown): data is LocalhostConfig {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  if (
    !(
      typeof obj.scanRoot === 'string' &&
      typeof obj.projects === 'object' &&
      obj.projects !== null &&
      typeof obj.pids === 'object' &&
      obj.pids !== null &&
      typeof obj.overrides === 'object' &&
      obj.overrides !== null &&
      Array.isArray(obj.hidden) &&
      Array.isArray(obj.ignored) &&
      typeof obj.sort === 'object' &&
      obj.sort !== null &&
      Array.isArray(obj.customOrder)
    )
  )
    return false

  if (
    obj.projectTypes !== undefined &&
    (typeof obj.projectTypes !== 'object' || obj.projectTypes === null)
  )
    return false
  if (
    obj.groupConfig !== undefined &&
    (typeof obj.groupConfig !== 'object' || obj.groupConfig === null)
  )
    return false
  if (obj.crashes !== undefined && (typeof obj.crashes !== 'object' || obj.crashes === null))
    return false

  return true
}

function repairConfig(data: Record<string, unknown>): LocalhostConfig {
  const defaults = defaultConfig()
  return {
    scanRoot: typeof data.scanRoot === 'string' ? data.scanRoot : defaults.scanRoot,
    projectTypes:
      typeof data.projectTypes === 'object' && data.projectTypes !== null
        ? (data.projectTypes as LocalhostConfig['projectTypes'])
        : defaults.projectTypes,
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
    customOrder: Array.isArray(data.customOrder) ? data.customOrder : defaults.customOrder,
    sort:
      typeof data.sort === 'object' && data.sort !== null
        ? (data.sort as LocalhostConfig['sort'])
        : defaults.sort,
    groupConfig:
      typeof data.groupConfig === 'object' && data.groupConfig !== null
        ? (data.groupConfig as LocalhostConfig['groupConfig'])
        : defaults.groupConfig,
    crashes:
      typeof data.crashes === 'object' && data.crashes !== null
        ? (data.crashes as LocalhostConfig['crashes'])
        : defaults.crashes,
  }
}

function applyDefaults(config: LocalhostConfig): LocalhostConfig {
  const defaults = defaultConfig()
  if (!config.projectTypes) config.projectTypes = defaults.projectTypes
  if (!config.groupConfig) config.groupConfig = defaults.groupConfig
  if (!config.crashes) config.crashes = defaults.crashes
  return config
}

let cachedConfig: LocalhostConfig | null = null

export async function readConfig(): Promise<LocalhostConfig> {
  if (cachedConfig) return structuredClone(cachedConfig)

  await ensureDir()

  let raw: string
  try {
    raw = await readFile(CONFIG_PATH, 'utf-8')
  } catch {
    const config = defaultConfig()
    await writeConfig(config)
    return config
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`
    await rename(CONFIG_PATH, backupPath)
    console.warn(`Corrupt config backed up to ${backupPath}`)
    const config = defaultConfig()
    await writeConfig(config)
    return config
  }

  if (isValidConfig(parsed)) {
    const config = applyDefaults(parsed)
    cachedConfig = structuredClone(config)
    return config
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const config = repairConfig(parsed as Record<string, unknown>)
    await writeConfig(config)
    return config
  }

  const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`
  await rename(CONFIG_PATH, backupPath)
  console.warn(`Invalid config backed up to ${backupPath}`)
  const config = defaultConfig()
  await writeConfig(config)
  return config
}

export async function writeConfig(config: LocalhostConfig): Promise<void> {
  await ensureDir()
  const tmpPath = `${CONFIG_PATH}.tmp`
  await writeFile(tmpPath, JSON.stringify(config, null, 2))
  await rename(tmpPath, CONFIG_PATH)
  cachedConfig = structuredClone(config)
}

let writeQueue: Promise<void> = Promise.resolve()

export function updateConfig(updater: (config: LocalhostConfig) => void): Promise<LocalhostConfig> {
  return new Promise<LocalhostConfig>((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      try {
        const config = await readConfig()
        updater(config)
        await writeConfig(config)
        resolve(config)
      } catch (err) {
        reject(err)
      }
    })
  })
}

export function __resetCache() {
  cachedConfig = null
}

export { CONFIG_DIR, CONFIG_PATH }
