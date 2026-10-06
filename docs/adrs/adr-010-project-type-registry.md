---
title: "ADR-010: Project Type Registry"
phase: 2
project: localhost
date: 2026-10-05
status: accepted
---

# ADR-010: Project Type Registry

## Status

Accepted

## Context

The scanner is hardcoded to detect only `package.json` (JavaScript projects) and the listener scanner filters only `node/bun/deno` processes. Non-JS projects (Rust, Go, Python) in `~/Code/` are invisible. Adding support for each new language requires code changes to both the scanner and listener scanner.

## Decision

Replace hardcoded detection with a configurable **project type registry** in `~/.localhost/config.json`. Each entry maps a marker filename to project metadata: display name, default dev command, package manager detection flag, and process names for lsof filtering.

Ship with two built-in types: `package.json` (Node) and `Cargo.toml` (Rust). Users add new types by editing config.

```json
{
  "projectTypes": {
    "package.json": {
      "name": "node",
      "detectManager": true,
      "processNames": ["node", "bun", "deno"]
    },
    "Cargo.toml": {
      "name": "rust",
      "defaultCommand": "cargo run",
      "processNames": ["cargo"]
    }
  }
}
```

The scanner walks each directory checking for registered marker files in registry order. First match wins. The listener scanner builds its lsof command filter dynamically from all types' `processNames` arrays.

## Alternatives Considered

### Hardcode all supported languages

- **Pros:** Simpler implementation. No config schema to design.
- **Cons:** Every new language requires a code change, a new release, and a restart. Users can't add support for their own tooling.

### Plugin system for project types

- **Pros:** Most extensible. Could support custom detection logic.
- **Cons:** Massive overengineering for a personal dev tool. Config entries cover the real use case.

## Consequences

### Positive

- Adding a new language is a config edit, not a code change
- Scanner and listener scanner stay generic — no language-specific branching
- Per-project `devScript` override still works for edge cases

### Negative

- Config schema grows — one more top-level key to validate and repair
- First-match-wins ordering could surprise users with polyglot projects (directory with both package.json and Cargo.toml)

## Enforcement

- Scanner must iterate the registry, not check hardcoded filenames — flag any `package.json` string literal in scanner.ts outside of tests
- Listener scanner must build its command filter from the registry — flag hardcoded process name lists
- New project types added to the codebase must go through config defaults, not code branches

## Related Decisions

- ADR-006 (Listener enumeration) — lsof filter now driven by registry instead of hardcoded
