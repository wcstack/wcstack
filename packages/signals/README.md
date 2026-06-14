# @wcstack/signals

> **Status: PoC (v0.0.0, unpublished).** This package explores a different reactivity lineage for wcstack. The API shape is settled enough to drive the demo and the test suite, but it is not yet released to npm. See [`docs/signals-state-design.md`](../../docs/signals-state-design.md) for the design rationale.

`@wcstack/signals` is a **signals-based, fine-grained reactive core** — zero runtime dependencies, buildless, standards-first.

Where [`@wcstack/state`](../state/README.md) connects UI and state through HTML path strings (no reactive primitives in your code), `@wcstack/signals` takes the opposite stance for the cases that want it: it **exposes the reactive primitives directly**. There is no DSL and no `data-wcs`; you call `signal()`, `computed()`, `effect()` in JavaScript. The two packages are complementary, not competing — same ecosystem, different coupling point.

The public API is shaped after the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (State / Computed / effect). The implementation is in-house and tiny, so it can later be swapped for a native or polyfilled signal without changing call sites.

## What's in the box

| Module | Entry | What it gives you |
|---|---|---|
| **Reactive core** | `@wcstack/signals` | `signal` / `computed` / `effect` / `createRoot` / `onCleanup` / `flushSync` |
| **Async resource** | `@wcstack/signals` | `resource` — an async producer as a reactive `{ value, loading, error }` triad (switchMap cancel/restart) |
| **Stream resource** | `@wcstack/signals` | `streamResource` — fold a continuous flow (async iterable / `ReadableStream`) into one reactive value |
| **wc-bindable adapter** | `@wcstack/signals` | `bindNode` — turn any wc-bindable IO node's properties into signals |
| **DOM layer** | `@wcstack/signals/dom` | `h` / `render` / `Fragment` / `SignalsElement` (re-exports the core too) |

## Design in one breath

- **Pull-validated three-color marking** (after Reactively / Solid). A write marks direct observers DIRTY and transitive ones CHECK; effects run on a coalesced microtask. A computed that recomputes to an *equal* value does **not** propagate — downstream work is skipped.
- **Fine-grained `h`, no VDOM.** `h(tag, props, ...children)` builds **real DOM once**. A prop or child passed as a function/signal is wired to a targeted `effect`, so only that one binding updates. No reconciler is shipped.
- **Ownership = lifecycle.** `createRoot` / effects collect the disposers of everything created during their run, so tearing down a subtree disposes its effects, listeners, and resources — no leaks.
- **IO is the node, reactivity is the core.** `bindNode` adapts a wc-bindable element (e.g. `<wcs-fetch>`) into signals. The element has no idea a signal is behind the binding.

## Install

```bash
# Not yet published. Build locally:
cd packages/signals && npm install && npm run build
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
import { signal, computed, effect, createRoot, bindNode, h, render } from "@wcstack/signals/dom";

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
      h("ul", null, () => people.get().map((p) => h("li", null, p.name))),
    ),
    document.getElementById("search-app"),
  );
});
```

A full, runnable version of this lives in [`examples/signals-live-search`](../../examples/signals-live-search/README.md).

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
| `SignalsElement` | `abstract class extends HTMLElement` | Lifecycle base; implement `render()`, optionally `getMountPoint()`. |

`setProp` rules: `style` accepts a string or an object; `class` / `className` map to `className` (and `null`/`false` clear it); a key that exists as a DOM property is assigned as a property; otherwise it's an attribute (`true` → empty attr, `null`/`false` → removed).

### Resources (`@wcstack/signals`)

| Export | Shape |
|---|---|
| `resource<T, A>(source, options?)` | `{ value, loading, error, dispose }` — `source(args, signal) => Promise<T> \| T` |
| `streamResource<T, C, A>(source, options?)` | `{ value, status, error, dispose }` — `source(args, signal) => AsyncIterable<C> \| ReadableStream<C> \| Promise<…>` |

Both: `options.args` is a reactive getter (reading signals there wires restart-on-change, switchMap-style — the previous request is aborted via the `AbortSignal` passed to `source`); `options.initial` seeds `value`. A stale response from a superseded request is dropped (checked against `signal.aborted`). Created inside an owner, a resource auto-disposes on teardown.

### wc-bindable adapter (`@wcstack/signals`)

```typescript
const bound = bindNode(target, descriptor?);
bound.signals.<propName>.get(); // output properties as read-only signals
bound.set("inputName", value);  // write a declared input
bound.command("cmdName", ...args); // invoke a declared command
bound.dispose();                // detach all property listeners
```

If `descriptor` is omitted, it's read from `target.constructor.wcBindable`. `set` rejects an undeclared input; `command` rejects an undeclared (or non-function) command. After `dispose`, the property signals stop updating, but `set`/`command` are thin forwarders and still reach the node — drop your reference to make the adapter inert.

## Notes & limitations (PoC)

- **Buildless single-entry rule.** In a buildless page (import map), import **everything** from one entry — `@wcstack/signals/dom` re-exports the core. Loading **both** the `@wcstack/signals` and `@wcstack/signals/dom` bundles gives you **two** reactive cores (module globals like the tracking context are per-bundle) and silently breaks reactivity across the boundary. Bundler users dedupe via the module graph and may use either entry.
- **JSX is shaped but not shipped.** `h` is the classic JSX factory; a consumer who wants JSX sets `jsxFactory: "h"` + `jsxFragmentFactory: "Fragment"` in their own tsconfig (opting into a build step). The buildless path is calling `h` directly.
- **No backpressure (stream).** The fold result *is* the buffer — demand does not flow back to the producer. Bound the fold (latest / count / window) for infinite streams; unbounded accumulation is a footgun.
- **Cooperative cancellation.** A `ReadableStream` is force-unwound on abort via `reader.cancel()`. A plain async iterable that ignores its `AbortSignal` and parks (stalls before the next `yield`) cannot be force-unwound — honor the signal in your `source`.
- **`setProp` has no attribute↔property type table.** A reactive `null`/`false` on a *string* DOM property (`id`, `title`, …) lands as `"null"`/`"false"`. Pass `""` or guard in the thunk; `class` is special-cased.
- **An effect that writes a value it depends on (mutating each run) loops.** A runaway flush is bounded by a hard iteration cap and throws rather than hanging.

## Headless usage

The reactive core has no DOM dependency — `signal` / `computed` / `effect` / `resource` / `streamResource` / `bindNode` all work in plain JS (Node, workers, tests). Only the `/dom` entry touches `document`.

## Development

```bash
npm run build            # clean → tsc → rollup (dual entry: index + dom)
npm test                 # vitest run
npm run test:coverage    # coverage (thresholds 100/97/100/100)
npm run lint             # eslint src
```

## License

MIT
