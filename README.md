# wcstack

**What if the browser had these built in?**

wcstack is a thought experiment turned into code. We imagine what future web standards *could* look like — reactive data binding, declarative routing, automatic component loading — and build them as if they already existed in the browser.

No framework. Just HTML tags that *should* exist.

---

## Rules of the Game

This project follows five strict constraints. They're what make it interesting.

| # | Rule | Why |
|---|------|-----|
| 1 | **Single CDN import** | One `<script>` tag. That's it. No npm, no bundler, no config. |
| 2 | **Features as custom tags** | Everything is a custom element. If it can't be expressed as `<wcs-something>`, it doesn't belong here. |
| 3 | **Initial load = tag definitions only** | The script just registers custom elements. No initialization code, no bootstrap ritual. |
| 4 | **Respect HTML semantics** | Expressions live in `data-*` attributes and text nodes — places HTML already allows extension. The DOM structure and semantics stay intact. |
| 5 | **Latest ECMAScript** | We actively adopt cutting-edge JS features. No transpiling to ES5. This is the future, after all. |

These rules sound simple. They're not.

Respecting HTML semantics means you need to deeply understand where the spec allows extension — and where it doesn't. Building everything as custom tags means solving lifecycle, ordering, and communication within the Custom Elements spec. No dependencies means every algorithm is yours to write. And it all has to feel like it *could* be a browser built-in.

---

## The Core Insight

In every existing framework, the **component** is where UI meets state. Even with external stores, you still write glue code inside the component to pull state in. State and UI always couple through JavaScript.

wcstack takes a different path. Literally.

The **only** contract between UI and state is a **path string** — `user.name`, `cart.items.*.subtotal`, `@shared`. No hooks. No imports. No glue code. The component's JavaScript doesn't contain a single line that references state. The HTML alone describes every data dependency.

```
State  ← "user.name" →  UI          Path binds the two layers
Comp A ← "@app" →       Comp B      Named path crosses components
Loop   ← "items.*" →    Template    Wildcard abstracts the index
```

This means you can redesign the UI without touching state, refactor state without touching the DOM, and read the HTML to understand everything. It's the same idea as a REST URL — a simple string contract, no shared code.

---

## Packages

Thirty-nine independent runtime packages + one tooling extension package. Zero runtime dependencies (except happy-dom for SSR). No build step required.

### What if HTML had reactive data binding?

[`@wcstack/state`](packages/state/) — Declare state inline, bind it to the DOM with attributes.

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { name: "Widget", price: 500, quantity: 2 },
          { name: "Gadget", price: 1200, quantity: 1 }
        ]
      },
      removeItem(event, index) {
        this["cart.items"] = this["cart.items"].toSpliced(index, 1);
      },
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.price"] * this["cart.items.*.quantity"];
      },
      get "cart.total"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
      },
      get "cart.grandTotal"() {
        return this["cart.total"] * (1 + this.taxRate);
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    {{ .name }} &times;
    <input type="number" data-wcs="value: .quantity">
    = <span data-wcs="textContent: .subtotal|locale"></span>
    <button data-wcs="onclick: removeItem">Delete</button>
  </div>
</template>
<p>Grand Total: <span data-wcs="textContent: cart.grandTotal|locale(ja-JP)"></span></p>
```

- **Path getters** — `get "users.*.fullName"()` computed properties at any depth
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>`
- **40+ built-in filters** — comparison, arithmetic, string, date, formatting
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Web Component binding** — bidirectional state sync with Shadow DOM

[Full documentation &rarr;](packages/state/README.md)

---

### What if routing was just HTML tags?

[`@wcstack/router`](packages/router/) — Define your app's navigation structure in markup.

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <nav slot="header">
          <wcs-link to="/">Home</wcs-link>
          <wcs-link to="/products">Products</wcs-link>
        </nav>
        <wcs-route index>
          <wcs-head><title>Home</title></wcs-head>
          <app-home></app-home>
        </wcs-route>
        <wcs-route path="products">
          <wcs-route index>
            <product-list></product-list>
          </wcs-route>
          <wcs-route path=":id(int)">
            <product-detail data-bind="props"></product-detail>
          </wcs-route>
        </wcs-route>
      </wcs-layout>
    </wcs-route>
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>
```

- **Nested routes & layouts** — compose UI declaratively with Light DOM
- **Typed parameters** — `:id(int)`, `:slug(slug)`, `:date(isoDate)` with auto-conversion
- **Auto-binding** — inject URL params into components via `data-bind`
- **Head management** — `<wcs-head>` switches `<title>` and `<meta>` per route
- **Navigation API** — built on the modern standard with popstate fallback
- **Route guards** — protect routes with async decision functions

[Full documentation &rarr;](packages/router/README.md)

---

### What if fetch was a tag?

[`@wcstack/fetch`](packages/fetch/) — Declarative HTTP communication as a headless Web Component.

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      loading: false,
      filterRole: "",
      get usersUrl() {
        const role = this.filterRole;
        return role ? "/api/users?role=" + role : "/api/users";
      },
    };
  </script>
</wcs-state>

<!-- URL changes automatically trigger re-fetch -->
<wcs-fetch data-wcs="url: usersUrl; value: users; loading: loading"></wcs-fetch>

<template data-wcs="if: loading">
  <p>Loading...</p>
</template>
<template data-wcs="for: users">
  <div data-wcs="textContent: .name"></div>
</template>
```

- **CSBC architecture** — Core / Shell / Binding Contract separation
- **wc-bindable-protocol** — works with React, Vue, Svelte, Solid via thin adapters
- **URL observation** — auto re-fetch when bound URL changes
- **Trigger property** — declarative fetch execution from state, no DOM refs
- **HTML replace mode** — htmx-like `target` attribute for server-rendered fragments
- **Headless Core** — `FetchCore` runs in Node.js, Deno, Cloudflare Workers

[Full documentation &rarr;](packages/fetch/README.md)

---

### What if custom elements loaded themselves?

[`@wcstack/autoloader`](packages/autoloader/) — Write a tag, it loads. No registration needed.

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/ui|lit/": "./components/ui-lit/"
    }
  }
</script>

<!-- Auto-loaded from ./components/ui/button.js -->
<ui-button></ui-button>

<!-- Auto-loaded with Lit loader from ./components/ui-lit/card.js -->
<ui-lit-card></ui-lit-card>
```

- **Import Map based** — namespace resolution, no per-component registration
- **Eager & lazy loading** — load critical components first, the rest on demand
- **MutationObserver** — dynamically added elements are auto-detected
- **Pluggable loaders** — mix Vanilla, Lit, or any custom loader
- **`is` attribute** — customized built-in elements with auto `extends` detection

[Full documentation &rarr;](packages/autoloader/README.md)

---

### What if your templates rendered on the server?

[`@wcstack/server`](packages/server/) — Same HTML, server-rendered. No special syntax needed.

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(`
  <wcs-state enable-ssr>
    <script type="module">
      export default {
        items: [],
        async $connectedCallback() {
          const res = await fetch("/api/items");
          this.items = await res.json();
        }
      };
    </script>
  </wcs-state>
  <template data-wcs="for: items">
    <div data-wcs="textContent: items.*.name"></div>
  </template>
`);
```

- **Drop-in SSR** — add `enable-ssr` to `<wcs-state>`, call `renderToString()`. Done.
- **Automatic hydration** — client picks up where the server left off, zero flicker
- **Relative URL resolution** — `baseUrl` option makes `fetch("/api/...")` work on the server
- **Version-safe fallback** — on version mismatch, DOM is cleaned up and CSR kicks in
- **`<wcs-ssr>` hydration data** — state snapshots, templates, and properties in one element

[Full documentation &rarr;](packages/server/README.md)

---

### Additional Packages

- [`@wcstack/websocket`](packages/websocket/) — Declarative real-time communication with `<wcs-ws>` and bindable connection/message state.
- [`@wcstack/upload`](packages/upload/) — Declarative file upload flows with progress, status, and framework-agnostic bindings.
- [`@wcstack/storage`](packages/storage/) — Declarative persistence with `<wcs-storage>` for localStorage / sessionStorage state sync.
- [`@wcstack/timer`](packages/timer/) — Declarative timers with `<wcs-timer>` for ticking, elapsed time, and state-driven polling.
- [`@wcstack/geolocation`](packages/geolocation/) — Declarative geolocation with `<wcs-geo>` for one-shot/continuous position, accuracy, and live permission state.
- [`@wcstack/debounce`](packages/debounce/) — Declarative debounce/throttle with `<wcs-debounce>` and `<wcs-throttle>` for coalescing value and signal streams.
- [`@wcstack/clipboard`](packages/clipboard/) — Declarative clipboard with `<wcs-clipboard>` for read/write, rich `ClipboardItem`s, copy/cut/paste monitoring, and live permission state.
- [`@wcstack/broadcast`](packages/broadcast/) — Declarative cross-tab messaging with `<wcs-broadcast>` for same-origin BroadcastChannel pub/sub as bindable state.
- [`@wcstack/worker`](packages/worker/) — Declarative Web Worker with `<wcs-worker>` for offloading work to a background thread as bindable message/error/running state.
- [`@wcstack/sse`](packages/sse/) — Declarative Server-Sent Events with `<wcs-sse>` for one-way streaming (EventSource) as bindable message/connection state, with named-event support.
- [`@wcstack/intersection`](packages/intersection/) — Declarative IntersectionObserver with `<wcs-intersect>` for lazy-loading, infinite scroll, and scrollspy as bindable visibility state.
- [`@wcstack/wakelock`](packages/wakelock/) — Declarative Screen Wake Lock with `<wcs-wakelock>` that keeps the screen awake while a bound boolean is true, re-acquiring across visibility changes.
- [`@wcstack/resize`](packages/resize/) — Declarative ResizeObserver with `<wcs-resize>` for element size, container-width probing, and size-dependent logic as bindable state.
- [`@wcstack/speech`](packages/speech/) — Declarative speech with `<wcs-speak>` (text-to-speech as a command-token) and `<wcs-listen>` (recognition results as event-token state).
- [`@wcstack/permission`](packages/permission/) — Declarative Permissions API monitor with `<wcs-permission>` exposing live `granted`/`denied`/`prompt` state. Read-only watcher (no commands); pairs with feature nodes like `<wcs-geo>`.
- [`@wcstack/network`](packages/network/) — Declarative Network Information monitor with `<wcs-network>` exposing live `effectiveType`/`downlink`/`rtt`/`saveData` state for adaptive loading. Read-only watcher (no commands, no attributes); unsupported (Firefox/Safari) is the common case, not an edge case.
- [`@wcstack/screen-orientation`](packages/screen-orientation/) — Declarative Screen Orientation monitor + `lock`/`unlock` commands with `<wcs-screen-orientation>` exposing `type`/`angle`/`portrait`/`landscape`. Monitoring needs no `_gen` guard (synchronous); `lock()` does (async, independent of monitoring).
- [`@wcstack/fullscreen`](packages/fullscreen/) — Declarative Fullscreen API with `<wcs-fullscreen target="...">`, reusing `<wcs-intersect>`'s target-resolution pattern. `active` tracks whether the resolved target is the document's `fullscreenElement`.
- [`@wcstack/picture-in-picture`](packages/picture-in-picture/) — Declarative Picture-in-Picture with `<wcs-pip target="...">` (target must be a `<video>` element). Same target-resolution pattern as `<wcs-fullscreen>`.
- [`@wcstack/pointer-lock`](packages/pointer-lock/) — Declarative Pointer Lock with `<wcs-pointer-lock target="...">` for games/canvas UIs. `movementX`/`movementY` intentionally out of scope in v1 (pair with `@wcstack/debounce`/`@wcstack/throttle` if added later).
- [`@wcstack/share`](packages/share/) — Declarative Web Share API with `<wcs-share>`: `share(data)` command, `value`/`loading`/`error`/`cancelled` state. `cancelled` (user dismissed the share sheet) is kept separate from `error` (a true failure).
- [`@wcstack/eyedropper`](packages/eyedropper/) — Declarative EyeDropper API (desktop color picker) with `<wcs-eyedropper>`: `open()`/`abort()` commands, `value` as `{ sRGBHex }`. Same `value`/`loading`/`error`/`cancelled` shape as `<wcs-share>`.
- [`@wcstack/contacts`](packages/contacts/) — Declarative Contact Picker API with `<wcs-contacts>`: `select(properties, options)` command (Android Chrome only — unsupported is the default elsewhere). `value` is always an array, even with `multiple: false`.
- [`@wcstack/credential`](packages/credential/) — Declarative Credential Management (password/federated only — WebAuthn is explicitly out of scope) with `<wcs-credential>`: `get(options)`/`store(credential)` commands sharing one `_gen` (documented concurrency limitation).
- [`@wcstack/idle`](packages/idle/) — Declarative Idle Detection with `<wcs-idle>`: gesture-gated `requestPermission()` + `start`/`stop`, exposing `userState`/`screenState`/`active`. Does not duplicate permission state — compose with `<wcs-permission name="idle-detection">`. Does not auto-start on connect.
- [`@wcstack/tilt`](packages/tilt/) — Declarative Device Orientation with `<wcs-tilt>`, absorbing iOS's gesture-gated `requestPermission()` (a no-op elsewhere) so callers write one flow that works everywhere. `permissionState` is a 3-value vocabulary tracked locally (no matching Permissions API entry exists).
- [`@wcstack/accelerometer`](packages/accelerometer/) / [`@wcstack/gyroscope`](packages/gyroscope/) / [`@wcstack/magnetometer`](packages/magnetometer/) / [`@wcstack/ambient-light-sensor`](packages/ambient-light-sensor/) — The Generic Sensor API family: `<wcs-accelerometer>`/`<wcs-gyroscope>`/`<wcs-magnetometer>` expose `x`/`y`/`z`; `<wcs-ambient-light-sensor>` exposes a single `illuminance` scalar (and has the weakest browser support — fingerprinting mitigations have disabled it in some browsers). All four compose with `<wcs-permission name="...">` rather than duplicating permission state, and need no `_gen` guard (synchronous start/stop) beyond a guarded sensor constructor call.
- [`@wcstack/notification`](packages/notification/) — Declarative desktop notifications with `<wcs-notify>`: show via command-token (`notify`), click back via event-token (`clicked`) — both directions in one tag. Self-contained permission, Service Worker fallback for mobile.
- [`@wcstack/defined`](packages/defined/) — Declarative custom-element readiness with `<wcs-defined>`: watches `whenDefined()` for a set of tags and exposes `defined`/`pending`/`missing`/`count`/`total` state, with timeout-based load-failure detection. Companion to the autoloader; what CSS `:defined` cannot do.
- [`@wcstack/camera`](packages/camera/) — Declarative camera capture and recording with `<wcs-camera>` (getUserMedia + built-in preview) and `<wcs-recorder>` (MediaRecorder). The live `MediaStream` is bound straight to elements via a command-token argument and **never stored in serializable state** — only derived values (permission, recording flag, the recorded `Blob`/URL) flow through state.
- [`@wcstack/signals`](packages/signals/) — A signals-based, fine-grained reactive **core** (the JS-first counterpart to `@wcstack/state`): `signal`/`computed`/`effect`, async `resource`/`streamResource`, keyed `For`/`Index`, and a `bindNode` adapter that drives the same wc-bindable IO nodes through signals. TC39-Signals-shaped, zero-dependency.
- [`wcstack-intellisense`](packages/vscode-wcs/) — VS Code extension that provides language support for `<wcs-state>` inline scripts.

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>
<body>

<wcs-state>
  <script type="module">
    export default {
      count: 0,
      countUp() { this.count++; }
    };
  </script>
</wcs-state>

<p>Count: {{ count }}</p>
<button data-wcs="onclick: countUp">+1</button>

</body>
</html>
```

One `<script>` tag. One custom element. Pure HTML. That's it.

---

## Styling on component state — `:state()`

Every I/O node reflects its boolean output states (`loading`, `connected`, `error`, `granted`, …) into [CustomStateSet](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet), so plain CSS can react to component state — no JavaScript required:

```css
wcs-fetch:state(loading) ~ .spinner    { display: block; }
form:has(wcs-fetch:state(error)) .msg  { display: block; }
wcs-ws:state(connected) ~ .indicator   { color: limegreen; }
wcs-permission:state(denied) ~ .help   { display: block; }
```

Each package README lists its reflected states. Supported in Chrome/Edge 125+, Safari 17.4+, Firefox 126+; in older browsers the styles simply don't apply — the components keep working. States are not serialized into SSR output (combine with `wcs-x:not(:defined)` for first-paint styling).

For debugging, add the `debug-states` attribute to a tag to mirror its states as `data-wcs-state-*` attributes in the DevTools Elements panel, or read the `debugStates` property. Write production CSS against `:state()`, not those attributes.

---

## Project Structure

```
wcstack/
├── packages/
│   ├── state/         # @wcstack/state
│   ├── router/        # @wcstack/router
│   ├── fetch/         # @wcstack/fetch
│   ├── autoloader/    # @wcstack/autoloader
│   ├── server/        # @wcstack/server
│   ├── storage/       # @wcstack/storage
│   ├── timer/         # @wcstack/timer
│   ├── geolocation/   # @wcstack/geolocation
│   ├── websocket/     # @wcstack/websocket
│   ├── upload/        # @wcstack/upload
│   ├── debounce/      # @wcstack/debounce
│   ├── clipboard/     # @wcstack/clipboard
│   ├── broadcast/     # @wcstack/broadcast
│   ├── worker/        # @wcstack/worker
│   ├── sse/           # @wcstack/sse
│   ├── intersection/  # @wcstack/intersection
│   ├── wakelock/      # @wcstack/wakelock
│   ├── resize/        # @wcstack/resize
│   ├── speech/        # @wcstack/speech
│   ├── permission/    # @wcstack/permission
│   ├── network/       # @wcstack/network
│   ├── screen-orientation/     # @wcstack/screen-orientation
│   ├── fullscreen/             # @wcstack/fullscreen
│   ├── picture-in-picture/     # @wcstack/picture-in-picture
│   ├── pointer-lock/           # @wcstack/pointer-lock
│   ├── share/                  # @wcstack/share
│   ├── eyedropper/             # @wcstack/eyedropper
│   ├── contacts/               # @wcstack/contacts
│   ├── credential/             # @wcstack/credential
│   ├── idle/                   # @wcstack/idle
│   ├── tilt/                   # @wcstack/tilt
│   ├── accelerometer/          # @wcstack/accelerometer
│   ├── gyroscope/              # @wcstack/gyroscope
│   ├── magnetometer/           # @wcstack/magnetometer
│   ├── ambient-light-sensor/   # @wcstack/ambient-light-sensor
│   ├── notification/  # @wcstack/notification
│   ├── defined/       # @wcstack/defined
│   ├── camera/        # @wcstack/camera
│   ├── signals/       # @wcstack/signals
│   └── vscode-wcs/    # wcstack-intellisense (VS Code extension)
```

Each package is independently built, tested, and published.

Examples under `examples/` track the packages that still live in this repository. The former AI/Auth0 demos moved to `@csbc-dev/ai-agent` and `@csbc-dev/auth0`, and are no longer included here. The legacy npm packages `@wcstack/ai` and `@wcstack/auth0` are deprecated.

## Development

Commands run from within a specific package directory (e.g., `packages/state/`):

```bash
npm run build            # Clean dist, compile TypeScript, bundle with Rollup
npm test                 # Run tests (Vitest)
npm run test:coverage    # Coverage (100% statements/functions/lines, 97%+ branches)
npm run lint             # ESLint
```

## License

MIT
