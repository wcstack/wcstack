# Reflecting output state into CSS — the design for adopting CustomStateSet (`:state()`) across the board

- **Date**: 2026-07-09 (revised the same day: the additional debug-observability spec of §3.8 was decided and folded in)
- **Status**: design settled (the decision gates are passed; implementation not started), with a change plan
- **How it came about**: an investigation into why the CSS selector `wcs-fetch[loading]` never matches (though it is syntactically valid) grew into a cross-cutting design for "making output state selectable from CSS". Seven questions were put, and the decisions below were obtained.
- **See also**: [async-io-node-guidelines.md](async-io-node-guidelines.md) (§0 invariants, §4.2 derived getters), [timing-and-firing-contract.md](timing-and-firing-contract.md)
- **日本語版**: [custom-state-reflection-design.ja.md](custom-state-reflection-design.ja.md)

## 0. TL;DR

Every I/O node's **boolean output state is reflected into `ElementInternals.states` (CustomStateSet)**, making it selectable from CSS with `:state()`.

```css
wcs-fetch:state(loading) ~ .spinner        { display: block; }
form:has(wcs-fetch:state(error)) .banner   { display: block; }
wcs-ws:state(connected) ~ .indicator       { color: green; }
wcs-permission:state(denied) ~ .fallback   { display: block; }
```

- **Core is unmodified.** The Shell subscribes to its own `*-changed` events in the constructor and updates the states (using the existing invariant that every Core dispatches its events at the Shell element itself)
- Attribute reflection is **not adopted** (`:state()` is adopted because it cannot structurally confuse input with output — decisions 1, 2, 4)
- Observation in DevTools is covered by a `debugStates` snapshot getter plus an opt-in `debug-states` attribute mirror (§3.8)
- A single sweeping change is **feasible**. But "the Shell diff" and "the test shim" are two inseparable sweeps (§2)

## 1. Decisions (settled; not to be relitigated)

| # | Question | Decision |
|---|---|---|
| 1 | The mechanism | **CustomStateSet (`:state()`)**. Attribute reflection is rejected |
| 2 | The one-way nature of input versus output | moot, given decision 1 (`:state()` cannot be written from outside) |
| 3 | The reflected vocabulary | as discussed (§3.2). Boolean observables plus derived getters are reflected; continuous and high-frequency values are excluded |
| 4 | Naming and attribute collisions | native attribute collisions are moot, given decision 1. Only the state-name rules are defined, in §3.3 |
| 5 | The timing contract | as discussed (§3.5), including adding a section to the timing contract |
| 6 | Feasibility of a sweeping change (implementation) | inspected → **feasible** (§2) |
| 7 | Feasibility of a sweeping change (norms and tests) | inspected → **feasible, but inseparable from rolling out the test shim** (§2) |
| 8 | Debug observability (an additional spec) | adopted: **a `debugStates` snapshot getter plus a `data-wcs-state-*` mirror opted into with `debug-states`** (§3.8). Exposing a live CustomStateSet and always-on attribute reflection are rejected |

## 2. Inspection results: is a sweeping change feasible (the answer to decisions 6 and 7)

All 41 directories were surveyed (2026-07-09; two parallel investigations plus individual corroboration).

### 2-1. Structural homogeneity — the premise for a mechanical diff holds

- The subject is the **33 I/O node packages / 37 tags** that have the Core/Shell structure (out of scope: state / router / signals / autoloader / server / vscode-wcs / poc-visual-editor, plus fetch's auxiliary elements `wcs-fetch-header` / `wcs-fetch-body` / `wcs-infinite-scroll`, which have no wcBindable)
- Every Core has `constructor(target?) { this._target = target ?? this }` and dispatches its events at the Shell element itself, without exception → **the reflection closes over a self-listener in the Shell, and Core does not change by one line**
- A Shell adding an `addEventListener` on itself has precedent (camera does it twice in the constructor; intersection / resize do it once in connectedCallback)
- Existing uses of `attachInternals` / `ElementInternals` / `CustomStateSet`: **zero** (a purely new addition)
- The great majority (about 29 packages) are exactly the same shape — "a two-line constructor plus a symmetric observe/dispose" — so **one template can be applied wholesale**. Only four groups need individual attention (§6 Phase 3):
  - **camera / recorder**: merge it into a heavy constructor (shadow DOM, existing self-listeners, visibilitychange management)
  - **debounce / throttle**: `Throttle extends Debounce` with a dynamic event prefix (`wcs-debounce:` / `wcs-throttle:`) → the reflection map is built from `eventPrefix` too
  - **speech**: two independent tags (Speak / Listen) with different sets of events to reflect
  - **the four sensors plus tilt**: only `error` is reflected (they have no boolean output)

### 2-2. Naming inconsistency — it was already unified (effectively closing the concern)

Surveying every package against the open item at the end of io-node-batch-implementation-plan.md, "unify the cancelled/error naming across nodes":

- `error` is **completely unified across 26 packages** as both a property name and an event name (`wcs-<ns>:error`)
- `cancelled` (double l) is **unified** across the four picker packages (contacts / credential / eyedropper / share) (`wcs-<ns>:cancelled-changed`)
- `abort` appears only as a command name, and `canceled` (single l) / `aborted` / `*-failed` only as lower-level code strings inside an error detail — **there is no inconsistency at the level of state or event names**
→ The precondition for freezing the state names is already met. No further renaming is needed.

### 2-3. The one structural constraint — the test environment

- happy-dom is unified at `^20.0.11` (20.10.6 in practice) across every package, but **even the latest version implements neither `attachInternals` nor `ElementInternals` nor `CustomStateSet`** (measured: `this.attachInternals is not a function`)
- → The Shell diff alone wipes out the tests. **Rolling a shim into each package's `__tests__/setup.ts` is an inseparable second sweep** (§3.6)
- Fortunately every I/O node's setup.ts is a homogeneous comment stub with a uniform insertion point

### The verdict

**A sweeping change is feasible.** "(1) the Shell diff (29 of one shape plus 4 groups individually) plus (2) the test shim plus the added tests" can be rolled out as a mechanical sweep that completes per package. The additions to the normative documents (guidelines / timing contract) take one cross-cutting pass (§5).

## 3. The design

### 3.1 The mechanism

The Shell constructor (`super()` → immediately after `new Core(this)`) obtains `attachInternals()` and updates the states from then on. **never-throw (guidelines §3.6) is carried through**:

- `attachInternals` absent (happy-dom, older environments) → set it to `null` and disable reflection quietly
- Older Chromium (below 125) throws a SyntaxError from `states.add()` for a state name without a dash → detect it with a probe at acquisition time (`add("wcs-probe")` → `delete`) and disable (graceful degradation: only the CSS fails to match; the functionality works completely)

Supporting browsers (the new `:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+, Firefox 126+ (Baseline).

### 3.2 The normative reflected vocabulary

**Reflected**:
1. **Boolean output observables** exposed through wcBindable (those with a dedicated `*-changed` event; e.g. `loading` / `connected` / `active` / `held` / `running`)
2. **Boolean derived getters** (guidelines §4.2; e.g. permission's `granted` / `denied` / `prompt` / `unsupported`, orientation's `portrait` / `landscape`) — an enum is reflected only through this existing convention (no new enum-expansion rule is invented)
3. **The presence of `error`** (on where the detail of `wcs-<ns>:error` is non-null; off on a null clear. The clearing dispatch with detail=null was confirmed in the fetch implementation)

**Not reflected**:
- Continuous and high-frequency values (sensor readings, tilt's `alpha/beta/gamma`, coordinates, `progress`, `ratio`, `width/height`, `tick/elapsed`, `charIndex`, `duration`, `angle`, `count/total`)
- A boolean derivable only from a continuous stream event (reading / boundary / tick), such as tilt's `absolute`
- Data values (`message` / `value` / `entry` / arrays)
- An enum with no derived getter (clipboard's read/write permission, the permission of geolocation / camera / listen / tilt, idle's `screenState`, network's `effectiveType`) → **out of scope for v1**. Adding the getters is a separate proposal, as an additive wcBindable change (§7)

### 3.3 State names

- A state name is the wcBindable property name (or derived getter name) **in kebab-case**. A single word stays as-is (`loading`, `cancelled`, `granted`); several words are converted (`saveData` → `save-data`)
- CustomStateSet is case-sensitive, so camelCase is not used as-is (for consistency with CSS convention)
- A mutually exclusive group (permission's four values, say) sets and deletes all its states together from the same event (the map in §3.4 expresses this naturally)

### 3.4 How it is wired — the canonical snippet

Only the Shell gains the following (Core unmodified). The code is not shared between packages; as with the other conventions it is a **copy pattern** (the self-contained, zero-dependency principle):

```ts
private _internals: ElementInternals | null = null;

// A debug snapshot (outside the contract, §3.8). Never returns the live CustomStateSet.
get debugStates(): string[] {
  return this._internals ? [...this._internals.states] : [];
}

private _initInternals(): ElementInternals | null {
  // never-throw (guidelines §3.6): where attachInternals is absent (happy-dom / older
  // environments) or older Chromium (<125) rejects a dash-less state name, disable quietly.
  try {
    if (typeof this.attachInternals !== "function") return null;
    const internals = this.attachInternals();
    internals.states.add("wcs-probe");
    internals.states.delete("wcs-probe");
    return internals;
  } catch {
    return null;
  }
}

private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
  if (this._internals === null) return;
  const states = this._internals.states;
  for (const [event, toStates] of Object.entries(map)) {
    this.addEventListener(event, (e) => {
      const debug = this.hasAttribute("debug-states"); // the §3.8 opt-in mirror
      for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
        try {
          // A ternary as an expression statement trips ESLint no-unused-expressions, so if/else (settled in the pilot)
          if (on) { states.add(name); } else { states.delete(name); }
        } catch { /* never-throw */ }
        if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
      }
    });
  }
}
```

An example of using it in the constructor (fetch). **The wiring goes before `new Core(this)`** (the canonical order, settled during the 2026-07-09 roll-out): on a node whose Core dispatches synchronously inside the constructor (speech's `unsupported-changed`, say), creating Core first misses that first event and `:state(unsupported)` never turns on. Where the Core does not dispatch, either order is equivalent, so new and revised code always puts the wiring first.
(An implementation note: in the 2026-07-09 roll-out, fetch / speak / listen wire first. The other Shells stayed with the equivalent Core-first order because their Cores do not dispatch in the constructor — with zero behavioral difference, aligning them as they are revised is enough):

```ts
constructor() {
  super();
  this._internals = this._initInternals();
  this._wireStates({
    "wcs-fetch:loading-changed": (d) => ({ loading: d === true }),
    "wcs-fetch:error":           (d) => ({ error: d != null }),
  });
  this._core = new FetchCore(this);
}
```

A mutually exclusive group (permission):

```ts
this._wireStates({
  "wcs-permission:change": (d) => ({
    granted: d === "granted", denied: d === "denied",
    prompt: d === "prompt", unsupported: d === "unsupported",
  }),
});
```

An inheritance structure (throttle) builds its map from `eventPrefix`:

```ts
const prefix = (this.constructor as typeof Debounce).eventPrefix;
this._wireStates({ [`${prefix}:pending-changed`]: (d) => ({ pending: d === true }) });
```

### 3.5 The timing contract (added to timing-and-firing-contract as a cross-cutting section)

1. **The states are a synchronous projection of the last `*-changed` / `:error` event fired** (not a projection of properties). Reflection runs synchronously during the dispatch of that event
2. The Shell's reflection listener is **registered in the constructor (i.e. at upgrade)** and never removed (self-referential, so no leak). A user listener registered after the upgrade **always sees the states already reflected**. A listener registered before the upgrade may run before reflection (stated as contract)
3. The same-value guard **follows the event's own contract**. Even for an unconditional dispatch with no guard (fetch's `loading-changed`, timing contract §1.1), `add`/`delete` are idempotent, so there is no observable difference
4. **The states are not cleared on disconnect** (they persist, like Core state). On a node where `dispose()` fires a state-resetting event, the states follow automatically. Every state starts off (the initial value of every reflected Core field was confirmed to be false-ish)

### 3.6 The test strategy (the second sweep, inseparable from the Shell diff)

- Add a shared shim to each package's `__tests__/setup.ts` (currently a comment stub):
  insert a definition that returns a FakeElementInternals (whose `states` is a plain `Set`-compatible object) **only where `HTMLElement.prototype.attachInternals` is undefined**, recording it in a `WeakMap<Element, FakeElementInternals>`. Add a `getStates(el)` inspection helper to `__tests__/helpers`
  (the "only where undefined" means it will not collide if happy-dom implements it later)
- The test template (5-8 per tag, described in Japanese):
  1. every state starts off
  2. a state event turns it on (`getStates(el).has("loading")`)
  3. the inverse event turns it back off
  4. `error` turns on for a non-null detail and off on a null clear
  5. it does not throw with `attachInternals` absent (constructed on an element with the shim removed; `debugStates` returns an empty array)
  6. (mutually exclusive groups only) one event switches every state consistently
  7. `debugStates` returns a snapshot (mutating the return value does not affect the states)
  8. with the `debug-states` attribute, `data-wcs-state-*` is toggled, and without it nothing is written
- Since case 5 exercises the guard branch (the `_internals === null` path), coverage of **100 / 97+ / 100 / 100 can be maintained**

### 3.7 SSR

`:state()` cannot be serialized into HTML, so the initial SSR paint carries no state styling (**an accepted limitation**, the trade-off of decision 1). @wcstack/server is unmodified. Where the initial paint matters, the README also documents the `wcs-x:not(:defined)` pattern.

### 3.8 Debug observability (decision 8)

**The motivation**: CustomStateSet has an observability hole. `attachInternals()` cannot be called twice on the same element (the second time is a NotSupportedError), so the states cannot be peeked at from the console, and DevTools' Elements panel does not display custom states. `$0.matches(':state(x)')` works, but you cannot enumerate without knowing the state names.

**1. The `debugStates` getter (standard on every Shell)**

- Returns a **snapshot array** of the state names currently on (see the §3.4 snippet)
- It MUST NOT return the live CustomStateSet — doing so would allow external writes through `el.debugStates.add(...)` and collapse the core of decisions 1 and 2, that "`:state()` cannot be written from outside"
- With `_internals` null (happy-dom, older environments) it is an empty array
- **Outside the contract**: not listed in wcBindable (not a binding target). The README states it is "for debugging, with no semantic guarantee"

**2. The opt-in attribute mirror through `debug-states`**

```html
<wcs-fetch url="/api" debug-states></wcs-fetch>
<!-- → data-wcs-state-loading / data-wcs-state-error toggle on every state change,
     and the Elements panel highlights the changes in real time -->
```

- **Off by default.** Only on an element carrying the `debug-states` attribute does it toggle a `data-wcs-state-<name>` attribute alongside the state update
- The attribute name lives in the **`data-wcs-state-*` namespace** (avoiding collision with the user's `attr.data-*` binding space)
- **Always-on reflection is rejected**: it would reintroduce the attribute reflection already rejected (§7), and CSS depending on `[data-wcs-state-*]` would become public API in practice (Hyrum's law). The production cost of style recalculation / MutationObserver / snapshot diffing would also be passed to every user. The README states that **CSS goes on `:state()`, not on this attribute**
- `debug-states` is a **non-observed input attribute**. It is checked with `hasAttribute` on each event dispatch (adding or removing it takes effect from the next event; leftover `data-wcs-state-*` after removal is not cleaned up — acceptable for a debugging feature, and stated as such in the README)
- Where `_internals === null` the mirror is disabled too (it is a *display* of the states, not an alternative surface; it must not be used as a fallback for older browsers)

## 4. The reflected-state map per package (the settled v1 vocabulary)

| Tag | Reflected states | Notes |
|---|---|---|
| `wcs-fetch` | `loading` `error` | the pilot |
| `wcs-upload` | `loading` `error` | `progress` excluded |
| `wcs-storage` | `loading` `error` | |
| `wcs-ws` | `connected` `loading` `error` | `readyState` is already covered by the existing booleans |
| `wcs-sse` | `connected` `loading` `error` | |
| `wcs-broadcast` | `error` | no boolean output |
| `wcs-worker` | `running` `error` | |
| `wcs-timer` | `running` | no error |
| `wcs-debounce` / `wcs-throttle` | `pending` | dynamic eventPrefix (§3.4) |
| `wcs-clipboard` | `loading` `monitoring` `error` | the two permission surfaces have no getter → out of v1 |
| `wcs-contacts` / `wcs-credential` / `wcs-eyedropper` / `wcs-share` | `loading` `cancelled` `error` | the four pickers are the same shape |
| `wcs-fullscreen` | `active` | error not exposed (and will not be) |
| `wcs-pointer-lock` | `active` | same |
| `wcs-pip` | `active` | same |
| `wcs-network` | `save-data` `supported` | the only instance of kebab-case conversion |
| `wcs-intersect` | `visible` `observing` `intersecting` | `ratio` excluded |
| `wcs-resize` | `observing` | the box values excluded |
| `wcs-screen-orientation` | `portrait` `landscape` `error` | the event namespace is `wcs-orientation:` |
| `wcs-geo` | `watching` `loading` `error` | permission has no getter → out of v1 |
| `wcs-idle` | `active` `error` | `screenState` has no getter → out of v1 |
| `wcs-wakelock` | `held` `error` | |
| `wcs-permission` | `granted` `denied` `prompt` `unsupported` | a mutually exclusive group (one event → four states) |
| `wcs-notify` | `granted` `denied` `prompt` `unsupported` `error` | same, plus error |
| `wcs-defined` | `defined` `error` | both derived from the detail of `wcs-defined:change` |
| `wcs-camera` | `active` `error` | the two permission surfaces have no getter → out of v1 |
| `wcs-recorder` | `recording` `paused` `error` | `duration` excluded |
| `wcs-speak` | `speaking` `paused` `pending` `unsupported` `error` | |
| `wcs-listen` | `listening` `unsupported` `error` | permission has no getter → out of v1 |
| `wcs-tilt` | `error` | `absolute` derives from the continuous `:change` → excluded |
| `wcs-accelerometer` / `wcs-gyroscope` / `wcs-magnetometer` / `wcs-ambient-light-sensor` | `error` | readings excluded |

Out of scope: `wcs-state` / `wcs-ssr` / `wcs-autoloader` (no observable state); `wcs-fetch-header` / `wcs-fetch-body` / `wcs-infinite-scroll` and router's structural elements (no wcBindable). For `wcs-route`'s `active` see §7.

## 5. Reflecting this into the normative documents (one cross-cutting pass)

1. **async-io-node-guidelines.md**:
   - Add **#10** to the §0 invariants: "reflect boolean output observables and the presence of error into CustomStateSet (`:state()` support). Reflection happens only in the Shell and is not brought into Core. Where attachInternals is absent, disable quietly (never-throw)"
   - **§4.5 (new)**, "Reflecting output state into CSS": make the canonical snippet of §3.4, the vocabulary rules (§3.2), the state-name rules (§3.3), and debug observability (§3.8: the `debugStates` snapshot MUST, returning a live Set MUST NOT, the `debug-states` opt-in mirror) normative
2. **timing-and-firing-contract.md**: add the four contracts of §3.5 as a cross-cutting section (peer to §3). Add to the guidelines §1 checklist that every new node includes one reflected-state map table in its tag-design doc
3. Where this design sits: it is a **node implementation convention**, not a change to wc-bindable-protocol (the protocol spec). No spec proposal is needed

## 6. The change plan

Premise: **do not dam up the v1.16.0 release train**. All of this starts after 1.16.0 departs and ships in **1.17.0** (an additive minor).

### Phase 0 — settle the design (this document)
- The naming-unification concern is closed by inspection (§2-2). Decided **not** to expose error on fullscreen / pointer-lock / pip (no API additions outside the scope)
- Completion criterion: approval of this doc

### Phase 1 — the pilot (fetch, half a day to a day)
1. Apply the §3.4 template to `Fetch.ts` (`loading` / `error`)
2. The `__tests__/setup.ts` shim plus `getStates()` in `helpers` plus the 5 template tests (§3.6)
3. Draft guidelines §0-10 / §4.5 and the timing-contract cross-cutting section (the norms are pinned together with the pilot)
4. Real-browser E2E: add a `:state(loading)` spinner to an existing example (the packages/fetch/examples/users-crud family) and confirm visually in Chrome / Safari / Firefox
- Completion criteria: fetch keeps 100/97+/100/100 coverage; the E2E looks right; the final shape of the template is settled

### Phase 2 — the sweeping roll-out of the standard template group (29 tags, 3 batches, 2-4 hours each)
A mechanical sweep. One batch = one branch/PR (following the precedent of the io-node batch implementation):
- **2a async I/O**: upload / storage / websocket / sse / broadcast / worker / timer
- **2b pickers and monitors**: contacts / credential / eyedropper / share / clipboard / geolocation / idle / wakelock / network
- **2c display and permission**: fullscreen / pointer-lock / pip / intersection / resize / screen-orientation / permission / notification / defined / tilt / the four sensors
- The diff per package: about +35 lines in the Shell (including `debugStates` and the debug mirror), about +15 in setup.ts, about +10 in helpers, plus 5-8 tests
- Completion criteria: coverage maintained across every package in the batch; `npm run build` passes

### Phase 3 — the group needing individual attention (a day)
- **camera / recorder**: coexist with the existing heavy constructor and self-listeners (`_wireStates` goes after the existing listener registration)
- **debounce / throttle**: build the map through dynamic `eventPrefix` resolution (§3.4). Verify the reflection through `wcs-throttle:pending-changed` independently in the Throttle tests
- **speech (Speak / Listen)**: define a map for each of the two tags
- Completion criteria: as above, plus the inheritance-path test for throttle

### Phase 4 — documentation and a showcase (1-2 days)
- Add a "CSS styling (`:state()`)" section from a template to the README.md / README.ja.md of the 33 packages concerned (a table of supported states plus a snippet)
- One cross-cutting section in the root README (including a note on supported browsers and graceful degradation)
- One `:state()` showcase in examples (a composite of a fetch loading indicator, a ws connection indicator, and a permission fallback, with the permission-free parts above the fold)

### Phase 5 — release
- As **1.17.0** (a minor, additive) across every package. The release notes lead with "`:state()` support" and state the supported browsers plus the behavior in older environments (only the styles fail to apply)
- Total estimate: about one week of work

## 7. What we are not doing, and follow-up candidates (separate judgments)

**Not doing (out of v1 scope)**:
- **Always-on** attribute reflection (rejected in decision 1, and never revisited — not worth the cost of duplicating `:state()`. The `debug-states` opt-in mirror of §3.8 is the sole exception and is never promoted into the contract)
- Exposing an error property on fullscreen / pointer-lock / pip (a wcBindable change independent of this work)
- Quantized reflection of continuous values (progress in 25% steps and the like — once there is demand)

**Follow-up candidates (additive, demand-driven)**:
1. **Filling in the derived boolean getters**: clipboard (read/write permission), geolocation, camera (both surfaces), listen, and tilt's permission; idle's `screen-locked`; network's `effective-type` family. These fill gaps in §4.2 consistency, and adding them automatically brings them into scope under the §3.2 rules
2. **`wcs-route`'s `active`** (the router package): outside the I/O nodes, but it already has a `wcs-route:active-changed` event of the same shape, and as navigation highlighting (including on `wcs-link`) it is **the highest-value application of this work**. router has a different Shell/Core structure, so it needs its own design and a separate judgment
3. Remove the shim once happy-dom implements ElementInternals (harmless to leave, since it is "defined only where undefined")

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| styles do not apply on older Chromium (<125) | quiet disabling through the probe (the functionality works completely). The README states the support table |
| happy-dom implements attachInternals later and collides with the shim | the shim is "defined only where undefined", so it is forward-compatible |
| the permanent maintenance burden of +150-200 tests | only homogeneous, templated tests. The template is placed as a norm in guidelines §4.5 to prevent divergence |
| a listener registered before the upgrade sees the states before reflection | stated as contract in the timing contract (§3.5-2). A usage pattern where this does real harm is rare |
| `:state()` is too little known to get used | Phase 4's showcase and the README section make "a loading UI in CSS alone" the headline. The SSR limitation is stated honestly alongside |
| CSS comes to depend on `data-wcs-state-*` and it becomes API in practice | off by default and opt-in; the `debug-` prefix in the attribute name states the intent; the README says "CSS goes on `:state()`" (§3.8) |
| `debugStates` gets used as an unofficial binding target | not listed in wcBindable, returns a snapshot (unwritable), and the README states it carries no guarantee |
