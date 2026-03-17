import type { Project, Visibility } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { ProjectStore } from '../stores/project-store'

@customElement('lh-project-card')
export class LhProjectCard extends LitElement {
  @property({ type: Object }) project!: Project
  @state() private menuOpen = false

  private closeMenuBound = (e: MouseEvent) => {
    if (!this.contains(e.target as Node)) {
      this.menuOpen = false
    }
  }

  createRenderRoot() {
    return this
  }

  private get statusColor(): string {
    switch (this.project.processState) {
      case 'running':
        return 'bg-success'
      case 'port-conflict':
        return 'bg-warning'
      default:
        return 'bg-muted'
    }
  }

  private get statusLabel(): string {
    switch (this.project.processState) {
      case 'running':
        return 'Running'
      case 'port-conflict':
        return 'Port conflict'
      default:
        return 'Stopped'
    }
  }

  private async handleStart() {
    await fetch(`/api/projects/${encodeURIComponent(this.project.id)}/start`, { method: 'POST' })
  }

  private async handleStop() {
    await fetch(`/api/projects/${encodeURIComponent(this.project.id)}/stop`, { method: 'POST' })
  }

  private handleOpen() {
    if (this.project.port) {
      window.open(`http://localhost:${this.project.port}`, '_blank')
    }
  }

  private toggleMenu() {
    this.menuOpen = !this.menuOpen
    if (this.menuOpen) {
      document.addEventListener('click', this.closeMenuBound, { once: true })
    }
  }

  private async handleVisibility(visibility: Visibility) {
    this.menuOpen = false
    ProjectStore.updateVisibility(this.project.id, visibility)
    await fetch(`/api/projects/${encodeURIComponent(this.project.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    })
  }

  render() {
    const p = this.project
    const isRunning = p.processState === 'running'
    const isHidden = p.visibility === 'hidden'

    return html`
      <div class="bg-surface-raised border border-border rounded-lg p-md hover:border-border-hover transition-colors ${isHidden ? 'opacity-60' : ''}">
        <!-- Header -->
        <div class="flex items-center justify-between mb-sm">
          <div class="flex items-center gap-sm">
            <span class="w-2 h-2 rounded-full ${this.statusColor}"></span>
            <h3 class="text-primary font-medium">${p.name}</h3>
          </div>
          <div class="flex items-center gap-xs">
            <span class="text-xs text-muted">${p.packageManager}</span>
            <div class="relative">
              <button
                class="text-muted hover:text-secondary hover:bg-surface-overlay text-xs px-sm py-xs rounded-md cursor-pointer"
                @click=${(e: Event) => {
                  e.stopPropagation()
                  this.toggleMenu()
                }}
              >···</button>
              ${
                this.menuOpen
                  ? html`
                <div class="absolute right-0 top-full mt-xs bg-surface-elevated border border-border rounded-md py-xs z-10 min-w-[120px]">
                  <button
                    class="block w-full text-left px-sm py-xs text-xs text-secondary hover:text-primary hover:bg-surface-overlay cursor-pointer"
                    @click=${() => this.handleVisibility('hidden')}
                  >Hide</button>
                  <button
                    class="block w-full text-left px-sm py-xs text-xs text-secondary hover:text-primary hover:bg-surface-overlay cursor-pointer"
                    @click=${() => this.handleVisibility('ignored')}
                  >Ignore</button>
                </div>
              `
                  : ''
              }
            </div>
          </div>
        </div>

        <!-- Info -->
        <p class="text-secondary text-xs mb-sm truncate" title=${p.path}>${p.path}</p>

        <div class="flex items-center gap-xs mb-sm text-xs">
          <span class="text-secondary">${this.statusLabel}</span>
          ${p.port ? html`<span class="text-muted">· :${p.port}</span>` : ''}
          ${p.devScript ? html`<span class="text-muted">· ${p.devScript}</span>` : ''}
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-xs">
          ${
            isRunning
              ? html`
              <button
                class="bg-danger/10 text-danger rounded-md px-sm py-xs text-xs hover:bg-danger/20 cursor-pointer"
                @click=${() => this.handleStop()}
              >Stop</button>
            `
              : html`
              <button
                class="bg-success/10 text-success rounded-md px-sm py-xs text-xs hover:bg-success/20 cursor-pointer"
                ?disabled=${!p.devScript}
                @click=${() => this.handleStart()}
              >Start</button>
            `
          }

          ${
            isRunning && p.port
              ? html`
              <button
                class="bg-accent/10 text-accent rounded-md px-sm py-xs text-xs hover:bg-accent/20 cursor-pointer"
                @click=${() => this.handleOpen()}
              >Open</button>
            `
              : ''
          }

          ${
            p.githubUrl
              ? html`
              <a
                href=${p.githubUrl}
                target="_blank"
                rel="noopener"
                class="text-secondary text-xs hover:text-primary"
              >GitHub</a>
            `
              : ''
          }
        </div>
      </div>
    `
  }
}
