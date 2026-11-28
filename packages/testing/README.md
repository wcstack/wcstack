# @wcstack/testing

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if testing a page were one import?**

A `<wcs-state>` page is plain DOM, so it already tests headlessly with happy-dom — the recipe is in the [state README](../state/README.md#testing-your-page) and needs no test-only API. `@wcstack/testing` is that recipe packaged: mount the HTML, wait for every element and binding, read and write the state, settle, assert. It is a convenience, not a requirement; the bare recipe keeps working without it.

It is for `<wcs-state>` pages. A page built on `@wcstack/signals` has no state tree for `state()` to return: test its signals, components and `bindNode` wiring directly under vitest + happy-dom.

```ts
import { mount, settle, fire } from "@wcstack/testing";

const app = await mount(`
  <wcs-state json='{"count": 1}'></wcs-state>
  <p data-wcs="textContent: count"></p>
  <button data-wcs="onclick: up">+1</button>
`);
expect(app.root.querySelector("p")!.textContent).toBe("1");

await app.state().write((s) => { s.count = 42; });   // what a handler does
await settle();
expect(app.root.querySelector("p")!.textContent).toBe("42");

fire(app.root.querySelector("button")!, "click");       // what a user does
await settle();
app.unmount();
```

```bash
npm install -D @wcstack/testing @wcstack/state @wcstack/server vitest happy-dom
```

`@wcstack/state` and `@wcstack/server` are peers: `mount()` registers the elements from state and waits with server's `waitForReady` — the same stabilization loop `renderToString` uses before serializing, so `<wcs-router>`'s first route, a `$connectedCallback` that inserts more elements, and `<wcs-state>`'s binding construction are all covered by one call. Under vitest, set `environment: 'happy-dom'` and nothing else is needed; in bare Node, see `installDom()`.

## API

### `mount(html, options?) → Promise<MountedApp>`

Registers the elements, inserts `html`, and resolves once everything under the root is ready.

| Option | Description |
|---|---|
| `root` | `"document"` (default) — the HTML becomes `document.body`'s content. `"shadow"` — it goes into an open ShadowRoot on a fresh host appended to `document.body`, so bindings scope to that root |
| `bootstrap` | Registration functions to run first. Default `[bootstrapState]` (imported lazily from `@wcstack/state`). A list replaces the default: name everything the page uses — `bootstrapState` too, beside `bootstrapRouter`, `bootstrapFetch`, … — as functions or async loaders: `async () => (await import("@wcstack/router")).bootstrapRouter()`. Since 4.31, a page with a `<wcs-state>` whose tag the list leaves undefined rejects, saying so; it used to resolve with nothing bound. Every wcstack bootstrap is idempotent |
| `stateTagName` | The state tag when `bootstrapState({ tagNames })` renamed it (default `wcs-state`) |
| `maxIterations` | Stabilization rounds for elements inserted while waiting (default 10) |
| `resolveModule` | Since 4.9. `(url: URL) => string \| URL \| null` — the local file a `<wcs-state src>` module is read from, the same option as `@wcstack/server`'s `renderToString`: it gets the URL the page names (resolved against `document.baseURI` — an `http:` URL under happy-dom) and returns a path or a `file:` URL. Node's module loader reads `file:` and `data:` URLs only. Installed for the length of the mount; the module is imported anew for each mount, so tests do not share a state object. Without it, or when it returns nothing, the state fails to initialize with a message saying so — for the root `<wcs-state>`, `mount()` rejects with it. A `.json` `src` is fetched, as before. See [A state in its own file](#a-state-in-its-own-file) |

Since 4.11, an option `mount()` does not have, or a value not of the option's type, rejects at once — before the document is touched — naming the option and listing the options, as every package's `bootstrapXxx()` does; a misspelt `resolveModul` used to be ignored, and the test failed later with Node's `ERR_UNSUPPORTED_ESM_URL_SCHEME`. An option whose value is `undefined` is skipped. `fire()`'s `init` and `installDom()`'s options are checked the same way.

**A Declarative Custom Component in the page.** Since 4.28, a `<template shadowrootmode>` in the mounted HTML becomes its parent's shadow root, as a browser's parser makes it — happy-dom leaves it a child — so a DCC's definition written in the HTML (or read from the part's file and put before the page's markup) defines its tag, and `mount()` waits for the definitions and for their instances: no `settle()` is needed before the first assertion. Up to 4.27 the definition had no shadow root, its tag was never defined, and `mount()` resolved without a word. A definition that fails is `@wcstack/state`'s to report (`console.error` under happy-dom); `mount()` still resolves.

```ts
const pager = readFileSync("parts/midori-pager.html", "utf8");
const app = await mount(`${pager}
  <wcs-state json='{"total": 120, "page": 2}'></wcs-state>
  <midori-pager id="pager" data-wcs="total: total; page: page"></midori-pager>`);
expect(app.root.querySelector("#pager")!.shadowRoot!.querySelector(".info")!.textContent).toBe("2 / 6");
```

The returned `MountedApp`:

| Member | Description |
|---|---|
| `root` | `document` or the ShadowRoot — query it |
| `container` | `document.body` or the shadow host |
| `state()` | Accessor for the root `<wcs-state>` — v2 has one state tree per root, so there is nothing to name. Volumes (`mount=`) are part of that tree: read them by path prefix. (`mount()` mounts DOM; `mount=` mounts state.) Throws if absent. `state<typeof appState>()` types the state `read` / `write` hand over — see [Typing the state](#typing-the-state) |
| `state().read(fn)` | Run `fn` against a readonly proxy and return its result |
| `state().write(fn)` | Run `fn` (sync or async) against a writable proxy — exactly what a handler does. Follow with `await settle()` |
| `state().element` | The element itself |
| `unmount()` | Remove the mounted HTML |

`mount()` also smooths four happy-dom edges so the page behaves as in a browser:

- it disables `URL.createObjectURL` once per process when a browser-style one is present — Node cannot import `blob:` URLs, and without this an inline `<script type="module">` state never finishes loading (the loader then takes its `data:` URL path, as SSR does);
- it wraps happy-dom's `textContent` / `innerText` setters to stringify like the DOM spec — happy-dom turns a numeric `0` into an empty string (and `innerText` throws on numbers), so a `textContent: count` binding would blank out at zero only under happy-dom;
- since 4.26, it inserts the HTML with `@wcstack/server`'s `setInnerHTML`, which keeps a `<template>` written in a table where browsers keep it. happy-dom's parser moves a `<template>` out of a `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>` or `<colgroup>` and leaves its rows or cells in the table, so a page with `<tbody><template data-wcs="for: rows"><tr>…` (or a `for:` over the cells of a `<tr>`) failed to mount with `[wcs/wildcard-rank] ".name" is relative: it needs an enclosing "for" template` — up to 4.25, such a page could not be tested headlessly;
- since 4.31, it builds the page out of the document and then moves it in, so that each element connects with its children — as a browser's parser leaves the page before a module script upgrades it. happy-dom connects an element at its start tag, before its children are parsed: a `<wcs-link>` moved no text into its `<a>`, and built its `href` before the router had read its basename (`/next` for `/app/next`).

#### Typing the state

Since 4.26, `state<S>()` takes the type of the page's state definition. `read` and `write` then hand their callback the state typed like `this` in a `defineState()` definition — its keys, getters, methods, dot paths (`"items.*.price"`) and the `$` API — so a misspelt key or a wrong argument is a type error, and a method is called without a cast. `read`'s state is readonly, as its proxy is. Without the type parameter the state is `any`, as before.

```ts
import { mount, settle } from "@wcstack/testing";
import type appState from "../public/state"; // export default defineState({ cartCount: 0, add(name: string) { … }, … })

const app = await mount(html, { resolveModule });
const state = app.state<typeof appState>();
await state.write((s) => s.add("apple"));      // typed: s.add(1) is an error
await settle();
expect(state.read((s) => s.cartCount)).toBe(1);   // number; s.cartCont is an error
```

A `<wcs-state>` with nothing to load — no `state`, `src` or `json` attribute and no inline `<script type="module">` — waits for `setInitialState()`, which a test cannot call before `mount()` returns. Since 4.9, `mount()` rejects at once and says what to write instead (`json=`, an inline script, or `src` with `resolveModule`); it used to never resolve, and the test timed out without a word. Volumes (`mount=`) are checked too; `bind-component` elements and elements inside a `<template>` are not.

#### A state in its own file

Since 4.9, a page that keeps its state in a file — `<wcs-state src="./state.js">`, the form the documents prefer under a strict CSP — mounts with `resolveModule`, which maps the URL the page names to the file:

```ts
import { mount } from "@wcstack/testing";

// public/index.html has <wcs-state src="./state.js">; this test is in tests/
const resolveModule = (url: URL) => new URL("../public" + url.pathname, import.meta.url);

const app = await mount(`
  <wcs-state src="./state.js"></wcs-state>
  <p data-wcs="textContent: total"></p>
`, { resolveModule });
```

`(url) => join(publicDir, url.pathname)` works as well. Write the URL as a concatenation, as above: Vite (and so vitest) rewrites `new URL("…", import.meta.url)` written with a string or template literal into an asset URL that is not the file. The state may `import` its helpers (`./lib.js`) — they resolve next to the file. An inline `<script type="module">` state cannot `import` a relative module under Node: it is evaluated from a `data:` URL, which has no base for `./lib.js` (the error then points at the CSP guide, which does not apply to a test). Put such a state in its own file and use `resolveModule`.

**A state that imports from a CDN URL.** The state file is imported by Node's own module loader, where Vitest's `resolve.alias` does not apply: a state that imports `https://cdn.jsdelivr.net/npm/…` (a buildless page's `defineState`, a Markdown parser) fails to initialize with `Only URLs with a scheme in: file and data are supported by the default ESM loader. Received protocol 'https:'`, though the config maps that URL to `node_modules`. Inline the packages that do the import, so Vitest loads the state through its own pipeline and the aliases apply (the counter-assist seam app, Vitest 5):

```js
// vitest.config.js
export default defineConfig({
  resolve: { alias: [{ find: "https://cdn.jsdelivr.net/npm/marked@18.3.0/lib/marked.esm.js", replacement: "…/node_modules/marked/lib/marked.esm.js" }] },
  test: {
    environment: "happy-dom",
    server: { deps: { inline: ["@wcstack/testing", "@wcstack/state", "@wcstack/server"] } },
  },
});
```

### `settle() → Promise<void>`

Two microtask turns and one macrotask — enough for a write to reach the DOM. Use it after `write()`, `fire()`, or any DOM event.

### `fire(target, type, init?) → boolean`

Dispatches an `Event` (or a `CustomEvent` when `init.detail` is given), bubbling by default. Returns `false` when a handler called `preventDefault()`. Since 4.11, an `init` key other than `bubbles`, `cancelable`, `composed` and `detail` throws: it never reached the event — `{ key: "Enter" }` made no `KeyboardEvent`. For another event class, call `target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))` yourself.

### `installDom(options?) → Promise<() => Promise<void>>`

For runners without a DOM environment: creates a happy-dom `Window` (`options.url`, default `http://localhost/`) — or takes `options.window` — and installs its globals with server's `installGlobals`. The returned function restores the globals and closes the window. Import `@wcstack/state` (and any other wcstack package) **after** calling it: element classes bind their base class at module evaluation. `happy-dom` is an optional peer, needed only here.

```js
import { installDom, mount, settle } from "@wcstack/testing";

const restore = await installDom();
try {
  const app = await mount(html);          // @wcstack/state is imported lazily, after the DOM exists
  // ...
} finally {
  await restore();
}
```

Since 4.28 the returned function closes the window before it puts the globals back: closing takes the page's elements out, and their callbacks still read `document`. Up to 4.27 it threw `Cannot read properties of undefined (reading 'documentElement')` once a `<wcs-state>` had been mounted — and `mount()` itself rejected in bare Node with `addEventListener is not defined`, from 4.12 on.

## Blind spots

Two things happy-dom cannot reproduce; keep one browser e2e (Playwright) for them:

- `customElements.define` upgrades existing nodes by **replacing** them, so "a value reaches the same node after a late define" cannot be asserted headlessly. An element upgraded that way that has an `id` — a Declarative Custom Component's instance always is — stays in happy-dom's id index after it leaves the page: `document.getElementById("pager")` returns the removed element, in a later `mount()` of the same file too (happy-dom 21). Read through the mounted root: `app.root.querySelector("#pager")`.
- Event timing differs from real browsers.

A `<template>` in a table is handled since 4.26: `mount()` puts it where browsers do (above). HTML a test inserts with `innerHTML` itself is not — insert it with `setInnerHTML(element, html)` from `@wcstack/server`.

**jsdom is not supported.** `mount()` finds the page's custom elements with the selector `*-*` (in `@wcstack/server`'s `waitForReady`), which happy-dom accepts and jsdom refuses: under `environment: 'jsdom'` it fails with `SyntaxError: Invalid selector *-*`. Run the page's tests under happy-dom. A library that behaves differently under happy-dom (a sanitizer whose output you assert) can be tested in a file of its own with `// @vitest-environment jsdom`.

## Example

[`examples/state-testing-todo/`](../../examples/state-testing-todo/) — a todo page and its vitest suite driving it through `mount` / `fire` / `settle`.

## License

MIT
