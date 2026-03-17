import type { ProcessState } from '@shared/types'
import { off, on } from '../sse-client'

type Listener = () => void

const listeners = new Set<Listener>()
const processStates = new Map<string, ProcessState>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function handleProcessStarted(data: unknown) {
  const { projectId } = data as { projectId: string }
  processStates.set(projectId, 'running')
  notify()
}

function handleProcessStopped(data: unknown) {
  const { projectId } = data as { projectId: string }
  processStates.set(projectId, 'stopped')
  notify()
}

function handleScanComplete(data: unknown) {
  const projects = data as Array<{ id: string; processState: ProcessState }>
  processStates.clear()
  for (const p of projects) {
    processStates.set(p.id, p.processState)
  }
  notify()
}

export const ProcessStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  init() {
    on('process-started', handleProcessStarted)
    on('process-stopped', handleProcessStopped)
    on('scan-complete', handleScanComplete)
  },

  destroy() {
    off('process-started', handleProcessStarted)
    off('process-stopped', handleProcessStopped)
    off('scan-complete', handleScanComplete)
  },

  getState(projectId: string): ProcessState {
    return processStates.get(projectId) ?? 'stopped'
  },

  getAll(): Map<string, ProcessState> {
    return new Map(processStates)
  },

  getRunning(): string[] {
    return Array.from(processStates.entries())
      .filter(([, state]) => state === 'running')
      .map(([id]) => id)
  },

  getConflicts(): string[] {
    return Array.from(processStates.entries())
      .filter(([, state]) => state === 'port-conflict')
      .map(([id]) => id)
  },
}
