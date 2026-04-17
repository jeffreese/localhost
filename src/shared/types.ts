/** Package manager detected from lock files */
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/** Process state derived from listener enumeration */
export type ProcessState = 'running' | 'stopped'

/** Project visibility */
export type Visibility = 'visible' | 'hidden' | 'ignored'

/** A TCP listener matched to a project by working directory */
export interface Listener {
  pid: number
  port: number
}

/** A discovered project */
export interface Project {
  id: string
  name: string
  path: string
  packageManager: PackageManager
  devScript: string | null
  githubUrl: string | null
  visibility: Visibility
  listeners: Listener[]
  processState: ProcessState
  /** True when Localhost started this process in the current session (log buffer exists). */
  spawnedByUs: boolean
}

/** A single captured line of process output. */
export interface LogLine {
  stream: 'stdout' | 'stderr'
  ts: number
  text: string
}

/** Sort field for dashboard project cards */
export type SortField = 'name' | 'status' | 'custom'

/** Sort direction */
export type SortOrder = 'asc' | 'desc'

/** Persisted sort preference */
export interface SortPreference {
  field: SortField
  order: SortOrder
}

/** Per-project config overrides */
export interface ProjectOverride {
  port?: number
  devScript?: string
}

/** Top-level config file schema */
export interface LocalhostConfig {
  scanRoot: string
  projects: Record<string, ProjectCache>
  pids: Record<string, number>
  overrides: Record<string, ProjectOverride>
  hidden: string[]
  ignored: string[]
  sort: SortPreference
  customOrder: string[]
}

/** Cached project data from last scan */
export interface ProjectCache {
  name: string
  path: string
  packageManager: PackageManager
  devScript: string | null
  githubUrl: string | null
}
