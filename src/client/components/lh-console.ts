import type { LogLine } from '@shared/types'
import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { stripAnsi } from '../ansi'
import { ConsoleStore } from '../stores/console-store'
import { ProjectStore } from '../stores/project-store'

@customElement('lh-console')
export class LhConsole extends LitElement {
  @state() private projectId: string | null = null
  @state() private lines: LogLine[] = []

  private unsub?: () => void
  private scrollContainer: HTMLElement | null = null
  private autoStickBottom = true

  createRenderRoot() {
    return this
  }

  connectedCallback() {
    super.connectedCallback()
    this.unsub = ConsoleStore.subscribe(() => this.sync())
    this.sync()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.unsub?.()
  }

  private sync() {
    const id = ConsoleStore.getOpenProjectId()
    this.projectId = id
    this.lines = id ? ConsoleStore.getLines(id) : []
  }

  private get projectName(): string | null {
    if (!this.projectId) return null
    return ProjectStore.getAll().find((p) => p.id === this.projectId)?.name ?? this.projectId
  }

  private handleClose() {
    ConsoleStore.close()
  }

  private handleScroll(e: Event) {
    const el = e.currentTarget as HTMLElement
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    this.autoStickBottom = distanceFromBottom < 32
  }

  updated() {
    if (!this.scrollContainer) {
      this.scrollContainer = this.querySelector('[data-console-scroll]')
    }
    if (this.autoStickBottom && this.scrollContainer) {
      this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight
    }
  }

  render() {
    if (!this.projectId) return html``

    return html`
      <div class="fixed inset-x-0 bottom-0 z-20 h-[45vh] min-h-[240px] bg-surface-elevated border-t border-border shadow-elevated flex flex-col">
        <div class="flex items-center justify-between px-md py-sm border-b border-border">
          <div class="flex items-center gap-sm min-w-0">
            <span class="text-primary font-medium text-sm truncate">Console · ${this.projectName}</span>
            <span class="text-muted text-xs">${this.lines.length} lines</span>
          </div>
          <button
            class="text-muted hover:text-primary hover:bg-surface-overlay rounded-md px-sm py-xs text-xs cursor-pointer"
            @click=${() => this.handleClose()}
            aria-label="Close console"
          >Close</button>
        </div>
        <div
          data-console-scroll
          class="flex-1 overflow-y-auto font-mono text-xs px-md py-sm bg-surface"
          @scroll=${(e: Event) => this.handleScroll(e)}
        >
          ${
            this.lines.length === 0
              ? html`<div class="text-muted italic">No output yet.</div>`
              : this.lines.map(
                  (line) => html`
                    <div class="${line.stream === 'stderr' ? 'text-danger' : 'text-primary'} whitespace-pre-wrap break-all">${stripAnsi(line.text)}</div>
                  `,
                )
          }
        </div>
      </div>
    `
  }
}
