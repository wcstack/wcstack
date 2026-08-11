# Design note: `@wcstack/screen-orientation` (`<wcs-screen-orientation>`)

- **Status**: implemented. This document is a snapshot of the questions and decisions worked through before implementation, kept afterwards as a reference for the design intent. Note that the `@` notation below (`hidden@!portrait`, `hidden@!landscape`) is pseudo-syntax for explanation and not actual `data-wcs` syntax (`!` negation does not exist in state; the implementation uses the `|not` filter — see README.md/README.ja.md).
- **The Web API**: the Screen Orientation API (`screen.orientation`, `ScreenOrientation`'s `change` event, `.type` / `.angle` / `.lock(type)` / `.unlock()`)
- **Where it sits**: the second member of batch 4 (the minimal monitor pattern) in [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) (ja). `Network Information` (`<wcs-network>`, [network-tag-design.md](./network-tag-design.md) (ja)) was implemented first, and on the foundation of its "single event → derived getters" and "no `_gen` needed" shape, this node completes batch 4 as **the one that has commands**.
- **Prior assets**: `permission` (the shape of a single state producing several derived boolean getters, the `_permGen` generation guard, Core/Shell separation), `network` (the shape of "batch 4 thinness" — no query needed, a fully synchronous subscription — and the criteria for omitting `_gen`), `fetch` (a command-side generation guard through a single `_gen`, [FetchCore.ts:54](../packages/fetch/src/core/FetchCore.ts#L54) and [FetchCore.ts:195](../packages/fetch/src/core/FetchCore.ts#L195)).
- **日本語版**: [screen-orientation-tag-design.ja.md](./screen-orientation-tag-design.ja.md)

---

## 0. The premise: the one member of batch 4 that has commands

Batch 4 in [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) (ja) shares the archetype "a single event → derived getters, a tiny Core", but where `network` was a pure monitor (`commands: []`), this node has two commands, `lock()` and `unlock()`. Its position within batch 4 comes down to three points.

| | `<wcs-network>` | `<wcs-screen-orientation>` |
|---|---|---|
| Direction | monitor only (`commands: []`) | **bidirectional** (monitor plus commands) |
| Per-instance configuration attributes | none (`inputs: []`) | **none** (stated in §3) |
| Synchronicity of monitoring | fully synchronous (no `_gen`) | monitoring is fully synchronous (no `_gen`), but **the commands are asynchronous** (§5) |
| Role within batch 4 | the fastest practice run (repeating the pure monitor) | the one that first confirms the monitor-plus-command combination |

Of these, "no per-instance configuration attribute is needed at all" is entirely shared with `network`. Both target **a single global in window/screen scope** — `screen.orientation` and `navigator.connection` — so the `target` attribute → element resolution that batch 1 (Fullscreen / Picture-in-Picture / Pointer Lock) requires ([io-node-batch-implementation-plan.md:26-42](./io-node-batch-implementation-plan.md#L26-L42), `_resolveTarget()`) never appears here. As a node where the design problem of "specifying the subject" does not exist at all, it sits opposite batch 1.

The asymmetry of "monitoring is synchronous, commands are asynchronous", on the other hand, is a new topic `network` did not have, and it is the subject of this document (§5).

---

## 1. Why it exists — what it solves

- **Orientation-dependent UI**: for a game, a video player, a photo viewer — UI that only makes sense in a particular orientation — switch it declaratively with a binding like `hidden@!portrait`.
- **Requesting an orientation lock**: the workflow of calling `lock("landscape")` for fullscreen video playback or a game and `unlock()` on the way out — a temporary orientation lock.
- **Cross-cutting combinations**: paired with `<wcs-fullscreen>` (batch 1), "lock to landscape once fullscreen is entered" writes naturally (both are thin nodes with no `target` or per-instance configuration, which keeps the wiring simple).

---

## 2. The exposed state — **decision: add derived `portrait`/`landscape` getters on top of `type`/`angle`**

The base shape already settled in the batch plan ([io-node-batch-implementation-plan.md:234-246](./io-node-batch-implementation-plan.md#L234-L246)):

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "type",  event: "wcs-orientation:change" },
    { name: "angle", event: "wcs-orientation:change", getter: e => e.detail.angle },
  ],
  commands: [
    { name: "lock", async: true },
    { name: "unlock" },
  ],
};
```

On top of that, **adding** the following two derived boolean getters is recommended.

```typescript
{ name: "portrait",  event: "wcs-orientation:change", getter: e => e.detail.type.startsWith("portrait") },
{ name: "landscape", event: "wcs-orientation:change", getter: e => e.detail.type.startsWith("landscape") },
```

### Why add them

- **Consistency with the existing pattern**: `permission` carves four derived booleans — `granted` / `denied` / `prompt` / `unsupported` — out of a single four-valued `state` property ([PermissionCore.ts:28-32](../packages/permission/src/core/PermissionCore.ts#L28-L32)). async-io-node-guidelines §4.2 makes decomposing a composite state into "one event plus derived getters" a SHOULD ([async-io-node-guidelines.md:215-222](./async-io-node-guidelines.md#L215-L222)), and this node, deriving booleans from `type` (a four-valued string), is a textbook application of it.
- **Simpler bindings**: without `portrait`/`landscape`, a user needs a multi-stage filter such as `hidden@type|ne('portrait-primary')|and(...)` or a hand-written computed property. One derived getter reduces it to a one-line `hidden@!portrait`. Most of the use cases (§1's "orientation-dependent UI") are binary — portrait or landscape — and rarely need `portrait-primary` distinguished from `portrait-secondary`.
- **Near-zero implementation cost**: it adds two derived getters that ride the existing `type` event, needing no change to Core's state or event dispatch logic (the same "just ride the same event" pattern as `network`'s `supported`, [network-tag-design.md:66](./network-tag-design.md#L66)).
- **`type` itself stays exposed**: the raw `type` property remains for advanced use cases that want `portrait-primary` distinguished from `portrait-secondary` (switching where a notification bar sits, say). `portrait`/`landscape` are a convenience addition, not a replacement for `type`.

Where unsupported (§7), `type` is `null`, so the `portrait`/`landscape` getters are made null-safe as `e.detail.type?.startsWith(...) ?? false`.

**An implementation note**: the snippet above is transcribed from the base shape settled in `io-node-batch-implementation-plan.md`; as with `portrait`/`landscape`, the implementation also adds `error` (event: `wcs-orientation:error`) as a public property (see §5 — the same never-throw error surfacing as `FetchCore` / `GeolocationCore` / `NotificationCore`).

---

## 3. No target — the second node needing no per-instance configuration attribute at all

`screen.orientation` is, like `document` and `navigator.connection`, a global platform object of which the page has exactly one. There is no element-specific "what to observe" parameter.

- Batch 1 (Fullscreen / Picture-in-Picture / Pointer Lock) shares the `target` attribute → element resolution (`_resolveTarget()`, [io-node-batch-implementation-plan.md:26-42](./io-node-batch-implementation-plan.md#L26-L42)) across every member, requiring "which element is this operating on" each time.
- `permission` requires "which permission" through the `name` attribute (plus descriptor extras) ([permission-tag-design.md:46-60](./permission-tag-design.md#L46-L60) (ja)).
- `network` and this node have exactly one thing to observe, so **there is no room to specify anything**. `<wcs-screen-orientation>` is simply connected as a tag with no attributes.

So the conclusion matches `network-tag-design.md §9` ([network-tag-design.md:117-122](./network-tag-design.md#L117-L122)): **`inputs: []`, no Shell attributes**. In this respect batch 4 consists of two nodes sharing "no per-instance configuration at all", sitting at the opposite pole from batch 1's target-dependent nodes.

---

## 4. `lock()`'s argument — the range of values accepted

`ScreenOrientation.lock(orientation)`'s argument is, per spec, a string union called `OrientationLockType`, but TypeScript's `lib.dom.d.ts` has no type definition for `ScreenOrientation.lock()` at all (it is experimental; only `unlock()` exists, [lib.dom.d.ts:30224-30229](../packages/state/node_modules/typescript/lib/lib.dom.d.ts#L30224-L30229)). The full set of `OrientationLockType`, from the primary spec ([Screen Orientation API — W3C](https://www.w3.org/TR/screen-orientation/)):

| Value | Meaning |
|---|---|
| `"any"` | unconstrained (free rotation) |
| `"natural"` | the device's natural orientation |
| `"landscape"` | landscape (either primary or secondary) |
| `"portrait"` | portrait (either primary or secondary) |
| `"portrait-primary"` | portrait, upright |
| `"portrait-secondary"` | portrait, inverted |
| `"landscape-primary"` | landscape, upright |
| `"landscape-secondary"` | landscape, inverted |

- **Decision**: type `lock(orientation: string)` as a union of those eight values (defining an `OrientationLockType` type alias in `types.ts`; a hand-written definition is needed since `lib.dom.d.ts` has none). But **do not validate** (no value checking; it passes straight to `screen.orientation.lock(orientation)`). An unknown string is rejected by the browser with the equivalent of a `TypeError`, which §5's never-throw absorbs. The type exists for DX (completion, typo detection), not as a runtime guard — a call through command-token (a string argument such as `command.lock: 'landscape'`) does not pass through TypeScript's checking, so the possibility of an invalid value at runtime remains in any case.
- The headless signature is `lock(orientation: OrientationLockType): Promise<void>`. The implementation simply does `_setError(null)` and then try/catches `await screen.orientation.lock(orientation)`, letting no exception escape on either success or failure.

---

## 5. `lock()`/`unlock()` are best-effort commands — state clearly that support is narrow

> **A correction made after implementation**: the "desktop versus mobile" contrast below was a pre-implementation guess and was refuted when the spec was checked afterwards. In fact `lock()` is rejected in an ordinary tab on desktop and mobile alike, and requires either fullscreen or an installed-PWA context (Safari does not implement `lock()` at all in any context). And for the rejection's error name, the current spec's first candidate is `NotAllowedError` (an unmet pre-lock condition such as fullscreen), with `NotSupportedError`/`SecurityError` as secondary, environment-dependent candidates. For the accurate constraints and error-name handling, see README.md/README.ja.md. The text below is left verbatim as a pre-implementation snapshot.

Many desktop browsers reject `screen.orientation.lock()` with a `NotSupportedError` (some implementations work on mobile only, or only inside a particular fullscreen context; Chromium, for example, sometimes refuses a lock when there is no fullscreen element).

- **Absorbed by never-throw**: a `lock()` rejection (`NotSupportedError` / `SecurityError` / anything else) flows into the `error` property and never escapes as an exception. No try/catch is required in the calling code.
- **It does not become an `unsupported` state**: unlike a binary support determination such as `network`'s `supported: boolean`, "does lock work" cannot be known without trying (a compound of environment-dependent factors — desktop, mobile, the presence of a fullscreen context — makes a prior determination unreliable). It leans on the ordinary command-failure pattern, where the caller decides failure by whether `error` is non-null.
- **Stated in the README (MUST)**: the README states the warning that "`lock()` is a best-effort command that normally fails outside a mobile context". It exists so a user does not mistake it for a bug, and it also notes that its reliability differs in character from `unlock()` (synchronous, no return value, never rejects).

---

## 6. The asymmetry of the `_gen` generation guard — the monitor half does not need it, the command half does

async-io-node-guidelines §3.4 makes the `_gen` generation guard a MUST, but in this node **monitoring and commands are treated differently** — a nuance of its own within batch 4. It is stated as its own subsection.

### 6.1 Monitoring (the `change` subscription) needs no `_gen`

Obtaining `screen.orientation` and subscribing with `addEventListener('change', ...)` are both fully synchronous, for exactly the same reasons as [network-tag-design.md §5](./network-tag-design.md#L76-L86).

- `screen.orientation` is a property reference that resolves immediately at call time; there is no async probe.
- `addEventListener` merely has the browser fire `change` of its own accord; Core is not actively waiting on anything.
- So the very race `_gen` protects against — "async work resolving after dispose and writing into a torn-down element" — cannot occur. As with `network`, the monitoring path carries no generation number.

### 6.2 The `lock()` command needs the single-`_gen` pattern

`lock()`/`unlock()` are commands with an asynchronous in-flight state. `lock()` returns a Promise that can take time to resolve or reject. That is where the "one `_gen` per Core" pattern, the same shape as `fetch`/`upload`, becomes necessary.

- **Why**: a new `lock()` call or an `unlock()` can happen while an older `lock()` is in flight. The older `lock()`'s settlement (success or failure) must not overwrite the state established afterwards. For example, if `lock("landscape")` is called and the user then rotates back and `unlock()` is called, the earlier `lock("landscape")` settling later and clearing `error` would be an inversion that must not happen.
- **The implementation form**: the same shape as `FetchCore`'s single `_gen` ([FetchCore.ts:54](../packages/fetch/src/core/FetchCore.ts#L54), [FetchCore.ts:195](../packages/fetch/src/core/FetchCore.ts#L195)). Capture `const gen = ++this._gen` when `lock()` starts, and on resolve/reject finish without writing state if `gen !== this._gen`. `unlock()` is a synchronous API (below) but does `this._gen++` when called, invalidating an in-flight `lock()` (the same thinking as `FetchCore.dispose()` doing `this._gen++` before `abort()`, [FetchCore.ts:74-76](../packages/fetch/src/core/FetchCore.ts#L74-L76)).
- **Its relation to `dispose()`**: `dispose()` also does `_gen++`. A `lock()` settling after a disconnect writes no state.

### 6.3 The asymmetry, summarized

| | Monitoring (the `change` subscription) | The `lock()`/`unlock()` commands |
|---|---|---|
| Nature | fully synchronous | `lock()` is asynchronous, `unlock()` synchronous |
| `_gen` needed? | **no** (the same shape as `network`) | **yes** (the same shape as `fetch`/`upload`) |
| Grounds | there is no async probe | an in-flight lock settling could overwrite later state |

That the same Core class ends up asymmetric — "monitoring needs no generation number, commands do" — is the interesting turn that appears for the first time across batch 4, and a point invisible from looking only at pure monitor nodes such as `permission`/`network`. In the implementation, `_gen` is kept entirely separate from the monitoring logic, with a comment stating that the field exists solely for `lock()`/`unlock()`.

---

## 7. unsupported and API resolution — resolved at call time, never cached

```typescript
private _api(): ScreenOrientation | undefined {
  return (typeof screen !== "undefined" && screen.orientation) ? screen.orientation : undefined;
}
```

- Per §3.7 (MUST), it is not cached in the constructor but resolved at call time on both the observation and command paths. `screen.orientation` can be undefined on older browsers (older Safari and the like), and resolution at call time is also needed for install/remove substitution in tests.
- **The defaults where unsupported**: `type`/`angle` are fixed at `null`. `lock()`/`unlock()` throw nothing and set the equivalent of `{ message: "unsupported" }` into `error` before resolving or no-oping (`lock()` resolves as a Promise; `unlock()` returns immediately as a synchronous function).
- `portrait`/`landscape` fall to `false` where unsupported, since `type === null` (the null-safe getters of §2).
- There is no explicit support-determination property such as `network`'s `supported: boolean`. `type === null` is the means of determining "is it unsupported" (neither a dedicated state like `permission`'s four-valued `state` nor a `supported` flag like `network`'s is needed here — the presence of the API itself is adequately expressed by `type`'s nullness).

---

## 8. secure-context — no constraint

The Screen Orientation API is not on the list of APIs requiring a secure context (there is no constraint like `geolocation`'s or `permission`'s). As with `network`, the README needs no "HTTPS required" note.

---

## 9. commands / autoTrigger — **decision: no autoTrigger; invocation through command-token works as usual**

- `screen.orientation` is itself an EventTarget implementation (the actual platform spec, [lib.dom.d.ts:30209](../packages/state/node_modules/typescript/lib/lib.dom.d.ts#L30209)), so Core can `addEventListener('change', ...)` directly with no synthetic-event wrapper.
- **There is no autoTrigger (the click shortcut)**. `lock()` can be called with or without a user gesture (the Screen Orientation spec has no explicit gesture requirement like the Fullscreen API's), but this node is not made a target for click delegation such as `data-orientationtarget`. Batch 4 is the "minimal monitor" pattern and has no principal one-click use case like batch 3's (a thin one-shot command).
- **To be clear**: the absence of autoTrigger does not mean `lock()` cannot be invoked from state. It is callable as usual through the command-token protocol (`$commandTokens` / `command.lock:`). The two are different routes; only the "one-click, self-contained shortcut UI" is not offered, while the ordinary command-token integration of "invoking from a declarative binding such as state's `command.lock: 'landscape'`" works just as on every other node.

---

## 10. Shell attributes — none

As with `network` ([network-tag-design.md §9](./network-tag-design.md#L117-L122)), `<wcs-screen-orientation>` has no attributes.

- `inputs: []`. `connectedCallback` merely starts the `change` subscription unconditionally.
- `lock`/`unlock` are commands, not attributes, so they do not fall under the Shell's "attribute-linked inputs" (the §4.3 classification). They are driven through command-token, or by calling the methods directly in headless use.

---

## 11. The test approach (happy-dom)

happy-dom has no `screen.orientation`, so everything is mocked.

- Give `FakeScreenOrientation extends EventTarget` mutable `type`/`angle` properties plus a helper for firing `change` manually. `lock`/`unlock` are stub methods (`lock` being a controllable Promise whose resolve/reject can be steered per call).
- Install and remove with `Object.defineProperty(screen, "orientation", { value: fake, configurable: true })` (the same shape as substituting `navigator.connection` for `network`).
- What to cover:
  - with `screen.orientation` absent, `type`/`angle` are `null` and `portrait`/`landscape` are `false`.
  - a `change` firing updates `type`/`angle`/`portrait`/`landscape` together, observable through the single `wcs-orientation:change` event.
  - where `type` is `"portrait-primary"`/`"portrait-secondary"`, `portrait` is `true` and `landscape` is `false` (and vice versa).
  - a successful `lock()` leaves `error` at `null`.
  - a `lock()` rejection (the equivalent of `NotSupportedError`) is absorbed into `error` under never-throw (and if the contract is that the caller's Promise resolves rather than rejects, that too is verified).
  - **The `_gen` generation guard**: where `unlock()` or a new `lock()` is called while a `lock()` is in flight, the older `lock()`'s settlement does not overwrite the new state (a direct verification of §6.2's asymmetry). A `lock()` settling after dispose writes no state.
  - since the monitoring side has no `_gen`, unsubscribing `change` after dispose is covered by a straightforward listener-removal check (the same shape as `network`; confirming the absence of a generation guard).
  - the idempotence of `observe()` (a double call does not register the listener twice).
  - `lock()`/`unlock()` in an unsupported environment throw nothing and set the equivalent of `"unsupported"` into `error`.

---

## 12. Decisions, summarized

| Question | Decision |
|---|---|
| §2 the exposed state | on top of `type` / `angle` (settled in the batch plan), **add** the derived booleans `portrait` / `landscape` (the same shape as permission's four-value pattern). The implementation also adds `error` (event: `wcs-orientation:error`) as a public property (the same shape as fetch/geolocation/notification; see the §2 implementation note and §5) |
| §3 target | **not needed**. Alongside `network`, one of the two members of batch 4 needing "no per-instance configuration attribute at all". The opposite of batch 1's target-dependent nodes |
| §4 `lock()`'s argument | typed as `OrientationLockType` (an eight-value union, hand-defined since `lib.dom.d.ts` has none). No runtime validation; it defers to the browser's rejection |
| §5 `lock()`'s support range | a best-effort command. Absorbed into `error` under never-throw. The README states "failing outside a mobile context is normal". It does not become an `unsupported` state (note: corrected after implementation — for the accurate constraints and error names see the note at the top of §5 and the README) |
| §6 the `_gen` generation guard | **asymmetric**: monitoring (the `change` subscription) does not need it (the same shape as `network`, fully synchronous). The `lock()`/`unlock()` commands need one `_gen` per Core (the same shape as `fetch`/`upload`) |
| §7 unsupported / API resolution | resolved at call time (never cached). Where unsupported, `type`/`angle` are fixed at `null` and `lock()`/`unlock()` throw nothing and return `error` (the equivalent of "unsupported") |
| §8 secure-context | no constraint |
| §9 autoTrigger | **none**. But `lock()` is invocable from state through command-token as usual (stated as a different route) |
| §10 Shell attributes | none (alongside `network`, the smallest in the batch) |
| package / tag | `@wcstack/screen-orientation` / `<wcs-screen-orientation>` / the Shell `WcsScreenOrientation` |

---

## 13. The recommended implementation order

1. `ScreenOrientationCore` (call-time resolution in `_api()` plus the `change` subscription plus the derived getters `type`/`angle`/`portrait`/`landscape`). The monitoring part comes to about as much code as a copy of `network`.
2. Add the `lock()`/`unlock()` commands and the single-`_gen` generation guard (§6.2). Build on `fetch`'s `_gen` implementation ([FetchCore.ts](../packages/fetch/src/core/FetchCore.ts)), implemented as a field independent of the monitoring logic.
3. The Shell `<wcs-screen-orientation>` (no attributes, `display:none`, an unconditional subscription on connect).
4. The fake double (`FakeScreenOrientation`) and the full test set. Write the test for §6.2's `_gen` asymmetry with particular care.
5. An example, with "lock to landscape while fullscreen" as the centrepiece. Combined with `<wcs-fullscreen>` (batch 1), also showing a setup where `hidden@!landscape` displays a warning banner only when the orientation is wrong.
6. README ja/en (stating that no secure context is needed, that `lock()` is best-effort and mobile-only in practice, and that failure is expressed through `error` rather than `unsupported`).
