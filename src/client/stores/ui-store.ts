type Listener = () => void

const listeners = new Set<Listener>()

let state = {
  selectedProjectId: null as string | null,
  configPanelOpen: false,
  showHidden: false,
  filter: '' as string,
}

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

export const UIStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getState() {
    return state
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
}
