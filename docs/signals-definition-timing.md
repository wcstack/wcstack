# signals and custom element definition timing — constraints, idioms, and `mountNode`

- **Audience**: authors of apps that bind headless I/O nodes with `@wcstack/signals`, and implementers or reviewers touching signals' adapter layer (`bindNode` / `mountNode`)
- **Status**: descriptive (informative), plus an implementation record for `mountNode` (§5 is as-built). It touches none of the protocols (wc-bindable / command-token / event-token)
- **Why this exists**: `bindNode` is a synchronous API that presupposes "the class is registered by the moment you call it", and that presupposition was buried implicitly in a single line of a recipe (`await whenDefined`). It surfaced in an example implementation (signals-tilt-maze) in the form of "cannot degrade partially when a sensor package fails to load", so this document makes four things normative in one place: (1) the structural reason for the constraint, (2) the correct idiom per loading situation, (3) the design of the `mountNode` helper that makes it the standard form, and (4) the platform seam behind it all
- **See also**: [signals-state-design.md](./signals-state-design.md) (the origin of bindNode's design, §3), [defined-tag-design.md](./defined-tag-design.md) (ja) (`<wcs-defined>` = completing whenDefined's failure semantics), `packages/signals/README.md` (the authoritative user-facing reference for mountNode)
- **Date**: 2026-07-28
- **日本語版**: [signals-definition-timing.ja.md](./signals-definition-timing.ja.md)

---

## 0. TL;DR — the decision table from loading situation to idiom

| Loading situation | Idiom | Behavior when the load fails |
|---|---|---|
| the app loads a **required** node itself | `import "@wcstack/<pkg>/auto"` (a side-effect import) plus `mountNode(tag)` | the whole module graph fails to evaluate = **dies loudly** (correct) |
| the app loads an **optional** node itself | `import("@wcstack/<pkg>/auto").then(() => mountNode(tag)).catch(degrade)` | `import()` **rejects** = a failure boundary per package |
| binding to **a tag you do not load** (via autoloader, on a page mixed with state, someone else's script) | `bindNode(el)` after `await customElements.whenDefined(tag)`, or gate with `<wcs-defined>` | whenDefined **pends forever** (it never rejects) — where UX demands it, turn it into `missing` with `<wcs-defined>`'s timeout |
| using a pure logic node **from JS alone** (no need for an element, `:state()`, or state) | **Core directly**: `import { XxxCore }` plus `bindNode(new XxxCore())` (§3.4) | the import failure rules as-is (static = evaluation failure, dynamic = rejection). **No registry involvement = the definition timing problem does not exist** |

What the table implies: `whenDefined` is not "the first recommendation" but "a last resort exclusively for tags you do not load yourself". Where the app owns the node, put the ordering guarantee on **the module graph** (ES modules' evaluation-order guarantee) rather than on runtime coordination. And where the element itself is unnecessary, using Core directly (floor 3 of §3.4) makes the definition timing problem vanish.

---

## 1. The structure of the constraint — why `bindNode` cannot be called before definition

`bindNode(el)` is a synchronous API, contracted to return the adapters (`signals.*` / `set` / `command` / …) then and there. It reads the descriptor from `el.constructor.wcBindable` (the entry point of `packages/signals/src/bindNode.ts`), so **the precondition is that the custom element class is registered (the element upgraded) at call time**. The `constructor` of an element before upgrade is a plain `HTMLElement` with no descriptor, and it throws a generic error ("no wc-bindable descriptor").

This is an essential asymmetry with `data-wcs` in `@wcstack/state`:

- **The declarative layer (state) can wait** — a binding is data in an attribute, and the runtime interpreting it can defer the wiring until upgrade (command-token subscriptions are deferred until the tag is defined).
- **An imperative API (signals) cannot wait** — a synchronous API returning a value right now needs the descriptor right now.

So the constraint follows you everywhere as long as you use an I/O node **as an element** in signals (using Core directly without creating an element — floor 3 of §3.4 — is the legitimate escape outside this constraint). `nodeSource` requires **an already-constructed** `BoundNode` as its first argument (it does not call `bindNode` internally), so it inherits the same constraint from the upstream `bindNode` call. Passing a hand-written descriptor to `bindNode(el, descriptor)` makes binding before definition theoretically possible, but it duplicates the protocol declaration and is therefore not adopted as a standard idiom (it stays as an escape hatch for non-custom-element targets).

## 2. What the previous idioms actually were, and their failure semantics

Every use of `bindNode` in the repository (five files as of 2026-07-28) fell into one of two idioms:

| Idiom | Where | Happy path | When the CDN load fails |
|---|---|---|---|
| a static import in the same module → bindNode | examples/websocket-chat/signals, packages/fetch/examples/pagination/signals | the module graph guarantees evaluation order (no await needed) | the whole module graph fails to evaluate → the app never starts (an error does appear in the console) |
| `await customElements.whenDefined()` → bindNode | examples/signals-live-search, examples/signals-tilt-maze, README §3 | resolves immediately | **hangs forever, silently** (whenDefined never rejects, by spec) |

The problem as it surfaced (signals-tilt-maze): it did `await Promise.all(whenDefined×4)` for all four tags, so a single failing sensor package left the promise unresolved and **nothing in the app mounted at all, drag fallback included**. The signals version was carrying exactly the failure mode the state version (state-tilt-maze) had solved with `<wcs-defined timeout>`.

**Current state (resolved)**: the two demos in the table's second row have moved to the form in §3, and no use of `whenDefined` remains in the repository. signals-live-search took §3.1's `mountNode` (removing the tags from the HTML); signals-tilt-maze, following the comparison-demo exception of §4, kept its tags in the HTML and split them into "static import for required nodes only, §3.2's dynamic import for optional ones". Note that the granularity of that split is decided by **what is lost when that import fails**. During the migration of signals-tilt-maze, a first version that treated wakelock as "required" and put it in the static import once again blanked the whole page when a single decorative package failed on the CDN (a reintroduction of this section's failure mode). Only nodes without which the app does not exist belong in a static import.

An important distinction: **what solves the ordering problem is the static import, not createElement**. A static import plus tags in the HTML is also order-safe (elements already connected are upgraded synchronously at `define()`). What `mountNode` additionally removes is the remaining coupling — the very possibility of a parser-created tag existing before the definition, placing tags in the HTML, and the indirection of `getElementById`.

## 3. The recommended idioms (§0 expanded)

### 3.1 A required node: static import plus `mountNode`

```js
import "@wcstack/raf/auto";        // the definition — the module graph guarantees "defined after this line"
import { mountNode } from "@wcstack/signals/dom";

const loop = mountNode("wcs-raf");
```

Failure semantics: an import failure appears in the console immediately as a module graph evaluation failure. Without a required node (the game loop, say) the app does not exist, so dying **loudly**, all-or-nothing, is correct.

### 3.2 An optional node: dynamic import plus `mountNode`

```js
const tilt = signal(null);
import("@wcstack/tilt/auto")
  .then(() => tilt.set(mountNode("wcs-tilt")))
  .catch(() => {/* degraded mode — the app keeps running */});
```

Unlike `whenDefined`, `import()` **rejects on a load failure**, which gives true failure detection with no timeout heuristic. The per-package failure boundary becomes the design unit for partial degradation as-is.

Caveat: an `import()` rejection is at the mercy of the browser's network timeout and can take tens of seconds on a stalled connection. For a snappy requirement such as "release the degraded UI after 5 seconds", either add a timeout with `Promise.race` or, at that one point, combine it with `<wcs-defined>` (whose whole job is making the wait normative).

### 3.3 A tag you do not load: `whenDefined` / `<wcs-defined>`

Late registration through the autoloader, a tag someone else loads on a page where state and signals coexist, content injected at runtime — here an ordering guarantee through imports is structurally impossible, and a `whenDefined` (raced against `AbortSignal.timeout`) or a `<wcs-defined>` gate remains the only means.

### 3.4 Floor 3: using Core directly — creating no element

An I/O node is layered into Core (framework-agnostic logic) and Shell (the custom element), and **Core alone is a complete wc-bindable node**. The shape is uniform across every package (confirmed on DefinedCore / TiltCore / RafCore): `extends EventTarget`; `constructor(target?)` with `target ?? this` (dispatching to itself by default); carrying `static wcBindable`; observable properties as public getters. So `bindNode(new XxxCore())` resolves `core.constructor.wcBindable` **even with the descriptor omitted**, and reads the seed correctly. This is not a trick discovered after the fact but signals' founding demonstration — `packages/signals/__tests__/integration.fetchCore.test.ts` is the test from that PoC's origin, binding an unmodified real FetchCore with no element and carrying it through to a DOM update.

```js
import { DefinedCore } from "@wcstack/defined";
import { bindNode } from "@wcstack/signals/dom";

// the same timeout→missing and late-promotion logic as <wcs-defined>, with no element and no registry
const gate = bindNode(new DefinedCore(["wcs-tilt", "wcs-accelerometer"], "all", 5000));
gate.signals.pending.get();
```

The floor model (the overall picture of this document):

| Floor | Form | The definition timing problem |
|---|---|---|
| 1 | `data-wcs` plus Shell (state) | the runtime defers the wiring until upgrade (the user never thinks about it) |
| 2 | `bindNode` / `mountNode` plus Shell (signals) | managed by §0's decision table (import order, gates) |
| 3 | `bindNode` plus Core directly (signals) | **does not exist** (no `customElements` registry involvement) |

When to apply which:

- **A good fit**: using a pure logic node (fetch / websocket / sse / broadcast / timer / debounce / defined / raf, …) from JS alone.
- **Where the Shell keeps its value**: element-coupled nodes (intersection's and resize's observation target, camera's embedded preview, the targets of fullscreen / pip / pointer-lock), `:state()` CSS reflection (Shell / ElementInternals only — e.g. the `wcs-raf:state(running)` chip in tilt-maze), HTML declarativeness, coexistence with state, the autoloader, attribute-based configuration.
- **The cost**: the lifecycle becomes manual (driving `observe()` / `dispose()` or the start / stop commands yourself — composed with `onCleanup(() => core.dispose())`).

Made normative (2026-07-28): **§3.9** of [async-io-node-guidelines.md](./async-io-node-guidelines.md) makes Core a public headless adopter surface — an entry export (MUST), semver protection for the structural guarantees (extends EventTarget, self-dispatch by default, `static wcBindable`, public getters, `observe()/dispose()/ready`, never-throw), headless constructibility (MUST), and a headless (Core) section in each package's README (MUST). An inventory confirmed zero deviations across all 38 I/O node Cores. That makes **floor 3 an officially recommended idiom**. Only the shape of the constructor's configuration arguments is package-specific (each README is authoritative). The authoritative user-facing reference is the "Binding a Core directly" section of the signals README.

## 4. The policy for applying this to examples

The comparison demos (signals-tilt-maze, websocket-chat) have exhibition value in the symmetry itself — "the same tags line up in the HTML as in the state version" — so no mechanical wholesale replacement is done. New signals-only demos and the canonical recipes in the README follow §0's decision table (README §3 has gained a note that whenDefined is "the form for tags you do not load yourself").

Where it landed:

| Demo | Landing |
|---|---|
| examples/signals-live-search | §3.1's `mountNode`. Being a standalone demo, the tags were removed from the HTML and it is unified on `import "@wcstack/fetch/auto"` plus `mountNode("wcs-fetch")` |
| examples/signals-tilt-maze | tags stay in the HTML, per §4's exception. Only `<wcs-raf>` is a static import (without it the game does not exist); tilt / accelerometer / wakelock use §3.2's dynamic import. The two sensors carry a 5-second ceiling through `Promise.race`, per §3.2's caveat, matching the wait of the state version's `<wcs-defined timeout="5000">` |

## 5. The `mountNode` API (as-built; Unreleased as of v1.22.6)

Exported from `@wcstack/signals/dom`. Implemented in `packages/signals/src/dom.ts`, tested in `__tests__/mountNode.test.ts` (12 tests).

```ts
mountNode<S extends NodeShape = DefaultNodeShape>(
  tagName: string,
  options?: {
    attrs?: Record<string, string | number | boolean>;
    parent?: Node;                    // document.body by default
    descriptor?: WcBindableDescriptor; // passed straight to bindNode's second argument
  },
): MountedNode<S>   // = BoundNode<S> & { el: HTMLElement; unmount(): void }
```

### 5.1 Decisions

1. **The internal order is create → attrs → bind → connect (normative)**. attrs are set before connection (the Shell reads its configuration in `connectedCallback`), and the adapter subscriptions come before connection too. That makes the window for missing an event fired from `connectedCallback` **structurally zero** (rather than relying on bindNode's re-seed). The test verifies it directly by catching an event fired at connect time.
2. **An undefined tag throws immediately with an Error that names the cause**. bindNode's generic error ("no wc-bindable descriptor") does not let a first-time reader see the cause (the tag is not defined). The message includes pointers to the side-effect import, whenDefined, and the descriptor escape hatch. Where `descriptor` is given explicitly the check is skipped (for non-custom-element targets, symmetrically with bindNode).
3. **attrs follow HTML boolean attribute semantics**: `true` → an empty attribute, `false` → no attribute, anything else stringified. Consistent with `setProp`'s attribute rules (`true` → empty attribute, `false` → removal).
4. **It does not auto-register with a reactive owner** (the same rule as bindNode). Teardown is an explicit `unmount()` (disposing the adapters plus `el.remove()`; idempotent). To bundle it with a scope, `onCleanup(() => m.unmount())`. Since the standard form is creating page-lifetime headless nodes at the top level, an implicit association would be the more dangerous choice.
5. **The SSR contract of the `./dom` entry is preserved**: it touches no DOM at module level, and a call in a non-DOM environment produces a clear Error in the same format as `createSignalsElement` (the `@wcstack/signals/dom:` prefix, separate guards for `document` and `customElements`, and a stated remedy).
6. **`MountedNode`'s `dispose()` is an alias of `unmount()` (a decision that came out of review)**. Exposing the inherited adapter-only `dispose()` as-is would give a silent partial teardown — "the signals look inert but the element stays connected and the Shell's I/O keeps running" (which a user calling `m.dispose()` out of bindNode habit, or a generic helper taking a `BoundNode`, would hit). mountNode owns the element's lifecycle, so it overrides dispose to mean a full teardown.
7. **The tag name is normalized to lowercase (a decision that came out of review)**. The registry is exact-key while `createElement` lowercases ASCII, so without normalization `mountNode(el.tagName)` (uppercase in an HTML document) would misdiagnose a defined tag as not defined — and the error message's guidance would be beside the point too (`whenDefined("WCS-X")` rejects on an invalid name).

### 5.2 Non-goals

- **No lazy variant (`mountNode.lazy(spec, tag)` or similar)** — composing with a dynamic import (§3.2) is short enough, and timeouts and degraded UI are the app's policy layer, not something to fold into the API.
- **No deferred adapter (a variant returning an unwired adapter before definition and wiring it at upgrade)** — that is not sugar but comes with normative decisions: whether a pre-upgrade `command` throws or drops (the state side has already made "tokens do not replay" normative, and the two would have to agree), and the fact that a pre-upgrade `set` writing an expando is not picked up at upgrade (the lazy-properties problem). bindNode's fail-fast is the honest form that avoids that decision, and mountNode removes the problem itself by "creating the element after the definition".

### 5.3 Open items (candidates)

- Improving `bindNode`'s own diagnostics: where the target is an HTMLElement with a dash in its tag name and `customElements.get()` is empty, emit a dedicated "tag not defined" message instead of the generic error. The mountNode path is covered by this implementation so the priority has dropped, but there is still value in rescuing how a first-time reader falls over when calling bindNode directly on an existing element (the §3.3 path).

## 6. Background — "the custom tag loading problem" as a platform seam

This problem family is fundamentally an unresolved area of the web platform, and decomposes into three layers:

1. **Resolving a tag name to a module** (who knows which module provides `<wcs-fetch>`) — a standards proposal exists: [WICG/webcomponents#782 "Lazy Custom Element Definitions"](https://github.com/WICG/webcomponents/issues/782) (`customElements.defineLazy(name, () => import(...))`, discussed since the 2018 Tokyo f2f, unshipped as of 2026-07). **`@wcstack/autoloader` is precisely a userland implementation of that proposal** (a declarative form wired to import maps).
2. **The visibility of a load failure** (`whenDefined` never rejects) — not a spec oversight but structural: the registry does not know the loader and cannot in principle determine that "nothing more is coming". A real failure signal can only flow once (1) is solved. **`<wcs-defined>`'s timeout → `missing` (promoted on a late arrival) is the honest answer to that structural absence**.
3. **The failure policy** (partial degradation, a disabled button, how long to wait) — this stays in the app layer forever, however perfect browsers become.

On the adjacent axis, Scoped Custom Element Registries (name collisions) shipped in Safari 26 / Chrome 146, but the loading axis has been waiting on userland demonstration ever since the retreat of HTML Imports (a precedent where browsers owned it once and let it go). **wcstack's position**: autoloader and `<wcs-defined>` are not "proprietary features" but "the userland shape (polyfill-shaped) of platform primitives that ought to exist", designed to thin out and disappear once the standard arrives. `mountNode` is neither of those; it is a tool for taking on (3), and the part that a library API design ought to take on, on the signals side.
