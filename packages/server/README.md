# @wcstack/server

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if Web Components rendered on the server?**

Imagine a future where your `<wcs-state>` templates are fully rendered before they reach the browser — data is fetched, bindings are resolved, lists are expanded, conditionals are evaluated. The user sees content instantly, and the client picks up exactly where the server left off.

That's what `@wcstack/server` explores. It runs your existing `@wcstack/state` templates through happy-dom, produces fully-rendered HTML with embedded hydration data, and lets the client resume reactivity with zero flicker. No special template syntax, no server-specific markup — just the same HTML you already write.

## Features

### Basic Features
- **Full Template Rendering**: Runs `@wcstack/state` bindings server-side — text, attributes, `for` loops, `if`/`elseif`/`else` conditionals, filters, and mustache `{{ }}` syntax.
- **Automatic Hydration Data**: Generates `<wcs-ssr>` elements containing the state's data and the page-level templates, and marks rows, branches and text bindings with comments, for seamless client-side hydration.
- **Async Data Fetching**: Supports `$connectedCallback` with `fetch()` — server waits for all async operations before rendering.
- **RenderCore**: A headless, event-driven rendering class that follows the `wc-bindable` protocol for observable `html` / `loading` / `error` state.
- **Zero Browser Dependencies**: Runs in Node.js with happy-dom as the only runtime dependency.

### Unique Features
- **Drop-in SSR**: No changes to your client-side templates. Add `enable-ssr` to `<wcs-state>` and render with `renderToString()`.
- **Template Fragment Preservation**: Page-level `for`/`if` templates are kept in `<wcs-ssr>` under the ids their anchor comments name, so the client can put them back and keep rendering from them.
- **Form Values in the Markup**: An input's `value` / `checked`, the options a select has selected and a textarea's text are written into the HTML, so the page shows them before the client binds it. Other DOM properties (e.g., `innerHTML`) are in the rendered HTML as they are, and the client applies every binding to the nodes it adopts.
- **wc-bindable Protocol**: `RenderCore` exposes rendering state via the standard protocol, enabling the same `bind()` pattern on both server and client.

## Installation

```bash
npm install @wcstack/server
```

## Quick Start

### `renderToString()` — One-shot rendering

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(`
  <wcs-state json='{"items":["Apple","Banana","Cherry"]}' enable-ssr>
  </wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: items.*"></li>
    </template>
  </ul>
`);

console.log(html);
// Fully rendered HTML with <wcs-ssr> hydration data
```

The same call doubles as a **snapshot test** for a page: `expect(await renderToString(html)).toMatchSnapshot()` in vitest pins the rendered markup without a browser. For headless DOM tests that also exercise writes and handlers, `installGlobals()` (below) is the globals swap to reuse — see [Testing Your Page](../state/README.md#testing-your-page) in the state README.

### `RenderCore` — Observable rendering with caching

```javascript
import { RenderCore } from "@wcstack/server";

const renderer = new RenderCore();

// Listen to state changes via wc-bindable protocol
renderer.addEventListener("wcs-render:loading-changed", (e) => {
  console.log("loading:", e.detail);
});

renderer.addEventListener("wcs-render:html-changed", (e) => {
  console.log("rendered:", e.detail.length, "bytes");
});

// Render and cache
await renderer.render(templateHtml);

// Subsequent reads use the cached result
console.log(renderer.html);
```

## API Reference

### `renderToString(html: string, options?: RenderOptions): Promise<string>`

Renders an HTML string containing `@wcstack/state` templates. Returns fully-rendered HTML with hydration data for any `<wcs-state enable-ssr>` elements.

**Options:**

| Option | Description |
|--------|-------------|
| `url` | Full URL of the request (e.g. `"http://localhost:3000/products/1"`). Reflected in `window.location` / `document.baseURI`. Required for server-rendering components that route on the URL. |
| `baseHref` | Value for the `<base href>` injected into `<head>`. Defaults to `"/"` when `url` is given. Set it explicitly for sub-path deployments. |
| `baseUrl` | Base URL for resolving relative fetch URLs. Defaults to the origin of `url`. |
| `bootstraps` | Array of bootstrap functions (defaults to `bootstrapState`). Async loaders are allowed — packages whose classes extend `HTMLElement` at module scope cannot be imported top-level in plain Node, so pass e.g. `async () => (await import('@wcstack/fetch')).bootstrapFetch()`; the loader runs after DOM globals are installed. |
| `timeoutMs` | How long to wait for the page to become ready, in milliseconds. Default `DEFAULT_RENDER_TIMEOUT_MS` (**30 000**). Exceeding it rejects with a message naming the cause. **Pass `0` to disable the limit.** Values that cannot work as a limit are treated as "no limit" too: `NaN`, anything `≤ 0`, and anything above `MAX_RENDER_TIMEOUT_MS` (2 147 483 647) **including `Infinity`** — Node's `setTimeout` rounds a delay past 2³¹−1 down to 1 ms, so "raising" the limit that way would otherwise invert into an immediate timeout. |

> **Why there is a limit at all.** `renderToString` swaps `globalThis`, so renders are serialised through one mutex, released in a `finally`. Before the limit, a page that never became ready never reached that `finally` — one bad page left **every later render on the process hanging forever**. The limit guarantees the mutex comes back.
>
> The budget is shared between waiting for readiness and the cleanup drain in `finally`; the drain gets whatever is left, but never less than `CLEANUP_MIN_TIMEOUT_MS` (1 000 ms), since a zero budget would mean "no limit" again. Worst-case wall time is therefore `timeoutMs + 1 000 ms`. With `timeoutMs: 0` the cleanup is unbounded as well — that is what disabling the limit means.

> **Long-lived processes.** The last cleanup step asks the state provider to drop what it kept for that render (`reset()` on the ssr-snapshot builder). `@wcstack/state` 4.0 restarts its template ids there, so each render numbers its templates from `wcs-t0` again instead of counting up across renders. It runs after the window is closed, and it is optional: a provider without it is simply not asked. A snapshot is always scoped to its own document either way.

**Rendering pipeline:**
1. Creates a happy-dom window and installs browser globals
2. Parses HTML and triggers `connectedCallback` on all `<wcs-state>` elements
3. Awaits all `$connectedCallback` promises (including `fetch()` calls)
4. Waits for `buildBindings` to complete
5. Calls the snapshot builder of `@wcstack/state`, which writes form values into the markup and generates `<wcs-ssr>` elements for states with `enable-ssr`
6. Restores globals and returns the rendered HTML

### `RenderCore`

Headless rendering class extending `EventTarget`. Implements the `wc-bindable` protocol.

| Property | Type | Description |
|----------|------|-------------|
| `html` | `string \| null` | Rendered HTML (cached after `render()`) |
| `loading` | `boolean` | `true` while rendering is in progress |
| `error` | `Error \| null` | Error from the last `render()` call, if any |

| Method | Returns | Description |
|--------|---------|-------------|
| `render(html)` | `Promise<string \| null>` | Renders the template and caches the result. Returns `null` on error. |

| Event | Detail | Description |
|-------|--------|-------------|
| `wcs-render:html-changed` | `string` | Fired when rendering completes successfully |
| `wcs-render:loading-changed` | `boolean` | Fired when loading state changes |
| `wcs-render:error` | `Error` | Fired when rendering fails |

**wc-bindable declaration:**

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "html", event: "wcs-render:html-changed" },
    { name: "loading", event: "wcs-render:loading-changed" },
    { name: "error", event: "wcs-render:error" },
  ],
};
```

### Helper Functions

| Function | Description |
|----------|-------------|
| `installGlobals(window)` | Installs happy-dom globals on `globalThis`. Returns a restore function. |
| `waitForReady(root, { maxIterations? })` | Awaits every custom element under `root` (a `document` or a `ShadowRoot`) that follows the readiness protocols — `static hasConnectedCallbackPromise` elements' `connectedCallbackPromise` (re-scanning while new elements appear, e.g. `<wcs-router>`'s initial route), then `static getBindingsReady(root)` (`<wcs-state>`'s binding construction). This is the wait `renderToString` performs before serializing; [`@wcstack/testing`](../testing/README.md)'s `mount()` reuses it. Rejects if binding initialization fails. |

### Constants

| Name | Description |
|------|-------------|
| `GLOBALS_KEYS` | Array of browser global keys installed during SSR (`document`, `HTMLElement`, `Node`, etc.) |
| `VERSION` | Package version string from `package.json` |
| `DEFAULT_RENDER_TIMEOUT_MS` | Default of `RenderOptions.timeoutMs` (30 000) |
| `MAX_RENDER_TIMEOUT_MS` | Largest delay Node's `setTimeout` honours (2 147 483 647); anything above is treated as "no limit" |
| `CLEANUP_MIN_TIMEOUT_MS` | Floor for the cleanup drain's share of the budget (1 000) |

## SSR Output Structure

When a `<wcs-state>` has the `enable-ssr` attribute, `renderToString()` inserts a `<wcs-ssr>` element immediately before it, holding the version of `@wcstack/state` that rendered the page, the state's data and the page-level templates. The rendered content stays where it is, marked with comments:

```html
<!-- Generated by renderToString() -->
<wcs-ssr version="4.0.0">

  <!-- State snapshot -->
  <script type="application/json">{"items":["Apple","Banana","Cherry"]}</script>

  <!-- Page-level templates, by the id their anchor comment names -->
  <template id="wcs-t0" data-wcs="for: items">
    <li data-wcs="textContent: items.*"></li>
  </template>

</wcs-ssr>

<wcs-state json='...' enable-ssr></wcs-state>

<!-- Rendered output (visible immediately) -->
<ul>
  <!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><li>Apple</li><!--wcs-|--><li>Banana</li><!--wcs-|--><li>Cherry</li><!--wcs-]-->
</ul>
```

| Marker | Meaning |
|--------|---------|
| `<!--wcs-p:ID-->` | Where a page-level `for:` / `if:` / `elseif:` / `else:` template was. The template is in `<wcs-ssr>` as `<template id="ID">` (`wcs-t0`, `wcs-t1`, … in each render) |
| `<!--wcs-[-->` … `<!--wcs-]-->` | A list's rows, right after its anchor; each row starts with `<!--wcs-\|-->` |
| `<!--wcs-[:i-->` … `<!--wcs-]-->` | The branch an `if:` / `elseif:` / `else:` chain rendered (`i` is its position in the chain, from 0), right after the chain's last anchor. No region when no branch is rendered |
| `<!--wcs-t:EXPR-->value<!--wcs-/t-->` | A text binding at page level (`{{ }}` or `<!--@@: -->`). `EXPR` is its whole expression, filters included, URI-encoded |
| `<!--wcs-s-->` / `<!--wcs-e-->` | Separates two adjacent text nodes / stands for an empty one, so that parsing the HTML gives back the same text nodes |
| `data-wcs-raw="…"` | On a text-only element (`<textarea>`, `<title>`) with `{{ }}` in it: its content as written, which the client puts back |

Inside a row or a branch, a nested `for:` / `if:` keeps its own anchor comment, and its region follows it in the same way.

- **Keep the comments in the output.** Removing them in a later minification step (`removeComments` and the like) breaks hydration. Their format is not an API either: do not post-process the output based on it.
- There is no property value table: what a binding rendered (`innerHTML` included) is in the HTML as it is, and the client applies every binding to the nodes it adopts. 3.x's `data-wcs-ssr-id` attributes and `<script type="application/json" data-wcs-ssr-props>` are gone.
- Form values go into the markup where they differ from it, on any page with a `<wcs-state>` (with or without `enable-ssr`): an input's `value` and `checked` attributes, `selected` on the options a select has selected, a textarea's text. A password's value is left out (the client's binding fills it in), and so is a textarea value that contains `{{`.
- `<wcs-ssr>` is generated for a root `<wcs-state enable-ssr>` only, not for a volume (`mount="…"`) or a component's `<wcs-state bind-component>`. A volume's data is in its root's snapshot.

The client-side `@wcstack/state` reads the `<wcs-ssr>` element during hydration, restores state and templates, and resumes reactivity without re-rendering.

### Server and client versions

`<wcs-ssr version>` is the version of `@wcstack/state` that rendered the page, and the client hydrates only a snapshot of its own major.minor. **Deploy `@wcstack/server` and the client together**, of the same major.minor.

- A 4.0 client discards the output of a 3.x server. It warns `<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` and renders the page on the client as if there were no server: the state loads from its own source, `$connectedCallback` runs on the client, and the server's rows, branches and markers give way to the templates they were rendered from. With the output of a 3.x server up to 3.5.2, a text binding outside templates also loses its filters (the warning says so). Purge HTML cached from a 3.x server when you switch.
- A 4.0 server with a 3.x client is not supported: the 3.x client does not read the 4.0 markers.

The details are in the [migration guide §3.6](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.md#36-ssr).

## Server Integration Example

```javascript
import { createServer } from "node:http";
import { RenderCore } from "@wcstack/server";

const renderer = new RenderCore();

const template = `
  <wcs-state enable-ssr>
    <script type="module">
      export default {
        async $connectedCallback() {
          const res = await fetch("http://localhost:3000/api/data");
          this.items = await res.json();
        },
        items: []
      };
    </script>
  </wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: items.*"></li>
    </template>
  </ul>
`;

createServer(async (req, res) => {
  if (!renderer.html) {
    await renderer.render(template);
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(renderer.html);
}).listen(3000);
```

## Input HTML Rules

- Pass only the contents of `<body>` — do not include `<html>`, `<head>`, or `<body>` tags.
- `<script>` / `<link>` external resource loading is not executed.
  → Provide required packages via `options.bootstraps`.

## What SSR Can Do

### State Initialization & Data Fetching

- Load `<wcs-state>` from `json` attribute, `src` attribute, or inline `<script type="module">`
- Execute `$connectedCallback` for server-side fetch (API calls, etc.)

```html
<!-- Direct JSON -->
<wcs-state enable-ssr json='{"title":"Hello"}'></wcs-state>

<!-- Fetch data from API in $connectedCallback -->
<!-- $connectedCallback is defined as a method on the state object; `this` is the state proxy -->
<wcs-state enable-ssr>
  <script type="module">
    export default {
      async $connectedCallback() {
        const res = await fetch('/api/users');
        this.users = await res.json();
      }
    };
  </script>
</wcs-state>
```

### Server Communication with wcs-fetch

- `<wcs-fetch>` auto-fetch (without `manual`) also executes on the server
- Use `manual` + `$connectedCallback` for explicit control:

```html
<wcs-fetch id="api" url="/api/users" manual></wcs-fetch>
<wcs-state enable-ssr>
  <script type="module">
    export default {
      async $connectedCallback() {
        const el = document.getElementById('api');
        this.users = await el.fetch();
      }
    };
  </script>
</wcs-state>
```

> Note: `bootstrapFetch` must be included in the `bootstraps` option.

### Bindings & Structural Rendering

- `data-wcs` binding application (text, attribute, class, style, property)
- `<template data-wcs="for:">` / `if:` / `elseif:` / `else:` structural rendering

```html
<ul>
  <template data-wcs="for: users">
    <li data-wcs="textContent: .name"></li>
  </template>
</ul>
<template data-wcs="if: isAdmin">
  <div class="admin-panel">...</div>
</template>
```

### Hydration

- Automatic `<wcs-ssr>` metadata generation for `<wcs-state enable-ssr>`
- Client-side hydration restores bindings without re-rendering: the server's rows and branches, nested ones included, are adopted where they are
- A `<wcs-state>` without `enable-ssr` is still rendered on the server, but it gets no `<wcs-ssr>` and is not hydrated: on the client only its `data-wcs` attribute bindings outside templates follow the state, while its `{{ }}` text, rows and branches stay as the server rendered them

### Custom Element Waiting

- Automatically awaits all custom elements with `static hasConnectedCallbackPromise = true`
- Uses a stabilization loop: after awaiting, re-scans the DOM for newly added custom elements (up to 10 iterations), ensuring elements dynamically inserted during `$connectedCallback` are also awaited

### Router SSR

Put `enable-ssr` on `<wcs-router>` and pass the request `url` (design: [docs/ssr-router-design.md](https://github.com/wcstack/wcstack/blob/main/docs/ssr-router-design.md) (ja)):

```javascript
const body = await renderToString(template, {
  url: `http://localhost:3000${req.url}`,
  bootstraps: [
    // classes extending HTMLElement cannot be imported top-level in plain
    // Node — the async loader runs after DOM globals are installed
    async () => (await import('@wcstack/state')).bootstrapState(),
    async () => (await import('@wcstack/router')).bootstrapRouter(),
  ],
});
```

- The initial route of the request URL is rendered on the server — typed params, nested routes, and structural templates (`for:` / `if:`) inside route content included.
- The client-side router **adopts** the server-rendered DOM instead of re-rendering it; state bindings hydrated on those nodes stay live. If anything about the server output doesn't verify (URL mismatch, edited templates), the client silently falls back to normal client-side rendering.
- `<wcs-ssr>` snapshots are built as a server-orchestrated final pass (the ssr-snapshot protocol), so hydration data always includes route content regardless of load order.
- `<wcs-link>` anchors are server-rendered (with `active` / `aria-current`) and adopted on the client.
- Sub-path deployments: pass `baseHref` and serve a matching `<base href>` to the client.

## What SSR Cannot Do

- Execute `<script src="...">` or `<link>` in `<head>`
- Access browser-specific APIs (localStorage, sessionStorage, navigator, etc.)
- Render Shadow DOM (Declarative Shadow DOM not supported)
- Register event handlers (restored via client-side hydration)
- Load components dynamically via `<wcs-autoloader>`
- Apply `outerHTML:` / `outerText:` (they are applied on the client: the server output contains the element as written, so the value is not in the HTML that search engines or no-JS views see)
- Render the children that a Light DOM custom element bound at page level renders from a value (the client renders them; children you wrote stay in the output)
- Run `$watch` handlers or `$stream` sources (on the server, streams keep their `initial` value; both start on the client)
- Server-render guarded routes (by design — the guard is an authorization point that runs client-side; the outlet is left empty), `<wcs-layout>` routes (adopted pages fall back to client-side rendering), or `<wcs-head>` contents (reflection targets `document.head`, which a body-only render cannot carry)

## HTML Splitting Pattern

`renderToString` receives only the `<body>` contents. Wrap the result with `<head>` and `<script>` tags on the outside:

```javascript
// server.js
const ssrBody = await renderToString(template, {
  baseUrl: 'http://localhost:3001',
});
const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="module" src="/packages/state/dist/auto.min.js"></script>
</head>
<body>${ssrBody}</body>
</html>`;
```

### Using Multiple Packages

```javascript
const ssrBody = await renderToString(template, {
  baseUrl: 'http://localhost:3001',
  // async loaders: these packages cannot be imported top-level in plain Node
  bootstraps: [
    async () => (await import('@wcstack/state')).bootstrapState(),
    async () => (await import('@wcstack/fetch')).bootstrapFetch(),
  ],
});
```

## How It Works

### Rendering Pipeline

1. **Global Setup**: Creates a happy-dom `Window` and temporarily installs browser globals (`document`, `HTMLElement`, `MutationObserver`, etc.) on `globalThis`. Disables `URL.createObjectURL` to force the base64 data URL fallback for inline scripts.

2. **SSR Mode**: Sets `data-wcs-server` attribute on the `<html>` element. `@wcstack/state` detects this attribute to enable SSR behavior.

3. **Bootstrap**: Calls user-provided bootstrap functions (defaults to `bootstrapState()` if omitted).

4. **HTML Parse & Callback**: Sets `document.body.innerHTML`, which triggers happy-dom's element lifecycle. Each `<wcs-state>` loads its data source and runs `$connectedCallback`. Awaits all custom elements with `hasConnectedCallbackPromise` via a stabilization loop — after each await, re-scans the DOM for newly added elements (up to 10 iterations).

5. **Ready**: Awaits `getBindingsReady()` of every custom element class that has it (`<wcs-state>`'s binding construction, see `waitForReady`) — text interpolation, attribute mapping, list expansion, conditional evaluation.

6. **SSR Metadata**: Calls the snapshot builder that `@wcstack/state` installed (the ssr-snapshot protocol) as a final pass. It writes form values into the markup, moves each list's rows and the rendered branch into a marked region right after its anchor, and inserts a `<wcs-ssr>` element before each root `<wcs-state enable-ssr>`.

7. **Cleanup**: Restores original globals and closes the happy-dom window.

### Client-Side Hydration

The client-side `@wcstack/state` detects `<wcs-ssr>` elements and, when the version has the client's major.minor:
1. Loads the state from its own source and takes the snapshot's data over it (getters, setters and methods stay), and skips `$connectedCallback`, which the server ran
2. Puts the templates back at their anchors (`<!--wcs-p:ID-->`) and turns the text markers back into bindings
3. Adopts the server's rows and branches where they are and applies every binding to them — a custom element in them is connected once and never disconnected. A server row that no longer fits its template is rendered again in its place; rows and branches the client does not render go as soon as the page is bound
4. Resumes normal reactive binding

The rendered DOM is visible immediately — hydration only wires up interactivity. A snapshot of another major.minor is discarded and the page renders on the client ([Server and client versions](#server-and-client-versions)).

## License

MIT
