import type { Project } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

interface PortEntry {
  port: number
  projectName: string
}

@customElement('lh-port-table')
export class LhPortTable extends LitElement {
  @property({ type: Array }) projects: Project[] = []

  createRenderRoot() {
    return this
  }

  private get portEntries(): PortEntry[] {
    const entries: PortEntry[] = []
    for (const p of this.projects) {
      for (const l of p.listeners) {
        entries.push({ port: l.port, projectName: p.name })
      }
    }
    return entries.sort((a, b) => a.port - b.port)
  }

  render() {
    const entries = this.portEntries
    if (entries.length === 0) return html``

    return html`
      <div class="bg-surface-raised border border-border rounded-lg p-md">
        <h3 class="text-primary font-medium mb-sm">Active Ports</h3>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted text-xs">
              <th class="pb-xs">Port</th>
              <th class="pb-xs">Project</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(
              (e) => html`
                <tr class="border-t border-border">
                  <td class="py-xs text-accent font-mono">:${e.port}</td>
                  <td class="py-xs text-primary">${e.projectName}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `
  }
}
