# Config File Contract

`~/.localhost/config.json` is the central data store shared between backend services. When modifying the config schema (types in `src/shared/`):

- Update the TypeScript types first
- Update all services that read/write the affected fields (Config Store, Scanner, Process Manager)
- Update the default config creation to include new fields
- Update corruption recovery to handle missing new fields gracefully
