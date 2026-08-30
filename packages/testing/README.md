# @wcstack/testing

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if testing a page were one import?**

A `<wcs-state>` page is plain DOM, so it already tests headlessly with happy-dom — the recipe is in the [state README](../state/README.md#testing-your-page) and needs no test-only API. `@wcstack/testing` is that recipe packaged: mount the HTML, wait for every element and binding, read and write the state, settle, assert. It is a convenience, not a requirement; the bare recipe keeps working without it.

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
| `bootstrap` | Registration functions to run first. Default `[bootstrapState]` (imported lazily from `@wcstack/state`). Add what the page uses — `bootstrapRouter`, `bootstrapFetch`, … — as functions or async loaders: `async () => (await import("@wcstack/router")).bootstrapRouter()`. Every wcstack bootstrap is idempotent |
| `stateTagName` | The state tag when `bootstrapState({ tagNames })` renamed it (default `wcs-state`) |
| `maxIterations` | Stabilization rounds for elements inserted while waiting (default 10) |

The returned `MountedApp`:

| Member | Description |
|---|---|
| `root` | `document` or the ShadowRoot — query it |
| `container` | `document.body` or the shadow host |
| `state(name?)` | Accessor for the `<wcs-state>` with that `name` attribute (default `"default"` = none). Throws if absent |
| `state().read(fn)` | Run `fn` against a readonly proxy and return its result |
| `state().write(fn)` | Run `fn` (sync or async) against a writable proxy — exactly what a handler does. Follow with `await settle()` |
| `state().element` | The element itself |
| `unmount()` | Remove the mounted HTML |

`mount()` also smooths two happy-dom edges so the page behaves as in a browser:

- it disables `URL.createObjectURL` once per process when a browser-style one is present — Node cannot import `blob:` URLs, and without this an inline `<script type="module">` state never finishes loading (the loader then takes its `data:` URL path, as SSR does);
- it wraps happy-dom's `textContent` / `innerText` setters to stringify like the DOM spec — happy-dom turns a numeric `0` into an empty string (and `innerText` throws on numbers), so a `textContent: count` binding would blank out at zero only under happy-dom.

### `settle() → Promise<void>`

Two microtask turns and one macrotask — enough for a write to reach the DOM. Use it after `write()`, `fire()`, or any DOM event.

### `fire(target, type, init?) → boolean`

Dispatches an `Event` (or a `CustomEvent` when `init.detail` is given), bubbling by default. Returns `false` when a handler called `preventDefault()`.

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

## Blind spots

Two things happy-dom cannot reproduce; keep one browser e2e (Playwright) for them:

- `customElements.define` upgrades existing nodes by **replacing** them, so "a value reaches the same node after a late define" cannot be asserted headlessly.
- Event timing differs from real browsers.

## Example

[`examples/state-testing-todo/`](../../examples/state-testing-todo/) — a todo page and its vitest suite driving it through `mount` / `fire` / `settle`.

## License

MIT
