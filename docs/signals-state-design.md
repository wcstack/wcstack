# Design note: signals-based lightweight state management (`@wcstack/signals`)

- **Status**: **implementation complete (2026-06-16, v1.13.1)**. This implementation completed Phases 0-4 along [signals-migration-plan.md](signals-migration-plan.md) (ja) (productionizing the packaging / bindNode's three surfaces / hardening h plus For and Index / resource × node cancel). All that remains is the release operation (`npm publish`). This document is the working-through of the design questions and the record of what was settled; §8 is the PoC result and §9 the record of the move to a real implementation. For the settled norms and API, see each README and the migration plan.
- **Scope**: a new package on a separate track that does **not replace** `@wcstack/state`. It puts signals at the reactivity engine and takes async I/O nodes (the wc-bindable-protocol tags) in as resources — a lighter, JS-first state management closer to the standards.
- **In one line**: it discards "the `data-wcs` DSL plus path addressing" and exposes `Signal.State` / `Signal.Computed` directly. Cell-based rather than a reactive proxy. An async I/O node plugs straight in through one signal adapter.
- **Prior assets**: the wc-bindable protocol (properties / commands / event-token), [[command-token-protocol]] / [[event-token-protocol]], the microtask coalescing of spread/fetch, [[state-stream-type-design]] (which shares the async-fold questions), [[watch-hook-design]].
- **How the idea arose**: from the question "could state be rebuilt on signals". The investigation led to a reframing: **going to signals is not a replacement of state but a new, separate track**, and the value lies not in swapping the reactivity engine but in "discarding the DSL and exposing signals directly".
- **日本語版**: [signals-state-design.ja.md](signals-state-design.ja.md)

---

## 0. The premise: why state is not "replaced"

The weight of `@wcstack/state` is not the reactive proxy. Looking at the source layout, most of the core is:

- `address/` — path-based addressing (the `a.b.*.c` string paths, wildcards, `AbsoluteStateAddress`)
- `bindTextParser/` plus `binding/` plus `bindings/` — the `data-wcs` DSL parser and the binding lifecycle
- `list/` — array diffing, `loopContext`, wildcard indices
- `dependency/` — tracking the path dependency graph

**What signals would replace is only `proxy/` plus `dependency/`.** Swapping just the reactivity engine for signals while keeping the DSL and path addressing does not make it lighter (it makes it worse, in fact, by losing the proxy's automatic deep tracking).

So the essence of a "lightweight version" is not *swapping the reactivity engine* but **discarding the binding layer and letting JS touch signals directly**. That is a different philosophy from state's, so it is designed as **a separate track coexisting with it**, not as a replacement.

| | `@wcstack/state` (today) | **`@wcstack/signals` (this proposal)** |
|---|---|---|
| Philosophy | HTML-declarative, DSL-driven | JS-first, programmable, lightweight |
| Reactivity | a bespoke proxy plus path dependency tracking | `Signal.State` / `Signal.Computed` (cell-based) |
| Deep reactivity | automatic through paths (`a.b.c`) | per cell (wrap explicitly where needed) |
| Binding | the `data-wcs` string DSL | direct signal references / a tiny template expression |
| Standards alignment | a bespoke implementation | follows the TC39 Signals proposal (with the cost in §4) |
| Async I/O | command/event-token plus spread | takes the same nodes in as resources (signals) |

---

## 1. The shape of the primitives (draft)

It takes the shape of TC39 Signals (`Signal.State` / `Signal.Computed` / `Signal.subtle.Watcher`) as-is, and adds **a resource that turns an async I/O node into a signal**.

```js
import { state, computed, resource, effect } from '@wcstack/signals';

// a synchronous cell
const count = state(0);
const doubled = computed(() => count.get() * 2);

// take an async I/O node in as a signal (§3)
const user = resource(
  () => fetchNode,                 // a wc-bindable async I/O node, or an async source
  { args: () => ({ id: id.get() }) } // re-fetch when a dependency changes (cancel/restart)
);
// user.value / user.loading / user.error are signals

effect(() => {
  document.querySelector('#n').textContent = String(doubled.get());
});
```

- `state` / `computed` are thin wrappers over the TC39 proposal (or pass-throughs).
- `resource` is where this package's value lies. It folds an async source into a signal triad of `{ value, loading, error }` (the same shape as fetch's triad, and continuous with the fold of [[state-stream-type-design]]).
- For consuming a continuous flow (a stream), a `streamResource` (latest / reduce) holding a fold above `resource` is considered later. That corresponds to a signals version of the state-side `$streams` proposal ([[state-stream-type-design]]).

---

## 2. What a signal actually is — a polyfill or our own (the most important question, the philosophical core) ★

The cost of "close to the standards". **TC39 Signals is Stage 1: not yet a standard, and dependent on a polyfill.** That is in direct tension with wcstack's zero-dependency principle.

| Option | Advantages | Disadvantages |
|---|---|---|
| A. depend on `signal-polyfill` | faithful to the proposed API; removable once native arrives | **a runtime dependency enters** (violating the zero-dependency principle) |
| B. our own tiny signal | keeps zero dependencies; writable in a few hundred lines | risk of API drift from the proposal; maintained ourselves |
| C. our own, but API-compatible with the proposal | zero dependencies plus swappable for the polyfill/native later | medium implementation cost; needs the equivalent of `subtle.Watcher` too |

**C is recommended.** Keep a tiny in-house implementation of just `State` / `Computed` / dependency tracking / `Watcher` (glitch-free recomputation and batching), matched to the proposal's API signatures, structured so it can be swapped once a native implementation arrives. It is the only line that satisfies both zero dependencies and "standards-first".

> This goes straight to the package's reason for existing. As long as it calls itself standards-first, the API leans on the TC39 proposal while carrying no dependency. If that consistency breaks, half the appeal of this proposal (lightweight, standard, zero-dep) goes with it.

---

## 3. Interoperation with async I/O nodes — already solved

The biggest tailwind for this proposal. The existing async I/O nodes (wcs-fetch / wcs-geo / wcs-broadcast / wcs-sse, …) speak **wc-bindable-protocol (properties / commands / event-token)** and **do not know whether a proxy or a signal is behind them**. So interposing one *protocol ⇄ signal adapter* in the signals core makes the existing nodes plug straight in.

### 3-1. Mapping the three surfaces onto signals

| Direction | The protocol surface | The signals side |
|---|---|---|
| element → state | a property (getter / value snapshot) | **a read signal** (pushing property changes into a `state` cell) |
| element → state | event-token (repeated notification) | **a signal folding the events** (updated per emit; the stream family) |
| state → element | command-token (start/cancel/abort, …) | emitted on a signal's value change, or by an explicit `command()` call |
| state → element | a property (write-back / input) | an effect from signal → element property |

### 3-2. The adapter's responsibilities

- Subscribe to the node's properties and reflect changes into a signal (element → signal).
- Subscribe to a signal and reflect changes into the node's property (signal → element). Preventing an infinite loop in both directions is the same-value guard (a norm already demonstrated in [[notification-tag-design]] and others).
- event-token updates a signal per emit (latest) or folds (reduce).
- **Idempotence**: it has to be re-evaluable when the binding is re-established. A live stream handle never becomes a signal's value (inheriting the norm of [[state-stream-type-design]] §7 as-is).

### 3-3. The consequence

The async I/O nodes become **a shared asset between the state track and the signals track**. There is no need to build the tags twice, and the separation of "I/O is a node, reactivity is the core" pays off on both tracks. It is also good evidence for wcstack's architecture as a whole (the separation of I/O nodes from state).

### 3-4. A design principle: complexity lives in async — so isolate it at a seam ★

The separation in §3 is not merely an implementation convenience; it is stated here as **a design principle that forms wcstack's backbone**.

**The premise: complexity lives in the product of async × reactivity × lifecycle.** Purely synchronous state management is essentially "when a value changes, update what depends on it" — not that hard. The difficulty leaps the moment async invades the reactive model, and the hardest features of existing frameworks (React's `useEffect` races / Suspense / tearing under concurrent rendering, Vue's async setup / `<Suspense>`, Svelte's `{#await}`) are **almost all the price of async being swallowed by the lifecycle**. The same four traps recur in every framework:

1. **Races / staleness** — fire A then B, and if A arrives last it must not overwrite B
2. **Cancellation** — nothing does it automatically by default (an AbortController wired by hand every time)
3. **Ordering (switchMap)** — "keep only the latest"; naive code gets it wrong almost always
4. **The loading/error/success state machine** duplicated everywhere (precisely why react-query / SWR / Suspense exist)

**The principle: this complexity cannot be deleted. All you can choose is where to put it.** Most existing frameworks mixed it **into** the render / reactive model, so the four traps **spread thinly across every component** (the responsibility for writing each effect correctly lands on the user). wcstack's bet is to **isolate async at the wc-bindable plus bindNode boundary**. The core stays "a purely synchronous function that knows nothing of Promises" (`bindNode`'s internals are `addEventListener` and nothing awaited), and races, cancellation, switchMap, and loading state are solved **once, inside a node (or a `resource`)**. None of it leaks into user code.

**The precise meaning of "lightweight" splits along two axes.** Conflating them makes the slogan brittle:

- **(1) The lightness of the core (the framework itself) → clearly holds.** The core has a small API surface (signal/computed/effect/h), is provably simple (both testing and debugging close synchronously), is swappable for TC39 signals (standardization is impossible once async is involved), and an app that uses no async closes with the core alone (import no fetch and there is zero byte of async code).
- **(2) The total byte count of the app → holds only partly.** An app that uses async ends up loading FetchCore and the rest, so **the total bytes shipped barely change**. What changes is how you pay: it becomes **pay-as-you-go**. The complexity of async **does not vanish; it moves into the nodes**.

**The honest cost (making it a node is not free).** As the price of lightness, complexity surfaces elsewhere: (a) the overhead of the seam that expresses every async capability as "a custom element with properties/events/commands" (wrapping something as small as a debounce in a DOM node is in some ways heavier than a function); (b) the complexity of composition moves into the binding layer (token / spread wiring); (c) **cross-cutting async** such as a global request interceptor or an auth refresh is awkward; (d) the core cannot be purified completely either (`resource`/`streamResource` stay in the core for ergonomics, and the hardest problem of §5-2 sits next to the core even after moving to a node).

**The refined thesis (the form this project endorses):**

> **Isolating async into nodes keeps the reactive core purely synchronous and provably simple, and makes async pay-as-you-go. Total complexity does not decrease, but it moves from "spread thinly across every component" to "concentrated in a few explicit seams", which raises reuse and verifiability.**

That form contradicts neither the implementation (bindNode is synchronous; async is a separate package) nor the stance of admitting §5-2 as the hardest problem — unlike the one-line slogan "the framework gets lighter". As a slogan in the README, use only the first half (the core is purely synchronous); as a design principle, keep the second half (isolation = reuse) too.

---

## 4. The binding layer — what replaces the discarded DSL

Discarding state's `data-wcs` DSL is the point of this proposal. A replacement has to be decided.

| Option | Form | Assessment |
|---|---|---|
| 1. effects written directly | `effect(() => el.textContent = sig.get())` | the lightest and most standard. But zero declarativeness (imperative) |
| 2. a tiny template expression | a tagged template such as `` html`${doubled}` `` | declarative. But **it cannot be JSX's compilation target** (§4-1). And it carries a separate template engine |
| 3. signal-aware web component attributes | something like `<x-counter .value=${sig}>` | good fit with wc-bindable. But it needs a binding layer after all |
| 4. fine-grained hyperscript | `h(tag, props, ...children)` plus `Fragment` | **it can be JSX's compilation target** (§4-1). Real DOM created once, with effects updating only the signal props |

**Recommendation: option 1 as the foundation, with a thin option 4 on top where needed.** This proposal's customer is "the JS-first user who dislikes DSLs", so ship first the minimal form that works with `effect` plus direct signal references. Building a thick template DSL would erase the differentiation from state (the weight was the DSL, so that would defeat the purpose).

> The dividing line: if you want declarative binding, use state. The signals track coexists with state as a lightweight, imperative-leaning layer where "you assemble signals in JS and update the DOM with effects".

### 4-1. Design JSX as a seam "you could put it on, but we do not"

The template layer is designed on the policy of **"assume JSX could ride on it later, but actually stop just short"**.

**Why `h` rather than a tagged template.** Under standard transforms, JSX **only ever compiles to a function call** (classic `h(type, props, ...children)` / automatic `jsx(type, props)`). An `html\`...\`` template literal cannot be JSX's compilation target. So for "a foundation JSX can ride on" to really hold, the template layer has to be **hyperscript (the jsx-factory shape)**. That is the reason for the switch from option 2 to option 4.

**Coexisting with buildless.** JSX requires transpilation and contradicts the buildless principle, so JSX itself cannot be the blessed path. But `h(...)` can be called directly with no build. Hence:

- **What ships is `h` / `Fragment` (i.e. the foundation JSX can ride on) and no further.**
- **JSX is opt-in through the user's own tsconfig (`jsxImportSource` / `jsxFactory`).** Only where the user chooses JSX do they leave buildless — their choice. The package stays zero-config.

That is the precise implementation of "assume it, stop just short".

**Three disciplines that make it hold:**

1. **Fixed as fine-grained (never a VDOM).** `h` creates real DOM once and updates **only** the props passed as a signal or function, through effects (the Solid style). Carrying a VDOM plus reconciler would erase the reason for existing, "lightweight".
2. **Exactly one forward-looking concession: reactive children.** `h` accepts a function or signal as a child (`() => cond.get() ? A : B`). That is the foundation for conditional and list control flow, and a JSX expression compiles down to that thunk. **No other JSX semantics (key / ref / context / controlled input) enters the contract for now** — that is the discipline of "stopping short".
3. **Keep the seam honest.** Not shipping JSX means: no `.tsx` in the package, no jsx-runtime types for now, no examples requiring transpilation. `h`'s contract stays as minimal as buildless usage demands.

**Where the layers live:**

- `reactive.ts` stays pure (DOM-independent).
- The DOM layer is a separate entry (`@wcstack/signals/dom` and the like) holding `h` / `Fragment`.
- A future JSX runtime is **a separate entry seam** at `@wcstack/signals/jsx-runtime` (vacant for now).

**Scope stages**: (a) the substrate only / (b) up to `h`+`Fragment` / (c) up to a jsx-runtime entry — **(b) is recommended**. "The shape JSX can ride on, without shipping JSX" is the sweet spot. It is the same shape as wcstack's design philosophy of making wc-bindable a framework-agnostic seam (a protocol seam).

---

## 5. The questions to settle (in order of importance)

### 5-1. What a signal is (§2) ★ — depending on the polyfill versus a compatible in-house implementation. The philosophical core. Settled first.

### 5-2. The cancel / restart of an async resource ★ — **the same hardest problem** as [[state-stream-type-design]] §4-1

Where a `resource`'s source depends on other signals, a dependency change aborts the old fetch and re-establishes it (the equivalent of switchMap).

- Fire the old fetch's AbortSignal → reset to `initial` (or retain the previous value — to be decided) → start the new source.
- It is about **extending a computed's dependency tracking to an async lifetime**. Without purity, "an old response mixes into the new state" and "aborts leak".
- **The design can be shared with the state-side `$streams`.** Using the same cancel/restart semantics on both tracks would unify the implementation and the norms. This should be **worked out jointly** with the state-stream proposal.

### 5-3. Coalescing (re-entry and performance)

With high-frequency updates (fast tokens, 60fps), running an effect per chunk thrashes. Apply the **microtask coalescing** already introduced in spread/fetch to the Watcher's batching, folding several updates within one tick into a single DOM application. Keep it consistent with TC39 Signals' Watcher semantics (notification is synchronous, recomputation deferred).

### 5-4. Handling deep reactivity

Being cell-based, there is no automatic tracking of `obj.a.b`.

- Recommended: **make the user design the signal granularity explicitly** (one signal for the whole object, or individual signals for the fields that need them). If you want deep tracking through a proxy, use state — that is the division.
- Room is left to add a shallow proxy wrapper later as an option (`reactive(obj)` making the first level signals), but not supporting it in the first stage is recommended (favouring lightness).

### 5-5. Lifecycle and disposal

- When `effect` / `resource` unsubscribe. Tying into a web component's `disconnectedCallback` is needed.
- `resource` lazy (starting on the first `.get()`) versus eager. Lazy is recommended, but reconciling it with the need to connect ahead of time is the same question as [[state-stream-type-design]] §4-1.

### 5-6. SSR / hydration

- state initializes from inline JSON or a script. The route for supplying initial values on the signals track (attribute / script / import) has to be decided. One option for the first stage is to settle on a JS import.

---

## 6. Assessing the value

- It could become **the purest implementation of "standards-first"**. Leaning the API on the TC39 proposal, structured so the polyfill can be dropped once native arrives, is the ideal form of wcstack's philosophy.
- It **demonstrates the separation of I/O nodes from reactivity at the architectural level**. The same async I/O nodes drive both the state track and the signals track = "I/O is a node, state is the core" proven on two tracks.
- **The customer is different.** state is for the HTML-declarative crowd, signals for the JS-first crowd. They do not cannibalize; they widen the pie.
- **The risk concentrates in two places**: (a) the philosophical judgment about what a signal is (§2), and (b) the cancel/restart of an async resource (§5-2). The latter is shared with the state-stream proposal, so **working it out jointly avoids paying twice**.
- **A nail against over-expectation**: a thick binding DSL would make it a worse copy of state. Being resolutely lightweight and imperative-leaning is the reason for existing (§4).

---

## 7. The recommended scope and the next stage

- **A strict scope**: not "a second declarative framework with a DSL" but limited to **"signals (TC39-compatible, in-house) plus an async I/O node resource adapter plus effect binding"**. Customers who want declarative binding are sent to state.
- **Options for the next stage**:
  1. Work the SPEC out further (in particular settling §2's policy on what a signal is and §5-2's cancel/restart, jointly with the state-stream proposal).
  2. A minimal PoC: write one tiny in-house signal (state/computed/effect/watcher) plus a `resource`, feed the existing wcs-fetch in as a resource, and carry it through to a DOM update. Verify the update cycle, aborts, and coalescing on real hardware before fixing the SPEC.
- Since it is a new core, the fastest way to kill the biggest uncertainty is confirming in a PoC whether "an async I/O node really does plug in through one adapter".

---

## 8. PoC implementation results (2026-06-14)

A minimal implementation as `packages/signals/` (`@wcstack/signals` v0.0.0, unreleased). **It demonstrated the biggest uncertainty — "does an async I/O node really plug in through one adapter" (§3).**

- **The layout**:
  - `src/reactive.ts` — a tiny in-house signal (`signal` / `computed` / `effect` / `flushSync`). Push-on-change / pull-on-read, deferred computeds, re-tracking of dynamic dependencies, microtask coalescing for effects (§5-3). Zero-dependency (implementing §2's option C in the field).
  - `src/resource.ts` — folds an async producer into a `{ value, loading, error }` triad. On an `args` change it **aborts and re-establishes (switchMap)**, preventing stale responses from slipping through (§5-2 implemented on both the success and error paths).
  - `src/bindNode.ts` — a thin adapter mapping a wc-bindable descriptor's properties into signals through event subscription, its inputs into `set`, and its commands into `command` (§3).
- **The demonstration (the most important part)**: `__tests__/integration.fetchCore.test.ts` feeds **an unmodified real `FetchCore`** (packages/fetch) through `bindNode` and confirms (1) a successful response → signal → **reaching a DOM update** through `effect`, (2) an HTTP error reflected into the error/status signals, and (3) wrapping FetchCore in a `resource` so that an `args` change aborts the previous request and re-establishes it. **FetchCore worked without ever knowing a signal was behind it** — the separation of "I/O is a node, reactivity is the core" holding in the field.
- **Quality**: 39 tests, coverage 100/100/100/100. `npm run build` (tsc plus rollup with 3 outputs) and `npm run lint` clean.
- **Updates to the design judgments**:
  - §2 (what a signal is) — a tiny in-house implementation holds in a few hundred lines, with the API leaned onto the TC39 shape. **Evidence supporting option C.** Short-circuiting propagation on value equality in `computed` is unimplemented in the PoC (over-execution accepted). A consideration for the second stage.
  - §5-2 (cancel/restart) — it works as a resource. But FetchCore does not take an external AbortSignal and depends on its internal `abort()`, so the PoC interposed a `sig→core.abort()` bridge. **It would be more natural if the node side accepted an external signal.** It remains a question to work out jointly with the state-stream proposal.
  - §4 (the binding layer) — `effect` plus direct signal references carried it through to DOM updates perfectly well. No DSL needed, confirmed in the field. The fine-grained `h` of §4-1 was implemented too (below).
- **The fine-grained `h` of §4-1 was implemented too**: `src/dom.ts` (a separate `@wcstack/signals/dom` entry, a `./dom` export in package.json, rollup made two-entry). `h(tag, props, ...children)` plus `Fragment` plus `render`. Real DOM created once, with `effect` updating only the props and children passed as a function or signal (no VDOM, no reconciler). Reactive children remove and insert through an anchor-comment scheme (supporting conditionals and lists). JSX has the shape to ride on it through the classic factory (`jsxFactory:"h"`) but **is not shipped** (no `.tsx`, no jsx-runtime types) — expressing "stop just short" in the implementation.
  - **An integration demonstration**: the signals from a real FetchCore → `bindNode` were carried straight into DOM construction with `h` (conditional rendering on the loading toggle plus rendering an array into `<li>`s). signals / resource / bindNode / h working end to end.
- **(d) ownership and lifecycle implemented [resolved]**: an owner tree was added to the reactive core (the Solid model). An `effect` **owns** the child effects and cleanups created during its own run, disposing them in LIFO order on re-run and on dispose. `createRoot(fn)` (a detached scope whose dispose handle the caller holds) and `onCleanup(fn)` are exposed. The `h` side benefits with minimal change: because the effect for a reactive child owns that subtree's prop and child effects, **rebuilding the subtree reliably disposes the previous inner effects** (the leak fix confirmed by a field test). Event listeners are removed with `onCleanup` too. An app mounts under `createRoot` and `dispose()` stops all reactivity = **the foundation for tying into a custom element's disconnectedCallback**. Owner and observer (dependency tracking) were kept orthogonal, so tracking is unaffected. 70 tests, 100/100/100/100.
- **(e) the connect/disconnect wiring on a real Shell implemented [resolved]**: `SignalsElement` (`@wcstack/signals/dom`, an abstract base). `connectedCallback` mounts `render()` under a `createRoot`; `disconnectedCallback` disposes the root and clears the mountPoint. Reconnection re-mounts freshly (the signal instances are kept), and a double connect is a no-op. That **connects the reactive tree to the real DOM lifecycle**: every effect / resource / listener created inside `render()` is destroyed when the element leaves. `resource` was tied into `onCleanup` too, so disposing the owner aborts anything in flight. **A full-stack demonstration**: a `SignalsElement` starts a `resource` (a real FetchCore) on connect → renders loading and the list with `h`; `el.remove()` disposes the root → the resource aborts → `core.abort()` → fetch's AbortSignal is aborted. Confirmed. 78 tests, 100/100/100/100.
- **(a) `streamResource` implemented [resolved]**: `src/streamResource.ts`. It **folds an async iterable / ReadableStream / async generator into a single signal** (latest by default; reduce requires `initial`). An `args` change aborts, resets to `initial`, and restarts (switchMap), with a `signal.aborted` check applying stale-drop on every path (chunk / completion / throw). A status companion of `"idle"|"active"|"done"|"error"` plus error. A ReadableStream falls back to `getReader()` where `Symbol.asyncIterator` is absent. Backpressure is given up (the fold result is the buffer). Tied into `onCleanup`, so disposing the owner aborts. 9 tests added, for 87 tests at 100/100/100/100.
  - **A joint verification with state's `$streams`**: this is the signals-side implementation of [[state-stream-type-design]]. The PoC settled that proposal's open questions (restart = reset value to initial / error = retain the previous value / fold default = latest / source = async iterable plus getReader / the status shape). Details in state-stream-type-design.md §8. The remaining state-specific difficulty converges on one point: "putting path-dependency-driven cancel/restart onto a proxy computed".
- **(c) short-circuiting propagation on computed value equality implemented [resolved]**: the reactive core was replaced, from push-dirty plus lazy recomputation to **three-colour marking (CLEAN/CHECK/DIRTY, the Reactively / Solid family)**. A signal write marks its direct observers DIRTY and transitive observers CHECK, and `updateIfNecessary` pull-validates a CHECK node by "refreshing the computed sources first, then verifying whether it really changed". **A computed that recomputes to an equal value does not raise its observers to DIRTY**, so downstream effects and computeds skip. A custom `equals` was added to computed too (the first computation is not compared, protected by `_initialized`). Effect re-runs are now tied to actual value changes (eliminating wasted runs). Owner, coalescing, and dynamic dependencies are unchanged. Every existing test held, plus 4 short-circuit tests, for 91 tests at 100/100/100/100.
- **(b) an example with real tags plus an import map created [resolved]**: `examples/signals-live-search/` (index.html / server.js / README ja and en). A real `<wcs-fetch>` (CDN `@wcstack/fetch/auto`) turned into signals through `bindNode`: the `query` signal → setting the url → an automatic fetch → folding back into signals → rendering the list with `h`. Plus a `<signal-counter>` extending `SignalsElement`, presenting pure signals plus the lifecycle. The server serves the unpublished signals dist through an import map. **A packaging discovery**: the build currently makes the index and dom entries independent bundles, each embedding reactive, so **importing both entries buildless duplicates the reactive core** (the module global — the tracking context — being per bundle) and reactivity breaks. As a countermeasure, `/dom` was made a browser superset (re-exporting the core) and the example imports from a single entry. **Productionizing needs code splitting that makes reactive a shared chunk** (the PoC inlines it) = a new next stage.
- **The remaining next stage**: (f) production packaging (rollup code splitting to make reactive a shared chunk, so a mix of index and dom still resolves to a single core). The PoC's functional core is all in place.

### Known behavior (out of v1 scope, normative)

- **A `computed` after its owner is disposed returns a stale value.** Once the enclosing scope (a `createRoot` or a parent effect) is disposed, the `computed` is `untrack`ed from its sources and is thereafter CLEAN with no sources, so a source change never re-dirties it and **it keeps returning its last value** (the same kind of behavior as the Solid family). Referring to a `computed` after disposal is **undefined behavior** and is not rescued in v1. To keep reading a signal from a disposed scope, hold that signal in another scope.

---

## 9. Taking stock of the work to move from PoC to a real implementation (2026-06-16)

The PoC's functional core (reactive / resource / streamResource / bindNode / h / SignalsElement) is all in place. From here, the work needed to turn "an unreleased PoC" into "a shippable implementation" is inventoried in priority order (**P0 blockers → P1 missing features → P2 finishing**).

### 9-1. P0 — shipping blockers

#### (1) packaging: resolving the duplicated reactive core [the one essential blocker, §8 (f)]
`rollup.config.js` currently emits `index` and `dom` as **independent bundles**, each inlining `reactive.ts`. Importing both entries buildless (through an import map) makes **the tracking context (a module global) separate per bundle** and reactivity breaks.

- The current avoidance — "make `/dom` a superset re-exporting the core, and have the example import from a single entry" — is **an operational workaround** and nothing more.
- Productionizing requires **code splitting** in rollup (`manualChunks` / a shared chunk, or `preserveModules`) to carve `reactive` into a single chunk, so that a mix of `index` and `dom` imports resolves to **a single core**.
- Along with that, the `dom` entry has no `.esm.min.js` output (only index generates a min) → the output symmetry needs fixing too.

#### (2) version and release housekeeping
- Update `package.json`'s `version: "0.0.0"` and `description` ("PoC"). Per [[feedback_version_alignment]], **align the version with** state/fetch/autoloader/router.
- Add it to the root README (the existing packages are listed; signals is not).

### 9-2. P1 — missing features (the parts the PoC "stopped short" of)

#### (3) bindNode does not map all three wc-bindable surfaces
`bindNode.ts` covers only **properties (a latest snapshot) plus inputs (`set`) plus commands (`command`)**. Against the table in §3-1, what is missing:
- **event-token (repeated notification) → a folded stream signal** (§3-1's second row). Everything is currently treated as a "latest value snapshot", with no route for folding per-emit. `streamResource` exists, but the glue from bindNode's event-token into a stream is unimplemented.
- **A writeback effect from signal → element property** (§3-2's "subscribe to a signal and reflect changes into the property"). There is currently only the imperative `set()`, with no automatic two-way reflection with a same-value guard.
- **command-token (a value change → emit)** (§3-1's third row). There is currently only the imperative `command()`.
- The descriptor type is **re-declared in-house** (`WcBindableDescriptor`) and risks **drifting** from the real `IWcBindable` (which has `protocol` / `version` / `async` / `attribute`). Importing the shared protocol type would be preferable.

#### (4) wiring resource's cancel/restart to a real node [§5-2, an open question]
FetchCore **does not take an external AbortSignal and depends on its internal `abort()`**, so the PoC interposed a `sig → core.abort()` bridge. For production, settle and generalize "the standard pattern for cancelling an I/O node with resource plus bindNode" (a bridge through the `abort` command). To be worked out jointly with [[state-stream-type-design]].

#### (5) production hardening of the DOM layer (h)
`dom.ts`'s `setProp` lists its own PoC limitations in a comment:
- No remapping between attribute and property names (`for`→`htmlFor`, `colspan`→`colSpan`).
- No guard against assigning to a read-only property (`key in el` is true for `firstChild` and the like too).
- No SVG namespace (`createElementNS`) support.
- **Reactive children render lists naively, deleting everything and re-inserting** (`insertReactive`) → resolved by the keyed list in 9-3.

### 9-3. The design for lists and keyed reconciliation (For / Index) ★

List rendering is carved out of P1 (5) as its own question. `insertReactive` currently does "delete everything, insert everything" whenever the array changes, rebuilding every row's DOM and disposing every row's effects even for a one-element change. A production live list needs **keyed reconciliation**.

**Conclusion: implementable. The hardest part is already solved in the PoC.**

- The essential difficulty of a keyed list is "**disposing each row's reactive scope correctly**". That is **already solved** by the owner tree (`createRoot` / `onCleanup` / `disposeOwned`, §8 (d)). The foundation exists for a row's effects / resources / listeners to be disposed in LIFO order when the row is removed.
- What remains is only "array diff → minimal DOM operations" = a mature algorithm (the equivalent of Solid's `mapArray` / `reconcileArrays`).

**Two helpers in the Solid style:**

| Helper | Key | Row recreation | Use |
|---|---|---|---|
| **`For`** | value identity (`===` by default, or an explicit `key` function) | add / move / remove only. A content change does not rebuild | arrays of objects (the main case, recommended) |
| **`Index`** | position (the index) | only when the array length changes. The item is passed to the row as a **signal** | arrays of primitives, where positions are stable |

How it looks:
```js
h('ul', null,
  For(() => items.get(), (item) =>
    h('li', null, () => item.name)   // the row is created once; a change to item.name updates fine-grained
  )
)
```

**What the implementation involves (about 150-250 lines plus tests, zero new dependencies):**

1. **Reuse the anchor scheme** — reserve the region with the existing anchor comments (the same positioning as `insertReactive`).
2. **A `createRoot` per row** — create each row under an independent owner. When a row goes, dispose its root → its inner effects reliably die.
3. **Reconcile** — hold a Map of old `key → {node, dispose}`, walk the new array and: a match → reuse the node / new → create the row under a `createRoot` / gone → dispose the root and remove the node / reordered → minimal movement with `insertBefore` (naive sequential inserts at first, optimized to two-ended / LIS later).
4. **The key strategy** — `===` on the value by default ([state's createListDiff](../packages/state/src/list/createListDiff.ts) is `===`-based too, with the idea of absorbing duplicate values through an index array). An explicit `key` option is also available.

**state's `createListDiff` is not reused.** That function is tightly coupled to `IListIndex` / `loopContext` / path addressing / a WeakMap cache keyed on the array reference, and does not fit signals' cell-based fine-grained model. **Only the thinking behind the algorithm (managing duplicate values with an indexByValue index array, aggregating add/delete/change) is taken as reference, and it is written afresh for signals.**

**The recommended order of attack:** get `For` (keyed, the practical main case) through first, with tests plus an example (making the list rendering in [signals-live-search](../examples/signals-live-search) keyed). Then `Index`.

### 9-4. P2 — finishing and settling

- **(6) Settling the public API (TC39 consistency)**: §1's samples write `state(0)` while the implementation is `signal()`. Settle the final public names (TC39 has `Signal.State` / `Signal.Computed`). Whether to expose `batch()` (an explicit batch) and `untrack()`, and whether to ship a `Watcher` equivalent for library integration.
- **(7) Strengthening the tests**: 91 tests at 100/100/100/100, but additions are needed for **the dual-entry single-core verification (packaging), event-token folding, signal→property writeback, SVG, attribute-name remapping, and For/Index reconciliation**. `streamResource` has no example.
- **(8) Settling the documentation**: this document still opens with "under design consideration" → now that the design judgments are in, **promote it to a SPEC** (the other packages use the SPEC.md form). Productionize the README ja/en. State honestly in the README what is out of v1 scope (**SSR/hydration §5-6, deep reactivity through a proxy §5-4, backpressure, and the parked leak from an AsyncIterable that does not cooperate with cancellation**).

### 9-5. The order of attack, summarized

| Priority | Item | Why |
|---|---|---|
| **P0-1** | rollup code splitting to make reactive a shared chunk | the one essential blocker. It breaks buildless |
| **P0-2** | version alignment plus the root README plus description | release housekeeping |
| **P1-3** | event-token / writeback / the shared type in bindNode | completing the three protocol surfaces = the reason for existing |
| **P1-4** | settling the resource × node cancel pattern | §5-2's one open question |
| **P1-5 / 9-3** | prop normalization in h and **For/Index keyed lists** | real-app durability. The owner is done; only the diff remains |
| **P2** | settling the API / more tests / promotion to a SPEC | finishing |

The two remaining big pieces are **"productionizing the packaging"** and **"bindNode's full protocol coverage"**. Lists and keys are reachable through the diff implementation alone, since the owner foundation is done.

---

## Related

- [[state-stream-type-design]] — shares the async fold, dependency-driven cancel-restart, and stream boundary rules. This proposal's `resource` / `streamResource` are the signals version of it. **To be worked out jointly.**
- [[watch-hook-design]] — state → observation (outward). On the signals track, effects take part of that role. The boundary needs sorting out.
- [[command-token-protocol]] / [[event-token-protocol]] — the foundation for interoperating with async I/O nodes (§3). The signal adapter maps those three surfaces onto signals.
- the wc-bindable protocol — the grounds on which an I/O node is independent of the reactivity implementation behind it. A premise for this proposal to hold.
