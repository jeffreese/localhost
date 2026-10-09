import type { GroupConfig, Project, SortField, SortOrder } from '@shared/types'
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
  @state() private groupConfig: GroupConfig = { groups: [], assignments: {} }
  @state() private newGroupName = ''
  @state() private editingGroupId: string | null = null
  @state() private editingGroupName = ''

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
      this.groupConfig = ProjectStore.getGroupConfig()
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
      const [projectsRes, groupsRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/groups'),
      ])
      const projects = await projectsRes.json()
      const groups = await groupsRes.json()
      ProjectStore.setGroupConfig(groups)
      ProjectStore.setProjects(projects)
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

  private get hasGroups(): boolean {
    return this.groupConfig.groups.length > 0
  }

  private getGroupedProjects(projects: Project[]): {
    groups: Array<{ id: string; name: string; collapsed: boolean; projects: Project[] }>
    ungrouped: Project[]
  } {
    const groups = this.groupConfig.groups.map((g) => ({
      ...g,
      projects: projects.filter((p) => p.group === g.id),
    }))
    const ungrouped = projects.filter((p) => p.group === null)
    return { groups, ungrouped }
  }

  private async handleCreateGroup() {
    const name = this.newGroupName.trim()
    if (!name) return
    await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    this.newGroupName = ''
  }

  private async handleDeleteGroup(groupId: string) {
    await fetch(`/api/groups/${groupId}`, { method: 'DELETE' })
  }

  private async handleToggleCollapse(groupId: string, collapsed: boolean) {
    await fetch(`/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed: !collapsed }),
    })
  }

  private startEditGroup(groupId: string, currentName: string) {
    this.editingGroupId = groupId
    this.editingGroupName = currentName
  }

  private async finishEditGroup() {
    if (!this.editingGroupId) return
    const name = this.editingGroupName.trim()
    if (name) {
      await fetch(`/api/groups/${this.editingGroupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    }
    this.editingGroupId = null
    this.editingGroupName = ''
  }

  private async handleAssignGroup(projectId: string, groupId: string | null) {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: groupId }),
    })
  }

  private handleGroupDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'
    }
  }

  private handleGroupDrop(e: DragEvent, groupId: string | null) {
    e.preventDefault()
    if (!this.draggedId) return
    this.handleAssignGroup(this.draggedId, groupId)
  }

  private renderProjectCard(project: Project) {
    return this.sortField === 'custom'
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
          <lh-project-card .project=${project} .groups=${this.groupConfig.groups} @assign-group=${(e: CustomEvent) => this.handleAssignGroup(project.id, e.detail.groupId)}></lh-project-card>
        </div>
      `
      : html`<lh-project-card .project=${project} .groups=${this.groupConfig.groups} @assign-group=${(e: CustomEvent) => this.handleAssignGroup(project.id, e.detail.groupId)}></lh-project-card>`
  }

  private renderFlatGrid(projects: Project[]) {
    return html`
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
        ${projects.map((p) => this.renderProjectCard(p))}
      </div>
    `
  }

  private renderGroupedGrid(projects: Project[]) {
    const { groups, ungrouped } = this.getGroupedProjects(projects)

    return html`
      ${groups.map(
        (group) => html`
        <div
          class="mb-lg"
          @dragover=${(e: DragEvent) => this.handleGroupDragOver(e)}
          @drop=${(e: DragEvent) => this.handleGroupDrop(e, group.id)}
        >
          <div class="flex items-center gap-sm mb-sm">
            <button
              class="text-muted hover:text-secondary text-sm cursor-pointer"
              @click=${() => this.handleToggleCollapse(group.id, group.collapsed)}
              aria-label=${group.collapsed ? 'Expand group' : 'Collapse group'}
              aria-expanded=${!group.collapsed}
            >${group.collapsed ? '▶' : '▼'}</button>
            ${
              this.editingGroupId === group.id
                ? html`
                <input
                  type="text"
                  class="bg-surface-raised text-primary border border-accent rounded-md px-sm py-xs text-sm focus:outline-none"
                  .value=${this.editingGroupName}
                  @input=${(e: InputEvent) => {
                    this.editingGroupName = (e.target as HTMLInputElement).value
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') this.finishEditGroup()
                    if (e.key === 'Escape') {
                      this.editingGroupId = null
                      this.editingGroupName = ''
                    }
                  }}
                  @blur=${() => this.finishEditGroup()}
                />
              `
                : html`
                <h2
                  class="text-primary font-medium text-sm cursor-pointer"
                  @dblclick=${() => this.startEditGroup(group.id, group.name)}
                  title="Double-click to rename"
                >${group.name}</h2>
              `
            }
            <span class="text-muted text-xs">${group.projects.length}</span>
            <button
              class="text-muted hover:text-danger text-xs cursor-pointer ml-auto"
              @click=${() => this.handleDeleteGroup(group.id)}
              aria-label="Delete group ${group.name}"
            >×</button>
          </div>
          ${
            !group.collapsed
              ? html`
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
                ${group.projects.map((p) => this.renderProjectCard(p))}
              </div>
            `
              : ''
          }
        </div>
      `,
      )}
      ${
        ungrouped.length > 0
          ? html`
          <div
            class="mb-lg"
            @dragover=${(e: DragEvent) => this.handleGroupDragOver(e)}
            @drop=${(e: DragEvent) => this.handleGroupDrop(e, null)}
          >
            ${
              groups.length > 0
                ? html`
                <div class="flex items-center gap-sm mb-sm">
                  <h2 class="text-secondary font-medium text-sm">Ungrouped</h2>
                  <span class="text-muted text-xs">${ungrouped.length}</span>
                </div>
              `
                : ''
            }
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
              ${ungrouped.map((p) => this.renderProjectCard(p))}
            </div>
          </div>
        `
          : ''
      }
    `
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
            ? this.hasGroups
              ? this.renderGroupedGrid(filtered)
              : this.renderFlatGrid(filtered)
            : html`
            <div class="text-center py-xl text-muted">
              <p class="text-lg">No projects found</p>
              <p class="text-sm mt-xs">Click "Scan" to discover projects in ~/Code/</p>
            </div>
          `
        }

        <!-- Group Management -->
        <div class="mt-md flex items-center gap-sm">
          <input
            type="text"
            placeholder="New group name..."
            class="bg-surface-raised text-primary border border-border rounded-md px-sm py-xs text-sm focus:outline-none focus:border-accent"
            .value=${this.newGroupName}
            @input=${(e: InputEvent) => {
              this.newGroupName = (e.target as HTMLInputElement).value
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') this.handleCreateGroup()
            }}
          />
          <button
            class="bg-surface-raised text-secondary border border-border rounded-md px-sm py-xs text-sm hover:text-primary hover:border-border-hover cursor-pointer"
            ?disabled=${!this.newGroupName.trim()}
            @click=${() => this.handleCreateGroup()}
          >Add Group</button>
        </div>

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
