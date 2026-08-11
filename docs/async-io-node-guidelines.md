# wcstack async I/O node authoring guidelines

- **Audience**: implementers adding a new async I/O node package to `@wcstack` — a Web API turned into a declarative tag (`@wcstack/fetch` / `geolocation` / `clipboard` / `sse` / `broadcast` / `worker` / `wakelock` / `intersection` / `resize` / `speech` / `permission` / `notification`, and the rest)
- **Status**: normative. "MUST / SHOULD / MAY" carry their RFC 2119 meaning. A new node MUST NOT be implemented against what is written here. Where a deviation is unavoidable, record the reason in the package's design document (`docs/<name>-tag-design.md`)
- **Why this exists**: every existing node shares the same skeleton — Core/Shell separation, wc-bindable conformance, never-throw, the `_gen` generation guard, SSR support. That consistency is what makes "learn one, use them all" true, and what makes them interoperable from the `state` binder. A new node that departs from the skeleton forces users to read its internals individually, and the value of the ecosystem collapses. This document collects the skeleton onto one page and turns it into a review checklist
- **See also**: the timing and firing contract is [timing-and-firing-contract.md](./timing-and-firing-contract.md) (ja). The norms for execution semantics (execution form, lanes, exclusivity modes, cancellation, retry, timeout) are in [async-execution-model.md](./async-execution-model.md). A proposed verification layer that cuts across both as ordered input/output traces, determinism boundaries, and conformance vectors is [io-node-trace-conformance.md](./io-node-trace-conformance.md) (ja). Snapshot boundaries for observables are [React immutable snapshots and the wc-bindable I/O boundary](./architecture-hardening/11-react-immutable-snapshot-boundary.md) (ja) and the [observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md) (ja). The protocols themselves live in their SPECs (wc-bindable / command-token / event-token). For the style of a design study, see the existing `docs/*-tag-design.md`
- **日本語版**: [async-io-node-guidelines.ja.md](./async-io-node-guidelines.ja.md)

---

## 0. TL;DR — the invariants a new node has to satisfy

1. **Split into two layers, Core and Shell.** Core is a headless implementation extending `EventTarget`; Shell is an `HTMLElement`. The Shell does nothing but wrap the Core with `new Core(this)`
2. **Conform to wc-bindable-protocol.** Declare `properties` / `inputs` / `commands` through `static wcBindable`
3. **never-throw.** A failure flows into declarative state as the `error` property (plus an `"unsupported"` state where needed), not as an exception
4. **Same-value guard.** A state setter fires its event only when the value actually changed
5. **The `_gen` generation guard.** Async work captures a generation number when it starts and does nothing on resolve if it is stale (preventing writes into a torn-down element after a disconnect or a fast reconnect)
6. **The `observe()` / `dispose()` lifecycle.** The Shell calls `observe()` in `connectedCallback` and `dispose()` in `disconnectedCallback`. `observe()` is idempotent
7. **SSR support.** Core has a `ready` promise representing the completion of its first probe, and the Shell exposes it as `connectedCallbackPromise` (`static hasConnectedCallbackPromise = true`)
8. **Resolve APIs at call time.** Global APIs (`navigator.x` and friends) are not cached; they are resolved on each call (so tests can substitute them, and unsupported environments are reported correctly)
9. **Test coverage 100 / 97+ / 100 / 100** (statements / branches / functions / lines). Test descriptions are written in Japanese
10. **Reflect output state into CSS (CustomStateSet).** The Shell reflects boolean output observables, derived boolean getters, and the presence of `error` into `ElementInternals.states` so they are selectable with `:state()`. Reflection lives only in the Shell and is never brought into Core. Where `attachInternals` is absent it disables itself quietly (§4.5)
11. **Core is a public headless surface.** Export the Core class from the package entry (`exports.ts`) and treat its structural guarantees (§3.9) as public API under semver. The README has a section on headless (Core) usage (§9)
12. **The producer snapshot contract.** A producer does not modify a state-like object or array after publishing it, and assigns a fresh value before notifying when the logical state changes. An event does not same-value guard its occurrences, and a handle states its owner and release point explicitly (§3.3.1). How values received as input are handled is §3.3.2
13. **Property upgrade.** The Shell calls `upgradeProperties(this)` at the top of `connectedCallback`, re-reading inputs assigned before the upgrade (§4.1.1)

---

## 1. Write the design document first (before the implementation)

Before writing code, create `docs/<name>-tag-design.md` and settle at least the points below. Use the existing `permission-tag-design.md` / `notification-tag-design.md` / `speech-tag-design.md` as templates.

Points to settle:

- **The tag name and short name**: `<wcs-xxx>`. It becomes the basis for the event prefix `wcs-xxx:` and the triggerAttribute `data-xxxtarget`
- **Direction**: is the node
  - **monitor-only** (element → state only, `commands: []`)? e.g. `permission` (the Permissions API has no `request()`)
  - **command-only** (state → element only)?
  - **bidirectional** (both command-token and event-token)? e.g. `notification` (a show command plus a click event)
- **The observable surface**: which properties are exposed. A composite state is decomposed into "one event plus derived getters" (§4.2)
- **Observable semantics**: whether each property is treated as `state` / `event` / `handle`. Tabulate the owner of each object or array, whether it is mutated after publication, and the stop / swap / release points of any live resource (§3.3.1)
- Whether **the desired / actual two-phase split** is needed. e.g. `wakelock` (separating the acquisition request `desired` from actually holding it, `actual`)
- **Whether a same-value guard alone suffices**, or debounce/throttle is left to the user (the user by default — let them write `notice@x|debounce(1000)` with a filter)
- How **permission / secure-context** are handled. Whether to reuse the existing four-value surface (`prompt` / `granted` / `denied` / `unsupported`)
- Whether it has **autoTrigger** (the click-to-invoke shortcut)
- **Whether it has an external clock** (an audio thread and the like — a time base of its own that the main thread's sync / microtask / task cannot express). If it does, **expose desired only and do not specify when it takes effect** ([timing-and-firing-contract.md §19.1](./timing-and-firing-contract.md) (ja)). It MUST NOT read the effective value back and publish it — the reading depends on the render quantum and the same-value guard stops working
- **Whether it handles live handles.** If so, the default is that **Core owns them and they never cross the protocol boundary** (as in worker / websocket / broadcast). Add pass-through of command-token arguments only when the need to hand one outward actually arises (camera is the sole example). Where handles connect to each other into a graph, read [ADR-14](./architecture-hardening/14-handle-graph-wiring.md) (ja) first — the topology is expressed as a descriptor, not as a value

Once the design has settled, reviewing it with the `architecture-review` or `protocol-spec-review` skill before implementing is recommended.

---

## 2. Package layout (file structure)

Treat `packages/notification/` as the most current reference implementation. Copying an existing package is the shortest path (permission is the smallest; notification is the fully loaded one — bidirectional plus SW plus autoTrigger).

```
packages/<name>/
  src/
    auto/
      auto.js              # prebuilt bootstrap (hand-written, copied to dist by rollup)
      auto.min.js
    core/
      <Name>Core.ts        # headless. extends EventTarget. static wcBindable.
    components/
      <Name>.ts            # the Shell. extends HTMLElement. class name Wcs<Name>.
    bootstrap<Name>.ts      # setConfig + registerComponents
    config.ts              # config / getConfig / setConfig (with deepFreeze/deepClone)
    registerComponents.ts  # customElements.define (guarded against double definition)
    autoTrigger.ts         # (command nodes only) data-xxxtarget click invocation
    raiseError.ts          # the shared error helper
    types.ts               # IWcBindable* plus the Core/Shell value, command, and input types
    exports.ts             # the public re-exports
  __tests__/
    setup.ts
    *.test.ts              # written in Japanese
  package.json             # "type":"module", rollup outputs, coverage thresholds
  tsconfig.json            # extends the root
  rollup.config.js
  eslint.config.js
  vitest.config.ts
  README.md / README.ja.md
```

What the public boundary (`exports.ts`) MUST export:

- `bootstrap<Name>`
- `getConfig` (the internal mutable `config` is not exported; `getConfig()` returns a deep-frozen clone)
- `<Name>Core` (for headless use)
- `Wcs<Name>` (the Shell class — required for adapter DX; see `feedback_export_shell_class`)
- the full set of types (`type` re-exports)

---

## 3. Rules for Core (the headless implementation)

Reference: [`packages/notification/src/core/NotificationCore.ts`](../packages/notification/src/core/NotificationCore.ts), [`packages/permission/src/core/PermissionCore.ts`](../packages/permission/src/core/PermissionCore.ts)

### 3.1 Shape

- `export class <Name>Core extends EventTarget`
- The constructor takes `target?: EventTarget` and sets `this._target = target ?? this`. The Shell passes itself in with `new Core(this)`, so the events Core dispatches bubble from the Shell element. In headless use, Core itself is the EventTarget
- It MUST NOT depend on DOM elements (`HTMLElement` / `document`). Core touches only Web APIs (`navigator` / `globalThis.X`)

### 3.2 `static wcBindable`

```ts
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [ /* observable outputs */ ],
  commands:   [ /* invocable methods (or [] where there are none) */ ],
};
```

- `properties`: `{ name, event, getter? }`. `event` takes the form `wcs-<name>:<kind>`. As far as the protocol goes, Core interprets `properties` only; `inputs` / `commands` are descriptive metadata (for tooling and codegen)
- `properties[].semantics` (`"state" | "event" | "handle"`) declares the observation semantics. **`event` and `handle` MUST be declared.** Omission means "unspecified", not `state`, and a reader keeps current behavior when it is omitted. Declaring `state` is optional for now (§3.3.1). Do not assume an adapter will infer it from the type or the property name
- `commands`: `{ name, async? }`. An async command carries `async: true`
- A monitor-only node sets `commands: []` and says so in a comment

### 3.3 State lives in a private field with a same-value-guarded setter

```ts
private _setState(v: T): void {
  if (this._state === v) return;          // the same-value guard (MUST)
  this._state = v;
  this._target.dispatchEvent(new CustomEvent("wcs-<name>:change", {
    detail: v, bubbles: true,
  }));
}
```

- Events always carry `bubbles: true`
- **Event-natured things (a click, a message — anything where each firing carries meaning) are not same-value guarded.** State-natured things (permission, loading, …) are. Which one it is has to be stated in the design document

### 3.3.1 The producer snapshot contract (MUST)

This section applies to new nodes and new observable properties. Existing nodes migrate in stages, starting from the [observable inventory](./architecture-hardening/12-wc-bindable-observable-inventory.md) (ja), and MUST NOT break their existing delivery, getters, or resource lifetimes wholesale.

#### `state`

A `state` is the current value at a point in time, readable both from the initial property read and from subsequent events.

- A producer MUST NOT in-place mutate an object / array / binary instance after publishing it.
- When the logical state changes, it MUST build a fresh object / array, assign it to the private field, and then fire the event.
- At the moment the event fires, the public getter and the event detail / custom getter MUST represent the same logical state. Where a defensive copy is returned, reference identity need not match, but content and ownership must not disagree.
- Do not clone arbitrary payloads indiscriminately. Where a reference is passed, the producer treats it as an ownership transfer it will not modify after publication, and the consumer treats it as read-only (producer MUST, consumer SHOULD).
- A value the producer keeps reusing or overwriting, such as an `ArrayBuffer`, MUST NOT be published as state as-is. Copy it explicitly only where the node has a specific reason to, or design it as an `event` or a `handle`.
- Where an opaque value is exposed (a platform `Error` / `Event`, a credential), also providing a serializable projection such as `errorInfo` is SHOULD. Do not describe the opaque value itself as general serializable state.

```ts
private _setItems(items: readonly Item[]): void {
  const next = items.map((item) => ({ ...item }));
  this._items = next;
  this._target.dispatchEvent(new CustomEvent("wcs-x:items-changed", {
    detail: next,
    bubbles: true,
  }));
}
```

The copy in this example exists so the node can convert a mutable input into an owned snapshot. It is not grounds for a general adapter to deep clone or deep freeze every payload. Deep equality, deep cloning, and deep freezing MUST NOT be enforced across the board. A decision to shallow-freeze only the adapter's outer snapshot during development lies outside the producer contract.

#### `event`

An `event` is an occurrence, not a current level.

- The declaration MUST carry `semantics: "event"`. A general consumer cannot be expected to treat an undeclared property as an occurrence.
- Every occurrence MUST be dispatched even when the same payload repeats. A same-value guard MUST NOT be placed on it.
- Keeping the last payload in a getter for compatibility with existing consumers is MAY. But the README MUST state that the getter value alone cannot express the occurrence count.
- It MUST NOT be assumed that events can be deduplicated by same-value comparison of a state snapshot. The surface received through a callback / stream / event-token is the authoritative one.

#### `handle`

A `handle` is a live resource with external state and a lifecycle of its own, such as a `MediaStream`.

- The declaration MUST carry `semantics: "handle"`. Stating it only in a source comment or the README leaves a general adapter unable to tell it from ordinary state.
- Which side is the owner — producer or consumer — and who releases it on swap, stop, or dispose MUST be recorded in the design document and the README.
- It MUST NOT be made to look like ordinary state through cloning, freezing, or a serializable projection.
- It SHOULD be passed over a ref / callback / direct-channel surface separate from the state snapshot. Where the current protocol forces it into `wcBindable.properties`, the README MUST also state that it is a live resource and describe its lifecycle, in addition to `semantics: "handle"`.

#### Managed resource values

A value that is itself primitive but whose backing resource the producer destroys — a `blob:` URL, say — needs a stronger lifetime contract than ordinary state. The producer MUST pin down, in the README and in tests, the revoke point on supersede / dispose and whether past values stay valid. Where the consumer lifecycle cannot be guaranteed, state that it is a best-effort current value.

### 3.3.2 The input value contract (MUST)

§3.3.1 governs the output side, producer → consumer. The input side (consumer → producer) has the dual problem. A framework's reactive store wraps values in a Proxy, so when a consumer writes `el.post = store.message`, Core receives a Proxy. This covers Vue's `reactive`, Svelte's `$state`, Solid stores, Alpine, MobX, and Qwik's `useStore`; what gets wrapped is plain objects / arrays / Maps / Sets (platform objects such as `MediaStream`, `Error`, `Blob`, and `ArrayBuffer` are unaffected).

- Core MAY pass a value received as input straight to a structured clone boundary (`Worker.postMessage`, `BroadcastChannel.postMessage`, IndexedDB, …). But since a Proxy cannot be structured-cloned and produces a `DataCloneError`, it MUST have a path that lands in `error` / `errorInfo` under never-throw (§3.6). It MUST NOT throw and break user code.
- Core MUST NOT implement framework-specific unwrapping (`toRaw` / `$state.snapshot` / `unwrap`). It would take on a dependency, and there is no general way to tell whose Proxy a given Proxy is. It also violates the zero-runtime-dependency principle.
- A node with an input that takes an object MUST state in its README that reactive store values are to be unwrapped before being passed. Scalar attribute-backed inputs are exempt, since they get stringified.
- Where an input value is retained and later republished as state, it SHOULD be converted into an owned snapshot on receipt. This keeps the producer's state from changing silently when the consumer's store is modified later — a measure so that §3.3.1's "do not modify after publication" cannot be broken from the input path.

### 3.4 The `_gen` generation guard (MUST)

```ts
private _gen = 0;

observe(): Promise<void> {
  const gen = ++this._gen;
  return someAsyncProbe().then((r) => {
    if (gen !== this._gen) return;        // discard if the generation is stale
    this._apply(r);
  });
}

dispose(): void {
  this._gen++;                            // invalidate everything in flight
  /* detach listeners, reset subscription flags */
}
```

This prevents async work that resolves after a disconnect, or after a fast disconnect→reconnect, from writing into a torn-down element or attaching a duplicate listener. **A boolean flag is not enough** (dispose→observe flips it false→true again and the old work slips through).

### 3.5 Lifecycle: `observe()` / `dispose()`

- `observe(...)`: start watching / subscribing. **Idempotent** (when already subscribed it only updates settings; it does not subscribe twice). Restarting goes through `dispose()` first
- `dispose()`: detach listeners, reset subscription flags, `_gen++`. An `observe()` after `dispose()` has to bring it back
- A design decision to leave a resource behind (notification, for instance, leaves displayed notifications on screen after dispose) has its reason written in a comment

### 3.6 never-throw (MUST)

- Public methods do not throw. A failure flows into the `error` property through `_setError({ error, message })`, and a missing API becomes the `"unsupported"` state
- Wherever a legacy engine might reject, catch it and keep the current state
- A method that has to return a value returns a sanitized one on failure (an empty string, null, …)

### 3.7 Resolve APIs at call time (MUST)

```ts
private _api() {
  const g = globalThis as any;
  return typeof g.SomeAPI === "function" ? g.SomeAPI : undefined;
}
```

Do not cache in the constructor. Tests can then install and remove the API, and unsupported environments are reported correctly. For APIs requiring a secure context, check `window.isSecureContext` at call time.

### 3.8 SSR: the `ready` promise

- Core has `get ready(): Promise<void>`, which resolves once the first probe settles. Where unsupported, `Promise.resolve()`
- `observe()` returns this promise

### 3.9 Core is a public adopter surface (headless adopter surface)

Core is not an implementation detail of the Shell but **a public surface that may be used directly, without an element**. `bindNode(new XxxCore())` in `@wcstack/signals` can bind a Core with no descriptor (resolving `core.constructor.wcBindable`), and since it never touches the `customElements` registry, the definition-timing problem does not exist there (floor 3 in [signals-definition-timing.md](./signals-definition-timing.md) (ja) §3.4). To support that usage, the following are guaranteed:

- The Core class MUST be exported from the package entry (`exports.ts`)
- **Structural guarantees** (all restatements of existing norms for adopters, all MUST): extends `EventTarget` (§3.1); dispatches to itself when `target` is omitted (§3.1); declares `static wcBindable` (§3.2); observable properties are readable through public getters (which §4.2's delegation presumes, and which bindNode's initial seed also reads); the `observe()`/`dispose()`/`ready` lifecycle (§3.5, §3.8); never-throw (§3.6)
- **Headless construction** (MUST): constructible without passing a `target` or any DOM element. Even where it takes configuration arguments (`DefinedCore(tags, mode, timeoutMs, target?)`, `DebounceCore(prefix, target?, options?)`), `target` stays optional
- **semver**: the structural guarantees above and the Core class name are public API under semver. **The shape and order of the constructor's configuration arguments are package-specific**, and each package's README / design document is authoritative for them (they sit outside the structural guarantees)
- The README MUST have a headless (Core) section (§9)

Current state (inventory of 2026-07-28): all 38 I/O node Cores satisfy `extends EventTarget`, `target ?? this`, and entry export (zero deviations). Five have a constructor that is not `(target?)` alone — defined / debounce / permission / raf / wakelock — and in every one `target` is omissible, so headless construction works. The authoritative user-facing explanation is the "Binding a Core directly" section of the `@wcstack/signals` README.

---

## 4. Rules for the Shell (the `<wcs-xxx>` custom element)

Reference: [`packages/notification/src/components/Notify.ts`](../packages/notification/src/components/Notify.ts)

### 4.1 Shape

```ts
export class Wcs<Name> extends HTMLElement {
  static hasConnectedCallbackPromise = true;       // SSR
  static wcBindable: IWcBindable = {
    ...<Name>Core.wcBindable,                       // inherit properties/commands
    inputs: [ /* the Shell's settable surface (attribute-linked) */ ],
    commands: <Name>Core.wcBindable.commands,
  };

  private _core: <Name>Core;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() { super(); this._core = new <Name>Core(this); }

  // attribute accessors (get reads the attribute, set reflects it; idempotent)
  // delegating getters to Core (forwarding the observable surface as-is)
  // commands (delegated to Core)

  connectedCallback() {
    upgradeProperties(this);                          // §4.1.1 (MUST, called first)
    this.style.display = "none";
    if (config.autoTrigger) registerAutoTrigger();
    this._connectedCallbackPromise = this._core.observe(/* settings resolved from attributes */);
  }
  disconnectedCallback() { this._core.dispose(); }
  get connectedCallbackPromise() { return this._connectedCallbackPromise; }
}
```

### 4.1.1 Property upgrade (MUST)

Call `upgradeProperties(this)` **at the top** of `connectedCallback` (MUST). `src/protocol/upgradeProperties.ts` is a generated copy distributed from `/protocol/upgrade-properties.ts` by `scripts/sync-protocol-types.mjs`; do not hand-edit it.

An element of an undefined tag is a plain `HTMLElement`, so `el.url = "..."` before the upgrade creates an own data property. It keeps shadowing the prototype accessor after the upgrade, so the setter is never called again and the value disappears silently. This happens routinely with frameworks that always assign properties (Angular's `[prop]`, Lit's `.prop=`, Solid's `prop:`) combined with a late definition (autoloader / CDN / code splitting) ([framework adapter binding constraints](./architecture-hardening/13-framework-adapter-binding-constraints.md) (ja) §1.2).

- It covers only inputs declared in `wcBindable.inputs`. An undeclared settable surface is not rescued.
- In a `connectedCallback` containing an `await`, call it synchronously before the first `await` (MUST).
- It is idempotent, so calling it on every connection is fine. It leaves own properties alone where the prototype side is not an accessor.

- Keep the Shell **thin**. Logic belongs in Core. The Shell's responsibilities are exactly: bridging attributes ↔ Core settings, delegating Core observables, driving the lifecycle, and reactive command-properties
- `this.style.display = "none"` (an I/O node is invisible; exceptions that need a layout box, such as `intersection`, use `display:contents` and the like, with the reason written down)

### 4.2 Decompose an observable into "one event plus derived getters"

A composite state (permission's four values, say) fires a single event and exposes booleans such as `granted` / `denied` / `prompt` / `unsupported` as **getters derived from that same event**. That way a simple binding like `hidden@granted` reads the same across every node.

```ts
{ name: "state",   event: "wcs-x:change" },
{ name: "granted", event: "wcs-x:change", getter: (e) => (e as CustomEvent).detail === "granted" },
```

### 4.3 Kinds of input

- **Attribute-linked inputs** (declarative config, e.g. `mode` / `body`): `get` reads via `getAttribute`, `set` reflects the attribute. Idempotent
- **Reactive command-properties** (a dynamic value causing a side effect, e.g. `notice` / `say`): no attribute; the setter same-value guards and then calls a Core method. `undefined` / `null` are normalized to a no-op (the binder contracts not to write undefined, but a direct assignment is possible). Make it suppressible with the `manual` attribute

### 4.4 SSR

Declare `static hasConnectedCallbackPromise = true` and hold the promise returned by `_core.observe()` in `connectedCallback` as `connectedCallbackPromise`. The state binder waits on it before taking a snapshot.

### 4.5 Reflecting output state into CSS (CustomStateSet / `:state()`)

The canonical design is `custom-state-reflection-design.md` (ja). A Shell has to satisfy the following:

- In the constructor, immediately after `super()` and **before `new Core(this)`**, obtain `attachInternals()` and wire the reflection listeners (so the first event Core dispatches synchronously inside the constructor is not missed — MUST), and reflect **boolean output observables, derived boolean getters, and the presence of `error`** (a non-null event detail) into `ElementInternals.states` (MUST). Continuous values, high-frequency values, data values, and enums with no derived getter are not reflected (design §3.2). A state name is the kebab-case of the property name (design §3.3)
- Reflection is done by the Shell subscribing to its own `*-changed` / `:error` events through **a self-listener registered in the constructor**. It MUST NOT be brought into Core, and the wcBindable declaration is not changed either
- **never-throw**: a missing `attachInternals` (happy-dom, older environments) and older Chromium (<125) rejecting state names without a dash are detected by a probe at acquisition time, and the whole reflection path disables itself quietly
- The states are a synchronous projection of the last event fired, and are not cleared on disconnect (the timing contract is timing-and-firing-contract §17)
- **Debug observability**: the `debugStates` getter MUST return a **snapshot array** of the state names currently on. It MUST NOT return the live `CustomStateSet` (that would be an external write path). It is not listed in wcBindable. Only on an element carrying the `debug-states` attribute does it mirror `data-wcs-state-<name>` attributes (off by default; the README steers CSS toward `:state()`)
- Follow design §3.4 / §3.6 for the canonical snippet and the test template (five to eight tests, with the shim in `__tests__/helpers.ts` plus `setup.ts`). A new node's tag-design doc has to include one table mapping the reflected states

---

## 5. The protocols (command-token / event-token)

A bidirectional node has two wiring directions. For details see the respective SPECs and the design notes in memory.

- **command-token** (state → element invocation): a method declared in `commands` is invoked with `command.<method>:`. Arguments pass through positionally and verbatim (MUST; not awaited; an undefined argument passes through too). See `spec-proposal-command-token-arguments.md` (ja)
- **event-token** (element → state): the events of `properties` flow to the state side. The key name is the wcBindable property name
- A property with `event` semantics flows per occurrence even for an identical payload. A property with `handle` semantics is not assumed to be retained as a state value and follows its owner / release contract
- Where the same Web API needs both a "reactive form" (same-value guarded, declarative) and an "imperative form" (fires even on an equal value, imperative), providing both is fine (speech's `say`/`speak`, notification's `notice`/`notify`)

---

## 6. config / bootstrap / registration

Reuse `packages/notification/src/config.ts` as-is:

- `config` (internal mutable, read at call time. **Not exported from exports.ts**)
- `getConfig()` (returns a deep-frozen clone; the public one)
- `setConfig(partial)` (type-checks and merges, invalidating the frozen cache)
- config carries at minimum `tagNames` / `autoTrigger` / `triggerAttribute`
- `registerComponents()` guards against double definition with `customElements.get()`
- `bootstrap<Name>(userConfig?)` is `setConfig` → `registerComponents`

`autoTrigger.ts` (command nodes only) picks up a `data-<name>target` click, resolves the element with `customElements.get()` (avoiding an import cycle), and calls the command. An invalid triggerAttribute selector is caught with try/catch, disabling only this shortcut.

---

## 7. Build

Follow the root policy: `rimraf dist` → `tsc` → `rollup -c`. Rollup produces, from `src/exports.ts`:

- `dist/index.esm.js`
- `dist/index.d.ts` (rollup-plugin-dts)

Plus `dist/auto.min.js` (Terser) from `src/auto.ts` as a separate entry. That one MUST be a **self-contained bundle with zero external imports**. `src/auto.ts` MUST NOT relatively import a sibling dist file — it would destroy the property that one `integrity` attribute covers the whole runtime ([sri.md](./sri.md)). `dist/index.esm.min.js` is not produced (it appeared in no `exports` and its only consumer was the old auto stub).

A node with extra entries, such as a Service Worker, adds rollup outputs and a subpath in `package.json`'s `exports` (e.g. `"./sw"`) — see notification.

`package.json` carries `"type": "module"` (ESM only, no CommonJS). Versions are released aligned with the client packages (state/fetch/autoloader/router) (see `feedback_version_alignment`).

---

## 8. Tests

- Vitest plus happy-dom. `__tests__/*.test.ts`, with a `setup.ts`
- Meet the coverage thresholds **100 / 97+ / 100 / 100** (statements / branches / functions / lines)
- Test descriptions (`describe` / `it`) are written in Japanese
- Substitute Web APIs with fake doubles (`FakeIntersectionObserver` and others are precedents). Since `_api()` resolves at call time, install/remove works in tests
- Always test:
  - never-throw (no exception when the API is absent, when it rejects, or outside a secure context)
  - the same-value guard (an equal write fires no event; event-natured values fire every time)
  - state-like objects / arrays (a previously published value does not change after a later update; a fresh value on every logical state change)
  - that the property read and the event payload / getter represent the same logical state
  - handles / managed resources (the release point on swap and dispose, and whether past values stay valid)
  - the `_gen` guard (async work resolving after a disconnect changes no state; dispose→observe brings it back)
  - the idempotence of `observe()`
  - SSR (`connectedCallbackPromise` / `ready` settle)
  - that an unsupported environment becomes `"unsupported"`

---

## 9. Documentation

- Write both `README.md` (English) and `README.ja.md` (Japanese), matching the structure of the existing nodes (overview, installation, attribute table, event table, command table, design notes)
- The README MUST have a **headless (Core) section** (§3.9): the Core class name, a minimal headless construction example (with the real constructor arguments), a note that the lifecycle becomes manual (`observe()`/`dispose()`, or start/stop commands), and a link to the `@wcstack/signals` README's "Binding a Core directly"
- Record, per observable, whether it is `state` / `event` / `handle`, who owns the value, its serializability, and its resource release point (MUST, §3.3.1)
- Add it to the node list in the root README
- A node with **timing / firing behavior** (when, how many times, what is synchronous and what is a microtask) MUST add a section to [timing-and-firing-contract.md](./timing-and-firing-contract.md) (ja) at the same granularity as its §1/§2. Whenever you are about to explain internal behavior in a long comment in an example, add an entry to that contract first and link the comment to it

---

## 10. Review convergence checklist

The completion criteria. Do not merge until all of them hold.

- [ ] Core extends `EventTarget`, does not depend on the DOM, and declares `static wcBindable`
- [ ] The Shell is thin and does nothing but wrap Core with `new Core(this)`
- [ ] never-throw (no public method throws)
- [ ] State setters have a same-value guard (event-natured ones excluded, and said to be)
- [ ] State-like objects / arrays are not modified by the producer after publication, and a fresh value is published on every logical state change
- [ ] Events do not lose occurrences of an identical payload, and handles / managed resources have their owner and release point pinned down in the documentation and in tests
- [ ] The property read and the event payload / getter represent the same logical state
- [ ] The `_gen` generation guard prevents stale async writes
- [ ] `observe()` is idempotent and `dispose()` is recoverable
- [ ] APIs are resolved at call time (not cached)
- [ ] SSR: `ready` / `connectedCallbackPromise` / `hasConnectedCallbackPromise`
- [ ] config / bootstrap / registerComponents / exports follow the rules
- [ ] Core is exported from the entry and is headless-constructible (`target` omissible), and the README has a headless (Core) section (§3.9)
- [ ] Tests at 100/97+/100/100, written in Japanese, with fake doubles
- [ ] README ja/en, the root README updated, and (where needed) a section added to the timing contract
- [ ] A design document `docs/<name>-tag-design.md` exists, with the reason recorded for any deviation
- [ ] A node with async execution satisfies the addendum checklist in [async-execution-model.md](./async-execution-model.md) §13 (declaring the execution form, lanes, and exclusivity modes, and the rest)
