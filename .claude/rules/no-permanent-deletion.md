# No Permanent Project Deletion

Projects can be **hidden** (removed from default dashboard view) or **ignored** (skipped on rescan), but never permanently deleted from config.

- "Delete" in the UI means "add to ignored list"
- Both hidden and ignored states are reversible
- Ignored paths must be checked before the scanner descends into a directory
- Hidden projects with stored PIDs still undergo startup reconciliation

**Source:** ADR-007
