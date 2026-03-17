import type { Project } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('lh-port-table')
export class LhPortTable extends LitElement {
  @property({ type: Array }) projects: Project[] = []

  createRenderRoot() {
    return this
  }

  private get portProjects(): Project[] {
    return this.projects
      .filter((p) => p.port !== null && p.processState !== 'stopped')
      .sort((a, b) => (a.port ?? 0) - (b.port ?? 0))
  }

  render() {
    const portProjects = this.portProjects
    if (portProjects.length === 0) return html``

    return html`
      <div class="bg-surface-raised border border-border rounded-lg p-md">
        <h3 class="text-primary font-medium mb-sm">Active Ports</h3>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted text-xs">
              <th class="pb-xs">Port</th>
              <th class="pb-xs">Project</th>
              <th class="pb-xs">Status</th>
            </tr>
          </thead>
          <tbody>
            ${portProjects.map(
              (p) => html`
                <tr class="border-t border-border">
                  <td class="py-xs text-accent font-mono">:${p.port}</td>
                  <td class="py-xs text-primary">${p.name}</td>
                  <td class="py-xs">
                    ${
                      p.processState === 'port-conflict'
                        ? html`<span class="text-warning">Conflict</span>`
                        : html`<span class="text-success">Running</span>`
                    }
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `
  }
}
