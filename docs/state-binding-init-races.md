# Investigation record: two races in state binding initialization (load-before-bind clobber / a silently dropped initial apply to an undefined element)

- **Status**: **resolved** (2026-07-12; investigated and fixed the same day).
  - **Bug 2 = option A implemented**: added `packages/state/src/apply/scheduleDeferredApply.ts`, which schedules a whenDefined re-application from `applyChange`'s skip branch (made symmetric with two-way attach and deferred spread). Unit test = `packages/state/__tests__/integration.applyDeferred.test.ts` (happy-dom replaces nodes, so it covers only the no-op / error / duplicate-registration guard); the real-browser regression for the happy path = `e2e/tests/state-deferred-apply.spec.ts` plus `e2e/fixtures/deferred-apply.html`. All state tests, the coverage thresholds (100/97/100/100), lint, and build are green.
  - **Bug 1 = option C applied → the permanent fix is implemented too (2026-07-21, unreleased)**: short term, `examples/state-cross-tab-todo` was fixed to the idiom (an undefined initial value plus a `$connectedCallback` pull plus script ordering), the storage README (en/ja) had its Quick Start §1/§4 corrected to the safe form, and "§5 load-before-bind: the idiom for a persistent slot" was added. The real-browser regression for reload persistence was added to `e2e/tests/state-cross-tab-todo.spec.ts`. The permanent fix is carried, as a generalization of option A, by `#init=element` / `#init=auto` of directional initial sync (`docs/architecture-hardening/09` §3.6, on by default since v1.21.0) — though the initial implementation had authority permanently blocking the steady-state apply too, which killed the save direction for a two-way member, corrected on 2026-07-21 to "authority governs the initial sync only" (the eighth item of §D in the same `10-defaulting-rollout-status.md`). After the release, one modifier — `value#init=element: todos` — replaces the idiom (an undefined initial value plus a `$connectedCallback` pull).
  - **Option B applied**: `examples/README.md` / `README.ja.md` now state the rule that "the script for an I/O node comes before state".
- §1 through §4 below are kept as the record at investigation time (the mechanism, the measurements, the comparison of candidates).
- **How it was found**: measured and found through Playwright real-browser verification of the three demos added to examples ([examples-uncovered-combos.md](./examples-uncovered-combos.md) (ja)).
- **Impact**:
  - Bug 1 caused **real damage to the existing demo `examples/state-cross-tab-todo`** (todos vanished on every reload; unfixed as of this document). Every page using `<wcs-storage>`'s two-way wiring was affected.
  - Bug 2 is configuration-dependent (a configuration where state finishes initializing before the I/O node is defined) and makes any state→element initial wiring go missing **silently**.
- **The shared background**: both stem from there being no guaranteed order between "`<wcs-state>`'s asynchronous initialization" and "the define / connectedCallback of the I/O node element". The existing demos are fine only by **the accident** of loading every package from the same CDN, which gets the define done first.

---

## 1. storage's load-before-bind clobber

### 1-1. Symptom

With the standard two-way wiring `<wcs-storage type="local" data-wcs="value: todos">`, **every reload overwrites and erases the persisted localStorage value with the state's initial value (`[]` / `null`)**.

### 1-2. Measured (Playwright, e2e serve :4173)

```
add one todo in examples/state-cross-tab-todo:
  before reload: localStorage = [{"id":"...","text":"probe item","done":false}]
  after  reload: localStorage = []        ← gone
  list items after reload: 0
```

The same symptom (0 swatches after a reload) was confirmed in state-color-palette before its fix.

### 1-3. The mechanism (a timeline)

1. In module script execution order, `wcs-storage` is defined → upgraded → `connectedCallback` → an automatic `load()` → `_setValue` with the persisted value → **the value event dispatches**. State's binding is not yet established at that point, so **the event is missed**.
2. `<wcs-state>`'s asynchronous initialization completes → the binding attaches → `applyChangeFromBindings` **writes the state's initial value (`[]` / `null`) into the element**.
3. `<wcs-storage>`'s `value` setter is **write-through** when not manual (the setter in `packages/storage/src/components/Storage.ts` → `_core.save(v)`) → `[]` stores `"[]"`, `null` calls `removeItem` → **the persisted value is gone**.
4. The save re-fires the value event → two-way writes `[]`/`null` back into state → the screen looks consistently "empty", which makes **the loss hard to notice**.

### 1-4. The workaround idiom (**now deprecated** — use `#init=element` from §1-6)

> **Status**: the following was the workaround as of 2026-07-12 and has been removed from examples and the storage README. The current canon is `value#init=element:` from §1-6. This section is kept as a record of how it went. It remains a valid workaround only in a configuration with `enableDirectionalInitialSync: false`.

Start the persistent slot **as `undefined`** (the existing norm is that `applyChangeToProperty` treats undefined as "no opinion" and skips the property write itself → steps 2-3 never happen) and pull the missed initial load value once in `$connectedCallback`:

```js
palette: undefined,   // not null and not [] (the clobber guard)

$connectedCallback() {
  (async () => {
    await customElements.whenDefined("wcs-storage");
    const el = document.querySelector("wcs-storage");
    if (!el) return;
    await el.connectedCallbackPromise;   // wait for the load to finish
    if (!Array.isArray(this.palette) && Array.isArray(el.value)) {
      this.palette = el.value;           // a no-op if it already arrived through the binding
    }
  })();
},
```

Reads go through a normalizing getter, `get list() { return Array.isArray(this.palette) ? this.palette : []; }` (the same shape as cross-tab-todo).

### 1-5. Candidates for a permanent fix (undecided)

| Option | Content | Trade-off |
|---|---|---|
| A | **Narrowly suppress the initial apply**: for a two-way wcBindable property, skip the initial state→element write where the element already holds a non-null value | A natural extension of the "do not write undefined" norm. But it is hard to distinguish from the legitimate case of "I want the state's initial value pushed into the element", and it is a behavior change, hence a compatibility risk |
| B | **Re-notify from the storage side after binding**: dispatch the loaded value once more after the binding is established | There is no protocol by which the element can know it "has been bound" (outside wc-bindable's remit). A time-based re-notification creates new races over double application and ordering |
| C | **Make only the idiom normative**: state in the storage and state READMEs that "a persistent slot takes an undefined initial value plus a `$connectedCallback` pull", and fix cross-tab-todo to that idiom | The safest, with no behavior change. But the trap remains (you fall into it if you do not know) |

**Short-term recommendation = C** (including the cross-tab-todo fix). **Consider a narrow version of A** in the medium term. B is not recommended.

### 1-6. The permanent fix (**settled, and the current canon**): `value#init=element:`

As a generalization of option A, directional initial sync (`docs/architecture-hardening/09-remediation-design.md` §3.6) was implemented, turned on by default in v1.21.0, and settled in v1.22.0 into the form where authority governs the initial sync only. **One modifier completely replaces the idiom of §1-4**:

```html
<wcs-storage key="todos" type="local" data-wcs="value#init=element: todos"></wcs-storage>
```

- `value` is the only two-way member on `<wcs-storage>` (the Shell adds `value` to `inputs`), so the default authority is `state`. That is exactly the clobber of step 2 in §1-3.
- `#init=element` answers `false` when consulted about the first apply, stopping the initial state→element write (`BindingSession.shouldApplyState`), and instead commits the element's current value into state (`readProducerSnapshot` → `commitProducerValue`).
- In the steady state, state→element keeps flowing as for any two-way member, so **the save direction does not die** (the permanent-block divergence present in v1.21.x is fixed).
- Seed the state slot to match the element's real initial value (`null` for an empty key), and null-guard reads with a normalizing getter.
- Applied in: `packages/storage/README.md|.ja.md` §1/§4/§5, `examples/state-cross-tab-todo`, `examples/state-color-palette`. The regression is `e2e/tests/state-cross-tab-todo.spec.ts` (reload persistence = the clobber side; cross-tab sync = the save direction).
- `wcs-validate` recognizes the same modifier and emits `wcs/storage-seed-clobber` only for an empty-value seed without it (`packages/vscode-wcs/src/service/ioNodeValidator.ts`).

---

## 2. A silently dropped initial apply to an undefined custom element

### 2-1. Symptom

Where state's binding initialization completes before the element is defined, **the state→element initial application to that element (the property write, the first apply of the command wiring) is silently discarded and never re-applied**.

It surfaced in `examples/state-sse-dashboard` (state served locally and therefore fast; sse/network from a CDN and therefore slow): `url: sseUrl` was never written, `<wcs-sse>` stayed at a null url attribute with readyState 2, and **the left panel was silent**. Not a single error appeared in the console.

### 2-2. The code in question

`packages/state/src/apply/applyChange.ts` (at the top of applyChange):

```ts
const customTag = getCustomElement(binding.replaceNode);
if (customTag) {
  if (customElements.get(customTag) === undefined) {
    // expecting the custom element side to initialize
    return;          // ← skipped for good; no re-application after whenDefined
  }
}
```

### 2-3. The asymmetry (why this is considered a bug)

Every other path retries against the same "not defined":

- `attachTwowayEventHandler` (`event/twowayHandler.ts`): **re-attaches** via `customElements.whenDefined(tag).then(() => attachTwowayEventHandler(binding))`
- event token (`event/eventTokenHandler.ts`): likewise retries after whenDefined
- spread (`bindings/collectNodesAndBindingInfos.ts`): held as an `IDeferredSpreadEntry` and re-expanded after whenDefined through `processDeferredNode`, plus `applyChangeFromBindings`

**Only the initial value application** is a one-way skip that "expects the custom element side to initialize". That holds in the static case where the element can initialize from its own HTML attributes, but **where the value comes from state (a url derived from a getter, say) the element has no way to know it**.

### 2-4. The workaround idiom (adopted and verified in all three demos)

Use the guarantee that module scripts **execute in document order**, and put **the I/O nodes' `<script>` first and state last**. By the time state's module runs, every node is defined and the race disappears regardless of configuration:

```html
<script type="module" src="https://esm.run/@wcstack/sse/auto"></script>
<script type="module" src="https://esm.run/@wcstack/network/auto"></script>
<script type="module" src="/state-dist/auto.min.js"></script>  <!-- state last -->
```

(Many existing demos put state first and still work — the accident of the define finishing first. As a rule, nodes first and state last is the safe arrangement.)

### 2-5. Candidates for a permanent fix (undecided)

| Option | Content | Trade-off |
|---|---|---|
| A | **Add a whenDefined re-application to applyChange** (making it symmetric with two-way attach): in the skip branch, `customElements.whenDefined(tag).then(() => a one-shot applyChangeFromBindings([binding]))`. The re-application needs a connection check (`isConnected`) and has to apply the latest state value | Restores the symmetry and makes it configuration-independent. Since the application becomes asynchronous, ordering for things like "a command emitted before the define" is still not guaranteed (that is the known blank-shot race on the token side, a separate problem). `appliedBindingSet` is per-context so no permanent double-application guard is needed, but a ledger is needed to avoid registering multiple whenDefined callbacks for the same binding |
| B | **Only make the script-ordering rule normative**: state "I/O nodes first, state last" in examples and the READMEs | Safe, with no behavior change. But it cannot constrain the user's own page setup (a bundler, lazy loading, going through the autoloader), so the trap remains |

**Recommendation = A and B together** (A is low-risk and lines up with two-way / eventToken / spread; B is the operational rule until A lands).

---

## 3. Related facts confirmed in the same investigation (not bugs, but background)

- `applyChangeToProperty` silently skips a write to a getter-only property with a try/catch (which is why `data-wcs="held: x"` on an output-only property such as `held` / `connected` is safe). An undefined value skips the write itself (the "no opinion" norm).
- `<wcs-network>`'s `observe()` dispatches its initial snapshot **synchronously**, so it fires before the binding is established and is missed (the same family of miss as bug 1). permission and notification happen to avoid it because their first dispatch follows an asynchronous query.
  - **Now resolved** (superseding the description at investigation time): every observable property of these monitor nodes is output-only, so with directional initial sync (on by default since v1.21.0) the default authority `element` has the binding read the property directly when established. The manual pull in `$connectedCallback` became unnecessary and has been removed from the network and screen-orientation READMEs too. The real-browser regression is `e2e/tests/monitor-initial-snapshot.spec.ts`.
  - It said "adopted in state-sse-dashboard" at the time, but that demo's manual pull was removed in Phase 2 and no longer exists (`docs/architecture-hardening/10-defaulting-rollout-status.md` §D).

## 4. How to reproduce

```bash
# Bug 1 (data loss in cross-tab-todo)
cd e2e && npm run serve   # :4173
# open /examples/state-cross-tab-todo/ in a browser, add a todo, then reload
# → localStorage("wcs-cross-tab-todos") collapses to []

# Bug 2 (the silently dropped initial apply)
# swap the <script> order in examples/state-sse-dashboard/index.html to put state first, then
node examples/state-sse-dashboard/server.js   # :3000
# → the url attribute of the left panel's <wcs-sse> is never written and samples stays at 0
```
