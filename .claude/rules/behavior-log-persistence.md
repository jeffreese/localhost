# Log Persistence

Process stdout/stderr must be written to both the in-memory ring buffer (for SSE broadcast) and the log file on disk (for persistence across restarts). (ADR-011)

Log files live at `~/.localhost/logs/<project-name>.log` with size-based rotation (10MB default). Keep `.log` + `.log.1`.

Console hydration must buffer SSE events during the initial fetch from disk, then merge — subscribing after the fetch completes drops events that arrive during the gap.

All log file operations use async I/O.
