# Guard Localhost Servers Against Browser Requests

A server bound to localhost or the LAN is reachable from any web page the user opens: the page can't read most responses, but it can make the request, and a request that writes is the attack. Install one request guard and register it before every route, static handler and WebSocket upgrade, so nothing runs ahead of it. Browsers apply no CORS to WebSockets, so CORS alone is not a guard.

## The guard

- **Host must be on an allowlist** (`localhost:<port>`, `127.0.0.1:<port>`, configured hosts). This blocks DNS rebinding, where a foreign domain resolves to 127.0.0.1.
- **An Origin, when present, must be on an allowlist.** Malformed allowlist config throws at startup rather than being skipped.
- **A missing Origin doesn't prove the caller isn't a browser.** No-cors GETs (`<img>`, `<script>`) and navigations send none. Use `Sec-Fetch-Site`: refuse `cross-site` and `same-site` (every localhost port is same-site), pass `same-origin`, `none` (typed URL) and an absent header (curl, server-to-server callers).
- **Scope path checks by the router's matched route, never the raw request URL.** Routers decode percent-escapes before matching, so `/%61pi/x` runs an `/api` handler while `url.startsWith('/api/')` is false.
- **Writes don't live on GET** outside the guarded prefix. A long-poll or "GET that upserts" is triggerable by any page that can embed an image.

## Test

Pin each branch: foreign Host, foreign Origin, cross-site Origin-less GET, an encoded-path bypass, and that an Origin-less, header-less write and WebSocket upgrade still pass (non-browser callers depend on it).

Applies when the server listens on loopback/LAN without per-request credentials and a browser can reach it. Doesn't apply to a public service behind real authentication (use CSRF protection there), or one only reachable over a Unix socket.

*Source: learned regression (purecontext-platform — Origin check passed Origin-less cross-site and percent-encoded requests).*
