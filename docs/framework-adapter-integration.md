# Embedding wcstack elements in a framework app

- **Written**: 2026-08-01
- **Updated**: 2026-10-20 — §2, §3, §4, §5 and §6–§10 from the fw-inventory seam app (React 19 and Vue 3
  over the I/O nodes, [seam-apps.md](./seam-apps.md))
- **Status**: usage guide (not normative — the normative references are each SPEC and the
  [async I/O node guidelines](./async-io-node-guidelines.md))
- **Audience**: anyone using `<wcs-*>` from a React / Vue / Svelte / Solid / Angular / Qwik app
- **Where this comes from**: it is the Phase A2 / A4 deliverable of
  [framework adapter binding constraints](./architecture-hardening/13-framework-adapter-binding-constraints.md).
  The design decisions are recorded in doc 13; the classification of value meanings is in the
  [observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md).
- **日本語版**: [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md)

## 0. Three rules

1. **Use `@wc-bindable` 0.9 or later, or wait for the definition before binding.** Since 0.9 the
   adapters wait for a late definition themselves; an older adapter goes silent and delivers nothing
   at all for an element defined after render (§1).
2. **For inputs that take an object, spell out "pass this as a property".** Left at the default,
   some frameworks stringify it into an attribute (§2).
3. **Pass deep plain copies of reactive store values.** A Proxy fails at the structured clone
   boundary, and Vue's `toRaw()` unwraps one level only (§3).

In the ordinary setup — bundling with a static import (`import "@wcstack/websocket/auto"`) — rule 1
is satisfied automatically, whatever the adapter version. Rules 2 and 3 apply regardless of setup.

§5–§10 cover where a framework behaves differently from `@wcstack/state`: outputs that are events,
commands instead of `trigger`, the order of props, the names a framework keeps, Vite's dev server and
the lint.

## 1. Definition timing

### 1.1 What happens

**`@wc-bindable` 0.9 and later** ([wc-bindable-protocol#22](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/22)):
every adapter passes `syncOn: "define"` to `bind()` by default (the imperative binders — `vanjs`,
`mobx`, `rxjs`, `signals` — pass `["define", "connect"]`). When the declaration cannot be read yet
and the tag name contains a `-`, `bind()` waits for `customElements.whenDefined(tagName)`, upgrades
the element, reads the declaration once more and binds. An element defined after render therefore
binds when its definition lands; nothing in this section is needed. A `syncOn` of your own replaces
the default — leave `"define"` in it. `bind()` called directly from `@wc-bindable/core` still
defaults to `"call"`: pass `syncOn: "define"` yourself.

**0.8 and earlier**: every adapter evaluates `isWcBindable(el)` exactly once at mount and, if it is
false, **gives up without retrying**. The element reference is the same object after an upgrade, so
neither a React dependency array nor Qwik's `track()` fires again. The result is that no error and no
log appears, while that element delivers neither its initial value nor any later event, ever.

```ts
// the shape common to every adapter up to 0.8
if (!isWcBindable(el)) return;   // ← merely not-yet-upgraded ends it here
unbind = bind(el, onUpdate);
```

`bind()` in `@wc-bindable/core` likewise returns a no-op and finishes quietly when it cannot read a
declaration and `"define"` is not asked for. `syncOn: "connect"` is an option for a late
**connection**, and does nothing for a late **definition**.

### 1.2 Setups where it happens, and where it does not (0.8 and earlier)

| Setup | When the definition lands | Impact |
| --- | --- | --- |
| static import of `@wcstack/<pkg>/auto` through a bundler | before render | none (recommended) |
| dynamic import via `@wcstack/autoloader` | after the DOM scan | **affected** |
| `<script type="module">` from a CDN | network-dependent | **affected** |
| lazy-loaded through dynamic import / code splitting | when the load completes | **affected** |

With 0.9 and later none of them is affected.

To load the wcstack tags themselves through the autoloader, give each package a wrapper that imports
its `/auto` ([autoloader README](../packages/autoloader/README.md#loading-wcstacks-own-tags)). A
wrapper that re-exports one class leaves `<wcs-fetch-header>` / `<wcs-fetch-body>` undefined, and the
request goes out without their header or body.

### 1.3 How to write the gate (0.8 and earlier)

A static import is the surest form, and still the simplest with any version.

```ts
// main.tsx / main.js — once, at the app entry
import "@wcstack/websocket/auto";
```

Where lazy loading is unavoidable, wait on `customElements.whenDefined()` before mounting.

```tsx
// React
function ChatGate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    customElements.whenDefined("wcs-ws").then(() => setReady(true));
  }, []);
  return ready ? <Chat /> : null;   // Chat is where useWcBindable is called
}
```

```vue
<!-- Vue -->
<script setup>
const ready = ref(false);
onMounted(() => customElements.whenDefined("wcs-ws").then(() => (ready.value = true)));
</script>
<template>
  <Chat v-if="ready" />
</template>
```

Svelte / Solid / Qwik / Angular take the same shape. **The `whenDefined` wait only means anything
before the component that calls the adapter mounts.** Waiting inside that same component is too
late — the adapter has already given up.

A dynamic `import("@wcstack/sse/auto")` type-checks since 4.6 (not released yet): each package ships a
`dist/auto.d.ts` for its `/auto` entry. On 4.5 and earlier TypeScript reports `TS7016` for it; declare
`declare module "@wcstack/*/auto";` once.

### 1.4 What does not substitute for it

- **`connectedCallbackPromise` / `hasConnectedCallbackPromise`** — these exist to take an initial
  snapshot after connection; they cannot be used to wait for a definition. On an undefined element
  the getter itself does not exist.
- **`<wcs-defined>`** — a gate that observes whether given tags are defined. Useful for handling the
  readiness of several tags declaratively, but `<wcs-defined>` has to be defined first itself.
- **A `setTimeout` delay** — unrelated to when the definition completes, so it merely happens to
  work on a fast network.

### 1.5 The input side is rescued

A property assigned before the upgrade, such as `el.url = "..."`, is not lost: it is re-read in
`connectedCallback` (only for inputs declared in `wcBindable.inputs`; wc-bindable 0.10's producer
guidance P4). That is about **inputs**; it does not rescue the missing **observation** of §1.1, so
with a 0.8 adapter the bind gate is still required.

## 2. Inputs that take an object

A DOM attribute can only hold a string, so an input that takes an object or array has to be passed
as a DOM property. React 19 / Vue / Svelte / Preact decide between property and attribute by looking
at whether a property of that name exists on the element, which means **an element that has not been
upgraded falls back to the attribute and gets stringified into `[object Object]`**.

wcstack's scalar inputs (`url`, `type`, `manual`, …) are attribute-backed accessors, so the meaning
survives the fallback. The only things that break are inputs taking an object (`post`, `options`,
`files`, …).

| Framework | How to pass as a property |
| --- | --- |
| Vue | `:post.prop="payload"` or `.post="payload"` |
| React 19 | `el.post = payload` through a `ref` (a JSX value depends on the property check) |
| Angular | `[post]="payload"` (Angular property binding always assigns a property) |
| Lit | `.post=${payload}` |
| Solid | `prop:post={payload}` |
| Svelte | grab it with `bind:this` and assign |

The reliable route in any framework is to **take the element with a ref and assign the property**.
Since 4.6 (not released yet) an element that finds an object written as one of its attributes when it
connects (`files="[object File]"`, `body="[object Object]"`) warns once: `[wcs/input-as-attribute]`.

**Assign a new object; do not change one in place.** A framework writes an input when its value
changes, and an object changed in place is the same value: `files.push(file)` on the array passed as
`files={files}`, or `payload.rows.push(row)` on an object bound with `:body.prop`, writes nothing, and
the element never hears of it. An automatic `<wcs-upload>` uploads on assignment, and `<wcs-fetch>`'s
`body` and `<wcs-upload>`'s `files` are used up by a request, so the next request goes without them.
Assign a new array or object (`setFiles([...files, file])`).

**Getting the element next to the adapter (React).** `useWcBindable`'s ref is a callback, so keep the
element yourself in a ref that also calls it — to call a command, assign an object input or listen to
an event (§5):

```tsx
const [bindRef, values] = useWcBindable<WcsSse, WcsSseValues<Stock>>();
const el = useRef<WcsSse | null>(null);
const ref = useCallback((node: WcsSse | null) => { el.current = node; bindRef(node); }, [bindRef]);
// <wcs-sse ref={ref} url="/api/stock/stream" />, then el.current?.close()
```

**In Vue, name the template ref statically.** `const { ref: stock, values } = useWcBindable()` with
`<wcs-sse ref="stock">` binds, and `stock.value` is the element. A `:ref="ref"` binding — the form
`@wc-bindable/vue`'s README shows — gets the ref unwrapped in `<script setup>`, so it passes `null`:
the adapter never binds, and `values` stays empty without a word.

**TypeScript and JSX.** The packages ship no JSX declarations for their tags; declare the ones you use.
For React 19:

```ts
// wcs-jsx.d.ts
import "react";
type Base = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wcs-sse": Base & { url?: string | null; events?: string; manual?: boolean };
      "wcs-storage": Base & { "storage-key"?: string; type?: "local" | "session"; manual?: boolean };
    }
  }
}
```

[`examples/websocket-chat/react/src/wcs-ws.d.ts`](../examples/websocket-chat/react/src/wcs-ws.d.ts)
declares `<wcs-ws>` the same way.

## 3. Pass reactive store values as raw

Vue's `reactive`, Svelte 5's `$state`, Solid stores, Alpine, MobX, and Qwik's `useStore` wrap values
in a Proxy. What gets wrapped is plain objects / arrays / Maps / Sets; platform objects such as
`MediaStream` / `Error` / `Blob` / `ArrayBuffer` are not affected.

A Proxy cannot be structured-cloned, so passing one straight through produces a **`DataCloneError`**
in `<wcs-worker>`'s `post` or a `<wcs-broadcast>` send. wcstack is never-throw, so no exception
surfaces — it lands in `error` / `errorInfo`, and since 4.6 (not released yet) the element also warns
once: `[wcs/post-uncloneable]`.

What has to be passed is a **deep** plain copy. Vue's `toRaw()` unwraps one level: the rows of a
reactive list are proxies too, and so are the rows of a list rebuilt with `filter` or a spread
(`picked.value.filter(…)`, `[...picked.value, item]`), so `toRaw(list)` still fails.

| Framework | Unwrapping |
| --- | --- |
| Vue | `JSON.parse(JSON.stringify(state.payload))`, or `toRaw()` on each level (not `toRaw(state.payload)` alone) |
| Svelte 5 | `$state.snapshot(payload)` |
| Solid (store) | `unwrap(payload)` |
| MobX | `toJS(payload)` |
| Qwik | an explicit copy, e.g. `JSON.parse(JSON.stringify(payload))` |

wcstack does not implement framework-specific unwrapping (it cannot take on the dependency, and
there is no general way to tell whose Proxy a given Proxy is). The normative text is
[guidelines §3.3.2](./async-io-node-guidelines.md).

## 4. Listening directly to event names containing a colon

wcstack event names contain a colon, as in `wcs-camera:stream-ready`.

**Through an adapter this never comes up.** `bind()` uses `addEventListener`, for which the spelling
of the event name is irrelevant. It matters when you want to listen directly in a template, without
the adapter.

| Framework | Direct binding in a template |
| --- | --- |
| Angular | **not possible**. `(wcs-camera:stream-ready)` is read as `target:event` and yields `Unsupported event target` ([angular/angular#28491](https://github.com/angular/angular/issues/28491), open) |
| React | **depends on the JSX transform, and then on the case**. A colon makes the attribute a JSX namespace name: Babel refuses it by default, Vite 8's transform compiles it. React 19 then listens to the event named after `on` as written: `onwcs-fetch:response` works, while `onWcs-fetch:response` compiles and never fires (`Wcs-fetch:response` is never dispatched), with no warning |
| Vue / Svelte / Solid | sometimes writable, but the handling of colons depends on the framework and version |

**The route that works everywhere is to take an element reference and call `addEventListener`.**

```ts
// Angular
constructor(private el: ElementRef, private renderer: Renderer2) {}
ngAfterViewInit() {
  this.renderer.listen(this.cameraEl.nativeElement, "wcs-camera:stream-ready", (e: CustomEvent) => {
    this.video.nativeElement.srcObject = e.detail;   // live MediaStream
  });
}
```

```tsx
// React
const cameraRef = useRef<HTMLElement>(null);
useEffect(() => {
  const el = cameraRef.current;
  if (!el) return;
  const onReady = (e: Event) => { videoRef.current!.srcObject = (e as CustomEvent).detail; };
  el.addEventListener("wcs-camera:stream-ready", onReady);
  return () => el.removeEventListener("wcs-camera:stream-ready", onReady);
}, []);
```

The representative case that needs this route is an observable classified as a `handle`.
`streamReady` on `<wcs-camera>` is a live `MediaStream` — a value that must not enter snapshot state
— so receiving it directly rather than through the adapter's values is the correct thing
([inventory §5.6](./architecture-hardening/12-wc-bindable-observable-inventory.md)).

## 5. Telling the adapter what a value means

`wcBindable.properties[].semantics` declares `state` / `event` / `handle`. An adapter that
interprets it can avoid dropping occurrences (same-value dedupe) and avoid wrongly snapshotting a
live handle. Today only `@wcstack/state` interprets the declaration; the `@wc-bindable` adapters do
not. So for now, assume the following.

- **Do not read an `event` output through the adapter's values.** `message` on `<wcs-sse>` /
  `<wcs-ws>` / `<wcs-broadcast>` / `<wcs-worker>` is an occurrence, not a state. The adapter calls back
  for each event, but it keeps the value in framework state, and the framework renders once for
  several updates (React batches the updates of consecutive tasks) and skips a value equal to the
  last one (React's `useState`, Vue's reactivity). Of five SSE messages that arrived in one chunk, a
  `useEffect` on `values.message` saw one; two equal pings counted once. Listen to the event on the
  element, and keep the adapter for the `state` outputs (`connected`, `loading`, `error`):

  ```tsx
  useEffect(() => {
    const node = el.current;   // the element, kept as in §2
    if (!node) return;
    const onMessage = (e: Event) => apply((e as CustomEvent).detail);
    node.addEventListener("wcs-sse:message", onMessage);
    return () => node.removeEventListener("wcs-sse:message", onMessage);
  }, []);
  ```

- A `handle` (`streamReady`) does not belong in values; receive it through the route in §4.

## 6. Commands, not `trigger`

`trigger` (on `<wcs-fetch>`, `<wcs-upload>`, `<wcs-storage>`, …) is a `@wcstack/state` idiom: writing
`true` runs the command, and the element resets it to `false`. State writes on every assignment, so
the next `true` runs it again. A framework writes only a change. With `trigger={refresh}` and
`setRefresh(true)` on each click, the first click runs the command and the element resets `trigger`,
but React still holds `true`: the second click writes nothing, and nothing is sent or said. From a
framework, call the command on the element (§2): `el.fetch()`, `el.upload()`, `el.save()`.

## 7. The order of props

A framework applies a JSX element's props, and a Vue template's bindings, in the order written, and
React 19 does it before the element is in the document. Where an element reads one input when another
is written, the order matters as it does in one `data-wcs`: write `url` before `trigger`. Since 4.6
(not released yet) an automatic `<wcs-upload>` given its `files` before its `url` keeps them and sends
them when the url arrives; on 4.5 and earlier `files={files} url=…` uploaded nothing and warned
`[wcs/command-not-ready]`.

## 8. Names a framework keeps, and an element's lifetime

React and Vue take `key` (and `ref`) for themselves and never hand them to the element.
`<wcs-storage key="…">` in JSX or a Vue template has no key, so it loads and stores nothing: write
`storage-key` (since 4.6 (not released yet); the element warns `[wcs/command-not-ready]` at its first
save without a key). On 4.5 and earlier, assign `el.key` through a ref.

A component's `key` also decides its lifetime. A `key` that changes remounts the component, and every
I/O node in it starts over: `<wcs-sse>` and `<wcs-ws>` open a new connection each time, without the
`Last-Event-ID` of the last one, so the events in between are lost. Keep I/O nodes outside a
component whose `key` changes.

Removing a prop writes `undefined` (React 19), which restores the attribute written in the markup. It
does not close a connection: to stop a `<wcs-sse>` or a `<wcs-ws>`, call `close()` on it, or unmount it.

## 9. Vite's dev server

- On the first dev load Vite finds the `@wcstack/*/auto` imports and optimizes them again: a few
  `504 (Outdated Optimize Dep)` errors and a reload, once. List the entries in `optimizeDeps.include`
  to avoid it.
- Vite's proxy keeps the browser's response open when the server behind it goes away, so an
  `EventSource` through it never reconnects: `<wcs-sse>` stays `connected` and receives nothing after
  the server restarts. End the response on a proxy error:

  ```js
  // vite.config.js
  const endOnError = (proxy) => proxy.on("error", (_err, _req, res) => res.destroy());
  export default defineConfig({
    server: { proxy: { "/api": { target: "http://localhost:3000", configure: endOnError } } },
  });
  ```

## 10. The lint

`wcs-validate` reads HTML pages: `data-wcs` bindings, `<wcs-*>` tags, wcstack scripts. A framework
app's page holds none of them, and its components (`.jsx`, `.tsx`, `.vue`, `.svelte`) are not read, so
a clean result does not cover a framework app. Since 4.6 (not released yet) the CLI says so after its
counts: `not read:` names the components, `nothing to check:` the pages with nothing in them.

## References

- [framework adapter binding constraints](./architecture-hardening/13-framework-adapter-binding-constraints.md)
- [wc-bindable observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md)
- [async I/O node guidelines](./async-io-node-guidelines.md)
- [proposal: make `bind()` wait for the definition](./spec-proposal-bind-definition-timing.md) (ja)
- [the React / Vue implementations of websocket-chat](../examples/websocket-chat/README.md)
- [seam apps](./seam-apps.md) — fw-inventory, where §2–§10 were found
