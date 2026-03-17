import type { Project } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { ProjectStore } from '../stores/project-store'
import { UIStore } from '../stores/ui-store'

@customElement('lh-config-panel')
export class LhConfigPanel extends LitElement {
  @state() private hiddenProjects: Project[] = []
  @state() private ignoredProjects: Project[] = []

  private unsubProject?: () => void

  createRenderRoot() {
    return this
  }

  connectedCallback() {
    super.connectedCallback()
    this.unsubProject = ProjectStore.subscribe(() => this.updateLists())
    this.updateLists()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.unsubProject?.()
  }

  private updateLists() {
    this.hiddenProjects = ProjectStore.getByVisibility('hidden')
    this.ignoredProjects = ProjectStore.getByVisibility('ignored')
  }

  private async handleRestore(projectId: string) {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'visible' }),
    })
  }

  render() {
    return html`
      <div class="bg-surface-raised border border-border rounded-lg p-md mb-lg">
        <div class="flex items-center justify-between mb-sm">
          <h3 class="text-primary font-medium">Settings</h3>
          <button
            class="text-secondary text-sm hover:text-primary cursor-pointer"
            @click=${() => UIStore.setConfigPanelOpen(false)}
          >Close</button>
        </div>

        <!-- Hidden Projects -->
        <div class="mb-md">
          <h4 class="text-secondary text-sm mb-xs">Hidden Projects (${this.hiddenProjects.length})</h4>
          ${
            this.hiddenProjects.length > 0
              ? html`
              <ul class="space-y-xs">
                ${this.hiddenProjects.map(
                  (p) => html`
                    <li class="flex items-center justify-between text-sm">
                      <span class="text-muted">${p.name}</span>
                      <button
                        class="text-accent text-xs hover:text-accent-hover cursor-pointer"
                        @click=${() => this.handleRestore(p.id)}
                      >Restore</button>
                    </li>
                  `,
                )}
              </ul>
            `
              : html`<p class="text-muted text-xs">No hidden projects</p>`
          }
        </div>

        <!-- Ignored Projects -->
        <div>
          <h4 class="text-secondary text-sm mb-xs">Ignored Projects (${this.ignoredProjects.length})</h4>
          ${
            this.ignoredProjects.length > 0
              ? html`
              <ul class="space-y-xs">
                ${this.ignoredProjects.map(
                  (p) => html`
                    <li class="flex items-center justify-between text-sm">
                      <span class="text-muted">${p.name}</span>
                      <button
                        class="text-accent text-xs hover:text-accent-hover cursor-pointer"
                        @click=${() => this.handleRestore(p.id)}
                      >Restore</button>
                    </li>
                  `,
                )}
              </ul>
            `
              : html`<p class="text-muted text-xs">No ignored projects</p>`
          }
        </div>
      </div>
    `
  }
}
