import type { Project } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { connect } from '../sse-client'
import { ProjectStore } from '../stores/project-store'
import { UIStore } from '../stores/ui-store'
import './lh-project-card'
import './lh-port-table'
import './lh-config-panel'

@customElement('lh-dashboard')
export class LhDashboard extends LitElement {
  @state() private projects: Project[] = []
  @state() private showHidden = false
  @state() private configPanelOpen = false
  @state() private filter = ''
  @state() private scanning = false

  private unsubProject?: () => void
  private unsubUI?: () => void

  createRenderRoot() {
    return this
  }

  connectedCallback() {
    super.connectedCallback()
    connect()
    ProjectStore.init()

    this.unsubProject = ProjectStore.subscribe(() => {
      this.projects = ProjectStore.getAll()
    })

    this.unsubUI = UIStore.subscribe(() => {
      const uiState = UIStore.getState()
      this.showHidden = uiState.showHidden
      this.configPanelOpen = uiState.configPanelOpen
      this.filter = uiState.filter
    })

    this.loadProjects()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.unsubProject?.()
    this.unsubUI?.()
    ProjectStore.destroy()
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

    return list
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
            <label class="flex items-center gap-xs text-sm text-secondary cursor-pointer">
              <input
                type="checkbox"
                .checked=${this.showHidden}
                @change=${() => UIStore.toggleShowHidden()}
              />
              Show hidden
            </label>
            <button
              class="bg-surface-raised text-secondary border border-border rounded-md px-sm py-xs text-sm hover:text-primary hover:border-border-hover"
              @click=${() => UIStore.toggleConfigPanel()}
            >
              Settings
            </button>
            <button
              class="bg-accent text-surface rounded-md px-md py-xs text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
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
              ${filtered.map(
                (project) => html`
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
          this.runningCount > 0
            ? html`
            <div class="mt-lg">
              <lh-port-table .projects=${this.projects}></lh-port-table>
            </div>
          `
            : ''
        }
      </div>
    `
  }
}
