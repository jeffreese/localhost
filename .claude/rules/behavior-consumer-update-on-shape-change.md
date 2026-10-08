# Update All Consumers on API/Type Shape Changes

When changing the shape of a shared type, API response, SSE event, or any data structure that crosses a module boundary:

1. Grep for all consumers of the changed type/endpoint
2. Update every consumer — including optimistic SSE handlers that patch local state without re-fetching
3. Update mocks in tests to return the new shape
4. Check SSE event handlers that filter, skip, or merge entries — a new field they don't spread gets silently dropped

The failure mode is silent: the old consumer destructures the wrong shape, gets `undefined`, and propagates it without error. Mocked tests pass because the mock returns the old shape.
