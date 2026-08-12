# A consistency audit of state's three component mechanisms

- **Written**: 2026-08-05
- **Status**: an audit record plus **the fixes completed** (2026-08-05 to 06, and §1.7 / §1.8 / §1.9 on 2026-08-10).
  All four decision gates G1-G4 of §7 are settled and implemented.
  Implemented = §1.1-§1.9 / §2.1-§2.4 / §2.6 / §2.7 / §3.1 / §3.2 / §3.4 / §3.5 / §3.6;
  partial = §2.5; corrected = §3.3 (an error in this document).
  **Every item the audit raised is resolved** (§2.5 in diagnostics only; §3.3 withdrawn as an error of this document).
  §1.7 records the later discovery that G1's own fix had landed on one lung,
  §1.8 records making the form §1.7 had left as "out of support" work,
  and §1.9 records **a separate defect that existed from before the audit**, found during §1.8's spike.
  The status table is §0.
- **Applies to**: `@wcstack/state`'s
  [`protocol/`](../../packages/state/src/protocol/) /
  [`dcc/`](../../packages/state/src/dcc/) /
  [`webComponent/`](../../packages/state/src/webComponent/)
- **Snapshot**: wcstack `065774839c36d2a34a22c928f968acdbb169a98f` (`@wcstack/state@1.25.0`)
- **Method**: reading the source plus temporary probe tests on happy-dom (§8 has the reproduction steps; the probes themselves are not kept in the repository)
- **日本語版**: [15-state-component-mechanism-consistency.ja.md](15-state-component-mechanism-consistency.ja.md)

## Conclusion

There are three mechanisms for "giving a custom element state" tied to `<wcs-state>`.

| Mechanism | How it is defined | wcBindable | Implementation |
|---|---|---|---|
| (1) the wc-bindable protocol | any custom element declares `static wcBindable` | **canonical** | `src/protocol/` |
| (2) DCC | HTML alone (`data-wc-definition` plus a Declarative Shadow DOM). wcBindable is **generated at runtime** from `$bindables` | auto-generated | `src/dcc/` |
| (3) bind-component | bridges a JS class's `state` property through outer/inner proxies | **not involved at all** | `src/webComponent/` |

(2) and (3) have the same purpose (giving a component state) yet **their contracts, lifecycle discipline, and strength of declaration validation do not line up**. It is a three-layer structure — (1) is canonical, (2) partially generates it, and (3) has independent semantics outside (1) — and the silent failures concentrate at the seams.

This document applies the "does the bind take" axis of [13-framework-adapter-binding-constraints.md](13-framework-adapter-binding-constraints.md) **between the three mechanisms inside wcstack**. Where 13 covers the boundary with external adapters, this covers whether our own three mechanisms agree with each other.

---

## 0. Status

| Topic | Content | Status |
|---|---|---|
| §1.1 | the semantics of `this.state` are doubled between mapped and plain | ✅ fixed (G1 = separating the internal channel) |
| §1.2 | the outer-state branch condition is the presence of a `data-wcs` attribute | ✅ fixed |
| §1.3 | a DCC re-calls `attachShadow` on reconnection and throws | ✅ fixed |
| §1.4 | a DCC inside a fragment (unconnected) drops its initial value | ✅ fixed (G4 = solved on the DCC side; implemented as lazy construction) |
| §1.5 | a duplicate in `$bindables` discards the whole wcBindable declaration | ✅ fixed |
| §1.6 | a command-token cannot be attached to a DCC method | ✅ fixed (G2 = an explicit `$commands` declaration) |
| §1.7 | the internal channel separated in §1.1 was never selected (delivery from parent to child never worked at all) | ✅ fixed (2026-08-10, discovered later) |
| §1.8 | a child scope cannot iterate the parent's list with `for` (the listIndex is lost crossing the boundary; it fails from the first render) | ✅ fixed (2026-08-10, the remainder of §1.7) |
| §1.9 | replacing a list whose rows contain components kills `for` (the form documented in the README; unrecoverable) | ✅ fixed (2026-08-10, found during §1.8's spike) |
| §1.10 | a component inside a parent-scope `for` cannot run a `for` in the child either (a silent hang) | ✅ fixed (2026-08-11, the remainder of §1.8) |
| §1.11 | a parent-origin row-field write does not cross more than one boundary (the row ledger piggyback stops after one hop) | ✅ fixed (2026-08-13) |
| §1.12 | a list cannot cross two boundaries when the intermediate component sits inside a parent `for` (Δ>0) | ❌ **open** (found while fixing §1.11) |
| §2.1 | the change event fires only on an exactly matching path | ✅ fixed (subpaths plus `$postUpdate` plus a property getter) |
| §2.2 | the DCC accessors are asymmetric between synchronous and asynchronous | ✅ fixed (the setter made synchronous; `callFn` deliberately keeps its Promise) |
| §2.3 | only `$bindables` has no declaration validation | ✅ fixed (structural validation plus an existence check; the `$streams` names resolved too) |
| §2.4 | the prototype chain is treated differently by State and DCC | ✅ fixed |
| §2.5 | the inner `<wcs-state>` is fixed at `:not([name])` | 🟡 partially fixed (behavior unchanged, made visible with a `console.warn`) |
| §2.6 | bind-component and a state source attribute both specified | ✅ fixed |
| §2.7 | when `bindableEventMap` is set | ✅ fixed |
| §3.1 / §3.2 / §3.4 | mutual exclusion, the range wcBindable is required over, the etiquette for a duplicate definition | ✅ fixed (G3 = making the separation normative) |
| §3.3 | root determination happens two ways | ❌ **an error in this document** (it is needed under SSR; corrected with a comment) |
| §3.5 | types and layering (`IStateElement` has no setter) | ✅ fixed |
| §3.6 | the READMEs under `src/` disagree with the implementation | ✅ fixed |

The fixes were implemented in the following.

| File | Topic |
|---|---|
| [`webComponent/bindWebComponent.ts`](../../packages/state/src/webComponent/bindWebComponent.ts) | §1.2 / §1.1 |
| [`webComponent/outerState.ts`](../../packages/state/src/webComponent/outerState.ts) | §1.1 (the mapped-only proxy and the lastValue ledger deleted, unified into one) |
| [`webComponent/innerState.ts`](../../packages/state/src/webComponent/innerState.ts) | §1.1 (the ledger write and listIndex resolution removed) |
| [`apply/applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts) | §1.1 (the internal channel separated) |
| [`webComponent/completeWebComponent.ts`](../../packages/state/src/webComponent/completeWebComponent.ts) / [`apply/applyChange.ts`](../../packages/state/src/apply/applyChange.ts) | §1.7 (the channel-selection gate keyed on the stateProp name) |
| [`webComponent/MappingRule.ts`](../../packages/state/src/webComponent/MappingRule.ts) | §1.7 (derived bindings registered as subscribers through the BindingSession) |
| [`webComponent/crossBoundaryAddress.ts`](../../packages/state/src/webComponent/crossBoundaryAddress.ts) (new) / [`webComponent/innerState.ts`](../../packages/state/src/webComponent/innerState.ts) | §1.8 (crossing the boundary by address rather than by path) |
| [`webComponent/outerListPath.ts`](../../packages/state/src/webComponent/outerListPath.ts) (new) / [`components/State.ts`](../../packages/state/src/components/State.ts) | §1.8 (propagating the `for` path's list declaration to the parent state) |
| [`bindings/BindingSession.ts`](../../packages/state/src/bindings/BindingSession.ts) | §1.8 (row bindings riding along in the parent's pattern ledger) |
| [`proxy/methods/isCacheable.ts`](../../packages/state/src/proxy/methods/isCacheable.ts) (new) | §1.8 (no second cache in a mapped state) |
| [`apply/applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts) / [`components/types.ts`](../../packages/state/src/components/types.ts) | §1.9 (not notifying a disconnected state element; `hasRootNode`) |
| [`components/State.ts`](../../packages/state/src/components/State.ts) / [`webComponent/MappingRule.ts`](../../packages/state/src/webComponent/MappingRule.ts) | §1.9 (re-reading mapped paths on reconnection; discarding the memo of derived rules) |
| [`list/wildcardLevel.ts`](../../packages/state/src/list/wildcardLevel.ts) (new) | §1.10 (the wildcard-position → chain-level conversion collected onto a tail origin. Behavior unchanged at Δ=0) |
| [`webComponent/baseListIndex.ts`](../../packages/state/src/webComponent/baseListIndex.ts) (new) | §1.10 (a child scope's base depth Δ, and the parent listIndex at row creation) |
| [`list/getListIndexByBindingInfo.ts`](../../packages/state/src/list/getListIndexByBindingInfo.ts) / [`list/getIndexValueByLoopContext.ts`](../../packages/state/src/list/getIndexValueByLoopContext.ts) / [`proxy/methods/getContextListIndex.ts`](../../packages/state/src/proxy/methods/getContextListIndex.ts) / [`proxy/methods/checkDependency.ts`](../../packages/state/src/proxy/methods/checkDependency.ts) / [`proxy/traps/get.ts`](../../packages/state/src/proxy/traps/get.ts) / [`dependency/walkDependency.ts`](../../packages/state/src/dependency/walkDependency.ts) | §1.10 (the seven sites rewritten onto a tail origin) |
| [`apply/applyChangeToFor.ts`](../../packages/state/src/apply/applyChangeToFor.ts) / [`dependency/walkDependency.ts`](../../packages/state/src/dependency/walkDependency.ts) / [`proxy/apis/getAll.ts`](../../packages/state/src/proxy/apis/getAll.ts) / [`proxy/methods/setByAddress.ts`](../../packages/state/src/proxy/methods/setByAddress.ts) | §1.10 (passing the base to the parent on all five row-creation routes) |
| [`list/loopContext.ts`](../../packages/state/src/list/loopContext.ts) / [`webComponent/outerListPath.ts`](../../packages/state/src/webComponent/outerListPath.ts) / [`webComponent/innerState.ts`](../../packages/state/src/webComponent/innerState.ts) | §1.10 (level checks including Δ) |
| [`event/handler.ts`](../../packages/state/src/event/handler.ts) / [`event/eventTokenHandler.ts`](../../packages/state/src/event/eventTokenHandler.ts) / [`proxy/apis/updatedCallback.ts`](../../packages/state/src/proxy/apis/updatedCallback.ts) / [`proxy/apis/getAll.ts`](../../packages/state/src/proxy/apis/getAll.ts) | §1.10 (not leaking Δ into userland) |
| [`proxy/methods/getByAddress.ts`](../../packages/state/src/proxy/methods/getByAddress.ts) | a by-product of §1.10 (a read of a path with no parent returns `undefined`, so a raw `TypeError` no longer takes the batch down with it) |
| [`dcc/defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) | §1.3 / §1.4 / §2.4 / §2.5 / §2.7 / §3.5 |
| [`dcc/processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts) (new) | §1.5 / §2.3 / §1.6 |
| [`dcc/wcBindable.ts`](../../packages/state/src/dcc/wcBindable.ts) | §1.6 (generating `commands`) |
| [`getAllPropertyDescriptors.ts`](../../packages/state/src/getAllPropertyDescriptors.ts) (new) | §2.4 (State and DCC share the traversal) |
| [`components/State.ts`](../../packages/state/src/components/State.ts) | §2.4 / §2.6 / §3.1 |
| [`components/types.ts`](../../packages/state/src/components/types.ts) | §3.5 / §2.2 (`initialized`) |
| [`dcc/dispatchBindableEvent.ts`](../../packages/state/src/dcc/dispatchBindableEvent.ts) (new) | §2.1 |
| [`dcc/dccPropertyFactories.ts`](../../packages/state/src/dcc/dccPropertyFactories.ts) | §2.2 |
| [`proxy/methods/setByAddress.ts`](../../packages/state/src/proxy/methods/setByAddress.ts) / [`proxy/apis/postUpdate.ts`](../../packages/state/src/proxy/apis/postUpdate.ts) | §2.1 |
| [`stateElementByName.ts`](../../packages/state/src/stateElementByName.ts) | §3.3 (a comment only; behavior unchanged) |
| `src/dcc/README.md` / `src/webComponent/README.md` | §3.6 (rewritten to the implementation as it stands) |

The regression tests are
[`webComponent.bindWebComponent.semantics.test.ts`](../../packages/state/__tests__/webComponent.bindWebComponent.semantics.test.ts) (new, closing the gap of §6),
[`dcc.processDccDeclarations.test.ts`](../../packages/state/__tests__/dcc.processDccDeclarations.test.ts) (new),
[`src.getAllPropertyDescriptors.test.ts`](../../packages/state/__tests__/src.getAllPropertyDescriptors.test.ts) (new),
plus additions to `dcc.defineDCC.test.ts` / `webComponent.bindWebComponent.test.ts` / `components.State.test.ts`.
Every new test (unit and e2e alike) was confirmed to fail against the pre-fix code.

---

## 1. Inconsistencies with confirmed real damage

### 1.1 bind-component had two outward proxies with opposite semantics ✅ fixed

`bindWebComponent`'s branch was decided **solely by "does the element have a `data-wcs` attribute"**.

| Branch | Implementation | `get` | `set` |
|---|---|---|---|
| mapped (`data-wcs` present) | the old `outerState.ts` | the `lastValue` cache (not a live read) | **discards the value** and only calls `$postUpdate(path)` |
| plain (no `data-wcs`) | the old `plainOuterState.ts` | passes through to the inner state proxy | writes through to the inner state proxy |

That proxy is exposed to the component author as `this.state`. Which means **the same component implementation behaves differently depending on whether the parent page wrote a `data-wcs`**. `$stateReadyCallback` is called on both branches, so of course the author touches `this.state`. The README's "`this.state.message = "..."` takes effect immediately" held only on the plain branch.

The mapped semantics themselves **made sense as an internal channel**. When the parent state changes, `applyChangeToWebComponent` performs `element["state"]["path"] = v`, but the authoritative value lives on the parent side, so all the child needs is a "re-read" notification — `$postUpdate` suffices. **The problem was using the same proxy for the internal channel and the public API**, not the mapped implementation being wrong.

**The fix (G1 = (b), separating the internal channel)**:

- The public proxy is now one kind, and the mapped / plain distinction is gone
  ([`outerState.ts`](../../packages/state/src/webComponent/outerState.ts)).
  Even under mapping, the innerState proxy it passes through resolves to the parent state through the mapping, so reads are live and writes reach the parent.
- The internal channel was separated into [`applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts) pulling the state element directly with `getStateElementByWebComponent` and calling `$postUpdate`. It never touches `element[stateProp]` (that function is selected only where `isWebComponentComplete` is true, so the state element is always registered).
- The now-unnecessary mapped-only proxy and `lastValueByAbsoluteStateAddress.ts` were deleted. `innerState.get` also lost its listIndex resolution and ledger write, removing one `createAbsoluteStateAddress` allocation per read.

The regression is pinned in a real browser
([`e2e/tests/state-bind-component-write.spec.ts`](../../e2e/tests/state-bind-component-write.spec.ts)).
Before the fix, `element.state.name` on a mapped element returns `undefined` and it falls over.

### 1.2 That branch condition was itself wrong ✅ fixed

The branch was `component.hasAttribute(config.bindAttributeName)`, not "is there at least one `<stateProp>.*` binding".

```html
<my-component data-wcs="class.on: flag"></my-component>  <!-- not one state.* -->
```

Here `bindings` is empty and [`MappingRule.ts:32-34`](../../packages/state/src/webComponent/MappingRule.ts) returns immediately with not one mapping created, while outerState stays with mapped semantics.

Measured by probe:

- `component.state.msg` → **always `undefined`** (`setLastValueByAbsoluteStateAddress` is called only on the mapping route)
- `component.state.msg = 'written'` → **a complete no-op** (the inner value stays `'hello'`; only `$postUpdate('msg')` flies)
- Remove the `data-wcs` under the same conditions and both read and write work

The existing [`webComponent.bindWebComponent.test.ts`](../../packages/state/__tests__/webComponent.bindWebComponent.test.ts) mocks outerState / innerState / MappingRule entirely, so the semantics of this route had never once been verified.

**The fix**: the branch condition became "is there at least one `<stateProp>.*` binding". Even with a `data-wcs`, zero mapping targets take the plain branch and reads / writes pass through to the inner state. Alongside that, `webComponent.bindWebComponent.semantics.test.ts` was added to pin the actual read / write results against the real modules (the gap of §6).

### 1.3 A DCC element always throws on reconnection ✅ fixed

The `connectedCallback` in [`defineDCC.ts:49-52`](../../packages/state/src/dcc/defineDCC.ts) calls `attachShadow` with no guard on `this._shadow` / `this.shadowRoot`.

```
Failed to execute 'attachShadow' on 'Element':
Shadow root cannot be created on a host which already hosts a shadow tree.
```

(Identical on happy-dom and in a real browser; confirmed by probe.)

The routes that hit it are everyday ones:

- an `if` remounting from false → true ([`applyChangeToIf.ts:35,49`](../../packages/state/src/apply/applyChangeToIf.ts) does `unmount()` → `mountAfter()` on the same node)
- **row pooling** in a `for` ([`applyChangeToFor.ts:188-195`](../../packages/state/src/apply/applyChangeToFor.ts) returns it to the pool and line 235 `pop()`s it for reuse)

`<wcs-state>` itself handles reconnection carefully with `_initialized` and `_connectGeneration` ([`State.ts:347-371`](../../packages/state/src/components/State.ts)), so this is the exact opposite construction, and **the lifecycle discipline not lining up within one package** is itself the defect.

**The fix**: `if (this._shadow !== null) return;` at the top of `connectedCallback`. A shadow tree is retained after the host disconnects, so doing nothing from the second time on is correct. In closed mode `this.shadowRoot` is `null`, so the check is done on the field.

### 1.4 A DCC inside a list silently drops its initial value ✅ fixed

The all-append fast path of `for` builds into a fragment and then `activateContent`s ([`applyChangeToFor.ts:244,266`](../../packages/state/src/apply/applyChangeToFor.ts)), inserting the fragment into the DOM at line 306. So at the moment the bindings are applied, the DCC is **unconnected**.

The DCC's `stateElement` getter depends on `_shadow` (first assigned in `connectedCallback`), so `if (!stateEl) return;` in [`dccPropertyFactories.ts:26-27`](../../packages/state/src/dcc/dccPropertyFactories.ts) silently discards the write.

The undefined-element guard in [`applyChange.ts:137-145`](../../packages/state/src/apply/applyChange.ts) **only has "wait for define" and no "wait for connect"**. An I/O node Shell assigns plain fields, so the value survives in Core even while unconnected — meaning **this failure is DCC-specific**.

**The fix (G4 = (a), solved on the DCC side)**: the shadow is built lazily through `_ensureShadow()`, called from both `connectedCallback` and the `stateElement` getter. Since the accessor can resolve `stateElement` even while unconnected, the write is queued onto the inner `<wcs-state>`'s `initializePromise` and applied after connection and the state load. No pending buffer is needed.

> **The difference from the decision**: G4 was settled as "move it forward into the constructor", but the implementation took lazy construction rather than the constructor. The purpose is the same (accessors work while unconnected; the impact stays inside DCC), and the constructor version would hit two problems: (1) determining the defining element requires reading an attribute, which is against constructor etiquette, and (2) where the same tag has two `data-wc-definition`s, the second — which already has a DSD shadow — gets an `attachShadow` and throws. Being idempotent, it doubles as §1.3's reconnection guard.

An extra pitfall found during implementation: `template.content` belongs to an inert template-owner document, so its clone is **not upgraded** as a custom element. Where the host is connected, `appendChild` upgrades it, but inserted into an unconnected shadow there is no trigger, and the inner `<wcs-state>` stays a plain `HTMLElement`, falling over with `createState is not a function`. `_ensureShadow` calls `customElements.upgrade` explicitly at its end. This is not reachable in a unit test (happy-dom upgrades on clone) and only surfaced in e2e.

### 1.5 A duplicate in `$bindables` invalidates the whole wcBindable declaration ✅ fixed

[`createWcBindable`](../../packages/state/src/dcc/wcBindable.ts) passes duplicate names straight through. The reader's [`readNamedList`](../../packages/state/src/protocol/wcBindableReader.ts) (lines 118-129), meanwhile, returns `null` on finding a duplicate, making the whole `readBindableDeclaration()` `null`.

Measured by probe: `$bindables: ["count","count"]` → `readBindableDeclaration()` is `null`. As a result, no two-way binding, no spread, and `resolveInitialSyncPolicy` passes it through as "not a bindable element". **No error and no warning. Our own factory is rejected by our own reader.**

**The fix**: `processDccDeclarations()` (originally `processBindablesDeclaration()`) was added, validating the declaration and failing fast before `defineDCC` calls `createWcBindable` (the same fix as §2.3).

### 1.6 A command-token cannot be attached to a DCC method (structurally impossible) ✅ fixed

- [`defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) puts methods on the prototype
- but `createWcBindable` generates only `properties` / `inputs` and **creates no `commands`**
- and [`applyChangeToCommand.ts:73-75`](../../packages/state/src/apply/applyChangeToCommand.ts) `raiseError`s where `declaredCommands` has no declaration

Measured by probe: the generated declaration is only `{protocol, version, properties:[…], inputs:[…]}`. `command.inc: $command.x` always fails.

Its counterpart, the event-token, references `properties` ([`eventTokenHandler.ts:86`](../../packages/state/src/event/eventTokenHandler.ts)) and therefore works on a DCC. That is, **the duality of command-token / event-token breaks on DCC alone**. The README's "Declarative Custom Components (DCC)" section documents no such limitation.

Note that 1.5 and 1.6 come from the same root (`createWcBindable` implements only part of (1)'s declaration spec). They are **the third and fourth of the same class** as the "it was not creating `inputs`" defect recorded in [10-defaulting-rollout-status.md, the 7th item](10-defaulting-rollout-status.md).

**The fix (G2 = (a), an explicit `$commands` declaration)**: `$commands: ["bumpBy"]` was introduced as the counterpart to `$bindables`, and only what is declared goes into `commands`. `$commands` gets the same structural validation as §2.3 plus a check that it is **a function** that really exists on the state (`$bindables` checks the converse — that it is not a function).

`async` is uniformly `true`. Since `callFn` always chains onto `initializePromise`, the return value as the caller sees it is a Promise even where the state-side method is synchronous. Reporting the state method's own asyncness would describe something the caller never observes.

The declaration module is no longer `$bindables`-specific, so `processBindablesDeclaration.ts` was renamed to [`processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts). The regression is pinned in a real browser ([`e2e/tests/state-dcc-command.spec.ts`](../../e2e/tests/state-dcc-command.spec.ts)).

### 1.7 The internal channel separated in §1.1 had never once been selected ✅ fixed (2026-08-10, discovered later)

G1 was a paired fix: unifying the public proxy (§1.1) and separating the internal notification channel (`applyChangeToWebComponent`). The public surface was fixed as intended, but **the gate that selects the separated internal channel was broken, and a change originating in the parent state had never once reached the child component**. The break was in three places.

1. **The completion ledger's key was mistaken** (the main one). `markWebComponentAsComplete` recorded it under `(component, the inner IStateElement)` while `applyChange` looked it up under `(component, context.stateElement = the parent scope's IStateElement)`. Under a standard Shadow arrangement those two never coincide, so `isWebComponentComplete` was permanently `false`. **Both being the same `IStateElement` type, TypeScript could not detect the mix-up.**
2. **The fallback cancelled itself out.** With the gate false it falls to `applyChangeToProperty`, but the old-value read there goes through the public proxy that §1.1 made a pass-through — a live read that already returns the parent's new value. `oldValue !== newValue` becomes false, the write is skipped entirely, and no re-render is enqueued on the child side either.
3. **The derived bindings for subpaths were not subscribers.** `MappingRule` lazily derived the rule for a subpath the child read (inner `user.name` = outer `person.name`) and pushed the corresponding binding into the node ledger with `addBindingByNode`, but **the only consumer reading that ledger was `bindWebComponent`'s primary extraction filter** — and the `propSegments` of the time lacked the stateProp prefix, so it did not match that filter either. Nothing was ever put in the absolute-address ledger, so it was invisible to the updater.

**Why it went unnoticed** (a recurrence of §6's "test gap"). The existing regressions pinned only two directions: "initial delivery" and "a write through the public property". The former is the route where the child's bindings live-read the parent through innerState, the latter the route where the child's own `setByAddress` enqueues a child address — **in both, the child's code runs, so the internal channel is never used**. And the unit test mocked `isWebComponentComplete` wholesale, so whether the actual arguments matched was outside what was verified.

**The fix**:

- The completion ledger's key changed from `IStateElement` to **the state property name**
  ([`completeWebComponent.ts`](../../packages/state/src/webComponent/completeWebComponent.ts)).
  Completion is a per-property fact (has `defineProperty(component, stateProp, …)` happened), so the granularity is right, and the types differ (`string` versus `IStateElement`) so this particular mix-up **becomes unwritable**. With the gate correctly true, route 2 is no longer taken at all.
- Derived bindings are registered not with `addBindingByNode` but with `initialize({ registerAddress: true })` on **the `BindingSession` that owns the primary** ([`MappingRule.ts`](../../packages/state/src/webComponent/MappingRule.ts)). Registration into the absolute-address ledger, teardown, and destruction on node removal all ride the existing lifecycle, so no ledger entry is left strongly referencing the component. `propSegments` keeps the stateProp (the apply side pulls the bound state element from the first segment). They are not pushed into the node ledger (keeping the prefix would otherwise contaminate the primary extraction filter on a rebind).

**The gate excludes a propSegments length of 1.** Now that the ledger is keyed on the stateProp name, `data-wcs="state: user"` (writing the stateProp itself as the property name, i.e. one segment of propSegments) would pass the gate too. `applyChangeToWebComponent` presumes "the first segment is the bound state element, the rest is the child-side path" and `raiseError`s where the remainder is empty, which punches through the `updater` drain (which catches no exception) and **takes unrelated updates riding the same batch down with it**. That form was a silent no-op before the fix too (the public property is getter-only, so the assignment is a strict TypeError that `applyChangeToProperty`'s try/catch swallows), so it stays a no-op. It was measured that "one misconfigured tag makes other bindings in the same batch unupdatable". The idea of failing `data-wcs="<stateProp>: <path>"` fast at bind time (the same treatment as §2.6's ban on co-specification) is breaking and is not part of this fix.

**Two cases give up only on registration** (translation is the real job, so the read is not dropped = behavior stays as it was before this mechanism existed. A `console.warn` only under `config.debug`).

- The primary's session cannot be pulled (an internal impossibility).
- The derived outer path contains a wildcard but no listIndex is determined. **This is the form where the child runs a `for` on top of an array mapping** (against the rule `state.items: rows`, the child's row reads `items.*.name`, so outer is `rows.*.name`). The derived binding's `node` is the component element in the parent scope while the loop is inside the child's Shadow, so the row cannot be identified from the component's DOM position. **This form of bind-component did not work even before this fix** (the child's own `for` never finishes initializing and not one row renders). Without the guard, `getAbsoluteStateAddressByBinding` `raiseError`s and what was a silent failure turns into an exception, so registration is skipped explicitly.
  → That form itself was **made to work in §1.8**. A row's subscription is solved not by one derived binding but by having the child's own row bindings ride along in the parent's pattern ledger (this skip itself is still correct).

The regression is pinned both on happy-dom
([`integration.bindComponentDelivery.test.ts`](../../packages/state/__tests__/integration.bindComponentDelivery.test.ts)) and in a real browser
([`e2e/tests/state-bind-component-parent-write.spec.ts`](../../e2e/tests/state-bind-component-parent-write.spec.ts)). The discriminator is **the view inside the Shadow** — a view in the parent scope is the parent's own binding and updates even while the channel is broken, so watching that never reveals the breakage. It covers two forms: a leaf mapping (`state.name: user.name`) and a subpath read under an object mapping (`state.user: user` plus the child reading `user.name`). Only the latter hits break 3. Both were confirmed to fail against the pre-fix code.

### 1.8 A child scope cannot iterate the parent's list with `for` ✅ fixed (2026-08-10)

The form §1.7 excluded as "a case where registration is impossible" — the child holding `<template data-wcs="for: items">` against the rule `state.items: rows` — **did not even manage the first render**. It threw `ListIndex not found: rows.*.name` and stopped with the child's binding initialization incomplete (`getBindingsReady` never resolving), so not one row rendered. The break was in three layers.

1. **The listIndex is lost crossing the boundary.** A mapped state is really an innerState proxy, and reads and writes to it are `Reflect.get/set(target, path)`. What reaches the Proxy trap is **the path string alone**, and the listIndex the child had resolved is discarded. After translating the path `items.*.name` → `rows.*.name`, innerState only pulls the loop context from `getLoopContextByNode(the component element)`. That is the context for the form "the component itself is inside the parent's `for`"; the child scope's loop is **inside** the component and cannot be pulled that way.
2. **The parent state does not know its mapping target is a list.** `setPathInfo(path, "for")` pushes `listPaths` / `elementPaths` onto **the state element that owns the binding**. The child's `for: items` is pushed only on the child side, and the parent — which holds the actual array — treats `rows` as a plain object path. The parent's dependency walk uses `listPaths` to decide the static child expansion `rows → rows.*`, so unregistered it never expands into per-row listIndexes but collapses into one "wildcard address with a null listIndex" (measured: unregistered `["rows.*#null"]` versus registered `["rows.*#0","rows.*#1"]`). A collapsed address matches none of the row bindings, which are registered with a listIndex. And without `rows.*` in `elementPaths`, assignment to a row itself (the swap idiom) falls to a plain assignment with no listIndex-ledger re-linking.
3. **There is no route subscribing to a parent-originated write of a row field** (skip condition (b) of §1.7).

**The fix**:

- **Cross the boundary by address** ([`crossBoundaryAddress.ts`](../../packages/state/src/webComponent/crossBoundaryAddress.ts) (new) / [`innerState.ts`](../../packages/state/src/webComponent/innerState.ts)). The address immediately before `Reflect.get/set` is pushed into a dynamic scope, and innerState reassembles it into a loop context for the outer wildcard path. Since the listIndex ledger (`listIndexesByList`) is keyed on **array object identity**, parent and child share the same `IListIndex` instance and it can be reused directly. The push/pop happens only on a state element where `hasMappedComponentState` is true, and never on an ordinary state's `getByAddress` / `setByAddress`.
- **Propagate outward that it is a list** ([`outerListPath.ts`](../../packages/state/src/webComponent/outerListPath.ts) (new) / [`State.setPathInfo`](../../packages/state/src/components/State.ts)). When the child declares a `for`, the mapping is pulled and `setPathInfo(outerPath, "for")` is delivered to the mapped state element too. `_initializeBindWebComponent` runs before binding collection, so the mapping rules already exist at that point.
- **Row bindings ride along in the parent's pattern ledger** ([`BindingSession.registerAddress`](../../packages/state/src/bindings/BindingSession.ts)). A list row's binding is registered under the two-level key `(absolutePathInfo, listIndex)`, so it can also be registered as a subscriber to the parent's `rows.*.name` **under the same listIndex**. That works around §1.7's constraint — one derived binding cannot represent a row (its node is the single component element in the parent scope) — by making the subscriber the child's real binding. Cleanup is done symmetrically by the existing teardown through `record.outerPatternPathInfo`.
- **No cache layer in a mapped state** ([`isCacheable.ts`](../../packages/state/src/proxy/methods/isCacheable.ts) (new)). Even with the three above, a parent-originated row write did not arrive, and the cause was **the child-side cache**. The authoritative value is in the parent and its invalidation is the parent's dependency walk, so the invalidation never reaches the child's copy. Not holding a second copy is the only consistent measure, and what is lost is only the duplicated layer (the parent's cache still works).

**A reference for translation must have no side effect** (from review). Points 2 and 3 both pull the mapping from inside `BindingSession.registerAddress`. `getOuterAbsolutePathInfo` **registers a subscriber binding through `session.initialize` while it derives the rule**, so calling it directly re-enters `initialize` from inside a session operation (measured in the nested form: one re-entry). A `registerSubscriber: false` was added to separate a reference-only route. The key point is not to memoize the reference-only result: memoizing it would make a later genuine read hit the memo and **skip the subscriber registration forever** (registration for the second row onward hits the ledger the first row's read established, so the derivation only reruns on the first).

**The support range.** What works is "the component is outside the parent's `for`, and the child iterates a mapped array". The nested form where **both** a parent-scope loop and a child-scope loop apply (the child also having a `for` on top of the rule `state.items: rows.*.children`) was initially out of scope (`getOuterRowPathInfo` rejected it as a wildcard-level mismatch). **Resolved on 2026-08-11 in §1.10** — parenting the child's row listIndex to the parent scope's row dissolved the premise of "two instances that cannot be composed".

The regression is on happy-dom
([`integration.bindComponentListRow.test.ts`](../../packages/state/__tests__/integration.bindComponentListRow.test.ts)), covering the first render, list replacement, a row-field write from the parent, a write-back from the child, reuse of row nodes, ledger cleanup, coexistence with the parent scope, **several instances of the same component** (propagation and subscription both have to work per state element instance), a cross-cutting `$getAll` read, and non-regression of the previously working forms and of plain components. The real browser is
[`e2e/tests/state-bind-component-list.spec.ts`](../../e2e/tests/state-bind-component-list.spec.ts).

### 1.9 Replacing a list whose rows contain components kills `for` ✅ fixed (2026-08-10)

In the form from the README's ["Loop with Components"](../../packages/state/README.md) (a `<my-row data-wcs="state.row: groups.*">` in each row of `<template data-wcs="for: groups">`), **replacing the array leaves not one row rendered, and no subsequent update ever recovers**. It is a separate matter found during §1.8's spike and predates both §1.7 and §1.8.

Because a row's content is reused from the pool, a recreated row has its apply run **before it returns to the DOM**. `stateElementByWebComponent` is a ledger keyed on the element, so at that point it still points at the previous (already disconnected) state element, and `createState` against it `raiseError`s with `State rootNode is not available.` **Neither the updater's drain nor `applyChangeToFor`'s row loop catches the exception**, so one row takes the whole rest of the batch down with it. That is the same shape as the "one misconfigured tag makes other bindings in the same batch unupdatable" that §1.7 stamped out.

The isolation (measured on happy-dom):

| What is inside the `for` row | List replacement |
|---|---|
| a `<span>` only / a plain custom element / an element with only a shadow / an **independent** `<wcs-state>` inside the shadow | ✅ |
| a **`<wcs-state bind-component>`** inside the shadow | ❌ every row dies, and re-replacing never recovers |

**There are three fixes, and missing any one of them fails in a different way.**

1. **Do not notify a disconnected state element**
   ([`applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts)).
   `IStateElement.hasRootNode` was added for the check (**registered and usable are different things**). This is a re-read notification carrying no value, so there is no point sending it to a disconnected child in the first place.
2. **Re-read mapped paths on reconnection**
   ([`State._reloadMappedPathsAfterReconnect`](../../packages/state/src/components/State.ts)).
   With only 1, the view of a component that **builds its shadow in the constructor** stays stale. In that form `<wcs-state>` is reused on reconnection and, `_initialized` being true, neither `_initializeBindWebComponent` nor `_initialize` runs — the child's bindings are not re-established. Since 1 drops the notification during disconnection, nothing fixes it unless it is re-read here. The form that rebuilds the shadow in `connectedCallback` gets a new state element and passes with 1 alone — **so the missing 2 is invisible unless both forms are tested**.
3. **Discard the memo of derived mapping rules**
   ([`MappingRule.resetDerivedMappingRules`](../../packages/state/src/webComponent/MappingRule.ts)).
   Even with 1 and 2, only the rows after a replacement fail to receive **row-field writes**. A derived rule (break 3 of §1.7) stands a subscriber up in the parent scope as it derives, but that subscriber is torn down when the child disconnects while **the memo remains, keyed on the element**, so after reconnection the derivation never runs again and no subscriber is re-established. `buildPrimaryMappingRule` does the same cleanup on a rebind. Since bindWebComponent does not run on reconnection, the same state is restored immediately before the re-read.

The regression is pinned both on happy-dom
([`integration.bindComponentRowReplace.test.ts`](../../packages/state/__tests__/integration.bindComponentRowReplace.test.ts)) and in a real browser
([`e2e/tests/state-bind-component-row-replace.spec.ts`](../../e2e/tests/state-bind-component-row-replace.spec.ts)). Both line up **the form that builds the shadow in the constructor and the form that builds it in connectedCallback** (for the reason in 2 above). The discriminator is the view inside the Shadow — a parent-scope row is the parent's own binding and updates even where delivery to the child is dead.

### 1.10 A component inside a parent-scope `for` cannot run a `for` in the child either ✅ fixed (2026-08-11)

The nested form §1.8 left as "out of scope" (the child having `for: items` on top of `state.items: groups.*.children`). The symptom was not an exception but **a silent hang** — `ListIndex not found: groups.*.children.*.name` merely surfaced as an unhandled rejection, `getBindingsReady` neither resolved nor rejected, and everything after the `await` never ran.

The wall was that **one array object was required to have two depths**. Seen from the parent, a row of `groups[i].children` has arity 2; seen from the child, a row of `items` has arity 1. But `listIndexesByList` is a WeakMap on array object identity, so one array can hold exactly one set of listIndex ledgers. Doubling the ledger was not an option — it would return to the "two representations of the same thing" that §1.7 stamped out.

**The idea behind the solution**: treat the child scope as "just a nested loop inside the parent loop". Because that is what it is. Parenting the listIndex the child creates to a **base listIndex** (the host component's parent-scope row, depth Δ) makes the ledger for `groups[i].children` arity Δ+1 — **the very same set** the parent demands of `groups.*.children.*`.

What made the implementation work was a rewrite that avoided plumbing Δ everywhere: moving the conversion of "a wildcard's position in a path → a level in the chain" **from a head origin to a tail origin** (`at(i)` → `at(i - W)`). `IListIndex.at()` accepts a negative value, so at Δ=0 both point at the same element — **a pure refactor with zero behavior change for existing scopes** — and Δ>0 then works. That "unchanged at Δ=0" was not left to inference: a temporary probe **measured every test** to confirm it (zero divergence on the real paths). **Out-of-range requests are the one exception**: "`$2` inside a one-level loop" regresses from a raiseError to "silently returning `$1`", so an explicit range guard is needed (one existing test caught this).

Δ is confined inside the boundary. `$1`, an event handler's index, `$updatedCallback`, and `$getAll` report the position within the scope — because a component's author writes without knowing whether they will be placed inside a list. `$resolve` is unmodified, since it looks things up by array position in the ledger.

**The base MUST NOT be cached** (a row's content is reused from the pool and the same element is re-linked to a different row — the same shape as the memo trap of §1.9). And the base has to be passed to the parent on **all five routes that can create a list row** — `createListDiff` reuses an existing ledger where there is one, so a miss is invisible on the first render and **only mixes arities into the ledger when a row is added**.

**As a by-product it stamped out a third instance of the same shape as §1.7 / §1.9**: a read pointing at a vanished row became a raw `TypeError: Reflect.get called on non-object`, which neither the updater's drain nor the row loop caught, so it took unrelated updates in the same batch down with it. A parent-scope-originated row notification is applied **before** the child's `for` that removes that row (within one scope the topological order puts `for` first, but nothing guarantees the order across the boundary). Resolved by making a read of a path with no parent return `undefined` — `undefined` is already a value that skips a property write, so the DOM is untouched and the `for` right after reconciles it.

The details, and a separate matter found during implementation (**the structure where an exception during binding initialization left the ready promise unresolved forever** — fixed on 2026-08-11 by plumbing the reject through; design doc §8.2), are in [state-bind-component-nested-for-design.md](../state-bind-component-nested-for-design.md) (ja).

The regression is on happy-dom
([`integration.bindComponentNestedFor.test.ts`](../../packages/state/__tests__/integration.bindComponentNestedFor.test.ts),
[`webComponent.baseListIndex.test.ts`](../../packages/state/__tests__/webComponent.baseListIndex.test.ts)) and in a real browser
([`e2e/tests/state-bind-component-nested-for.spec.ts`](../../e2e/tests/state-bind-component-nested-for.spec.ts)). Both line up **the form that builds the shadow in the constructor and the form that builds it in connectedCallback** (the reason in §1.9). One phenomenon appeared only in the real browser — the existing behavior where a write to an out-of-range row throws `ListIndex not found: <parent path>`, whose message points at the wrong cause (unrelated to this work, but recorded in design doc §8.4; fixed on 2026-08-11 to an indexed message).

### 1.11 A parent-origin row-field write does not cross more than one boundary ✅ fixed (2026-08-13)

Everything verified in §1.1 through §1.10 sat at **depth 1** — host to component, one
boundary. What §1.10 nested was the `for`, not the boundary. The form with two boundaries
stacked — a mapped `bind-component` inside another component's shadow — had never been
measured.

Measured, **scalar paths hold in every direction down to depth 4**. They do so because the
resolution is recursive: `innerState`'s get / set re-enter `outerAbsPathInfo.stateElement`,
and that outer element may itself be an innerState, so extra hops compose with no special
casing. Lists also hold to depth 3 for the initial render, list replacement, and write-back
from the leaf.

The one case that did not hold is a **parent-origin row-field write**, which stops at depth 1.
The cause is that the mechanism added in §1.8 — piggybacking a row binding onto the parent's
pattern ledger — was an **explicit one-shot registration**. `getOuterRowPathInfo` walked one
boundary outward and stopped, and the record kept the result in the single
`record.outerPatternPathInfo` field. At depth 2 the leaf row is therefore only listed under the
intermediate scope's `list.*.name`, and when the host that owns the values writes
`rows.*.name` there is no subscriber at all — the intermediate scope merely passes the array
through and owns no row binding of its own, so it does not relay either.

> **What resolves recursively scales with depth; what registers explicitly stops at one.**

The fix makes the outward walk multi-hop (`getOuterRowPathInfosBeyond`) and promotes the
record to `outerPatternPathInfosRest`. The first hop is unchanged, and the rest stays `null`
when there is no second hop — so the overwhelmingly common depth-1 row allocates no array
(the same "hold one, promote on the second" idiom as `interestedSessionsByNode`). Each hop is
registered only after checking `Δ + innerW === outerW`, so a hop whose arity does not line up
stops the walk and falls back to the previous behavior. Teardown releases every hop
individually (each is an independent resource).

The regression is [`integration.bindComponentDepthN.test.ts`](../../packages/state/__tests__/integration.bindComponentDepthN.test.ts).
The point is that **depth 1 is kept in the same test as the control**: if depth 1 passes and
depth 2 fails, that points at the mechanism rather than at how the test was written. Depth is
parameterised from 1 to 4, and both the constructor-built and connectedCallback-built shadow
forms are lined up (the reason in §1.9).

### 1.12 A list cannot cross two boundaries when the intermediate component sits inside a parent `for` ❌ open

§1.10's nested form with one more boundary added, the intermediate component sitting at Δ=1.

```
host { groups: [ { children: [...] }, ... ] }
  └ <template for: groups>
       └ <panel state.items: groups.*.children>   … the Δ=1 intermediate (pass-through)
            └ <card state.list: items>            … the leaf iterates
```

This fails **from the initial render** with `ListIndex not found: groups.*.children.*.name`, i.e.
upstream of the row-field subscription (§1.11): the listIndex does not cross at all.
`getBaseListIndex` only looks one boundary's worth of loop context off the component element,
so crossing two boundaries appears to lose the composition of Δ (Δ₁+Δ₂).

It is independent of the §1.11 fix, and the symptoms were confirmed identical before and after
it (4 failures before, 2 after; these two are what remains). The reproduction sits in the same
file under `describe.skip`. It cannot be pinned with `it.fails` because this form fails by
throwing **asynchronously** out of the updater drain rather than by a synchronous assertion,
so `it.fails` leaves it as a Vitest unhandled error. Remove the `.skip` once it is fixed.

---

## 2. Contract divergences (the real damage is case-dependent)

### 2.1 A DCC change event fires only on an exactly matching path ✅ fixed

`setByAddress` decided on an exact match of `bindableEventMap[address.pathInfo.path]`. With `$bindables: ["user"]`, writing `user.name` did not fire. In-place array mutation, `$postUpdate`, and getter-derived values were likewise silent. wcBindable's `properties[].event` is contracted to "fire on a change", so this diverged.

**The fix**: the decision was carved out into [`dispatchBindableEvent.ts`](../../packages/state/src/dcc/dispatchBindableEvent.ts), covering three routes.

1. **An exact match** — as before. The `detail` is the value written.
2. **A subpath** — `user.name` / `items.*.done` fire the `user` / `items` member. An entry in `$bindables` is always a flat top-level name (a dotted name is rejected by §2.3's existence check), so looking at the first segment suffices. In this case no `detail` is attached — carrying a value that is not the whole member would mislead.
3. **`$postUpdate`** — the canonical idiom for notifying an in-place mutation. It fires from `postUpdate` too.

Alongside that, `createWcBindable` now declares `getter: (event) => event.target[name]` on each property. That settles into the form **the event notifies, the value is read from the element**, removing the dependence on `detail`. A subpath write has no single value that could be carried, and where the state-side setter normalizes, the `detail` would be the pre-normalization value — so `detail` was never a trustworthy route.

**What remains uncovered**: an in-place mutation with no `$postUpdate` (`items.push(...)`). It does not pass through the set trap and is not caught here either, but that is the same as the norm of the reactive core as a whole (an in-place mutation is notified with `$postUpdate`) and is not a DCC-specific divergence.

**The interaction with `$listKeys`**: an array assignment to a list path declaring [`$listKeys`](../state-list-key-design.md) (ja) decomposes, after key matching, into per-path writes of the changed fields (that doc's §2). Each of those falls under 2 (a subpath), so **one list assignment fires `1 + N` times** (N = the number of rows with a changed field). The first is an exact match on the list itself, so its `detail` carries the new array; the subsequent subpath firings carry no `detail`. Measured (changing `name` on 2 of 3 rows): 3 firings with the declaration, 1 without.

Since an observer takes the form "the event notifies, the value is read from the element", **duplicate firings do not change the result**, but the event count being proportional to the number of changed rows is treated as a known property of applying `$listKeys` and `$bindables` to the same list. Folding it back to one would require coalescing per update cycle rather than per write, which is beyond `dispatchBindableEvent`'s remit and is deferred.

### 2.2 The DCC accessors are asymmetric between synchronous and asynchronous ✅ fixed

- `getterFn` is synchronous. Where the state is uninitialized it `console.warn`s and returns `undefined`
- `setterFn` / `callFn` are **asynchronous**, going through `initializePromise.then()`

([`dccPropertyFactories.ts`](../../packages/state/src/dcc/dccPropertyFactories.ts))

`el.count = 5; el.count` returns the old value. And since [`readProducerSnapshot`](../../packages/state/src/bindings/BindingSession.ts) reads `target[name]` synchronously, `#init=element` / `#init=auto` could commit `undefined` into the parent state through `commitProducerValue`. The default is `state` authority (being on both properties and inputs), so the ordinary route does not hit it.

**The fix**: `initialized` (the synchronous counterpart of `initializePromise`) was added to `IStateElement`, and `setterFn` now **writes synchronously where already initialized**. Only while uninitialized does it queue onto `initializePromise` as before — so §1.4's route of "not dropping a value written to an unconnected row" stays.

`getterFn` also treats uninitialized as the normal case of "no value yet", returning `undefined` without a warning. The initial snapshot read of a row on a fragment (`readProducerSnapshot`) always comes through here, so warning would make the ordinary flow noisy (§1.4's e2e was in fact emitting many). Only genuine errors remain as warnings.

`callFn` was **deliberately left always returning a Promise**. Making it synchronous would change the return type with the initialization state, and would contradict declaring `async: true` uniformly on `commands` in §1.6.

### 2.3 Only `$bindables` has no declaration validation 🟡 partially fixed

| Declaration | Validation |
|---|---|
| `$commandTokens` | array / non-empty string / reserved-name collision / duplicates all `raiseError` ([`processCommandTokensDeclaration.ts:17-39`](../../packages/state/src/command/processCommandTokensDeclaration.ts)) |
| `$streams` | collision checks against getterPaths / setterPaths |
| `$bindables` | only `Array.isArray(...) ? ... : []` in [`defineDCC.ts:28-30`](../../packages/state/src/dcc/defineDCC.ts) |

As a result, a non-array is silently ignored (`$bindables: "count"` quietly treated as empty), a nonexistent property name is unchecked (measured by probe: `["nosuch"]` goes into `properties` / `inputs` as-is → a write from the parent lands on an expando and vanishes), and a name starting with `$` is unchecked (it never appears on the prototype thanks to `isInternalProperty`, yet it goes into wcBindable).

**The fix**: [`processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts) was added, `raiseError`ing on **a non-array / a non-string or empty string / a leading `$` / duplicates** with the same strength as `$commandTokens`.

**The existence check** (done together with G2): `raiseError` where the name is absent from `getAllPropertyDescriptors` (the traversal shared in §2.4). It also looks at the kind, steering a method written in `$bindables` and a value property written in `$commands` to the other declaration.

For `$streams`, the choice was "allow stream names as existing too, and generate accessors". A value property is materialized on the instance side and has no descriptor at `defineDCC` time, so rejecting it straightforwardly would make `$streams` × `$bindables` an error across the board. That combination previously **grew no accessor and died silently**, so making it work seemed more sensible than erroring. Names with no descriptor become `streamBackedBindables`, for which `defineDCC` grows getters/setters separately.

> A remaining question: a stream-backed member also goes onto both `properties` and `inputs` (i.e. is treated as settable). Writing to a producer-driven value makes little sense, but `$streams` writes with `Reflect.set` at runtime too, so it is consistent as it stands. The point that the change event fires only on an exactly matching path (§2.1) applies to stream-backed members too.

### 2.4 The prototype chain is treated differently by State and DCC ✅ fixed

- `State` walked the prototype chain to collect getterPaths / setterPaths
- `defineDCC` used only the own descriptors from `Object.getOwnPropertyDescriptors(state)`

Writing the state as a class instance or through `Object.create(proto)` makes the two disagree, giving the state "it is in getterPaths but no accessor grows on the DCC prototype". An object literal being the convention makes it unlikely to surface, but the mere fact of two traversals was also the reason §2.3's existence check could not be added.

**The fix**: the traversal was carved out into [`getAllPropertyDescriptors.ts`](../../packages/state/src/getAllPropertyDescriptors.ts) and shared by both. For the same name, the nearer one (closer to the object itself) wins — matching the actual precedence of property resolution. The original implementation had the more distant prototype overwrite last, but since getterPaths / setterPaths only look at the set of names, it never surfaced.

### 2.5 The DCC's inner `<wcs-state>` is fixed at `:not([name])` 🟡 partially fixed

`stateTagSelector` in [`defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts). Add a `name` and `stateElement` is always `null`, making every getter `undefined` and every setter a no-op.

Conversely, bind-component **requires** a `name` in the Light DOM ([`State.ts:278`](../../packages/state/src/components/State.ts)). For the same "state inside a component", the naming conventions are exact opposites, with no cross-validation.

**The fix**: behavior is unchanged, but a `console.warn` is emitted where `$bindables` is declared and no unnamed `<wcs-state>` is found (the branch previously failed silently). Unifying the naming convention itself is untouched, pending §3.

### 2.6 Specifying both bind-component and a state source attribute silently discards one ✅ fixed

The path is `_initializeBindWebComponent()` → `setInitialState()` → `_resolveSetState()` ([`State.ts:628-634`](../../packages/state/src/components/State.ts)), but `_initialize()` prefers `state` / `src` / `json` / an inner `<script>` where present and does not await `_setStatePromise` (`State.ts:213-240`). The result is that the proxy built by `createInnerState` is discarded along with everything else, and the parent↔child mapping dies.

**The fix**: `_initializeBindWebComponent` detects co-specification with `state` / `src` / `json` / an inner `<script type="module">` and `raiseError`s. Co-specification is always a configuration mistake, so failing fast is correct.

### 2.7 When `bindableEventMap` is set ✅ fixed

`defineDCC` set it in `initializePromise.then()`, so an initial change made inside `$connectedCallback` emitted no event.

**The fix**: it is set synchronously inside `connectedCallback`. `setBindableEventMap` only assigns a field and does not reference the state, so calling it before `<wcs-state>` initializes is safe.

---

## 3. Design and hygiene

- **3.1** ✅ fixed (G3). A `bind-component` inside a DCC definition was silently ignored by the DCC detection's `return`. A DCC's state belongs to the template and is loaded per instance, so it is incompatible with bind-component, whose source is the host's properties at definition time. Changed to `raiseError`.
- **3.2** ✅ fixed (G3). The range over which wcBindable is required did not line up between mechanisms. spread (`...:`) and command-token require wcBindable and `raiseError` where it is undeclared, but a bind-component component has no wcBindable, so `state.msg: x` passes. **The same "component", yet different syntax is writable.**

  This was reframed as a design consequence rather than a defect. bind-component wires through **paths** rather than a declared property surface, so it is coherent that the syntaxes requiring a `wcBindable` declaration are unavailable. Rather than unify them, it was **made normative**: a new "Choosing a Component Mechanism" section was added to README.md / README.ja.md with a table across six axes — how it is defined, where the state lives, whether there is a `static wcBindable`, binding a value from the parent / invoking a method from the parent, whether spread is available, and reading / writing its own state — stating that they are mutually exclusive and giving guidance on choosing. `src/dcc/README.md` and `src/webComponent/README.md` cross-reference it.
- **3.3** ~~Root determination happens two ways~~ ❌ **an error in this document (corrected 2026-08-05)**. The coexistence of `instanceof ShadowRoot` (`State.ts:268,357` / `setByAddress.ts:237`) and `rootNode.constructor.name === ...` ([`stateElementByName.ts`](../../packages/state/src/stateElementByName.ts)) was written up as "not lined up", but the latter was **necessary**. Under SSR, `@wcstack/server`'s `installGlobals` puts only part of happy-dom onto `globalThis`, and its `GLOBALS_KEYS` does not include `Document`. Node has no `Document` either, so `rootNode instanceof Document` would be a ReferenceError. `ShadowRoot` is in the list, which is why the instanceof elsewhere works. **The action taken = adding a comment explaining why** (they are not unified). The point that bindings are not built for a `DocumentFragment` root is a fact, but a fragment is given its own destination through `setRootNodeByFragment`, so it is not an omission here.
- **3.4** ✅ fixed (G3). The etiquette on a duplicate definition was uneven. A duplicate DCC tag `console.warn`ed and skipped, while a duplicate state name `raiseError`ed (`stateElementByName.ts`). The DCC side was aligned to `raiseError`. Settling for a warning means first-wins and **an instance of a different template growing**, producing "it looks like it works but the contents differ". That is right to fail as an authoring error.
- **3.5** ✅ fixed. `IStateElement` had `bindableEventMap` (readonly) but no `setBindableEventMap`, so `defineDCC` imported the concrete `State` and cast (a backwards reference from dcc → components). A setter was added to the interface, and `defineDCC` now depends only on `import type { IStateElement }`. The type of `stateElement` lines up with `dccPropertyFactories` too.
- **3.6** ✅ fixed. [`src/dcc/README.md`](../../packages/state/src/dcc/README.md) remained a design memo and disagreed with the implementation (`typeof func.constructor.name === "AsyncFunction"` is always false; the old spec of dispatching events at the stateElement rather than the host; and so on). [`src/webComponent/README.md`](../../packages/state/src/webComponent/README.md) was only fragments. Both were rewritten as supplements to the implementation, stating explicitly that "`packages/state/README.md` is authoritative", with unfixed limitations linked to this document.

---

## 4. The root causes

They come down to three.

1. **(2) partially implements (1)'s declaration spec** — `createWcBindable` creates only `properties` / `inputs`, with no `commands` and no duplicate check. (1)'s reader is strict, so the declaration (2) generates gets rejected by (1) (1.5 / 1.6 / 2.3). It is a recurrence of the same structure as the missing `inputs` in 10-defaulting-rollout-status.md.
2. **The internal channel and the public API use the same proxy** — (3)'s `outerState` is correct for the internal purpose of "a re-read notification from parent state to child", but it is visible to the author as `this.state` (1.1 / 1.2).
3. **The lifecycle discipline is not shared between mechanisms** — `<wcs-state>` handles reconnection, generations, and being unconnected, while (2)'s DCC class handles none of it (1.3 / 1.4).

## 5. The remediation outlook (order and size)

| Priority | Item | Size | Status | Notes |
|---|---|---|---|---|
| P0 | 1.2 change the branch condition to "is there at least one `<stateProp>.*` binding" | a few lines | ✅ | a pure condition bug with no semantic change |
| P0 | 1.3 a reconnection guard in the DCC `connectedCallback` | a few lines | ✅ | `if (this._shadow !== null) return;` |
| P0 | 1.5 / 2.3 declaration validation in `createWcBindable` equivalent to `$commandTokens` | small | ✅ | `processDccDeclarations` added. The existence check was done together with G2 |
| P1 | 1.4 make the DCC's shadow construction possible before connection | medium | ✅ | §7 G4 = (a). Implemented as lazy construction (the reason is in §1.4) |
| P1 | 1.6 generating the DCC's `commands` | small to medium | ✅ | §7 G2 = (a), an explicit `$commands` declaration. §2.3's existence check done at the same time |
| P2 | 1.1 unify the semantics of `this.state` | large | ✅ | the internal channel and the public API separated (§7 G1 = (b)) |
| P2 | 2.1 the firing range of the change event | medium | ✅ | a subpath folds onto the member of its first segment. `$postUpdate` fires too |
| P3 | 2.4 share the traversal / 2.6 fail fast on co-specification / 2.7 set synchronously / 3.5 types / 3.6 README | small | ✅ | |
| P3 | 2.5 unify the naming convention | small | 🟡 | only the diagnostic warn was done. Unifying the convention goes with §7 G3 |
| P3 | 3.1 / 3.2 / 3.4 | small | ✅ | §7 G3 = (b), making the separation normative |
| — | 2.3's existence check | small | ✅ | `$streams` names are allowed and accessors generated (the end of §2.3) |

## 6. The regression-test gaps

- ✅ `webComponent.bindWebComponent.test.ts` mocks every dependency, so it never verified **the combination of outerState / innerState semantics**. 1.2 fell into that gap → `webComponent.bindWebComponent.semantics.test.ts` was added, pinning the read / write results against the real modules.
- ✅ `__e2e__/dcc/index.html` had only a single DCC instance, with **no DCC in a list and no conditional DCC**. 1.3 / 1.4 fell into that gap → [`e2e/tests/state-dcc-in-list.spec.ts`](../../e2e/tests/state-dcc-in-list.spec.ts) was added, hitting both with a three-row `for` plus an `if` toggle. **Without that e2e, 1.4's fix would have passed while still incomplete** (the missing upgrade of a template clone does not reproduce on happy-dom; the end of §1.4).
- ✅ bind-component, in unit and e2e alike, only looked at "initial delivery from parent to child", and **the read / write through the public property had never once been exercised**. 1.1 fell into that gap → [`e2e/tests/state-bind-component-write.spec.ts`](../../e2e/tests/state-bind-component-write.spec.ts) was added, pinning both directions of `element.state.x` on a mapped element in a real browser.
- 🟡 The `bindable-conformance` job of 10-defaulting-rollout-status.md §209 states that "a declaration factory that does not appear in the dist exports (DCC's `createWcBindable`) is pinned by a state unit test", but that unit test only looked at the identical set of `properties`/`inputs`, leaving `commands` and duplicate names outside its scope → duplicates and `commands` are now pinned by `dcc.processDccDeclarations.test.ts`.

## 7. Decision gates

**All four were settled on 2026-08-05.** Below are the decisions, and why the rejected options are recorded.

### G1: the semantics of `this.state` — ✅ **(b) separate the internal channel** (implemented)

The public surface is unified on the plain semantics: even under mapping, reads are live and writes reach the parent state through innerState. The parent → child re-read notification moved into `applyChangeToWebComponent` pulling the state element directly with `getStateElementByWebComponent` and calling `$postUpdate`. Since it no longer goes through `element[stateProp]`, the public proxy no longer needs the "discard the value" constraint.

- Rejected (a) "let mapped write through too" — it fixes the proxy semantics, but the parent → child notification would keep travelling the same route, adding a round trip of redundant write-back into the parent state and leaving a dependence on echo suppression (the same-value guard / propagation context).
- Rejected (c) "mapped is read-only" — minimal to implement, but it contradicts the README and the purpose of `$stateReadyCallback`, and forces users to rewrite.

As a by-product the mapped-only proxy (the old `outerState.ts`) and `lastValueByAbsoluteStateAddress.ts` became unnecessary and were deleted. `innerState.get` also lost its listIndex resolution and ledger write, removing one `createAbsoluteStateAddress` allocation per read.

### G2: the DCC's commands — ✅ **(a) add an explicit `$commands` declaration** (implemented)

`$commands: ["inc"]` was introduced as the counterpart to `$bindables`, and only what is declared goes onto `wcBindable.commands`.

- Rejected (b) "auto-declare the functions on the prototype" — internal helpers would surface publicly. An explicit declaration is also consistent with the existing policy that "data-wcs is wiring, not a DSL".
- Rejected (c) "make not generating them normative" — it would leave §1.6's asymmetry (event-token works while command-token alone cannot).

§2.3's existence check (`$streams` × `$bindables`) was done at the same time.

### G3: the relationship between (2) and (3) — ✅ **(b) make the separation normative**

They are not unified. The README states the guidance "HTML alone → DCC; a JS class → bind-component" plus a table of the syntax available per mechanism. §3.1's silent return becomes a `raiseError`, and §3.4's `console.warn` on a duplicate DCC tag is aligned to `raiseError`. **Implemented.**

The table's axes are six: how it is defined, where the state lives, whether there is a `static wcBindable`, binding a value from the parent, invoking a method from the parent, whether spread is available, and reading / writing its own state. It is not in the SPEC — this is a choice of mechanism within wcstack, not a norm of the wc-bindable protocol.

### G4: applying to an unconnected element — ✅ **(a) solve it on the DCC side** (implemented)

Accessors work while unconnected. The impact stays inside DCC, and it naturally subsumes §1.3's reconnection guard. The implementation took the lazy construction of `_ensureShadow()` rather than moving into the constructor (the reason is in §1.4).

- Rejected "extend `applyChange` to wait for connect" — the cause is general, but it would change the application timing of every mechanism and every I/O node. §1.4 is a DCC-specific symptom (other Shells assign plain fields, so the value survives while unconnected), so the case for moving the general side is weak.
- Rejected "a pending buffer on the DCC side" — it avoids touching the constructor but adds contracts about state and flush order.

## 8. How to reproduce the probes

The "measured by probe" figures in this document can be reproduced as follows. A temporary file was placed in `packages/state/__tests__/`, run with `npx vitest run <file>`, and deleted after confirmation (it is not kept in the repository).

- **1.3**: `defineDCC(host, shadow, {count:0,$bindables:['count']})` → create an instance and append it to `document.body` → `el.remove()` → re-append and confirm `attachShadow` throws.
- **1.5**: pass an element carrying `createWcBindable('t-dup', ['count','count'])` to `readBindableDeclaration()` and confirm it returns `null`.
- **1.6**: confirm simultaneously that the generated `static wcBindable` has no `commands` key and that `Ctor.prototype.inc` is a function.
- **1.2 / 1.1**: run `bindWebComponent(fakeStateElement, component, 'state', {...})` both with and without a `data-wcs` on `component`, and compare the read / write results of `component.state.msg` (mapped: `undefined` / a no-op; plain: pass-through).
