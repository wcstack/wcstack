# The wcstack timing and firing contract

- **Audience**: authors of apps and examples that combine the `@wcstack/state` binder / `$streams` with the wc-bindable async primitive tags (`@wcstack/fetch`, `@wcstack/intersection`, and the rest)
- **Status**: reference. Each entry describes the behavior of the current reference implementation. A change in behavior means a change to this document
- **Why this exists**: the examples — [`state-search`](../examples/state-search) and [`state-intersect-scroll`](../examples/state-intersect-scroll) in particular — rely for their correctness on things no README API table states: when and how many times an event fires, what is synchronous versus a microtask, which operations are idempotent. Left implicit, a demo's long comments become a stopgap for missing documentation and a user cannot reproduce the result without reading the internals. This document collects those contracts onto one page
- **See also**: a proposed cross-cutting verification layer that maps the firing order here onto conformance vectors as test inputs and settle boundaries is [io-node-trace-conformance.md](./io-node-trace-conformance.md) (ja). Execution forms, lanes, and commit rules for I/O nodes are in [async-execution-model.md](./async-execution-model.md)
- **日本語版**: [timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md)
- **TL;DR**: (1) `loading-changed(true)` fires once per dispatch, before the await, unconditionally. (2) auto-fetch is **deferred to a microtask and de-duplicated by url**; an explicit trigger is **immediate and unconditional (bypassing the dedupe)**. (3) a dependency change in `$streams.args` aborts the old run after the updater drains and restarts it (switchMap style). (4) `observe()` is **idempotent for the same target+options (it emits no new callback)**; force re-observation with `reobserve()`. (5) the initial data-wcs binding application happens on a separate microtask (waitable with `getBindingsReady()`)

---

## 0. Preliminaries: synchronous / microtask / task

The three layers this document distinguishes in the browser event loop:

| Layer | Examples | Ordering guarantee |
|---|---|---|
| **synchronous** | work that runs immediately inside a setter (`trigger=true` → starting `fetch()`) | completes on the spot |
| **microtask** | `queueMicrotask`, a Promise `.then`, immediately after an `await` | drained in full after the current task ends and **before the next task** |
| **task** | an `IntersectionObserver` callback, `setTimeout`, user input | after the microtask drain |

**The key invariant**: microtasks queued during the current task always all finish before the next task runs. Read the firing order of auto-fetch and binding initialization with that ordering in mind.

---

## 1. @wcstack/fetch — the firing and execution contract

Reference: [`packages/fetch/src/components/Fetch.ts`](../packages/fetch/src/components/Fetch.ts), [`README`](../packages/fetch/README.md)

### 1.1 `loading-changed` fires once per dispatch, before the await, unconditionally
`FetchCore.fetch()` fires `wcs-fetch:loading-changed(true)` when the request starts, **before its first `await`**. There is no value dedupe (send the same url repeatedly and it fires every time). Where a new request aborted an older one, **the aborted side emits no response**, but its `loading-changed(true)` has already fired.

→ **Consequence**: to count the requests actually sent, count the false→true edges of `loading` (counting `response`/`value` loses the aborted ones). That is what `requestCount` in `state-search` does.

### 1.2 auto-fetch is deferred to a microtask and de-duplicated by url (v1.13 onward)
A `url` change (via the attribute) and the automatic fetch on connect are collected into a `queueMicrotask` (`_scheduleAutoFetch`).

- **Several inputs in one tick collapse into one fetch, decided on the final state**: if a spread writes `manual` after `url`, the decision is taken on the state as of the microtask, so no order-dependent spurious fetch happens
- **Same-value guard**: an auto-fetch where `url === _lastFetchedUrl` is skipped. What `_lastFetchedUrl` remembers is not "the previous url" but **the last url actually fetched** (it is written only inside `fetch()`, and reset to null only on disconnect). So intervening non-fetch states (an empty url, say) do not update `_lastFetchedUrl`, and `"abc"→""→"abc"` **is skipped** just as `"abc"→"abc"` is. To fetch the same url again you need an explicit trigger (§1.3's `fetch()` / `trigger=true` / the `fetch` command) or a remount that resets `_lastFetchedUrl` to null

### 1.3 An explicit trigger is immediate and unconditional (bypassing the dedupe)
A `fetch()` call, `trigger=true`, the `fetch` command, and a `data-fetchtarget` click all **run synchronously and immediately**, and do **not** pass through the `_lastFetchedUrl` same-value guard.

→ **Consequence**: "run the same url again" cannot be expressed with auto-fetch on `<wcs-fetch>` (it gets de-duplicated) — **only an explicit fetch expresses it**.

### 1.4 `response` fires on errors too; `value` is null on error
`wcs-fetch:response` (the event of the `value` property) **fires on HTTP and network errors as well** (`value=null`, an error code in `status`, `status=0` for a network error). Always look at `status` to decide success (a 2xx check). `error` is filled for both a non-2xx HTTP response and a network throw, and is null only on abort/supersede.

→ **Consequence**: a design that accumulates through `eventToken.value` plus `$on` (`packages/fetch/examples/infinite-scroll`) breaks by appending `null` unless the handler rejects on status first.

### 1.5 `trigger` is silently ignored when the url is empty
`trigger=true` while `url` is empty **does nothing** (no fetch, no event, the flag stays false). Set a url and write `true` again to run it.

### 1.6 `body` resets to null on every `fetch()`; `method="HEAD"` does not read the body
(Supplementary. For details see the fetch README's "Design Notes".)

---

## 2. @wcstack/intersection — the observation and firing contract

Reference: [`packages/intersection/src/core/IntersectionCore.ts`](../packages/intersection/src/core/IntersectionCore.ts), [`README`](../packages/intersection/README.md)

### 2.1 The `IntersectionObserver` callback is a task (after layout)
Visibility notifications arrive as a task after layout. They are **not microtasks**. §3 builds on that fact.

### 2.2 `observe()` is idempotent for the same target+options (it emits no new callback)
`observe(el, opts)` early-returns for the same element with the same options; it neither rebuilds the observer nor re-sends the initial callback (a deliberate design, to avoid the create→observe→disconnect churn caused by an autoloader upgrade).

→ **Consequence**: where visibility has **not changed** but you want to re-evaluate "is it visible right now" (re-arming an edge-driven consumer), calling `observe()` again is **a no-op** and does nothing.

### 2.3 `reobserve()` forces re-observation (teardown→observe)
`reobserve(el, opts)` tears the observer down and observes again, so **a new `IntersectionObserver` emits an initial callback for the current visibility**. On success `observing` stays true (no false blip).

→ **Consequence**: self-healing after a short page (an append changed the layout but no visibility transition occurred) is expressed with `reobserve()`. That is `command.reobserve` in `state-intersect-scroll`. `<wcs-infinite-scroll>` (the high-level tag) does not have that command and therefore cannot self-heal.

### 2.4 `change` is event-natured (no same-value guard; fires every time)
`wcs-intersect:change` always fires per callback (no same-value guard). `intersecting` / `ratio` are getters derived from that event. `visible` is a latch (true on the first intersection, released only by `reset()`).

---

## 3. A cross-cutting contract: `$streams` restart and equal-value page selection (preventing page skips)

`state-intersect-scroll` uses the switchMap-style restart of `$streams`. Incrementing `page++` on every intersection edge would be wrong there: a later edge would abort the in-flight run for page N and jump to N+1. The demo preserves ordered appends with the following combination.

1. `sentinelChanged` (an IntersectionObserver task) computes `page = floor(items.length / pageSize) + 1`
2. While page N is running, or after it failed, `items.length` is unchanged, so this merely re-assigns N. The primitive same-value guard (on by default) makes the enqueue itself a no-op and the stream does not restart
3. `$updatedCallback` commits a successful chunk into `items` and calls `reobserve()`
4. On the next visibility callback the expression returns N+1. After the updater drains the `page` update, the dependency hit in `$streams.args` aborts the old run and starts a new one with the new args

→ No hand-written exhaust guard on `!loading` / `!error` is needed, and an ordinary intersection edge never turns into an out-of-budget retry of a failed page.
Deliberately retrying the same page updates a separate dependency, `retryNonce`. That is the boundary of the current `$streams` restart API, which encodes an occurrence ("again with the same arguments") as a value difference. Besides the button, in an error state that already has items, a sentinel edge accompanied by evidence that "scrollY moved since the error was recorded" updates `retryNonce`. There are two forms of evidence: a `leave` where scrollY moved arms the following `enter` once, and an `enter` where scrollY moved qualifies on its own. The latter rescues the case where the layout shift of the error UI itself pushed the sentinel out of the band — that leave fires with scrollY unchanged and cannot arm, and no new leave edge follows however far the user then scrolls away (IntersectionObserver fires only on transitions), so making arming the sole qualification would silently void the round trip back. The former rescues the case where the returning enter lands exactly on `errorScrollY` (a fling to a clamped bottom, say). A layout-induced edge satisfies neither qualification, since scrollY did not move, so merely rendering the error never reserves a retry.

Do not call `reobserve()` on error. With the sentinel still visible, the new observer's initial callback retries immediately, producing a layout-driven infinite retry that repeats the same cycle every time the budget is exhausted. So "re-arm even on error" is rejected, and an actual `leave → enter` or the Retry button is the recovery edge. An empty feed cannot scroll, so only the button remains.
The cancel / restart / stale-drop contract for a changed dependency is normatively defined in [`packages/state/docs/streams.md`](../packages/state/docs/streams.md).

---

## 4. @wcstack/state — when bindings are applied

Reference: [`packages/state/src/buildBindings.ts`](../packages/state/src/buildBindings.ts), [`stateElementByName.ts`](../packages/state/src/stateElementByName.ts)

### 4.1 The initial data-wcs application is on a separate microtask (no ordering guarantee against `$connectedCallback`)
`connectedCallback` on `<wcs-state>` goes: (1) load the state → resolve `initializePromise` → (2) run `$connectedCallback`. The **initial application of data-wcs bindings, meanwhile, happens in `buildBindings` (a separate microtask)**, which runs after waiting on `initializePromise`. So **at the time `$connectedCallback` runs, neither "the url is on the element" nor "the command tokens are wired" is guaranteed**.

→ **Consequence**: to poke an element from `$connectedCallback` on the assumption that bindings exist (emitting a command, reading an element property), wait on `getBindingsReady()`:

```js
async $connectedCallback() {
  await customElements.get("wcs-state").getBindingsReady(document);
  // by here the url has been applied and the commands are wired
}
```

For an unregistered rootNode it returns `Promise.resolve()`, so it cannot hang.

Note that **this wait is not needed in order to read the initial snapshot of a monitor node**. Directional initial sync (on by default) solves that structurally, and the value arrives through the property read when the binding is established (§7.1, §10.1). The wait is needed only when `$connectedCallback` actively pokes the element (emitting a command, reading an element property).

### 4.2 Writing `undefined` is skipped (clear explicitly with `null`)
The binder does not write `undefined` into properties/inputs (it skips the write itself). For details and the SPEC proposal see [spec-proposal-undefined-write-skip.md](./spec-proposal-undefined-write-skip.md) (ja).


### 4.3 With `<wcs-view-transition>` on the page, the drain lands on a frame, not a microtask
The drain (`Updater._applyChange`) normally applies its bindings synchronously inside the microtask it was queued on. When a `@wcstack/view-transition` arbiter is installed **and accepts the `state` participant** (`for=` includes `state`, the default), the binding application is handed to `document.startViewTransition`, which invokes it on a later frame.

→ **Consequence 1**: code that writes state and then reads the DOM after `await Promise.resolve()` sees the old DOM. Wait for the transition, or use `$updatedCallback` — it still fires right after the bindings are applied, inside the update callback, so its *position* is unchanged even though it moves a frame later along with them.

→ **Consequence 2 — the mechanism order inverts.** The drain-end batch listeners (`$watch` → `$streams` restart, §3) stay on the original microtask, because they consume state addresses and not the DOM. `$updatedCallback` does not. So the order §3 calls fixed — `$updatedCallback` → `$watch` → `$streams` restart — becomes `$watch` → `$streams` restart → `$updatedCallback` for as long as the arbiter accepts `state`. This is the only thing on a page that reorders that layer. A `$watch` handler that reads something `$updatedCallback` wrote cannot rely on the declared order while the tag is present.

What does **not** change: initial rendering is never wrapped (only the drain is); `inSsr()` short-circuits to the synchronous path; and a batch with no bindings to apply is never handed to the arbiter, so a write to a headless path (`$watch`-only, `$streams` internal state) neither animates nor defers. With no arbiter installed — or with `for="router"` — the drain is byte-for-byte what it was.

Normative description: [view-transition-design.md](./view-transition-design.md) §7.2.

---

## 5. example → the contracts it depends on (traceability)

| example | Contracts it depends on |
|---|---|
| [`state-search`](../examples/state-search) | §1.1 (counting dispatches by loading edges) / §1.2 (auto-fetch on a debounced url change) / §1.4 (no response on abort → no staleness) |
| [`users-crud`](../packages/fetch/examples/users-crud) | §1.3 (re-fetching with the `refreshList` command) / §1.4 (response fires on error too → decide success by status) / §1.5 (suppressing detail for an empty url) |
| [`infinite-scroll`](../packages/fetch/examples/infinite-scroll) | §1.2/§1.4 (appends check status) / §2.1 (the sentinel needs a box and fires on the first task) |
| [`state-intersect-scroll`](../examples/state-intersect-scroll) | §2.2+§2.3 (self-healing with reobserve) / §3 (`$streams` restart plus equal-value page selection to prevent page skips) |

---

## 6. Maintenance guidance

- A change that **alters** these contracts (how many times something fires, when, the idempotence rules) can be breaking. Update this document, the relevant READMEs, and the dependent examples together
- When adding a new async primitive tag, add a section here at the same granularity as §1/§2: when, how many times, what is synchronous
- Whenever you are tempted to explain internal behavior in a long comment in an example, check whether this document has an entry first; if not, add one and then link the comment to it

---

## 7. @wcstack/screen-orientation — the monitoring and `lock()` firing contract

Reference: [`packages/screen-orientation/src/core/ScreenOrientationCore.ts`](../packages/screen-orientation/src/core/ScreenOrientationCore.ts), [`README`](../packages/screen-orientation/README.md)

### 7.1 The initial snapshot fires synchronously and is not re-sent to a late subscriber
`observe()` reads the current `screen.orientation` synchronously as it subscribes and, if it differs from the default, dispatches `wcs-orientation:change` immediately. But `@wcstack/state`'s data-wcs binding attaches its listener on a separate microtask after `initializePromise` resolves (§4.1), so nobody is subscribed yet when that initial dispatch flies during the Shell's `connectedCallback`, and it does not arrive. From then on the binding can only get a value from the **next** `change` (an actual device rotation).

→ **Consequence**: the *event* does not arrive, but **the value does**. Every observable property of this node is output-only (in `properties`, absent from `inputs`), so the default binding authority becomes `element` and the binding reads the property directly when established (directional initial sync, on by default since v1.21.0; `BindingSession.readProducerSnapshot` / `initialSync.ts`'s `hasOutput && !hasInput ? "element" : "state"`). The initial values (`portrait`/`landscape`/`type`/`angle`) are therefore correct from the first render with no manual pull. This is not specific to screen-orientation; it holds for every monitor node. The real-browser regression test is `e2e/tests/monitor-initial-snapshot.spec.ts`.

Only in a configuration with `enableDirectionalInitialSync: false` does the old idiom (`$connectedCallback` plus `customElements.whenDefined` plus a property pull) become necessary again.

### 7.2 `lock()` is last-wins through the `_gen` generation (independent of the monitoring path)
`lock()` increments and captures `_gen` on each call and, if the generation changed while it was awaiting (another `lock()`/`unlock()`/`dispose()` happened in between), discards the resolve/reject result and does nothing. The monitoring path (`observe()` and the `change` listener) is entirely synchronous and neither consumes nor consults `_gen` — that asymmetry (monitoring: no `_gen` needed; commands: `_gen` required) is this node's design characteristic.

→ **Consequence**: with a consecutive `lock("landscape")` → `lock("portrait")`, a late resolve/reject of the earlier call does not overwrite the `error` the later one established. "The last `lock()` called wins" always holds.

### 7.3 `unlock()` / `dispose()` invalidate an in-flight `lock()` by generation
`unlock()` does `_gen++` before its main body. `dispose()` detaches the listener and invalidates an in-flight `lock()` with `_gen++` (`dispose()` is a fully synchronous block, and a stale `lock()` can only settle on a microtask or later, so where the `_gen++` sits inside the block makes no observable difference). Both make an in-flight `lock()` stale, so even if that `lock()` resolves or rejects afterwards it does not rewrite the state `unlock()`/`dispose()` established.

→ **Consequence**: both "call `unlock()` while a `lock()` is in flight" and "disconnect while a `lock()` is in flight" are safe, with no risk of the old `lock()`'s result overwriting things.

### 7.4 `error` is same-value guarded (`===` reference comparison) — `"unsupported"` dedupes through a shared constant
`_setError` does not re-dispatch when `this._error === error`. Creating a new object literal on each failure where the API is absent would change the reference every time and defeat the guard, so `"unsupported"` passes a module-scope shared constant with the same reference every time.

→ **Consequence**: calling `lock()`/`unlock()` repeatedly in an unsupported environment fires `wcs-orientation:error` only the first time. An actual failure object (a rejected `NotSupportedError`, say) is a new object per call, is not caught by the guard, and fires on every failure.

---

## 8. @wcstack/tilt — the `requestPermission()` and `change` firing contract

Reference: [`packages/tilt/src/core/TiltCore.ts`](../packages/tilt/src/core/TiltCore.ts), [`README`](../packages/tilt/README.md), [device-orientation-tag-design.md](./device-orientation-tag-design.md) (ja)

### 8.1 `connectedCallback` does not subscribe — the "lost initial snapshot" of screen-orientation §7.1 does not arise here
`observe()` is a synchronous no-op that only returns `_ready` (fixed at `Promise.resolve()`); it neither subscribes to `deviceorientation` nor reads a current value (§6 decision 4). Unlike `screen.orientation`, Device Orientation has no synchronously readable "current value" at all (values arrive only through events), so the problem screen-orientation §7.1 has — a synchronous dispatch during `connectedCallback` vanishing because the data-wcs listener is not attached yet — cannot occur structurally. Until `start()` is called, no `wcs-tilt:change` fires at all.

→ **Consequence**: initial values are not something to worry about. `start()` is always called after `requestPermission()` (usually inside a user gesture handler), by which point the `@wcstack/state` data-wcs bindings are normally established (via §4.1's separate microtask), so the `$connectedCallback` pull that screen-orientation's README Quick Start needs (§7.1) is unnecessary — tilt's own README has no such pattern.

### 8.2 The post-await write in `requestPermission()` is benign — it has no `_gen`
`requestPermission()` is async (`await Ctor.requestPermission()`) but, unlike `start`/`stop`, uses no `_gen` and no `AbortController`. Its post-await writes are plain property assignments plus dispatch on `permissionState`/`error`; they create nothing whose lifetime needs managing, such as a subscription or a callback registration. Even if the element has disconnected, the write neither revives a subscription nor causes a double registration — with nobody subscribed, `dispatchEvent` simply misses harmlessly (the same shape as `requestPermission()` on `<wcs-idle>`, [idle-detection-tag-design.md](./idle-detection-tag-design.md) (ja) §4.1).

→ **Consequence**: calling `requestPermission()` repeatedly (unlikely in practice given the gesture constraint) settles `permissionState`/`error` in **resolve order rather than call order**, since there is no supersession through `_gen`. Browsers return a cached result immediately after the first permission dialog, so in practice that reordering is essentially never visible.

### 8.3 `wcs-tilt:change` is same-value guarded (all four of `alpha`/`beta`/`gamma`/`absolute` compared)
`_apply` skips the dispatch when all four fields of the new `deviceorientation` event match the previous snapshot (§3.3 MUST). The comparison is `===` (two nulls match).

→ **Consequence**: while the device is at rest, the native `deviceorientation` keeps firing at a high rate and on some platforms keeps producing identical values, but `wcs-tilt:change` only arrives when the value actually changed.

### 8.4 `wcs-tilt:error` is same-value guarded (`===` reference comparison) — a successful settle always clears it to `null`
`_setError` does not re-dispatch when `this._error === error`. A rejection from `requestPermission()` (a call outside a gesture context, say) builds a new object literal (`{ error: e }`) in each catch, so the reference changes every time and it fires on every failure. A call that settles without an exception (granted, a plain denied, an immediate granted in a non-gating environment) never reaches the catch, so `_setError(null)` is called first unconditionally — if the previous value was non-null, `wcs-tilt:error(null)` flies; if it was already null, the guard suppresses the dispatch.

→ **Consequence**: the inconsistency of "an old failure left in `error` while only `permissionState` updates" cannot happen — a successful settle always clears `error` before updating `permissionState` (the call order inside `TiltCore.requestPermission()`).

---

## 9. The four Generic Sensor siblings (accelerometer / gyroscope / magnetometer / ambient-light-sensor) — the `reading` and `error` firing contract

Reference: [`packages/accelerometer/src/core/AccelerometerCore.ts`](../packages/accelerometer/src/core/AccelerometerCore.ts) (all four are the same shape; gyroscope / magnetometer / ambient-light-sensor share the contract), [sensor-tag-design.md](./sensor-tag-design.md) (ja)

All four are identical in both Core and Shell and share the contract completely. The only difference is the shape of the observed value (three axes x/y/z versus ambient-light-sensor's single scalar `illuminance`).

### 9.1 Nothing starts on connect — completely inert until the `start` command fires
The Shell's `connectedCallback` does not call `observe()` (it only sets `display: none` and swaps in the SSR promise; sensor-tag-design.md §1.3). Merely binding leaves `x`/`y`/`z` (`illuminance`) at their initial `null` and fires no `wcs-*:reading` at all. The "lost initial snapshot" of screen-orientation §7.1 cannot arise structurally (there is nothing to dispatch on connect). `disconnectedCallback` calls `dispose()` (= `stop()`), so **reparenting the element means stopping the sensor, with no automatic resumption** — values stay frozen at the last sample until `start` fires again.

→ **Consequence**: for the same reason as tilt §8.1, no `$connectedCallback` pull is needed. `start` normally fires after a `requestPermission`-style gesture flow, by which point the data-wcs bindings are established.

### 9.2 `reading` has **no** same-value guard (fires per sample) / `error` **does** (a composite name+message key)
`reading` is event-natured (a new sample each time) and is dispatched **every time**, even when the value happens to be identical (sensor-tag-design.md §1.1). `x`/`y`/`z` are getters derived from the single `wcs-*:reading` event (one native `reading` updates every axis at once). `error`, by contrast, is state-natured: `_setError` suppresses a re-dispatch only when **both** `error` (the name) and `message` match the previous ones — a differing name alone or a differing message alone re-dispatches.

### 9.3 `error` is sticky — it is not cleared by a successful (re)start or by receiving a reading
Unlike screen-orientation's `lock()`, which calls `_setError(null)` on success, the four monitoring sensors do **not** rewrite `error` on the success path. After a failure (`unsupported`, a `SecurityError` from the constructor) followed by a successful retry, the previous `error` remains (see each README's "Notes and limitations"). Clearing and reinterpreting it is the consuming state's responsibility.

### 9.4 The trio of no `_gen`, fully synchronous paths, and never-throw
`start()`/`stop()` are synchronous subscribe/unsubscribe toggles with no async probe, so the `_gen` generation guard is unnecessary (sensor-tag-design.md §1.5, on the same grounds as network §5). never-throw is carried on three paths: (1) API absent → `{ error: "unsupported", ... }`; (2) a synchronous exception from the constructor (permission refusal, a Permissions-Policy block) → caught into `error`; (3) a synchronous throw from a non-conforming `sensor.start()` → caught, then **torn down** (detaching the failed instance's listeners and returning `_sensor` to null) before going to `error` — the teardown lets the next `start()` retry with a fresh sensor. `start()` is idempotent while running (it does not create a second sensor), and `frequency` is read only at `start()`.

### 9.5 The message fallback for an `error` event is the constant `"Sensor error"`
Where a native `error` event carries no `error` field, it is normalized to `{ error: "error", message: "Sensor error" }` (rather than storing the string `"undefined"` that `String(undefined)` would produce). The wording is identical across all four.

---

## 10. @wcstack/network — the monitoring firing contract

Reference: [`packages/network/src/core/NetworkCore.ts`](../packages/network/src/core/NetworkCore.ts), [`README`](../packages/network/README.md), [network-tag-design.md](./network-tag-design.md) (ja)

### 10.1 The initial snapshot fires synchronously during connect and does not reach the data-wcs binding (the same shape as screen-orientation §7.1)
The Shell's `connectedCallback` calls `observe()`, which reads `navigator.connection` synchronously as it subscribes and, if it differs from the default snapshot (every field null, `supported: false`), dispatches `wcs-network:change` immediately. In a supporting environment `supported` goes false→true, so that initial dispatch **always** happens — but per §4.1 the data-wcs listener attaches on a separate microtask, so it reaches nobody.

→ **Consequence**: the *event* does not arrive, but **the value does**. Since every observable property is output-only, the default authority is `element` and the binding reads the property directly when established (the same mechanism as §7.1). No manual pull is needed.

### 10.2 In an unsupported environment (Firefox/Safari) `change` never fires at all
With `navigator.connection` absent, `observe()`'s initial read returns `UNSUPPORTED_SNAPSHOT` — the same reference as the default — which the same-value guard suppresses. There is nothing to subscribe to afterwards either, so `wcs-network:change` never fires. Determining `supported` is therefore not a matter of waiting for an event but of **the property read when the binding is established** (the same mechanism as 10.1). Even in a supporting environment `supported` settles once on connect and never fires again, which makes that property read the only route to it (regression: `e2e/tests/monitor-initial-snapshot.spec.ts`).

### 10.3 `change` is same-value guarded on all five fields / `observe()` is idempotent / no `_gen`
`_apply` compares `effectiveType`/`downlink`/`rtt`/`saveData`/`supported` individually and does not dispatch when all five match (defence in depth against a double-fired native `change`). `observe()` is idempotent through the `_subscribed` flag (no duplicate listener), and `dispose()` resets the flag so dispose→observe revives it (the revival re-reads). The subscription is fully synchronous, so there is no `_gen` (network-tag-design.md §5). It is a pure monitor (`commands: []`) with no command surface.

---

## 11. @wcstack/permission — the monitoring firing contract

Reference: [`packages/permission/src/core/PermissionCore.ts`](../packages/permission/src/core/PermissionCore.ts), [`README`](../packages/permission/README.md)

### 11.1 A pure monitor (`commands: []`) — one observable, `state`, with the other four values as getters derived from the same event
`granted` / `denied` / `prompt` / `unsupported` are all getters derived from the single `wcs-permission:change` event (whose detail is the raw `state` value). `_setState` is same-value guarded and dispatches once only when `state` actually changed — the four derived values change in lockstep with `state`, so that notifies every property at once.

### 11.2 In a supporting environment the first value settles when `query()` resolves (asynchronously); only some unsupported cases dispatch synchronously during connect
In a supporting environment `observe(descriptor)` issues `navigator.permissions.query()` and the first `change` flies when the query resolves (not as a synchronous dispatch during connect — though the order between that resolve and the establishment of the data-wcs binding, itself on §4.1's separate microtask, is not guaranteed either). Where **the API is absent or the descriptor has no `name`**, by contrast, the transition from the initial `"prompt"` to `"unsupported"` is dispatched **synchronously** during `connectedCallback` and, as in §7.1, does not reach data-wcs (an `"unsupported"` arising from a query rejection comes at resolve time, i.e. asynchronously).

→ **Consequence**: determining `unsupported` is not a matter of waiting for an event but of **the property read when the binding is established** (the same mechanism as network §10.2; `state` / `granted` / `denied` / `prompt` / `unsupported` are all output-only, so the default authority is `element`).

### 11.3 `observe()` is a no-op while subscribed — swapping the descriptor does not re-query
After the subscription is established, `observe()` only updates the stored descriptor and **does not re-query even for a different `name`** (the v1 Shell is fixed to the descriptor from connect time). To switch permission, `dispose()` and then `observe()` with the new descriptor.

### 11.4 `_permGen` — bumped per query and on `dispose()` (a stale query attaches no listener)
An in-flight query bails at resolve time if the generation it captured has gone stale (attaching no listener and writing no state). Where a fast disconnect→reconnect leaves an earlier query to resolve later, only the current subscription holds a listener. While subscribed, `change` events from the live `PermissionStatus` (the user flipping a grant in browser settings) keep flowing in.

---

## 12. @wcstack/resize — the observation and firing contract

Reference: [`packages/resize/src/core/ResizeCore.ts`](../packages/resize/src/core/ResizeCore.ts), [`README`](../packages/resize/README.md)

### 12.1 Observation is command-driven (auto-observed on connect unless `manual`) / the initial size arrives as the observer's first entry
The `observe` command resolves the Shell's `target` and attaches `ResizeObserver.observe()`. Core dispatches nothing synchronously during connect; the initial size arrives as the first entry ResizeObserver itself delivers when observation begins (after layout in a real browser — normally later than the establishment of the data-wcs binding (§4.1), so §7.1's lost initial snapshot is not a practical problem here).

### 12.2 `change` has no same-value guard (fires per callback) / `observing` does
`entry` / `width` / `height` are getters derived from the single `wcs-resize:change` (event-natured, the same shape as intersection §2.4). A re-notification of the same size flows through as-is. `observing` is state-natured and same-value guarded.

### 12.3 `observe()` is idempotent for the same element and options / a change tears down and rebuilds, re-delivering the first entry
The same churn countermeasure as intersection §2.2. When the element or the options (`box` / `round`) change, the observer is rebuilt and **re-observing re-delivers the initial size** (which is why flipping `round` fires again with the new rounding). Idempotence is judged on **the requested** options (so that after a `box` fallback, re-observing does not rebuild and re-fall-back every time).

### 12.4 No `_gen` / unsupported and failures are silent no-ops (there is no error surface)
Establishing the subscription is synchronous, and a stale callback is stopped by the observer teardown in `disconnect()` itself, so no generation guard is needed. An absent `ResizeObserver` (SSR) is a silent no-op with `observing` left false. An unsupported `box` is retried once with `content-box`, and if that also fails it gives up with `observing` false — this node has no `error` property at all.

---

## 13. @wcstack/geolocation — the acquisition and monitoring firing contract

Reference: [`packages/geolocation/src/core/GeolocationCore.ts`](../packages/geolocation/src/core/GeolocationCore.ts), [`README`](../packages/geolocation/README.md)

### 13.1 Three generation counters — the one-shot is capture-only, the watch bumps
- `_permGen`: for the permission query. Bumped per query and on `dispose()` (the same shape as §11.4)
- `_acqGen`: for the one-shot. **Only `dispose()` bumps it**; `getCurrentPosition()` merely captures — so concurrent one-shots do not swallow each other's success (the same judgment as share / contacts being capture-only). Since the Geolocation API has no AbortController, the generation guard is the only means of invalidating an in-flight one-shot
- `_watchGen`: bumped by `watch()` / `clearWatch()` / `dispose()`. A callback from an old watch arriving after a clearWatch→watch restart cannot be rejected by a null check on `_watchId` (the new watch has re-set it), so it is rejected by generation comparison

### 13.2 `position` has no same-value guard (fires per fix) / a successful fix clears the error
`latitude` / `longitude` / `accuracy` / `coords` / `timestamp` are getters derived from the single `wcs-geo:position`, and a fix dispatches every time. On the watch path too, every successful fix calls `_setError(null)` (preventing a transient TIMEOUT from lingering; thanks to the same-value guard it is silent when error is already null). `watching` / `loading` / `permission` are same-value guarded; `error` is reference-guarded and each failure is a fresh object.

### 13.3 A watch error does not cancel the watch
The watchPosition error callback only raises `error`; `watching` stays true (the watchId is alive, and teardown is `clearWatch()`'s responsibility). To stop on a terminal error such as PERMISSION_DENIED, the consumer reacts to `error` and fires `clearWatch`.

### 13.4 `dispose()` resets `_loading` silently
`dispose()` bumps all three generations and returns `_loading` to false **without dispatching**. An in-flight callback that bailed will no longer clear loading, and leaving it set would let the same-value guard eat the loading=true edge of the next acquisition after a reconnect — hence the silent reset.

### 13.5 The permission probe starts in the constructor / `getCurrentPosition()` never rejects (every path resolves)
The first permission probe starts in Core's constructor (before connect). `getCurrentPosition()` resolves on every path — stale, success, and failure (so as not to hang the SSR connectedCallbackPromise). A non-`manual` connect auto-starts either watchPosition() or getCurrentPosition() depending on the presence of the `watch` attribute.

---

## 14. @wcstack/idle — the `start()` and `change` firing contract

Reference: [`packages/idle/src/core/IdleCore.ts`](../packages/idle/src/core/IdleCore.ts), [`README`](../packages/idle/README.md), [idle-detection-tag-design.md](./idle-detection-tag-design.md) (ja)

### 14.1 Nothing starts on connect (no auto-start)
`observe()` is a synchronous no-op. The permission is gesture-gated, so an automatic start on connect would always fail and is deliberately absent by design (idle-detection-tag-design.md §6). For the same reason as tilt §8.1 and sensor §9.1, no initial snapshot is lost structurally and the `$connectedCallback` pull idiom is unnecessary.

### 14.2 `start()` is the "stop then new generation" supersede style / dispatches the initial state on success
`start()` begins by calling `stop()` (aborting the old session, removing its listeners, bumping `_gen`) and then captures the new generation — the same "a new call overtakes the old" style as fetch, and **the opposite** of share / contacts being capture-only. After `await detector.start()` succeeds it calls `_setError(null)` → `_setState(detector.userState, detector.screenState)`, so **the initial idle state arrives when start() succeeds** (normally with the data-wcs bindings already established, since it follows a gesture flow). On failure it tears down the failed session's listeners and controller before flowing into `error` (leaving them in place would let a later `change` from the same instance write state contradicting the error just recorded).

### 14.3 An AbortError originating from stop needs no special-casing (`_gen` moves first)
`stop()` does `_gen++` **before** `abort()`, so an AbortError caused by stop is always judged stale by the time the catch is reached. The signal is private, so no AbortError of other origin exists — which is why there is no AbortError branch inside the catch.

### 14.4 `change` has a composite same-value guard / `requestPermission()` has no `_gen`
`wcs-idle:change` is suppressed only when **both** `userState` and `screenState` match the previous ones (a difference in either fires). `requestPermission()` is a benign post-await write of the same shape as tilt §8.2 (no `_gen`): a successful settle (granted, a plain denied) does `_setError(null)`, while a rejection fires every time with a fresh `{ error }`.

---

## 15. @wcstack/wakelock — the desired / actual and re-acquisition firing contract

Reference: [`packages/wakelock/src/core/WakeLockCore.ts`](../packages/wakelock/src/core/WakeLockCore.ts), [`README`](../packages/wakelock/README.md)

### 15.1 The two phases desired (`active`) and actual (`held`) — only `held` is exposed
The OS releases the lock on its own when visibility is lost and so on, so "wanted" (`_active`) and "held" (`held`) diverge. Only `held` / `error` are bindable; desired is a non-bindable plain getter (a value that does not change on an OS auto-release, so it is not made observable). `held-changed` is same-value guarded. On connect it auto-requests only when the `active` attribute is present and it is not `manual`.

### 15.2 Two routes to re-acquisition — returning through visibilitychange, and a release while still visible (lease renewal)
In addition to a hidden→visible return (re-acquiring where desired and not held), an OS release **while still visible** (battery-low, power-saver, and the like, without an accompanying `visibilitychange`) triggers a re-acquisition attempt right after held=false is reflected through the sentinel's `release` event. A failed re-acquisition records `error` and stops (it attaches no listener, so no `release` re-entry and no loop).

### 15.3 The same-value guard on `error` is the family's only **value comparison** (name plus message)
In a denied environment the rejection of every re-acquisition on a visibility return builds **a fresh Error each time**, so reference comparison would not guard. Comparing `name` plus `message` by value means that toggling hidden→visible in a permanently denied environment fires `wcs-wakelock:error` only the first time. A transition that passes through null (cleared on success, then failing again) always fires again.

### 15.4 Two stages, `_gen` plus an in-flight flag — one coalesced retry if superseded
`_gen` is bumped by `release()` and at the start of each acquisition. The `_acquiring` flag prevents a duplicate platform call from concurrent `request()`s (two rapid visibilitychanges, or a release→request overlap), and an acquisition superseded mid-await drops its sentinel and then retries **exactly once** if it is still desired, not held, and visible. A chain of retries can only lengthen with the number of external overlaps — a bounded design.

---

## 16. fullscreen / pointer-lock / picture-in-picture (the target-reference trio) — the `active` and `error` firing contract

Reference: [`packages/fullscreen/src/core/FullscreenCore.ts`](../packages/fullscreen/src/core/FullscreenCore.ts), [`packages/pointer-lock/src/core/PointerLockCore.ts`](../packages/pointer-lock/src/core/PointerLockCore.ts), [`packages/picture-in-picture/src/core/PipCore.ts`](../packages/picture-in-picture/src/core/PipCore.ts), [fullscreen-tag-design.md](./fullscreen-tag-design.md) (ja) (the archetype; the other two nodes are described as deltas from it)

### 16.1 `active` is derived by self-filtering "the document-wide value === my resolved target" (same-value guarded)
Only `active` is bindable (`wcs-fullscreen:change` / `wcs-pointer-lock:change` / `wcs-pip:change`). Each instance decides not "is something fullscreen / locked / in PiP" but "is **my** resolved target that", so several coexisting instances separate correctly (fullscreen-tag-design.md §2.1). The detail shape is `{ active }` plus getters for fullscreen and PiP, and a plain boolean for pointer-lock (a known design difference within the family).

### 16.2 `error` is non-bindable (no dedicated event, pull-only) — a deliberate design shared by the three
`_setError` only assigns and does not dispatch, and it is not declared in `wcBindable.properties`. Read `element.error` imperatively after the command's promise settles (all three READMEs state this). These are three known exceptions to the family majority that turns error into an event; aligning them means doing all three at once together with their READMEs (this document describes the contract as it stands).

### 16.3 Where the subscription lives: document for fullscreen and pointer-lock, the `<video>` itself for PiP
fullscreen attaches `fullscreenchange` (with a webkit fallback) and pointer-lock `pointerlockchange` (same) to the document. PiP attaches `enterpictureinpicture` / `leavepictureinpicture` to the resolved `<video>` and re-wires when the target changes. PiP also re-wires through `observe(element)` inside `requestPictureInPicture()` itself, so `active` tracks a `<video>` that appeared after connect time.

### 16.4 An initial firing on connect happens only when (re)connecting in an already-active state
`observe()` and target resolution on connect re-derive `active`, but normally it is false→false, the same-value guard catches it, and there is no dispatch. Only when (re)connecting while pointing at an element that is already fullscreen / locked / in PiP does a synchronous dispatch occur during connect and, for the same reason as §7.1, fail to reach data-wcs. Since the request APIs require a user gesture, in practice this arises mainly on reparenting.

### 16.5 Async commands are `_gen` last-wins / the no-op check in the exit commands comes before the bump / pointer-lock's exit is synchronous
`requestFullscreen()` / `requestPictureInPicture()` bump and capture `_gen` per call (the same last-wins as screen-orientation §7.2; `dispose()` bumps too). `exitFullscreen()` / `exitPictureInPicture()` perform their silent no-op checks ("already inactive", "API absent") **before** the `_gen` bump — so that a call which does nothing does not make an in-flight request stale and swallow its error / active update. pointer-lock's `exitPointerLock()` is a synchronous platform API (returning `void`), so it has no `_gen`, only a defensive try/catch.

## 17. A cross-cutting contract: custom states (CustomStateSet / `:state()`) are a synchronous projection of the last event fired

Applies to: every I/O node. The canonical design is `custom-state-reflection-design.md` §3.5 (ja); the implementation rules are guidelines §4.5.

### 17.1 Reflection runs synchronously during the dispatch of that event
In its constructor (i.e. at upgrade) the Shell registers reflection listeners for its own `*-changed` / `:error` events, and never removes them. Registration happens **before Core is created (`new Core(this)`)** so as not to miss the first event Core dispatches synchronously inside the constructor (speak/listen's `unsupported-changed`, say). A user listener that did `addEventListener` after the upgrade **always sees the states already reflected** (by listener registration order). A listener registered before the upgrade may run before reflection — that order is not guaranteed.

### 17.2 The states are a projection of events, not of properties
Whether a same-value guard applies follows each event's own contract (fetch §1.1's `loading-changed` fires unconditionally, but `add`/`delete` are idempotent so there is no observable difference). Every state starts off. States are not cleared on disconnect or `dispose()` — on nodes where dispose fires a state-resetting event, the states follow automatically.

### 17.3 Where reflection is impossible it disables itself quietly
Where `attachInternals` is absent (including the happy-dom test environment) and on older Chromium (<125), which rejects state names without a dash, a probe at acquisition time makes the whole reflection path a no-op. Functionality, events, and properties are entirely unaffected. The `debug-states` attribute mirror (`data-wcs-state-*`) is disabled at the same time (it displays the states; it is not an alternative surface).

> **Remaining work**: contract sections for the monitor nodes are all written, §7 through §16 (2026-07-06). When adding a new async primitive tag, follow the guidance in §6: re-read the implementation and add a section here (do not assert anything the implementation cannot confirm).

---

## 18. @wcstack/raf — the frame delivery and paint contract (2026-07-10, partly measured)

Covers: the frame loop of `RafCore.start()`, the normalization of `dt`, the two phases of `suspended`, and the measured answer to "does making rAF the source line up with paint". The design is `raf-tag-design.md` (G1/G2/G3 decided).

### 18.1 `tick` fires per frame from the rAF callback (no same-value guard, reading style)
The only time source is the `DOMHighResTimeStamp` argument of the callback (`performance.now()` is never mixed in). The detail is `{ count, elapsed, dt, timestamp }`, with `tick`/`elapsed`/`dt` as getters derived from the same event (guidelines §4.2). The notification tick from `reset()` is not a frame, so its `timestamp = 0`. `running`/`suspended` are same-value guarded.

### 18.2 `dt` represents only the interval between frames of continuous running (G3)
`start()` / `resume()` / `visibilitychange` (both edges) discard `_lastTs`, so the `dt` of the next frame to arrive is 0. **A difference spanning an interruption never reaches an observer.** There is no upper clamp — how to handle a slow frame is the consumer's domain decision (the maze demo puts `Math.min(dt, 40)` on the physics side). `elapsed` is Σdt, so this normalization automatically makes it "active time" (there is no segment bookkeeping).

### 18.3 `running` / `suspended` are the desired / actual two phases (the same shape as §15 wakelock)
In a hidden tab, rAF **stops completely** (unlike setInterval's ~1Hz throttle). `running` is the intent that start was called, and stays true while hidden. `suspended` is derived as "running and hidden", driven by the `visibilitychange` that `observe()` (the Shell's connect) subscribes to. Before observe() and in an environment with no document it is always false. stop/pause remove the intent, so suspended goes false immediately too. Verified in a real browser: with a synthetic visibilitychange, `suspended` true/false and the CSS match of `:state(suspended)` were both confirmed (headless Chromium).

### 18.4 [Measured] A state write originating from tick reaches the DOM "by the next frame" — exactly one frame of paint delay
Measurement (headless Chromium; `<wcs-raf>` → `eventToken.tick` → `$on` incrementing a counter → a `textContent` binding):
- Within the same task as the tick dispatch (at a `setTimeout(0)` after the microtask drain), the DOM holds **the previous frame's value** (100 out of 100 runs).
- By the next frame's rAF callback it is applied (≥99 out of 100).

So `wcs-raf`'s tick lines up with vsync, but a paint that has been through `@wcstack/state`'s event → `$on` → updater pipeline is **exactly one frame late**. The updater itself is a `queueMicrotask` (per §4), which means a task boundary exists somewhere upstream (not yet identified — a candidate for investigation on the state side. Flushing within the same frame would remove one frame of visual delay from the event-driven updates of every I/O node).

Consequences: (1) this is not specific to raf but a general property of writes through event-token / two-way (the old `<wcs-timer interval="16">` loop behaved the same, so it is not a regression from the raf migration). (2) It does not affect the correctness of dt-based physics or logic. Only the visual delay of +1 frame (~16.7ms). (3) How it was verified: a Playwright probe against the maze demo in examples (reading the DOM from a tick listener via `setTimeout(0)`, and reading it on the next frame).

---

## 19. @wcstack/audio — the application-time and rebuild contract (2026-08-03)

Covers: when a value applied to `<wcs-audio>` becomes audible, and which DOM changes induce a graph rebuild. The design is [audio-tag-design.md](./audio-tag-design.md) (ja); the grounds are [ADR-14](./architecture-hardening/14-handle-graph-wiring.md) (G4/G5 adopted).

### 19.1 A node with an external clock exposes desired only and does not specify the application time (cross-cutting)

**This section is not specific to audio; it applies to every node with a clock of its own (an audio thread and the like).**

> A write to an input property is accepted synchronously and the getter returns the new value immediately (desired). **The time at which that value becomes audible (or otherwise effective) depends on the render quantum and output latency of the API in question, and this contract does not specify it.** The effective value (actual) is not exposed.

§18.4's raf could be pinned to "exactly one frame" by measurement, but audio's render quantum (128 samples) plus `outputLatency` is hardware-dependent and cannot be fixed to a value. So "not specified" is itself the contract.

Consequences:
- The same-value guard operates on the **desired value** (`param.value` is never read back).
- Parameter updates are smoothed with `setTargetAtTime(v, currentTime, 0.02)`. **Those 20ms are part of the contract**, to prevent clicks — not an implementation detail.
- It is the shape of exposing only **one side** of §15 wakelock's desired/actual pair (wakelock exposed the actual side, `held`; here it is the other way round).

### 19.2 Only the enumerated DOM changes induce a rebuild (MUST NOT extend)

| Change | Reaction |
|---|---|
| a numeric attribute or property (`frequency`, `gain`, `attack`, …) | **live update**, applied to every instance including sounding voices |
| a structural attribute (`id`, `out`, `param`, `note`, `master`, `poly`) | **rebuild** |
| adding, removing, or moving an audio tag | **rebuild** |
| any other DOM change | **nothing (MUST NOT rebuild)** |

That last row is not decoration. The root `MutationObserver` is attached with `subtree: true`, but **it filters on whether the mutated node is an audio element**. Without the filter, adding a single `<div>` for a control cuts off the sound currently playing (the actual behavior of the prototype `wcs-synth.js`).

### 19.3 A rebuild comes with an audible break

Rebuilding the graph discards every sounding voice. That is not an implementation convenience but a side effect **stated as part of the contract**, and the flip side of the design intent that structure is something you declare, not something you animate.

### 19.4 Rebuilds coalesce on a microtask, and `setPatch` is idempotent

- Consecutive DOM edits are bundled into one rebuild. On a microtask, not a task (the cross-cutting contract of §3).
- `setPatch()` distinguishes a rebuild from a live update automatically, using **a structural hash that serializes the topology alone**. Numbers are not part of the hash. So a caller may re-submit the whole patch at any time without classifying the kind of change, and a re-submission with no change costs nothing (the same shape as resize's idempotent `observe()`, §12.2).
- There are two routes by which `setPatch` actually gets called (each element's `connectedCallback`, and the `MutationObserver`'s delivery). From the second call onward, a matching structural hash means no rebuild, so **the nodes are built exactly once**.

### 19.5 `dispose()` is not terminal

`dispose()` discards the graph and unsubscribes from the shared context's `statechange`, but a later `observe()` / `setPatch()` rebuilds it. An element going silent forever just because it moved within the DOM is unacceptable (the same shape as permission's `dispose()` → `observe()` resumption, §11.3).

### 19.6 Voice reclamation is on the audio clock (not timer-dependent)

A released voice is reclaimed only once `freeAt = noteOff + release * 3 + 0.3` (on the audio clock) has passed. **No wall-clock timer is used**: in a background tab `setTimeout` is throttled to about one-minute intervals while audio keeps playing, so a timer-based approach would leak a voice per key press.
