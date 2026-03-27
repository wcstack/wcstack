# @wcstack/server

**What if Web Components rendered on the server?**

Imagine a future where your `<wcs-state>` templates are fully rendered before they reach the browser — data is fetched, bindings are resolved, lists are expanded, conditionals are evaluated. The user sees content instantly, and the client picks up exactly where the server left off.

That's what `@wcstack/server` explores. It runs your existing `@wcstack/state` templates through happy-dom, produces fully-rendered HTML with embedded hydration data, and lets the client resume reactivity with zero flicker. No special template syntax, no server-specific markup — just the same HTML you already write.

## Features

### Basic Features
- **Full Template Rendering**: Runs `@wcstack/state` bindings server-side — text, attributes, `for` loops, `if`/`elseif`/`else` conditionals, filters, and mustache `{{ }}` syntax.
- **Automatic Hydration Data**: Generates `<wcs-ssr>` elements containing state snapshots, template fragments, and property maps for seamless client-side hydration.
- **Async Data Fetching**: Supports `$connectedCallback` with `fetch()` — server waits for all async operations before rendering.
- **RenderCore**: A headless, event-driven rendering class that follows the `wc-bindable` protocol for observable `html` / `loading` / `error` state.
- **Zero Browser Dependencies**: Runs in Node.js with happy-dom as the only runtime dependency.

### Unique Features
- **Drop-in SSR**: No changes to your client-side templates. Add `enable-ssr` to `<wcs-state>` and render with `renderToString()`.
- **Template Fragment Preservation**: `for`/`if` template sources are captured with UUID references so the client can re-execute structural directives.
- **Property Hydration**: DOM properties that can't be expressed as attributes (e.g., `innerHTML`) are serialized separately and restored during hydration.
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

### `renderToString(html: string): Promise<string>`

Renders an HTML string containing `@wcstack/state` templates. Returns fully-rendered HTML with hydration data for any `<wcs-state enable-ssr>` elements.

**Rendering pipeline:**
1. Creates a happy-dom window and installs browser globals
2. Parses HTML and triggers `connectedCallback` on all `<wcs-state>` elements
3. Awaits all `$connectedCallback` promises (including `fetch()` calls)
4. Waits for `buildBindings` to complete
5. Generates `<wcs-ssr>` elements for states with `enable-ssr`
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
| `extractStateData(stateEl)` | Extracts data properties from a `<wcs-state>` element (excludes `$`-prefixed keys and functions). |

### Constants

| Name | Description |
|------|-------------|
| `GLOBALS_KEYS` | Array of browser global keys installed during SSR (`document`, `HTMLElement`, `Node`, etc.) |
| `VERSION` | Package version string from `package.json` |

## SSR Output Structure

When a `<wcs-state>` has the `enable-ssr` attribute, `renderToString()` inserts a `<wcs-ssr>` element immediately before it containing all hydration data:

```html
<!-- Generated by renderToString() -->
<wcs-ssr name="default" version="0.1.0">

  <!-- State snapshot -->
  <script type="application/json">{"items":["Apple","Banana","Cherry"]}</script>

  <!-- Template fragments (for client-side re-execution) -->
  <template id="uuid-1234" data-wcs="for: items">
    <li data-wcs="textContent: items.*"></li>
  </template>

  <!-- Non-attribute properties (optional) -->
  <script type="application/json" data-wcs-ssr-props>
    {"wcs-ssr-0": {"innerHTML": "<b>rich</b>"}}
  </script>

</wcs-ssr>

<wcs-state json='...' enable-ssr></wcs-state>

<!-- Rendered output (visible immediately) -->
<ul>
  <li>Apple</li>
  <li>Banana</li>
  <li>Cherry</li>
</ul>
```

The client-side `@wcstack/state` reads the `<wcs-ssr>` element during hydration, restores state and templates, and resumes reactivity without re-rendering.

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

## How It Works

### Rendering Pipeline

1. **Global Setup**: Creates a happy-dom `Window` and temporarily installs browser globals (`document`, `HTMLElement`, `MutationObserver`, etc.) on `globalThis`. Disables `URL.createObjectURL` to force the base64 data URL fallback for inline scripts.

2. **State Bootstrap**: Calls `bootstrapState({ ssr: true })` to register `<wcs-state>` in SSR mode.

3. **HTML Parse & Callback**: Sets `document.body.innerHTML`, which triggers happy-dom's element lifecycle. Each `<wcs-state>` loads its data source and runs `$connectedCallback`.

4. **Binding Resolution**: Waits for all bindings to build and apply — text interpolation, attribute mapping, list expansion, conditional evaluation.

5. **Hydration Data Collection**: For each `<wcs-state enable-ssr>`:
   - Extracts reactive data (excluding `$`-prefixed internals and functions)
   - Captures template fragments with UUID references
   - Collects non-attribute property bindings (e.g., `innerHTML`, `value`)

6. **Cleanup**: Restores original globals, resets SSR mode, and closes the happy-dom window.

### Client-Side Hydration

The client-side `@wcstack/state` detects `<wcs-ssr>` elements and:
1. Restores state from the JSON snapshot (skipping network requests)
2. Re-attaches template fragments using UUID references
3. Applies non-attribute properties from the props script
4. Resumes normal reactive binding

The rendered DOM is visible immediately — hydration only wires up interactivity.

## License

MIT
