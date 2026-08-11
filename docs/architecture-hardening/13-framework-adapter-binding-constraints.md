# Framework adapter binding constraints

- **Written**: 2026-08-01
- **Status**: a design decision record. **Phases A1-A4 are done** (A1 = implementing property upgrade in the Shell;
  A2 / A4 = [the integration guide](../framework-adapter-integration.md);
  A3 = [the proposal document for making `bind()` wait for the definition](../spec-proposal-bind-definition-timing.md) (ja)).
  A0's reproduction test was substituted with a conformance test using synthetic objects; reproduction in a real browser has not been done.
  A3's proposal has been submitted as [wc-bindable-protocol#22](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/22).
  What remains is catching up the wcstack-app skill (a separate repository), which happens **after the release**
  ([10-defaulting-rollout-status.md](10-defaulting-rollout-status.md) §D, at the end)
- **Applies to**: every Shell declaring `static wcBindable`, the `@wc-bindable` framework adapters, and the
  distribution route that presumes `@wcstack/autoloader`
- **External spec snapshot**:
  - `@wc-bindable/core@0.8.0`, `@wc-bindable/react@0.8.0`, `@wc-bindable/vue@0.8.0` (the npm artifacts)
  - svelte / solid / angular / qwik / signals / rxjs are the implementations on upstream `main` (versions may have drifted)
- **日本語版**: [13-framework-adapter-binding-constraints.ja.md](13-framework-adapter-binding-constraints.ja.md)

## Conclusion

[React immutable snapshots](11-react-immutable-snapshot-boundary.md) (ja) and the
[observable inventory](12-wc-bindable-observable-inventory.md) deal with "the meaning of a delivered value". This
document deals with what comes before that: **whether the bind takes at all**. The two are independent, and however
accurate the classification of values, nothing arrives if no bind is attached.

All eight adapters examined check `isWcBindable(el)` at mount and, if false, **give up without retrying**. In a
configuration where the custom element's upgrade happens after that moment, it stays unresponsive forever, with no
error and no log. The same cause — a late definition — produces a different failure on the input side too. When a
framework assigns a DOM property before the upgrade, an own data property permanently shadows the prototype accessor
and the wcstack Shell never receives the value. The latter is a producer-side defect wcstack can fix on its own, and
no package currently has anything equivalent to `_upgradeProperty`.

Both are premises of the public claim that "framework interoperation works if you use an adapter", and can proceed on
a separate track from the classification of value meanings (Phases 0-4).

## 1. Splitting the problem on two axes

### 1.1 The observation side — no bind is attached

If the element has not been upgraded by the time the adapter calls `bind()`, `getWcBindableDeclaration()` returns
`undefined` and `isWcBindable()` is false. The adapter early-returns there. The element reference is the same object
after the upgrade, so neither a React dependency array nor Qwik's `track()` fires again, and no second chance arrives.

### 1.2 The input side — a property assignment shadows the accessor

An element that has not been upgraded is a plain `HTMLElement`, and `el.url = "x"` creates an own data property. Once
the class's accessor lands on the prototype at upgrade, the own property takes precedence and the setter is never
called again. This is a long-known problem with custom elements, and the countermeasure (`_upgradeProperty`) is the
producer's responsibility.

Both come from the same root (definition timing), but the responsibility and the place to fix differ. 1.1 is fixed by
the adapter / core; 1.2 by wcstack's Shell.

## 2. Assessment of the current state

### 2.1 Adapters do not distinguish "not yet" from "not one at all"

Every implementation read has the same shape.

| Adapter | When it tries to bind | Behavior when not upgraded |
| --- | --- | --- |
| react | `useEffect([el, onUpdate])` | early return. `el` does not change, so it never re-runs |
| vue | `onMounted` | early return. No retry |
| svelte | the action's first setup | early return. `update` only runs when params change |
| solid | when the directive runs | early return. No retry |
| qwik | `useVisibleTask$` | early return. `track(() => ref.value)` does not re-fire on upgrade |
| angular | `ngOnInit` | early return. No retry |
| signals / rxjs | an explicit `bind(el)` call | early return. Calling again is the user's responsibility |

`bind()` in `@wc-bindable/core` likewise returns a no-op cleanup and finishes quietly when it cannot read the
declaration. That is consistent with the SPEC's "discovery == bindability" contract, but what `syncOn: "connect"`
handles is a late **connection**, not a late **definition**. signals / rxjs are the most careful implementations,
passing `syncOn: "connect"`, but they fall at the `isWcBindable()` check before that and are not rescued.

The condition for it to surface is "the element's definition comes after the adapter's mount". In a setup that
statically imports `@wcstack/<pkg>/auto` through Vite or similar, the definition lands first and it does not happen.
It happens with `@wcstack/autoloader`'s dynamic import, a CDN `<script type="module">`, and any route where
code-splitting delays the load. **Buildless / one-line CDN is wcstack's headline feature**, and as long as that route
is described as "interoperable", this is not a condition that can be ignored.

The same problem has already been settled on the signals side ([the definition timing norms](../signals-definition-timing.md),
[initialization order](01-binding-initialization-order.md) (ja)). Only the external adapters remain unaddressed.

### 2.2 The Shell has no upgrade countermeasure

wcstack's input properties are prototype accessors, uniformly shaped so the setter writes to the attribute.

```ts
get url(): string { return this.getAttribute("url") || ""; }
set url(value: string) { this.setAttribute("url", value); }
```

Across a sweep of `packages/**/src`, there is **not one** implementation that re-reads own properties in
`connectedCallback` (an equivalent of `_upgradeProperty`). So in a framework that assigns properties before the
upgrade, the value stagnates in the own property and never reaches the element.

Framework behavior splits into two groups.

| Group | Frameworks | When not upgraded | Effect on wcstack |
| --- | --- | --- | --- |
| always assigns a property | Angular (`[prop]`), Lit (`.prop=`), Solid (`prop:`), Vue (with an explicit `.prop`) | the own property permanently shadows the accessor | **the value never arrives.** No error |
| falls back to an attribute on `key in el` | React 19, Vue (by default), Svelte, Preact | it is set as an attribute | scalars are attribute-backed, so harmless. **An object input is stringified and breaks** |

The latter is mostly harmless thanks to wcstack's design (attribute-backed accessors) — unintended good fortune. The
only things that break are inputs taking an object (`post`, `options`, `files`, …).

### 2.3 Some frameworks cannot bind the event names in a template

wcstack's event names contain a colon, as in `wcs-camera:stream-ready`. Angular's template reads a colon as the
`target:event` separator, so `(wcs-camera:stream-ready)` yields `Unsupported event target` (angular/angular#28491,
open). In React's JSX a colon is likewise treated as a namespace name and cannot be written as-is under the default
Babel configuration.

Going through an adapter is unaffected, since `bind()` uses `addEventListener`. It matters for the route that binds
directly without an adapter, and for the design [inventory §5.6](12-wc-bindable-observable-inventory.md) pointed
to — "take `event` / `handle` out of values and receive them on a separate surface". The escape hatch that was assumed
there, "the user listens to the element's events directly", cannot be written straightforwardly in these frameworks.

## 3. The division of responsibility

| Problem | Primary responsibility | Why |
| --- | --- | --- |
| holding the bind until the upgrade completes | wc-bindable core / adapters | the check is part of discovery, and an adapter alone cannot express "not yet" |
| the usage procedure in a late-definition setup | wcstack documentation | the lateness originates in wcstack's own distribution shape |
| re-reading pre-upgrade properties | **the wcstack Shell** | a standard custom-elements producer responsibility; unfixable from outside |
| the attribute fallback for object inputs | wcstack documentation plus the framework's explicit syntax | the means of preserving the type is on the framework side; announcing the need is the producer's job |
| how expressible the event names are | wcstack naming plus the adapter surface | the producer chose the names. But renaming is a breaking change, so it is solved at the surface |
| integration with a framework's change detection | each adapter | zoneless, OnPush, and the like are framework-specific. wcstack does not take them on |

## 4. The recommended staged introduction

### Phase A0: establishing the scope of impact

Confirm whether 1.1 and 1.2 actually reproduce on the three routes where the definition is late (the autoloader's
dynamic import, a CDN `<script type="module">`, code splitting). The first deliverable is the reproduction test;
nothing is fixed at this point.

### Phase A1: property upgrade in the Shell (wcstack alone) — implemented (2026-08-01)

A shared helper that re-reads own properties at the top of `connectedCallback` was added. Since the input names are
already declared in `static wcBindable.inputs`, it can be applied mechanically just by walking the declaration.

The canonical source is `/protocol/upgrade-properties.ts`, distributed by `scripts/sync-protocol-types.mjs` as
`packages/<pkg>/src/protocol/upgradeProperties.ts` (the same distribution route as the protocol types, and covered by
CI's `--check`).

```ts
export function upgradeProperties(element: object): void {
  const inputs = (element as { constructor?: { wcBindable?: IWcBindable } }).constructor?.wcBindable?.inputs;
  if (inputs === undefined) return;
  for (const input of inputs) {
    const name = input.name;
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    if (!hasAccessorOnPrototype(element, name)) continue;   // do not break a public class field
    const record = element as Record<string, unknown>;
    const value = record[name];
    delete record[name];
    record[name] = value;
  }
}
```

It applies to the 38 Shells declaring `static wcBindable` (`<wcs-throttle>` is covered automatically by inheriting
from `<wcs-debounce>`; `<wcs-route>` is out of scope as it has no `inputs`). `<wcs-router>` has an
`async connectedCallback`, so it is called synchronously before the first `await`.

The only behavior change is in the direction of "values that used to be dropped now arrive"; the existing attribute
route is unaffected.

**A side finding**: this work revealed that `raf` was missing from the distribution list in
`scripts/sync-protocol-types.mjs`, so `packages/raf/src/protocol/wcBindable.ts` was drifting while still carrying the
AUTO-GENERATED banner and being outside `--check` (a registration oversight). Fixed by adding it to the list.

### Phase A2: documenting the usage procedure for a late-definition setup — done (2026-08-01)

The canonical usage procedure was placed as [Embedding wcstack elements in a framework app](../framework-adapter-integration.md).
It states that a static import is the surest route; that where that is unavoidable, gating with
`customElements.whenDefined()` has to happen **before the component that calls the adapter mounts**; and why
`connectedCallbackPromise` / `hasConnectedCallbackPromise` / `<wcs-defined>` / `setTimeout` do not substitute. The
attribute fallback for object inputs (§2) and unwrapping a reactive proxy (§3) are collected in the same document.

The root README (en / ja) gained a summary of the three rules plus a link to this document.
The wcstack-app skill is a separate repository (wcstack/wcstack-skill), so catching it up remains separate work.

### Phase A3: the proposal upstream — proposal document written (2026-08-01)

[A proposal for making `bind()` handle "not yet defined"](../spec-proposal-bind-definition-timing.md) (ja) was
written. It compares option A (adding `syncOn: "define"`, recommended), option B (distinguishing `pending` through
the return value), and option C (a separate function), and includes draft normative wording, the conformance test
conditions, and the non-goals. It recommends option A, which changes no default behavior and touches one place in the
core. It can be submitted independently of the semantics-metadata proposal in
[inventory §5.6](12-wc-bindable-observable-inventory.md).

Submitted upstream: [wc-bindable-protocol#22](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/22)
(2026-08-01, in English). An implementation PR waits on their choice of option.

### Phase A4: an alternative route for the event names — done (2026-08-01)

The naming is not changed (it would be a breaking change). Instead, how to receive events in frameworks that cannot
bind a colon is written in [the integration guide §4](../framework-adapter-integration.md). It shows, with real code,
that going through an adapter is unaffected; that Angular (`Unsupported event target`) and React (JSX's namespace
interpretation) cannot write it in a template; that a ref plus `addEventListener` (`Renderer2.listen` in Angular) is
the portable route in any framework; and that the representative case needing that route is `streamReady`, classified
as a `handle`.

Whether Vue / Svelte / Solid template syntax can write a name containing a colon depends on the framework and version,
so rather than assert something unmeasured, it recommends the portable route.

Where decision gate 6 of the parent design adds an event / handle surface, that surface will be shaped so as not to
depend on template syntax.

## 5. Verification conditions

### Shell

- [x] A value assigned to a property before the upgrade goes through the setter and takes effect after it.
- [x] On the ordinary route with no own property it does nothing (idempotent; no side effect on reconnection).
- [x] It leaves alone an own property whose prototype side is not an accessor (it does not break a public class field).
- [x] It throws for neither an element without an `inputs` declaration nor an element without `wcBindable`.
- The above are pinned in each package by `__tests__/protocol.upgradeProperties.test.ts` (the shared conformance test that is generated and distributed).
- [x] For inputs taking an object, the fact that an attribute fallback breaks them silently is stated for users
  ([the integration guide §2](../framework-adapter-integration.md), the root README).

### Late definition

- Even where the adapter mounts before the element is defined through the autoloader, the initial value and subsequent events arrive after the definition.
- Where that does not hold, a workaround is presented in a form users can see (the gating procedure in the README).
- In the ordinary setup where the definition comes first, the added waiting does not delay the initial delivery.

## 6. Non-goals

- Removing the colon from wcstack's event names.
- Forking or patching the `@wc-bindable` adapters on the wcstack side.
- Having wcstack take on the change detection, SSR, and hydration of every framework.
- Abolishing the late-definition setup itself (buildless / CDN is a premise of this project).

## 7. Decision gates

1. **What upgrade covers**: only walk the `wcBindable.inputs` declaration, or cover every setter on the Shell.
2. **Scope of application**: introduce it across all 35 packages at once, or start with new nodes and nodes where real damage was confirmed.
3. **Presenting the waiting procedure**: stop at a README addition, recommend using `<wcs-defined>`, or go as far as guaranteeing definition completion in the `auto` entry.
4. **The shape of the upstream proposal**: adding `syncOn: "define"` to the core, or leaning on a retry in the adapter.
5. **Event names**: is keeping them as-is plus documenting the alternative route acceptable as the settled answer.

The recommendation: gate 1 on the `inputs` declaration; gate 2 all at once (the behavior change is one-directional and low-risk); gate 3 starting from a README addition; gate 4 favouring the proposal to the core; gate 5 keeping things as they are.

## 8. Value and priority

| Aspect | Assessment |
| --- | --- |
| immediate breakage in a static-import setup | low |
| real breakage in an autoloader / CDN setup | high |
| does it close within wcstack alone | Phases A1 / A2 do |
| upstream dependency | Phase A3 only |
| support for the public claim of "interoperable with React / Vue / Svelte / Solid" | high |
| coupling with the classification of value meanings (docs 11 / 12) | low (it can proceed independently) |

Phase A1 was the only real defect listed here that could be fixed without waiting on upstream or on metadata.
Implemented. A2 / A4 / A3 have landed as documents. What remains is two things outside this repository —
submitting [the proposal document](../spec-proposal-bind-definition-timing.md) (ja) upstream, and catching up the
wcstack-app skill (a separate repository).

## References

- [React immutable snapshots and the wc-bindable I/O boundary](11-react-immutable-snapshot-boundary.md) (ja)
- [The wc-bindable observable inventory](12-wc-bindable-observable-inventory.md)
- [The order of tag definition and binding establishment](01-binding-initialization-order.md) (ja)
- [signals' definition timing norms](../signals-definition-timing.md)
- [The async I/O node authoring guidelines](../async-io-node-guidelines.md)
- [`WcsWebSocket` (a real example of an attribute-backed accessor)](../../packages/websocket/src/components/WebSocket.ts)
- [Vue and Web Components (the `in` check and the `.prop` modifier)](https://vuejs.org/guide/extras/web-components.html)
- [React DOM Components — Custom HTML Elements](https://react.dev/reference/react-dom/components#custom-html-elements)
- [angular/angular#28491 — Namespaced Custom Events](https://github.com/angular/angular/issues/28491)
