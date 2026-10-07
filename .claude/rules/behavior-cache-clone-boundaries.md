# Cache Clone Boundaries

When a function caches an object in a module-level variable, every path that stores to the cache and every path that returns from the cache must use `structuredClone` (or equivalent deep copy).

Partial coverage creates silent corruption:
- A cached reference returned to a caller lets caller mutations corrupt the cache for all subsequent readers
- A caller's reference stored as the cache lets the caller corrupt it after the store
- On write failure, in-place mutations on the cached reference persist in memory despite never reaching disk

Verify all code paths through the function — not just the hot-cache early return. Cold-read paths, recovery paths, and the write-side store are all boundaries that need cloning.
