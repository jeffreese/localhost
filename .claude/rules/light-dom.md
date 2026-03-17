# Light DOM Only — No Shadow DOM

Every Lit component must render to light DOM. Override `createRenderRoot()` to return `this`. Never use `this.shadowRoot` or `static styles` (use Tailwind tokens instead of component-scoped CSS).

This ensures Tailwind's global stylesheet and design token CSS custom properties apply to all components without injection.

**Source:** ADR-003
