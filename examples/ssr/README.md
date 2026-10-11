# wcstack SSR Demo

Server-Side Rendering demo using `@wcstack/state` and `@wcstack/server`.

## Quick Start

```bash
cd examples/ssr
npm install
npm start
```

Open http://localhost:3001 (`PORT` overrides the port).

### Against the repository's builds (`WCS_LOCAL=1`)

To try a change in the working tree before it is published, run the demo on
the repository's own builds instead of the npm install and the CDN (no
`npm install` needed):

```bash
WCS_LOCAL=1 node examples/ssr/server.js
```

`WCS_LOCAL=1` renders with `packages/server/dist` (which resolves
`@wcstack/state` to `packages/state` through `packages/server/node_modules`),
serves `/packages/<pkg>/dist/…` from the repo, and loads the client from
`/packages/state/dist/auto.min.js` instead of the pinned `esm.run` URL — the
server and the client then run the same engine. Without it nothing changes.
The e2e suite (`e2e/tests/ssr-example.spec.ts`) runs the demo this way.

## What This Demo Shows

### Server-Side Rendering
- The HTML is fully rendered on the server before being sent to the browser
- Data is fetched via `$connectedCallback` → `fetch("/api/users")` on the server
- The rendered HTML includes all user data, so content is visible before JavaScript loads

### Hydration
- When the auto bundle (the `/auto` CDN entry, `dist/auto.min.js`) loads in the browser, the existing DOM is hydrated (not re-rendered)
- Event handlers become active (buttons work)
- State changes trigger reactive DOM updates
- Hydration only happens when the browser's `@wcstack/state` matches the server's on major/minor; on a mismatch the client discards the SSR output and renders from scratch
- So `server.js` reads the version back out of the `<wcs-ssr version>` it just rendered and pins the CDN tag to it (`https://esm.run/@wcstack/state@<version>/auto`) instead of tracking `latest`

### Features Demonstrated

| Feature | Description |
|---|---|
| `$connectedCallback` + `fetch()` | Server fetches `/api/users` and renders the list |
| `{{ counter }}` | Mustache text binding with +1 button |
| `for: users` | List rendering with Add/Remove buttons |
| `if: show` / `else:` | Conditional block with Toggle button |
| `<wcs-ssr>` | Contains initial state JSON, templates, and version info |

## Architecture

```
Browser Request
    │
    ▼
┌──────────────────────────────────┐
│  server.js (Node.js)             │
│                                  │
│  1. Read template.html           │
│  2. renderToString() via         │
│     happy-dom + @wcstack/state   │
│  3. $connectedCallback runs      │
│     → fetch("/api/users")        │
│  4. Bindings applied             │
│     → for/if/text rendered       │
│  5. <wcs-ssr> generated          │
│     → state data + templates     │
│  6. Return full HTML             │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│  Browser                         │
│                                  │
│  1. HTML displayed immediately   │
│     (no JavaScript needed)       │
│  2. auto bundle loads            │
│  3. <wcs-state enable-ssr>       │
│     → reads <wcs-ssr> data       │
│     → skips $connectedCallback   │
│  4. Adopts the server DOM        │
│     → templates back at anchors  │
│     → rows/branches kept in place│
│     → bindings applied to them   │
│  5. Page is now interactive      │
│     → buttons, state changes     │
└──────────────────────────────────┘
```

## Files

| File | Description |
|---|---|
| `package.json` | Dependency: `@wcstack/server` (which brings in `@wcstack/state`) |
| `server.js` | Node.js server with SSR rendering and `/api/users` endpoint |
| `template.html` | Source template with `<wcs-state enable-ssr>` and bindings |

## Endpoints

| URL | Description |
|---|---|
| `http://localhost:3001/` | SSR-rendered page (cached) |
| `http://localhost:3001/nocache` | SSR-rendered page (fresh render each time, for benchmarking) |
| `http://localhost:3001/api/users` | JSON API returning user data |

## SSR Output Structure

The server generates HTML like this (4.0; trimmed):

```html
<!-- SSR metadata for hydration: the rendering @wcstack/state version, the state, the page-level templates -->
<wcs-ssr version="4.0.0">
  <script type="application/json">{"users":[...],"show":true,"counter":0}</script>
  <template id="wcs-t0" data-wcs="for: users">...</template>
  <template id="wcs-t1" data-wcs="if: show">...</template>
  <template id="wcs-t2" data-wcs="else:">...</template>
</wcs-ssr>

<!-- State element (skips $connectedCallback on client) -->
<wcs-state enable-ssr>
  <script type="module">export default { ... };</script>
</wcs-state>

<!-- Pre-rendered text binding -->
<h2>Counter: <!--wcs-t:counter-->0<!--wcs-/t--></h2>

<!-- Pre-rendered for block: the anchor, then the rows -->
<!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><li class="user-item">...</li><!--wcs-|-->...<!--wcs-]-->

<!-- Pre-rendered if/else chain: one anchor per template, then the branch it rendered (0 = the if:) -->
<!--wcs-p:wcs-t1-->
<!--wcs-p:wcs-t2--><!--wcs-[:0--><div class="info-box">This block is visible...</div><!--wcs-]-->
```

A page-level text marker carries the binding's whole expression, output filters included and URI-encoded, so hydration restores the same binding: `{{ price|toFixed(2) }}` renders as `<!--wcs-t:price%7CtoFixed(2)-->3.14<!--wcs-/t-->`. Rows and branches carry no text markers: their templates in `<wcs-ssr>` hold the expressions, and the client applies them to the nodes it adopts. The markers are described in the [`@wcstack/server` README](../../packages/server/README.md#ssr-output-structure); their format is not an API, so do not post-process the output based on it, and keep the comments (an HTML minifier's `removeComments` breaks hydration).
