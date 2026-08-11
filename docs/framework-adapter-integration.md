# Embedding wcstack elements in a framework app

- **Written**: 2026-08-01
- **Status**: usage guide (not normative — the normative references are each SPEC and the
  [async I/O node guidelines](./async-io-node-guidelines.md))
- **Audience**: anyone using `<wcs-*>` from a React / Vue / Svelte / Solid / Angular / Qwik app
- **Where this comes from**: it is the Phase A2 / A4 deliverable of
  [framework adapter binding constraints](./architecture-hardening/13-framework-adapter-binding-constraints.md) (ja).
  The design decisions are recorded in doc 13; the classification of value meanings is in the
  [observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md) (ja).
- **日本語版**: [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md)

## 0. Three rules

1. **Where an element is defined after render, wait for the definition before binding.** Without
   the wait, the adapter goes silent and delivers nothing at all (§1).
2. **For inputs that take an object, spell out "pass this as a property".** Left at the default,
   some frameworks stringify it into an attribute (§2).
3. **Unwrap reactive store values before passing them.** A Proxy fails at the structured clone
   boundary (§3).

In the ordinary setup — bundling with a static import (`import "@wcstack/websocket/auto"`) — rule 1
is satisfied automatically. Rules 2 and 3 apply regardless of setup.

## 1. Definition timing

### 1.1 What happens

Every `@wc-bindable` adapter evaluates `isWcBindable(el)` exactly once at mount and, if it is false,
**gives up without retrying**. The element reference is the same object after an upgrade, so neither
a React dependency array nor Qwik's `track()` fires again. The result is that no error and no log
appears, while that element delivers neither its initial value nor any later event, ever.

```ts
// the shape common to every adapter
if (!isWcBindable(el)) return;   // ← merely not-yet-upgraded ends it here
unbind = bind(el, onUpdate);
```

`bind()` in `@wc-bindable/core` likewise returns a no-op and finishes quietly when it cannot read a
declaration. `syncOn: "connect"` is an option for a late **connection**, and does nothing for a late
**definition**.

### 1.2 Setups where it happens, and where it does not

| Setup | When the definition lands | Impact |
| --- | --- | --- |
| static import of `@wcstack/<pkg>/auto` through a bundler | before render | none (recommended) |
| dynamic import via `@wcstack/autoloader` | after the DOM scan | **affected** |
| `<script type="module">` from a CDN | network-dependent | **affected** |
| lazy-loaded through dynamic import / code splitting | when the load completes | **affected** |

### 1.3 How to write the gate

A static import is the surest form.

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

### 1.4 What does not substitute for it

- **`connectedCallbackPromise` / `hasConnectedCallbackPromise`** — these exist to take an initial
  snapshot after connection; they cannot be used to wait for a definition. On an undefined element
  the getter itself does not exist.
- **`<wcs-defined>`** — a gate that observes whether given tags are defined. Useful for handling the
  readiness of several tags declaratively, but `<wcs-defined>` has to be defined first itself.
- **A `setTimeout` delay** — unrelated to when the definition completes, so it merely happens to
  work on a fast network.

### 1.5 The input side is rescued (next release onward)

A property assigned before the upgrade, such as `el.url = "..."`, is not lost: it is re-read in
`connectedCallback` (only for inputs declared in `wcBindable.inputs`). That is about **inputs**; it
does not rescue the missing **observation** of §1.1. The bind gate is still required.

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

## 3. Pass reactive store values as raw

Vue's `reactive`, Svelte 5's `$state`, Solid stores, Alpine, MobX, and Qwik's `useStore` wrap values
in a Proxy. What gets wrapped is plain objects / arrays / Maps / Sets; platform objects such as
`MediaStream` / `Error` / `Blob` / `ArrayBuffer` are not affected.

A Proxy cannot be structured-cloned, so passing one straight through produces a **`DataCloneError`**
in `<wcs-worker>`'s `post` or a `<wcs-broadcast>` send. wcstack is never-throw, so no exception
surfaces — it merely lands in `error` / `errorInfo`, which makes the cause hard to see.

| Framework | Unwrapping |
| --- | --- |
| Vue | `toRaw(state.payload)` |
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
| React | **not possible**. `on<name>` can handle names with dashes, but a colon is read as a JSX namespace name |
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
([inventory §5.6](./architecture-hardening/12-wc-bindable-observable-inventory.md) (ja)).

## 5. Telling the adapter what a value means

`wcBindable.properties[].semantics` declares `state` / `event` / `handle`. An adapter that
interprets it can avoid dropping occurrences (same-value dedupe) and avoid wrongly snapshotting a
live handle. Today only `@wcstack/state` interprets the declaration; the `@wc-bindable` adapters do
not. So for now, assume the following.

- An `event` whose payload repeats (`message`, `fired`, `clicked`, …) can be dropped if fed straight
  into a value-based store. Receive it as an event, or distinguish occurrences with a counter.
- A `handle` (`streamReady`) does not belong in values; receive it through the route in §4.

## References

- [framework adapter binding constraints](./architecture-hardening/13-framework-adapter-binding-constraints.md) (ja)
- [wc-bindable observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md) (ja)
- [async I/O node guidelines](./async-io-node-guidelines.md)
- [proposal: make `bind()` wait for the definition](./spec-proposal-bind-definition-timing.md) (ja)
- [the React / Vue implementations of websocket-chat](../examples/websocket-chat/README.md)
