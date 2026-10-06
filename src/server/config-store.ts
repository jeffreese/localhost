import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
    sort: { field: 'name', order: 'asc' },
    customOrder: [],
  }
}

async function ensureDir() {
  await mkdir(CONFIG_DIR, { recursive: true })
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
    Array.isArray(obj.ignored) &&
    typeof obj.sort === 'object' &&
    obj.sort !== null &&
    Array.isArray(obj.customOrder)
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
    customOrder: Array.isArray(data.customOrder) ? data.customOrder : defaults.customOrder,
    sort:
      typeof data.sort === 'object' && data.sort !== null
        ? (data.sort as LocalhostConfig['sort'])
        : defaults.sort,
  }
}

let cachedConfig: LocalhostConfig | null = null

export async function readConfig(): Promise<LocalhostConfig> {
  if (cachedConfig) return cachedConfig

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
    cachedConfig = parsed
    return parsed
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
  cachedConfig = config
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

export function resetCache() {
  cachedConfig = null
}

export { CONFIG_DIR, CONFIG_PATH }
