---
title: "ADR-007: Project Visibility Model (Hide/Ignore/Restore)"
phase: 2
project: localhost
date: 2026-03-16
status: accepted
---

# ADR-007: Project Visibility Model (Hide/Ignore/Restore)

## Status

Accepted

## Context

Localhost scans `~/Code/` recursively, which will inevitably discover projects the user doesn't want to manage — archived repos, forks, experiments, dependency directories. Without a way to exclude projects, the dashboard becomes cluttered. Users need to remove projects from view without losing the ability to recover them.

## Decision

We will implement a **three-tier visibility model**:

| Visibility | Dashboard | Rescan | Recovery |
|------------|-----------|--------|----------|
| **Visible** | Shown | Included | N/A |
| **Hidden** | Not shown (unless "show hidden" is active) | Included (stays hidden) | Toggle "show hidden" → click "restore" |
| **Ignored** | Not shown | Skipped entirely | Config panel → manage ignored → restore |

Both hidden and ignored states are stored as path lists in `~/.localhost/config.json`. Both are reversible — no data is permanently deleted.

**Hide** is for "I don't want to see this right now." **Ignore** is for "stop discovering this on every scan."

## Alternatives Considered

### Delete from config entirely (irreversible)
- **Pros:** Simplest implementation
- **Cons:** Accidental deletion requires a rescan and re-configuration. No safety net.

### Single "exclude" list
- **Pros:** Simpler model — one list instead of two
- **Cons:** Conflates two different intents. "I don't want to see my fork of React" (skip on scan) is different from "I don't need this project today but might tomorrow" (hide from view).

### `.localhostignore` file per project
- **Pros:** Opt-out at the project level
- **Cons:** Violates the "no per-project dotfiles" constraint from Phase 1. Requires filesystem writes to other repos. Central config is the right place.

## Consequences

### Positive
- Dashboard stays clean — users only see projects they actively manage
- Both operations are reversible — no accidental data loss
- Ignored paths improve scan performance (skipped early in the walk)
- Clear semantic distinction between "hide from view" and "stop scanning"

### Negative
- Two lists to manage instead of one — slightly more complexity in the config panel
- Hidden projects still appear in rescans (by design) — could confuse users who expect "hide" to mean "ignore"

## Enforcement

- Never permanently delete project data from config — "delete" in the UI means "add to ignored list"
- Ignored paths must be checked before the scanner descends into a directory, not after discovery
- Hidden projects must still undergo PID/port reconciliation if they have stored PIDs (a hidden project can still be running)

## Related Decisions

- ADR-006: PID/port reconciliation (hidden/ignored projects with stored PIDs still need reconciliation)
