# Project Type Registry

Project detection uses a config-driven registry (`config.projectTypes`), not hardcoded marker files. (ADR-010)

The scanner iterates registered marker files from the registry — flag any hardcoded `package.json` string literal in scanner.ts outside of tests.

The listener scanner builds its lsof command filter from the registry's `processNames` arrays — flag hardcoded process name lists.

Adding support for a new project type is a config change (add an entry to `projectTypes`), not a code change.
