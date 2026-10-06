# Config Write Serialization

All config mutations go through `updateConfig()`, which serializes concurrent access via an async queue. Direct read-modify-write of the config file outside this function creates race conditions.

Config writes use atomic replacement: write to a `.tmp` file, then `fs.rename` to the config path. A crash mid-write leaves either the old or new version, never a corrupt file.

Config reads are served from an in-memory cache after the first load. The cache is updated on every `updateConfig` call. Do not bypass the cache with direct `fs.readFile` calls.
