# @wcstack/signals

`@wcstack/signals` is a **signals-based, fine-grained reactive core** — zero runtime dependencies, buildless, standards-first. See [`docs/signals-state-design.md`](../../docs/signals-state-design.md) for the design rationale.

Where [`@wcstack/state`](../state/README.md) connects UI and state through HTML path strings (no reactive primitives in your code), `@wcstack/signals` takes the opposite stance for the cases that want it: it **exposes the reactive primitives directly**. There is no DSL and no `data-wcs`; you call `signal()`, `computed()`, `effect()` in JavaScript. The two packages are complementary, not competing — same ecosystem, different coupling point.

The public API is shaped after the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (State / Computed / effect). The implementation is in-house and tiny, so it can later be swapped for a native or polyfilled signal without changing call sites.

## What's in the box

| Module | Entry | What it gives you |
|---|---|---|
| **Reactive core** | `@wcstack/signals` | `signal` / `computed` / `effect` / `createRoot` / `onCleanup` / `flushSync` |
| **Async resource** | `@wcstack/signals` | `resource` — an async producer as a reactive `{ value, loading, error }` triad (switchMap cancel/restart) |
| **Stream resource** | `@wcstack/signals` | `streamResource` — fold a continuous flow (async iterable / `ReadableStream`) into one reactive value |
| **wc-bindable adapter** | `@wcstack/signals` | `bindNode` (properties→signals, event-token streams via `on`, input write-back via `bindInput`, command-token via `bindCommand`) + `nodeSource` (node cancel bridge for `resource`) |
| **DOM layer** | `@wcstack/signals/dom` | `h` / `render` / `Fragment` / `For` / `Index` / `SignalsElement` (re-exports the core too) |

## Design in one breath

- **Pull-validated three-color marking** (after Reactively / Solid). A write marks direct observers DIRTY and transitive ones CHECK; effects run on a coalesced microtask. A computed that recomputes to an *equal* value does **not** propagate — downstream work is skipped.
- **Fine-grained `h`, no VDOM.** `h(tag, props, ...children)` builds **real DOM once**. A prop or child passed as a function/signal is wired to a targeted `effect`, so only that one binding updates. No **VDOM reconciler** is shipped; keyed lists are handled by `For` / `Index` (array diffing that reuses and moves rows), not a VDOM.
- **Ownership = lifecycle.** `createRoot` / effects collect the disposers of everything created during their run, so tearing down a subtree disposes its effects, listeners, and resources — no leaks.
- **IO is the node, reactivity is the core.** `bindNode` adapts a wc-bindable element (e.g. `<wcs-fetch>`) into signals. The element has no idea a signal is behind the binding.

## Install

```bash
npm install @wcstack/signals
```

Or buildless via an import map (both entries share one reactive core chunk — see [Buildless](#buildless-import-maps)):

```html
<script type="importmap">
{ "imports": {
    "@wcstack/signals": "https://esm.run/@wcstack/signals",
    "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom"
} }
</script>
```

## Quick start

### 1. Signals, computed, effect

```typescript
import { signal, computed, effect } from "@wcstack/signals";

const count = signal(0);
const doubled = computed(() => count.get() * 2);

effect(() => {
  console.log(`count=${count.peek()}, doubled=${doubled.get()}`);
});
// → logs "count=0, doubled=0"

count.set(1); // effect re-runs on the next microtask → "count=1, doubled=2"
```

- `get()` reads **and** tracks (registers the current effect/computed as a dependent).
- `peek()` reads **without** tracking (no dependency edge).
- `effect` re-runs are coalesced onto a microtask. Need it applied synchronously (e.g. to read the DOM back in a test)? Call `flushSync()`.

### 2. A reactive custom element

```typescript
import { signal, computed, h, SignalsElement } from "@wcstack/signals/dom";

class SignalCounter extends SignalsElement {
  count = signal(0);
  doubled = computed(() => this.count.get() * 2);

  render() {
    return h("div", { class: "counter" },
      h("button", { onClick: () => this.count.set(this.count.peek() - 1) }, "−"),
      h("output", null, () => String(this.count.get())),
      h("button", { onClick: () => this.count.set(this.count.peek() + 1) }, "+"),
      // `doubled` is a computed: this only re-renders when the doubled VALUE changes.
      h("span", { class: "muted" }, () => `×2 = ${this.doubled.get()}`),
    );
  }
}
customElements.define("signal-counter", SignalCounter);
```

`connectedCallback` mounts `render()` under an ownership root; `disconnectedCallback` disposes every effect created there and clears the mount point. Subclasses only implement `render()`. Override `getMountPoint()` to return a shadow root.

### 3. Driving a real IO node — signals ↔ `<wcs-fetch>`

```typescript
import { signal, computed, effect, createRoot, bindNode, h, render, For } from "@wcstack/signals/dom";

await customElements.whenDefined("wcs-fetch");
const fetchEl = document.getElementById("search-fetch");
const bound = bindNode(fetchEl); // descriptor read from fetchEl.constructor.wcBindable

const query  = signal("");
const people = computed(() => bound.signals.value.get() ?? []);

createRoot(() => {
  // query → url: <wcs-fetch> auto-fetches on url change and re-dispatches events,
  // which the adapter folds back into bound.signals.* . Typing fast aborts the
  // in-flight request (FetchCore cancels the superseded one).
  effect(() => {
    const q = query.get().trim();
    bound.set("url", q ? `/api/people?q=${encodeURIComponent(q)}` : "/api/people");
  });

  render(
    h("div", null,
      h("input", { type: "search", onInput: (e) => query.set(e.target.value) }),
      h("p", null, () => bound.signals.loading.get() ? "Loading…" : `${people.get().length} result(s)`),
      // Keyed list: one stable <li> per id, reconciled in place (see §6).
      h("ul", null, For(() => people.get(), (p) => h("li", null, p.name), { key: (p) => p.id })),
    ),
    document.getElementById("search-app"),
  );
});
```

A full, runnable version of this lives in [`examples/signals-live-search`](../../examples/signals-live-search/README.md).

### 6. Keyed lists — `For` / `Index`

A bare reactive child (`() => items.map(render)`) rebuilds its whole subtree on every change. For lists, use `For` (keyed by value/identity) or `Index` (keyed by position) — each keeps a stable DOM row per item and reconciles in place, so reordering moves rows instead of rebuilding them (preserving per-row DOM, focus, and input state). Each row runs under its own ownership scope, so a removed row disposes exactly its effects.

```typescript
import { signal, h, For, Index } from "@wcstack/signals/dom";

const todos = signal([{ id: 1, text: "a" }, { id: 2, text: "b" }]);

// For — keyed by `id`. Rows are reused/moved on reorder; `each` receives the item
// and an index ACCESSOR (the index changes when the row moves).
h("ul", null,
  For(todos, (t, index) => h("li", null, () => `${index()}: ${t.text}`), { key: (t) => t.id }),
);

// Index — keyed by position (good for primitive arrays). `each` receives the item
// as an ACCESSOR (the value at a slot changes; the slot does not) and a fixed index.
const nums = signal([10, 20, 30]);
h("ul", null,
  Index(nums, (n) => h("li", null, () => String(n() * 2))),
);
```

- `For` keys default to value identity (`===`); pass `{ key }` for objects. Keys must be unique (a duplicate throws). Use `Index` for primitive lists where position is the stable identity.
- `each` must return a **single** Node (one row = one node).

### 4. Async resource (switchMap)

```typescript
import { signal, resource } from "@wcstack/signals";

const id = signal(1);
const user = resource(
  async (userId, signal) => (await fetch(`/api/users/${userId}`, { signal })).json(),
  { args: () => id.get() }, // reading id here wires restart-on-change
);

// user.value / user.loading / user.error are read-only signals.
id.set(2); // aborts the in-flight request and starts a fresh one.
```

### 5. Stream resource (fold a flow)

```typescript
import { streamResource } from "@wcstack/signals";

// latest (default): value becomes the last chunk.
const latest = streamResource((args, signal) => openEventStream(signal));

// reduce: accumulate. `initial` is required and is what value resets to on restart.
const log = streamResource((args, signal) => openLogStream(signal), {
  fold: (acc, chunk) => [...(acc ?? []), chunk],
  initial: [],
});
// log.value / log.status ("idle"|"active"|"done"|"error") / log.error
```

## API reference

### Reactive core (`@wcstack/signals`)

| Export | Signature | Notes |
|---|---|---|
| `signal<T>` | `(initial: T, equals?) => WriteSignal<T>` | `get` (tracks) / `peek` (no track) / `set`. Default equality is `Object.is`. |
| `computed<T>` | `(fn: () => T, equals?) => ReadSignal<T>` | Lazy, memoized, equality short-circuit. Re-tracks deps on every run (conditional deps pruned). Reading itself throws a clear "circular dependency" error. |
| `effect` | `(fn: () => Cleanup \| void) => EffectHandle` | Runs once immediately, then on coalesced microtasks. Return a cleanup; it runs before each re-run and on dispose. `handle.dispose()` stops it. |
| `createRoot<T>` | `(fn: (dispose) => T) => T` | Fresh ownership scope. Everything created inside is disposed by `dispose`. The root is detached (not auto-disposed by an enclosing owner). If `fn` throws, the half-built scope is disposed before the error propagates. |
| `onCleanup` | `(fn: () => void) => void` | Register a teardown with the current owner. No-op with no owner. |
| `flushSync` | `() => void` | Run queued effects synchronously now. |

### DOM layer (`@wcstack/signals/dom`)

| Export | Signature | Notes |
|---|---|---|
| `h` | `(tag, props?, ...children) => Node` | `tag` is a tag string, a `Component`, or `Fragment`. Function/signal props & children are reactive. `onXxx` props are event listeners. |
| `render` | `(child, container) => Node` | Append a child (resolving fragments/arrays/reactives) into a container. |
| `Fragment` | `symbol` | `h(Fragment, null, ...children)` groups without a wrapper element. |
| `For<T>` | `(list, each, options?) => ListView` | Keyed list. `list` is a signal or `() => T[]`; `each(item, index: () => number)` returns one Node; `options.key(item, i)` defaults to value identity. Reuses/moves rows by key; disposes removed rows. |
| `Index<T>` | `(list, each) => ListView` | Position-keyed list. `each(item: () => T, index: number)` returns one Node. Rows are reused per slot (the value at a slot updates via a signal); grows/shrinks at the tail. |
| `SignalsElement` | `abstract class extends HTMLElement` | Lifecycle base; implement `render()`, optionally `getMountPoint()`. |

`setProp` rules: `style` accepts a string or an object (camelCase / kebab-case / `--custom` keys); `class` / `className` are set as the `class` **attribute** (works for SVG too; `null`/`false` clear it); a key that resolves to a writable DOM property is assigned as a property (with `null`/`undefined` normalized to `""` so a string prop like `id`/`src` clears instead of landing the literal `"null"`); otherwise it's an attribute (`true` → empty attr, `null`/`false` → removed).

### Resources (`@wcstack/signals`)

| Export | Shape |
|---|---|
| `resource<T, A>(source, options?)` | `{ value, loading, error, dispose }` — `source(args, signal) => Promise<T> \| T` |
| `streamResource<T, C, A>(source, options?)` | `{ value, status, error, dispose }` — `source(args, signal) => AsyncIterable<C> \| ReadableStream<C> \| Promise<…>` |

Both: `options.args` is a reactive getter (reading signals there wires restart-on-change, switchMap-style — the previous request is aborted via the `AbortSignal` passed to `source`); `options.initial` seeds `value`. A stale response from a superseded request is dropped (checked against `signal.aborted`). Created inside an owner, a resource auto-disposes on teardown.

### wc-bindable adapter (`@wcstack/signals`)

```typescript
const bound = bindNode(target, descriptor?);

// element → signal
bound.signals.<propName>.get();          // output properties as read-only signals (latest value)
bound.on("propName", { fold?, initial? }); // event-token STREAM: folds every emit (latest by default)

// signal → element
bound.set("inputName", value);           // write a declared input (imperative)
bound.bindInput("inputName", someSignal); // reactive write-back: mirror a signal into the input
bound.command("cmdName", ...args);       // invoke a declared command (imperative)
bound.bindCommand("cmdName", trigger, mapArgs?); // command-token: invoke when `trigger` CHANGES

bound.dispose();                         // detach all listeners/effects
```

If `descriptor` is omitted, it's read from `target.constructor.wcBindable`. The adapter covers the four wc-bindable mappings: `signals[name]` is the **state view** of a property (equality-guarded — same value, no update); `on(name)` is the **occurrence view** of the same event (a stream — updates on *every* emit, even an equal value), folded latest-by-default. `bindInput` mirrors a signal into an input with a same-value guard (`node[name] !== v`) so a write that re-dispatches an event cannot loop. `bindCommand` invokes a command when the trigger **changes** (the initial value does not fire), with `mapArgs` shaping the call. `set`/`bindInput` reject undeclared inputs; `command`/`bindCommand` reject undeclared (or non-function) commands. After `dispose` the adapter is **inert** (signals/streams stop, methods throw); `dispose` is idempotent. `bindInput`/`bindCommand` also return a per-binding disposer.

#### `nodeSource` — cancel bridge for `resource`

`nodeSource(bound, run, { abort? })` builds a `resource` source from a wc-bindable node: it wires the resource's `AbortSignal` to the node's cancel command (default `"abort"`), then delegates to `run`. Wrap it in `resource({ args })` and any node declaring an abort command gets switchMap cancel/restart — an `args` change aborts the in-flight call (cancelling the node's real `AbortController`) and starts the next. The node's own value/loading/error stay on `bound.signals`.

```typescript
import { signal, resource } from "@wcstack/signals";

const bound = bindNode(fetchEl);
const id = signal(1);
const r = resource(
  nodeSource(bound, (b, userId) => b.command("fetch", `/api/${userId}`)),
  { args: () => id.get() },
);
id.set(2); // aborts the in-flight fetch via the node's abort command, then refetches
```

## Using JSX (opt-in)

`h` is the classic JSX factory shape, so JSX is **available but not shipped** — opting in is your choice and means leaving the buildless path (JSX must be transpiled). The package ships only the substrate (`h` + `Fragment`); there is no `.tsx` and no `jsx-runtime` types.

Minimal setup — point the **classic** runtime at `h`/`Fragment` in your own `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

Then import both into every `.tsx` file (the factory must be in scope) and write JSX:

```tsx
import { h, Fragment, signal, render } from "@wcstack/signals/dom";

const count = signal(0);
const view = (
  <button onClick={() => count.set(count.peek() + 1)}>
    count: {() => count.get()}
  </button>
);
render(view, document.body);
```

Note what carries over and what does **not**:

- **Reactive bits are still thunks/signals.** `{() => count.get()}` (or passing a signal) is what wires the targeted effect — a bare `{count.get()}` reads once and never updates. JSX changes the syntax, not the reactivity model.
- **The classic runtime only.** Automatic runtime (`"jsx": "react-jsx"` + `jsxImportSource`) is **not** supported — there is no `./jsx-runtime` export (it's a planned-but-unshipped seam). Use `"jsx": "react"` with the two factory options above.
- **Most JSX semantics are not in the contract.** `ref`, `context`, and controlled inputs are **not** implemented, and there is no JSX `key` attribute — `{items.map(...)}` rebuilds wholesale just as it does without JSX. For keyed lists, call [`For`/`Index`](#6-keyed-lists--for--index) directly (they work the same inside JSX).

A step-by-step guide (esbuild / tsc / Vite setups, a verifying `.tsx` example, troubleshooting) is in [`docs/signals-jsx-setup.md`](../../docs/signals-jsx-setup.md).

## Buildless (import maps)

Both entries ship as production code-split bundles that import **one shared reactive-core chunk**, so on a buildless page you can import the headless core from `@wcstack/signals` and the DOM layer from `@wcstack/signals/dom` and still get a **single** reactive instance (one tracking context). Map both specifiers; the shared `core-*.esm.js` chunk is resolved by relative path, so serve the whole `dist/` (or use a CDN that does). Bundler users dedupe via the module graph and may use either entry.

## Notes & limitations

- **JSX is shaped but not shipped.** `h` is the classic JSX factory; the buildless path is calling `h` directly. Wiring JSX is opt-in (and leaves buildless) — see [Using JSX](#using-jsx-opt-in) and [`docs/signals-jsx-setup.md`](../../docs/signals-jsx-setup.md).
- **Use `For`/`Index` for lists, not a bare reactive child.** A function/signal child is an *insertion point*: on each run every node it produced before is removed and the freshly-resolved nodes inserted. That is fine for conditional/small dynamic regions, but for a list (`() => items.map(render)`) the whole subtree regenerates on any change — DOM-regen cost grows with size and per-row state (focus, an inline `<input>`/`<select>` being edited, scroll, selection) is lost. Use [`For`/`Index`](#6-keyed-lists--for--index) for keyed reuse. Each row must be a single Node.
- **No backpressure (stream).** The fold result *is* the buffer — demand does not flow back to the producer. Bound the fold (latest / count / window) for infinite streams; unbounded accumulation is a footgun.
- **Cooperative cancellation.** A `ReadableStream` is force-unwound on abort via `reader.cancel()`. A plain async iterable that ignores its `AbortSignal` and parks (stalls before the next `yield`) cannot be force-unwound — honor the signal in your `source`.
- **`setProp` covers the common attribute↔property cases, not all.** A small remap table handles `for`→`htmlFor`, `tabindex`→`tabIndex`, `colspan`/`rowspan`, etc.; read-only DOM members fall through to `setAttribute`; SVG tags are created in the SVG namespace and `class` is always set as an attribute (so SVG works). `style` objects accept camelCase, kebab-case, and CSS custom properties (`--x`). `null`/`undefined` on a DOM property are normalized to `""` (so a string prop like `id`/`src` clears, not `"null"`), but `false` is left as-is — correct for boolean props (`disabled = false`), so a reactive `false` on a *string* prop still lands as `"false"`. The same `""` normalization also hits **object/array-valued custom-element props** — a reactive `null` lands as `""`, not `null`; pass an empty array/object to clear such a prop. Pass `""` or guard in the thunk; `class` is special-cased (`false` → `""`).
- **An effect that writes a value it depends on (mutating each run) loops.** A runaway flush is bounded by a hard iteration cap and throws rather than hanging.
- **Out of scope for v1.** SSR/hydration (initialize from JS, not markup), deep/proxy reactivity (use `@wcstack/state` for path-based deep tracking), and stream backpressure are deliberately not provided — see the design doc.

## Headless usage

The reactive core has no DOM dependency — `signal` / `computed` / `effect` / `resource` / `streamResource` / `bindNode` / `nodeSource` all work in plain JS (Node, workers, tests). Only the `/dom` entry (`h` / `For` / `Index` / `SignalsElement`) touches `document`.

## Development

```bash
npm run build            # clean → tsc → rollup (dual entry: index + dom)
npm test                 # vitest run
npm run test:coverage    # coverage (thresholds 100/100/100/100)
npm run lint             # eslint src
```

## License

MIT
