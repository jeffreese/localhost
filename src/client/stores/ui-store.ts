import type { SortField, SortOrder } from '@shared/types'

type Listener = () => void

const listeners = new Set<Listener>()

let state = {
  selectedProjectId: null as string | null,
  configPanelOpen: false,
  showHidden: false,
  filter: '' as string,
  sortField: 'name' as SortField,
  sortOrder: 'asc' as SortOrder,
}

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function persistSort() {
  fetch('/api/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sort: { field: state.sortField, order: state.sortOrder } }),
  })
}

export const UIStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getState() {
    return state
  },

  async loadPreferences() {
    try {
      const res = await fetch('/api/preferences')
      const data = await res.json()
      if (data.sort) {
        state = { ...state, sortField: data.sort.field, sortOrder: data.sort.order }
        notify()
      }
    } catch {
      // Use defaults
    }
  },

  selectProject(id: string | null) {
    state = { ...state, selectedProjectId: id }
    notify()
  },

  toggleConfigPanel() {
    state = { ...state, configPanelOpen: !state.configPanelOpen }
    notify()
  },

  setConfigPanelOpen(open: boolean) {
    state = { ...state, configPanelOpen: open }
    notify()
  },

  toggleShowHidden() {
    state = { ...state, showHidden: !state.showHidden }
    notify()
  },

  setFilter(filter: string) {
    state = { ...state, filter }
    notify()
  },

  setSortField(field: SortField) {
    state = { ...state, sortField: field }
    notify()
    persistSort()
  },

  setSortOrder(order: SortOrder) {
    state = { ...state, sortOrder: order }
    notify()
    persistSort()
  },

  toggleSortOrder() {
    state = { ...state, sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }
    notify()
    persistSort()
  },
}
