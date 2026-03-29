# wcstack SSR Demo

Server-Side Rendering demo using `@wcstack/state` and `@wcstack/server`.

## Quick Start

```bash
cd examples/ssr
npm install
npm start
```

Open http://localhost:3001

## What This Demo Shows

### Server-Side Rendering
- The HTML is fully rendered on the server before being sent to the browser
- Data is fetched via `$connectedCallback` → `fetch("/api/users")` on the server
- The rendered HTML includes all user data, so content is visible before JavaScript loads

### Hydration
- When `auto.js` loads in the browser, the existing DOM is hydrated (not re-rendered)
- Event handlers become active (buttons work)
- State changes trigger reactive DOM updates

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
│  2. auto.js loads                │
│  3. <wcs-state enable-ssr>       │
│     → reads <wcs-ssr> data       │
│     → skips $connectedCallback   │
│  4. hydrateBindings()            │
│     → restores templates         │
│     → Content-izes for/if blocks │
│     → registers bindings         │
│  5. Page is now interactive      │
│     → buttons, state changes     │
└──────────────────────────────────┘
```

## Files

| File | Description |
|---|---|
| `package.json` | Dependencies: `@wcstack/server`, `@wcstack/state` |
| `server.js` | Node.js server with SSR rendering and `/api/users` endpoint |
| `template.html` | Source template with `<wcs-state enable-ssr>` and bindings |

## Endpoints

| URL | Description |
|---|---|
| `http://localhost:3001/` | SSR-rendered page (cached) |
| `http://localhost:3001/nocache` | SSR-rendered page (fresh render each time, for benchmarking) |
| `http://localhost:3001/api/users` | JSON API returning user data |

## SSR Output Structure

The server generates HTML like this:

```html
<!-- SSR metadata for hydration -->
<wcs-ssr name="default" version="1.5.3">
  <script type="application/json">{"users":[...],"show":true,"counter":0}</script>
  <template id="u0" data-wcs="for: users">...</template>
  <template id="u1" data-wcs="if: show">...</template>
  <template id="u2" data-wcs="else:">...</template>
</wcs-ssr>

<!-- State element (skips $connectedCallback on client) -->
<wcs-state enable-ssr>
  <script type="module">export default { ... };</script>
</wcs-state>

<!-- Pre-rendered content -->
<h2>Counter: <!--@@wcs-text-start:counter-->0<!--@@wcs-text-end:counter--></h2>

<!-- Pre-rendered for block -->
<!--@@wcs-for:u0-->
<!--@@wcs-for-start:u0:users:0-->
<li class="user-item">...</li>
<!--@@wcs-for-end:u0:users:0-->

<!-- Pre-rendered if/else block -->
<!--@@wcs-if:u1-->
<!--@@wcs-if-start:u1:show-->
<div class="info-box">This block is visible...</div>
<!--@@wcs-if-end:u1:show-->
```
