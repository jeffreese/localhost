import type { Project, SortField, SortOrder } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { connect } from '../sse-client'
import { ConsoleStore } from '../stores/console-store'
import { ProjectStore } from '../stores/project-store'
import { UIStore } from '../stores/ui-store'
import './lh-project-card'
import './lh-port-table'
import './lh-config-panel'
import './lh-console'

@customElement('lh-dashboard')
export class LhDashboard extends LitElement {
  @state() private projects: Project[] = []
  @state() private showHidden = false
  @state() private configPanelOpen = false
  @state() private filter = ''
  @state() private sortField: SortField = 'name'
  @state() private sortOrder: SortOrder = 'asc'
  @state() private customOrder: string[] = []
  @state() private scanning = false
  @state() private dragOverId: string | null = null

  private draggedId: string | null = null

  private unsubProject?: () => void
  private unsubUI?: () => void

  createRenderRoot() {
    return this
  }

  connectedCallback() {
    super.connectedCallback()
    connect()
    ProjectStore.init()
    ConsoleStore.init()

    this.unsubProject = ProjectStore.subscribe(() => {
      this.projects = ProjectStore.getAll()
    })

    UIStore.init()
    this.unsubUI = UIStore.subscribe(() => {
      const uiState = UIStore.getState()
      this.showHidden = uiState.showHidden
      this.configPanelOpen = uiState.configPanelOpen
      this.filter = uiState.filter
      this.sortField = uiState.sortField
      this.sortOrder = uiState.sortOrder
      this.customOrder = uiState.customOrder
    })

    UIStore.loadPreferences()
    this.loadProjects()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.unsubProject?.()
    this.unsubUI?.()
    UIStore.destroy()
    ProjectStore.destroy()
    ConsoleStore.destroy()
  }

  private async loadProjects() {
    try {
      const res = await fetch('/api/projects')
      const data = await res.json()
      ProjectStore.setProjects(data)
    } catch {
      // Will retry on SSE reconnect
    }
  }

  private async handleScan() {
    this.scanning = true
    try {
      await fetch('/api/scan', { method: 'POST' })
    } finally {
      this.scanning = false
    }
  }

  private get filteredProjects(): Project[] {
    let list = this.showHidden
      ? this.projects.filter((p) => p.visibility !== 'ignored')
      : this.projects.filter((p) => p.visibility === 'visible')

    if (this.filter) {
      const lower = this.filter.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(lower))
    }

    if (this.sortField === 'custom') {
      const order = this.customOrder
      list.sort((a, b) => {
        const ai = order.indexOf(a.id)
        const bi = order.indexOf(b.id)
        // Projects not in customOrder go to the end, sorted by name
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    } else {
      const dir = this.sortOrder === 'asc' ? 1 : -1
      if (this.sortField === 'name') {
        list.sort((a, b) => dir * a.name.localeCompare(b.name))
      } else {
        list.sort((a, b) => {
          if (a.processState === b.processState) return a.name.localeCompare(b.name)
          return dir * (a.processState === 'running' ? -1 : 1)
        })
      }
    }

    return list
  }

  private handleDragStart(e: DragEvent, projectId: string) {
    this.draggedId = projectId
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  private handleDragOver(e: DragEvent, projectId: string) {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'
    }
    if (this.dragOverId !== projectId) {
      this.dragOverId = projectId
    }
  }

  private handleDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement
    if (!target.contains(e.relatedTarget as Node)) {
      this.dragOverId = null
    }
  }

  private handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault()
    this.dragOverId = null
    if (!this.draggedId || this.draggedId === targetId) return

    const filtered = this.filteredProjects
    const order = filtered.map((p) => p.id)
    const fromIdx = order.indexOf(this.draggedId)
    const toIdx = order.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) return

    order.splice(fromIdx, 1)
    order.splice(toIdx, 0, this.draggedId)

    // Append any projects not in the visible list to preserve their position
    const fullOrder = [...order, ...this.customOrder.filter((id) => !order.includes(id))]
    UIStore.setCustomOrder(fullOrder)
    this.draggedId = null
  }

  private handleDragEnd() {
    this.draggedId = null
    this.dragOverId = null
  }

  private initCustomOrder() {
    // Capture current visible order as initial custom order
    const filtered = this.filteredProjects
    const order = filtered.map((p) => p.id)
    UIStore.setSortField('custom')
    UIStore.setCustomOrder(order)
  }

  private get runningCount(): number {
    return this.projects.filter((p) => p.processState === 'running').length
  }

  render() {
    const filtered = this.filteredProjects

    return html`
      <div class="max-w-6xl mx-auto px-md py-lg">
        <!-- Header -->
        <header class="flex items-center justify-between mb-lg">
          <div>
            <h1 class="text-2xl font-bold text-primary">Localhost</h1>
            <p class="text-secondary text-sm mt-xs">
              ${this.projects.length} projects · ${this.runningCount} running
            </p>
          </div>
          <div class="flex items-center gap-sm">
            <input
              type="text"
              placeholder="Filter projects..."
              class="bg-surface-raised text-primary border border-border rounded-md px-sm py-xs text-sm focus:outline-none focus:border-accent"
              .value=${this.filter}
              @input=${(e: InputEvent) => UIStore.setFilter((e.target as HTMLInputElement).value)}
            />
            <div class="flex items-center gap-xs">
              <select
                class="bg-surface-raised text-primary border border-border rounded-md px-sm py-xs text-sm focus:outline-none focus:border-accent cursor-pointer"
                .value=${this.sortField}
                @change=${(e: Event) => {
                  const value = (e.target as HTMLSelectElement).value as SortField
                  if (value === 'custom' && this.customOrder.length === 0) {
                    this.initCustomOrder()
                  } else {
                    UIStore.setSortField(value)
                  }
                }}
              >
                <option value="name">Name</option>
                <option value="status">Status</option>
                <option value="custom">Custom</option>
              </select>
              ${
                this.sortField !== 'custom'
                  ? html`
                <button
                  class="bg-surface-raised text-secondary border border-border rounded-md px-xs py-xs text-sm hover:text-primary hover:border-border-hover cursor-pointer"
                  title=${this.sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  @click=${() => UIStore.toggleSortOrder()}
                >
                  ${this.sortOrder === 'asc' ? '\u2191' : '\u2193'}
                </button>
              `
                  : ''
              }
            </div>
            <label class="flex items-center gap-xs text-sm text-secondary cursor-pointer">
              <input
                type="checkbox"
                .checked=${this.showHidden}
                @change=${() => UIStore.toggleShowHidden()}
              />
              Show hidden
            </label>
            <button
              class="bg-surface-raised text-secondary border border-border rounded-md px-sm py-xs text-sm hover:text-primary hover:border-border-hover cursor-pointer"
              @click=${() => UIStore.toggleConfigPanel()}
            >
              Settings
            </button>
            <button
              class="bg-accent text-surface rounded-md px-md py-xs text-sm font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer"
              ?disabled=${this.scanning}
              @click=${() => this.handleScan()}
            >
              ${this.scanning ? 'Scanning...' : 'Scan'}
            </button>
          </div>
        </header>

        ${this.configPanelOpen ? html`<lh-config-panel></lh-config-panel>` : ''}

        <!-- Project Grid -->
        ${
          filtered.length > 0
            ? html`
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
              ${filtered.map((project) =>
                this.sortField === 'custom'
                  ? html`
                  <div
                    draggable="true"
                    class="drag-wrapper ${this.dragOverId === project.id ? 'drag-over' : ''}"
                    @dragstart=${(e: DragEvent) => this.handleDragStart(e, project.id)}
                    @dragover=${(e: DragEvent) => this.handleDragOver(e, project.id)}
                    @dragleave=${(e: DragEvent) => this.handleDragLeave(e)}
                    @drop=${(e: DragEvent) => this.handleDrop(e, project.id)}
                    @dragend=${() => this.handleDragEnd()}
                  >
                    <lh-project-card .project=${project}></lh-project-card>
                  </div>
                `
                  : html`
                  <lh-project-card .project=${project}></lh-project-card>
                `,
              )}
            </div>
          `
            : html`
            <div class="text-center py-xl text-muted">
              <p class="text-lg">No projects found</p>
              <p class="text-sm mt-xs">Click "Scan" to discover projects in ~/Code/</p>
            </div>
          `
        }

        <!-- Port Table -->
        ${
          this.projects.some((p) => p.listeners.length > 0)
            ? html`
            <div class="mt-lg">
              <lh-port-table .projects=${this.projects}></lh-port-table>
            </div>
          `
            : ''
        }
      </div>

      <lh-console></lh-console>
    `
  }
}
