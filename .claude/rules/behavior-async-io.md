# Async I/O Only

Zero synchronous I/O in production server code. All filesystem operations use `fs.promises`, all child process calls use `execFile` or `spawn` (async), all config reads use the cached async path.

Flag any use of `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `execSync`, or `spawnSync` in `src/server/`.

Test files may use sync operations where appropriate.
