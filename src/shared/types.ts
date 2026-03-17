/** Package manager detected from lock files */
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/** Process state after PID/port reconciliation */
export type ProcessState = 'running' | 'stopped' | 'port-conflict'

/** Project visibility */
export type Visibility = 'visible' | 'hidden' | 'ignored'

/** A discovered project */
export interface Project {
  id: string
  name: string
  path: string
  packageManager: PackageManager
  devScript: string | null
  githubUrl: string | null
  visibility: Visibility
  port: number | null
  processState: ProcessState
  pid: number | null
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
}

/** Cached project data from last scan */
export interface ProjectCache {
  name: string
  path: string
  packageManager: PackageManager
  devScript: string | null
  githubUrl: string | null
}
