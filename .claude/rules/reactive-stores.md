# Reactive Stores — One Per Domain, No External Libraries

State management uses three typed store classes: ProjectStore, ProcessStore, UIStore. No external state libraries (Redux, Zustand, MobX, etc.).

Rules:
- One store per domain — don't merge stores or create overlapping ones
- Stores don't import other stores
- Components subscribe in `connectedCallback` and unsubscribe in `disconnectedCallback`
- Components never modify store internals directly — use store methods

**Source:** ADR-004
