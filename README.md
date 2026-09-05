# wcstack

> [!IMPORTANT]
> ### 🤖 AI coding agents — start with **[AGENTS.md](./AGENTS.md)**
> The vendor-neutral entry point for this repo. Read it **before** building an app *with* wcstack or working *on* this monorepo. (Claude Code also auto-reads [CLAUDE.md](./CLAUDE.md).)

**What if the browser had these built in?**

wcstack is a thought experiment turned into code. We imagine what future web standards *could* look like — reactive data binding, declarative routing, automatic component loading — and build them as if they already existed in the browser.

No framework. Just HTML tags that *should* exist.

**🌐 [wcstack.github.io](https://wcstack.github.io)** — landing page, live demos, and the full package tour.

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

The **only** contract between UI and state is a **path string** — `user.name`, `cart.items.*.subtotal`, or a mount point such as `state: user`. No hooks. No imports. No glue code. The component's JavaScript doesn't contain a single line that references state. The HTML alone describes every data dependency.

```
State  ← "user.name" →    UI          Path binds the two layers
Host   ← "state: user" →  Component   A mount grafts a component onto the one tree
Loop   ← "items.*" →      Template    Wildcard abstracts the index
```

This means you can redesign the UI without touching state, refactor state without touching the DOM, and read the HTML to understand everything. It's the same idea as a REST URL — a simple string contract, no shared code.

---

## AI-Assisted Development

Working with an AI coding agent — Claude Code, Codex, Cursor, Copilot, or anything else? Point it at **[AGENTS.md](./AGENTS.md) first**. It is the vendor-neutral entry point for this repository, and it covers both directions:

- **Building an app *with* wcstack** — install the [wcstack-app skill](https://github.com/wcstack/wcstack-skill) for the complete `data-wcs` binding syntax and tag catalog, then gate generated HTML with `npx @wcstack/lint --errors-only` and iterate until it exits `0`.
- **Working *on* this monorepo** — package layout and commands, generated-file rules, and the protocols that must not be changed casually.

Claude Code reads [CLAUDE.md](./CLAUDE.md) (the more detailed, tool-specific guide) automatically; tell every other agent to start at AGENTS.md.

---

## Packages

Forty-seven independent runtime packages + one tooling extension package. Zero runtime dependencies (except happy-dom for SSR). No build step required.

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
- **46 built-in filters** — comparison, arithmetic, string, date, formatting
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
- [`@wcstack/raf`](packages/raf/) — Declarative requestAnimationFrame with `<wcs-raf>`: frame ticks, first-class `dt`, and a `suspended` output for hidden tabs.
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
- [`@wcstack/audio`](packages/audio/) — Web Audio graphs written as markup with `<wcs-audio>` and ten node tags: nesting is the signal chain, `out=`/`param=` route by id, and `<wcs-voice poly="N">` gives polyphony. The patch that crosses the protocol boundary is a plain descriptor — live `AudioNode` handles never leave the Core.
- [`@wcstack/midi`](packages/midi/) — Declarative Web MIDI with `<wcs-midi>`: one tag for both directions, messages decoded into `type`/`note`/`velocity`/`channel` (a velocity-0 note-on is normalized to `noteoff`), and live port state. Omit `input` and every input port is subscribed.
- [`@wcstack/view-transition`](packages/view-transition/) — Declarative View Transition arbiter with `<wcs-view-transition>`: one policy tag that makes router route swaps and state list/branch updates animate. It coalesces every change requested in the same microtask into a single transition and arbitrates collisions (`latest`/`queue`/`exhaust`); a DOM change is applied exactly once whatever happens to its animation. Leave and move — the two things CSS alone cannot do for DOM a framework removes. Without the tag, nothing about the framework's timing changes.
- [`@wcstack/signals`](packages/signals/) — A signals-based, fine-grained reactive **core** (the JS-first counterpart to `@wcstack/state`): `signal`/`computed`/`effect`, async `resource`/`streamResource`, keyed `For`/`Index`, and a `bindNode` adapter that drives the same wc-bindable IO nodes through signals. TC39-Signals-shaped, zero-dependency.
- [`@wcstack/devtools`](packages/devtools/) — In-page DevTools overlay with `<wcs-devtools>`: inspect state trees (with inline editing through the normal reactive pipeline), see which DOM nodes each path is wired to, and watch a live timeline of writes, update batches, and command/event-token emissions — including zero-subscriber "empty emits". One script tag, connects via the DevTools Hook Protocol, zero-dependency.
- [`@wcstack/lint`](packages/lint/) — Static-contract validator CLI (`npx @wcstack/lint`, command name `wcs-validate`): checks HTML `data-wcs` bindings and `wcstack.manifest.json` sidecars headlessly with the same validator core as the VS Code extension — identical diagnostic codes and ranges in IDE and CI, stable exit-code contract for generate–validate–fix loops. Zero-dependency.
- [`@wcstack/typescript`](packages/typescript/) — TypeScript tooling for apps: `wcs-schema` compiles a typed state file and writes the sidecar `stateSchema` the validator consumes, so `data-wcs` paths are checked against real types in CI and every editor (typos become errors, false warnings disappear); `wcs-schema check` fails CI when the manifest drifts from the type; `wcs-tsc` type-checks the inline `<script type="module">` state inside an HTML file with the same compiler. `typescript` is a peer dependency; zero runtime dependencies. The full TypeScript story is in [docs/typescript.md](docs/typescript.md).
- [`@wcstack/testing`](packages/testing/) — Headless test helpers: `mount(html)` registers the elements, inserts the page fragment under happy-dom and waits for every element and binding (router routes included, via `@wcstack/server`'s `waitForReady`); `state().read/write`, `settle()`, `fire()` drive it like a user or a handler would. The README recipe as one import — a convenience, never a requirement.
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

> Enforcing a Content-Security-Policy? The inline `<script type="module">` above is evaluated through a `blob:` URL and needs `script-src blob:`; moving the state into `src="./state.js"` needs no extra directive. Per-feature directive table: [docs/csp.md](docs/csp.md).

For production, pin the version and add an `integrity` attribute. `dist/auto.min.js` is a self-contained bundle with zero imports, so **one hash covers every line of wcstack that runs** — the usual ESM caveat, where `integrity` protects only the entry and not what it imports, does not apply:

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@2.1.0/dist/auto.min.js"
        integrity="sha384-..."></script>
```

Digests for every package ship in each GitHub Release (and as an attached `sri.json`), computed from the published tree rather than read back from the CDN. Details, and what the hash deliberately does not cover: [docs/sri.md](docs/sri.md).

Using several packages? The **`wcstack` entry bundle** packs the SPA core — state, router, fetch, storage, autoloader — into a single self-contained tag: one request, and one hash covering the whole core (254 KB min / 71 KB gzip). Single packages stay the default for pages that need less; do not concatenate the files yourself via jsDelivr `/combine/` (minified ESM does not survive concatenation — [docs/sri.md §3.1](docs/sri.md)):

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/wcstack@2.1.0/dist/auto.min.js"
        integrity="sha384-..."></script>
```

Testing the page? It is plain DOM — mount it under happy-dom, await the bindings, assert: [Testing Your Page](packages/state/README.md#testing-your-page).

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

## Using wcstack elements inside React / Vue / Svelte / Solid

Every I/O node implements [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol), so a thin adapter (`@wc-bindable/react`, `/vue`, `/svelte`, `/solid`, …) wires an element's outputs into framework state without per-element glue. Three rules make that work:

**1. Import the definition before you render.** Adapters check `isWcBindable(el)` once on mount and never retry, so an element that upgrades later stays silently unbound. A static import at the app entry is the reliable fix:

```ts
import "@wcstack/websocket/auto";   // main.tsx / main.js — before the app renders
```

If the definition genuinely has to arrive late (autoloader, CDN tag, code-split), gate the mount on `customElements.whenDefined("wcs-ws")`. `connectedCallbackPromise` is not a substitute — it covers connection, not definition.

**2. Pass object-valued inputs as properties.** DOM attributes only hold strings, and several frameworks fall back to attributes when the property is not on the element yet, which stringifies your payload. Use `.prop` (Vue), `prop:` (Solid), `.prop=` (Lit), or assign through a ref.

**3. Unwrap reactive proxies before handing values in.** Vue's `reactive`, Svelte's `$state` and Qwik's `useStore` wrap plain objects in proxies, and a proxy cannot cross a structured-clone boundary — `<wcs-worker>` and `<wcs-broadcast>` will report a `DataCloneError` instead of sending. Pass `toRaw()` / `$state.snapshot()` / `unwrap()` results.

Live handles such as `<wcs-camera>`'s `MediaStream` are deliberately not snapshot state: take them from the element event via a ref. Note that Angular templates and JSX cannot bind event names containing a colon, so `addEventListener` (or `Renderer2.listen`) is the portable path.

Full guide, per-framework snippets and the reasoning: [docs/framework-adapter-integration.md](docs/framework-adapter-integration.md). Working demos: [examples/websocket-chat](examples/websocket-chat/) (React 19 and Vue 3 against the same server as the vanilla, state and signals variants).

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
│   ├── raf/           # @wcstack/raf
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
│   ├── audio/         # @wcstack/audio
│   ├── midi/          # @wcstack/midi
│   ├── view-transition/  # @wcstack/view-transition
│   ├── signals/       # @wcstack/signals
│   ├── devtools/      # @wcstack/devtools
│   ├── lint/          # @wcstack/lint
│   ├── typescript/    # @wcstack/typescript
│   ├── testing/       # @wcstack/testing
│   ├── wcstack/       # wcstack (entry package: the wcstack/auto SPA-core bundle)
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

## Versioning and breaking changes

All published packages share one version and are released in lockstep — a release bumps every package, whether or not it changed.

**Covered by semver** — changing any of these incompatibly means a major release:

- The `data-wcs` binding syntax and its documented semantics (paths, filters, structural directives, spread).
- Each package's documented element surface: tag names, attributes, and the `static wcBindable` declaration (`properties` / `event` / `getter`).
- The interop protocols: wc-bindable, command-token, event-token, transition-runner, binder, ssr-snapshot.
- Tooling contracts: the manifest schema (`schemaVersion`), the `wcs-schema` / `wcs-tsc` CLIs, and the `@wcstack/testing` API. The devtools hook protocol carries its own `version` field; a non-additive change bumps it and rides a major release.

**Not covered** — may change in a minor or patch release:

- Internal module layout and anything not re-exported from a package entry point.
- Console message wording and performance characteristics.
- Anything explicitly marked experimental or reserved in the docs.

**Deprecation practice**: where feasible, a surface is flagged for at least one minor release (a lint rule and/or a runtime notice pointing at the replacement) before the next major removes it — v1.x flagged named state with `wcs/named-state-deprecated` before v2.0 removed `name=` / `@name`.

## License

MIT
