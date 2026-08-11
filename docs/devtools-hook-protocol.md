# DevTools hook protocol design (devtools-hook-protocol)

- Status: **v1 implemented (2026-07-14, unreleased)** — the UI side is [devtools-tag-design.md](devtools-tag-design.md) (ja).
  Implementation: runtime side = packages/state/src/devtools/ (the bridge plus five instrumentation points),
  consumer side = packages/devtools/src/protocol/. Every acceptance gate in §7 passed
  (state 1747 tests / jsfb-verify identical before and after instrumentation / a zero-residue test after detach).
  §9's G-R was demonstrated through an edit round trip in the real-browser e2e (devtools-smoke.mjs);
  G-P was left passing straight through with no measured problem (absorbed by the rAF merge on the UI side).
- Where this sits: a normative protocol for **compensating for weak static inspectability with runtime
  inspectability**. It is the fourth protocol document after wc-bindable / command-token / event-token, and
  the only point of contact between the UI (`<wcs-devtools>`) and the runtime (state, and signals in future).
- Scope decisions (user's call, 2026-07-14):
  - A: proceed as far as Phase 1 (hook implementation plus the overlay UI)
  - B: ship it as an in-page overlay (a browser extension is deferred to a Phase 3 decision)
  - C: v1 covers **state plus its wiring (binding / token)** only; signals gets a reserved namespace and nothing more
- **日本語版**: [devtools-hook-protocol.ja.md](./devtools-hook-protocol.ja.md)

## 0. In one line

The runtime holds instrumentation points that cost **one branch when no hook is attached**, and every ledger,
formatting concern, and piece of UI for inspection lives on the hook consumer (devtools) side.
There is exactly one point of contact: `globalThis.__WCSTACK_DEVTOOLS_HOOK__`. It does not depend on module
identity (even where a CDN leaves several copies of state on the page, each copy registers as its own source).

---

## 1. Design principles (normative)

1. **detached zero-cost**: with no hook attached, the cost of each instrumentation point MUST NOT exceed
   one null check. No allocation, string formatting, or closure creation while detached.
   Precedent: the call-time check plus early return in signals' `dev.ts`.
2. **Ledgers live on the hook side**: the runtime keeps no permanent ledger for enumeration (the lesson of
   the event-ledger leak: [state-append-clear-cost], where a missed detach held DOM forever). The one
   exception is the state element registry of §4.1 (a handful of elements, deleted on disconnect, bounded by the DOM).
3. **Two layers, push plus pull**: changes flow as events (push), and the state of the world at attach time is
   taken through a snapshot API (pull). Late attachment works as far as those two layers reach (§6).
4. **The protocol carries only values that do not cross a module boundary**: an event payload **may contain
   live references** to runtime-internal objects (IBindingInfo and the like) — same realm, overlay assumed,
   the direct consequence of decision B. But a consumer MUST NOT mutate the internals of a participant.
   Turning this into a browser extension later means adding a serialization layer on the devtools side (no protocol change).
5. **Separating inspected from inspector**: the DevTools UI itself runs on wcstack (dogfooding), but has to be
   able to exclude itself from what is inspected (the ignore mechanism of §5).
6. **Inert under SSR**: where `inSsr()` is true, the bridge creates no global and emits no events.

## 2. The global and the handshake

```ts
// both sides acquire it create-if-missing (independent of load order)
interface IDevtoolsHookRegistry {
  readonly version: 1;                       // the protocol version. An additive change does not raise it
  readonly sources: Map<string, IDevtoolsSource>;
  register(source: IDevtoolsSource): void;   // runtime → registry
  unregister(sourceId: string): void;
  addListener(l: IDevtoolsListener): () => void;  // devtools → registry. The return value detaches
}

interface IDevtoolsListener {
  onSourceRegistered?(source: IDevtoolsSource): void;
  onEvent?(sourceId: string, event: DevtoolsEvent): void;
}
```

- The global name: `globalThis.__WCSTACK_DEVTOOLS_HOOK__`.
- Creation rule: whichever side references it installs a minimal implementation with `??=`.
  **The registry implementation is embedded in both sides** (the state-side bridge and the devtools-side
  client each carry a minimal implementation of the same spec; first one wins).
  Keep the implementation to about 30 lines, and on a version mismatch `console.warn` and let the newer one
  *not* win (first-wins is fixed; behavior is never swapped out).
- When the runtime registers: state registers once inside `bootstrapState()`.
  The sourceId is `"state:" + a random UUID` (reusing `getUUID`). Where a page has N module copies of state,
  there are N sources — that is the normal case (§5).
- **The shape of the hot path**: the bridge holds a module-local `let sink: ((e) => void) | null`.
  When the listener count crosses 0↔1+, the registry swaps it by calling each source's `_setSink()`.
  An instrumentation point is nothing but `sink !== null && sink(...)` (the implementation form of principle 1).
  Constructing the event object also happens inside the `sink !== null` check.

## 3. The Source interface (the pull API)

```ts
interface IDevtoolsSource {
  readonly id: string;
  readonly kind: "state";        // v1. "signals" is reserved (§8)
  readonly packageVersion: string;
  // --- pull ---
  getStateElements(): IStateElementSummary[];   // the origin of the attach-time snapshot
  keys(name: string, rootNode: Node): string[]; // enumerating top-level keys (the origin for drawing the state tree)
  read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown;
  write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
  // --- internal (registry only) ---
  _setSink(sink: ((e: DevtoolsEvent) => void) | null): void;
}

interface IStateElementSummary {
  readonly name: string;
  readonly rootNode: Node;
  readonly element: Element;          // a live reference to <wcs-state> (principle 4)
  readonly paths: {
    list: ReadonlySet<string>; element: ReadonlySet<string>;
    getter: ReadonlySet<string>; setter: ReadonlySet<string>;
  };
  readonly commandTokenNames: ReadonlySet<string>;
  readonly eventTokenNames: ReadonlySet<string>;
  readonly staticDependency: ReadonlyMap<string, readonly string[]>;
  readonly dynamicDependency: ReadonlyMap<string, readonly string[]>;
}
```

- `keys` returns the top-level keys excluding methods, anything starting with `$`, and keys containing a
  wildcard (that the typeof access used to detect a method runs a getter once is by design; a getter that
  throws out of context is treated as "the key exists"). Where IStateElementSummary's paths hold only paths
  that have been bound, this takes every declared data surface as its origin.
- `read` / `write` go through `stateElement.createState("readonly" | "writable", cb)`. So **a write travels the
  ordinary reactive pipeline (set trap → enqueue → drain)**, which makes an edit from DevTools follow exactly
  the same path as a set from user code (no separate path is built).
- On the side effects of `read`: a get on the readonly proxy does not pollute the dependency graph as long as
  it is outside a dependency-tracking scope (a call that is neither during binding application nor inside
  `$updatedCallback`). During implementation, re-confirm the conditions under which `trackDependency` fires,
  and if a polluting path is found, switch to the internal plain-read API (calling `getByAddress` directly)
  (implementation gate G-R, §9).
- Reading a wildcard path is made concrete with `indexes` (the same semantics as `$resolve`).

## 4. Instrumentation points on the state side (the hooks v1 adds)

The files changed and the firing points. All go through §2's `sink` and conform to principle 1.

### 4.1 Make the state element registry enumerable

- Keep the WeakMap in [stateElementByName.ts](../packages/state/src/stateElementByName.ts) and
  **add a parallel `Set<IStateElement>` (module-local)**. Add on register, delete on unregister
  (`State.ts`'s disconnectedCallback → `setStateElementByName(…, null)`).
- This is the one always-on ledger (the explicit exception to principle 2). Its size is bounded by the number
  of `<wcs-state>` elements and entries are always deleted on disconnect, so it cannot leak. It is the substance
  of `getStateElements()`.
- Events: `state:element-registered` / `state:element-unregistered`,
  payload = `{ name, rootNode, element }`.

### 4.2 The write log

- Fires in [setByAddress.ts](../packages/state/src/proxy/methods/setByAddress.ts) **after** the same-value guard
  (actual writes only).
- payload = `{ stateName, path, listIndexes: number[] | null, value, oldValue? }`.
  `oldValue` is included only where the guard already obtained it (a primitive with the guard on).
  It MUST NOT perform an extra get for reference types (protecting the hot path).
- The swap path (`_setByAddressWithSwap`) goes through the same point, so it needs no separate handling.

### 4.3 The update batch (drain)

- Uses the existing `registerUpdateBatchListener` in [updater.ts](../packages/state/src/updater/updater.ts)
  as-is. **Zero runtime changes.**
- The bridge registers on attach and unregisters on detach (hanging off it as a consumer of the same standing
  as the `$streams` listener).
- Event: `state:update-batch`, payload = `{ addresses: ReadonlySet<IAbsoluteStateAddress> }`.

### 4.4 Growth and shrinkage of the binding ledger

- Firing points go into `addBindingByAbsoluteStateAddress` / `removeBindingByAbsoluteStateAddress` /
  `clearBindingSetByAbsoluteStateAddress` in
  [getBindingSetByAbsoluteStateAddress.ts](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts).
- Events: `state:binding-added` / `state:binding-removed`,
  payload = `{ absoluteAddress, binding /* a live IBindingInfo reference */ }`.
  Clear is `state:binding-cleared`, `{ absoluteAddress }`.
- The devtools side builds the node⇔binding⇔path ledger from these. **The runtime holds no ledger.**

### 4.5 Token emission (command / event)

- Thinly override `emit` in [CommandToken.ts](../packages/state/src/command/CommandToken.ts) and
  [EventToken.ts](../packages/state/src/event/EventToken.ts) (`sink && sink(...)` → `super.emit(...)`).
- A token does not know its own stateElement, so owner information `{ stateName }` is added to the constructor
  as an **internal optional argument**, passed in by the registry (`getOrCreateCommandToken` and friends).
  The external protocol specs (command-token-protocol / event-token-protocol) are unchanged.
- Event: `state:token-emit`,
  payload = `{ kind: "command" | "event", stateName, tokenName, args: unknown[], subscriberCount }`.
  An emit with `subscriberCount === 0` flows through as-is, as a "blank shot" — the point being to make the
  pre-whenDefined blank-shot command race that raf ran into **visible on the timeline**.

### 4.6 Instrumentation v1 does not do

- Tracing gets (reads): an order of magnitude more volume, straight into the hot path. Not doing it.
- Events for dynamic changes in the dependency graph: pull suffices (`IStateElementSummary.staticDependency`
  and the rest).
- `$streams`: status/error ride on 4.2/4.3 **as ordinary paths** through `$streamStatus.*` and the like, so no
  dedicated event is needed (reusing the reactive exposure that is already designed).

## 5. Several sources, and excluding oneself

- Where a page has several copies of state (the accident of mixing CDN `.`/`.dom` entries, or a copy that
  devtools itself brings in) → each is its own source. The UI shows tabs/filters per source.
- **Excluding oneself**: devtools knows the sourceId of the runtime its own UI uses — catching the register of
  the module it imported through `onSourceRegistered` is ambiguous once the same version has been deduped.
  As a reliable mechanism, rather than an implicit marker such as
  `globalThis.__WCSTACK_DEVTOOLS_IGNORE_NEXT__` set **before** registration, the
  **reserved state-name prefix `"wcs-devtools"`** is made normative:
  - the name of a `<wcs-state>` that devtools creates MUST begin with `wcs-devtools*`
  - the UI excludes elements, addresses, and events with that prefix from display by default
  - as a second net, it also tests whether `rootNode` is contained under the `<wcs-devtools>` ShadowRoot

## 6. How far late attachment works (an explicit limitation)

The information available at attach time splits into two layers. **The difference is by design, and is surfaced in the UI.**

| Information | Loaded first | Attached late |
|---|---|---|
| the element list, the state tree, reading and writing values | ✓ | ✓ (4.1's registry plus pull) |
| the update batch / write / token timeline | ✓ | ✓ (from attach onward only) |
| **the binding ledger (internal objects)** | ✓ (accumulated from 4.4's events) | ✗ — the past cannot be reconstructed |
| the declared wiring view (the element⇔path correspondence) | ✓ | ✓ (substituted by **re-scanning the DOM**) |

- Why it cannot be reconstructed: the cache of the binding ledger's key `IAbsoluteStateAddress` is a two-level
  WeakMap in [AbsoluteStateAddress.ts:5](../packages/state/src/address/AbsoluteStateAddress.ts#L5) and is
  **not enumerable**. Making it enumerable would change GC lifetimes, so that is rejected.
- The substitute, re-scanning the DOM: `data-wcs` attributes and `<!--wcs-*-->` comments remain in the DOM after
  bindings are built, so the devtools side can assemble a **declaration-level wiring view** with the equivalent
  of `bindTextParser` (or by importing that same parser). It is shown with a "declared" badge to distinguish it
  from entries originating in live bindings (details in tag-design §UI).
- The recommended path: on a late attach, the UI states that "a full live wiring view needs a reload" and offers
  a one-click reload (`location.reload()` — devtools comes in through a `<script>`, so after the reload it is
  loaded first).

## 7. Cost verification gates (implementation acceptance criteria)

1. In the detached state, the measurements of `e2e/bench/jsfb-verify.mjs` (append / swap / clear / select) match
   the pre-instrumentation numbers within noise (the threshold for calling it a regression follows that driver's
   existing practice).
2. After attach → detach, no residual reference remains on the bridge side (sink nulled, the updater listener
   removed, the devtools-side ledger cleared). Preventing a repeat of the event-ledger leak.
3. The registry of 4.1 reliably shrinks on disconnect (a test adding and removing elements in a round trip).

## 8. The signals reservation (handover to Phase 2)

- `IDevtoolsSource.kind: "signals"` and the event namespace `signals:*` are reserved.
- Why it is deferred (the grounds for keeping it out of v1): a signal / computed / effect is **anonymous**, and
  without designing an identifier API (`signal(v, { name })` or similar) on the signals side first, the display
  reads "Signal #47" and is worthless. Since it entails a change to the API surface, it is an independent design
  decision (connecting to the [signals-migration-plan.md](signals-migration-plan.md) (ja) line).
- The expected correspondence when signals implements it: source pull = the list of root signals (the owner
  tree); push = write / recompute / effect-run. Independent of `dev.ts`'s `__WCS_DEV__`
  (dev.ts = warnings, hook = inspection; the two are not merged).

## 9. Open gates

- **G-R (side effects of read)**: verifying at implementation time that §3's readonly read pollutes neither the
  dependency graph nor the cache. Where it does, switch to reading `getByAddress` directly.
- **G-P (the granularity of binding events)**: a bulk list update makes binding-added/removed fire in bursts.
  Whether the devtools-side ring buffer can absorb it, or the bridge needs microtask aggregation, is decided by
  benchmark at implementation time (passing straight through is the default; aggregation is deferred as it adds
  complexity).
