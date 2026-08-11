# The wcstack async execution model contract

- **Audience**: implementers and reviewers of `@wcstack` async I/O nodes — when designing a new node, and when reviewing a change that touches an existing node's async behavior (exclusivity, cancellation, retry, timeout)
- **Status**: normative. "MUST / SHOULD / MAY" carry their RFC 2119 meaning. The inventory in §12 is descriptive (informative); the normative parts are §2–§11 and §13
- **What this document does not change (most important)**:
  - **It does not touch the protocols.** It makes no change to the vocabulary, types, or syntax of wc-bindable-protocol (`IWcBindableProperty` / `IWcBindableCommand`), command-token, or event-token — and an implementation based on this document MUST NOT change them either
  - **It does not require behavior changes in existing nodes.** Existing implementations are ratified in §12, and where they disagree with the norms here, the disagreement is recorded as a deviation (the existing implementation wins). Refactoring for conformance is optional
- **Why this exists**: [async-io-node-guidelines.md](./async-io-node-guidelines.md) made the skeleton normative (Core/Shell separation, never-throw, the `_gen` generation guard, `observe()/dispose()/ready`). But the following were left to per-node implicit implementation: (1) **the exclusivity method** (how an older execution relates to a newer one), (2) **the first-class means of cancellation**, (3) **retry policy**, (4) **timeouts**, and (5) **the error envelope, and how it differs from a user-initiated dismissal**. Left implicit, every new node re-solves the same problems on its own (an old result overwriting a new one, an input that changes continuously, work completing after a disconnect, no guaranteed completion order) and subtly different semantics proliferate. This document gives those five **names and a canonical form**, so that the node collection lines up as one shared execution model for async work
- **See also**: the skeleton rules are in [async-io-node-guidelines.md](./async-io-node-guidelines.md) — this document extends its §3.3 / §3.4 / §3.6 from the execution-semantics side. A proposed cross-cutting verification layer that maps the lane / commit rules here onto ordered input and output traces plus conformance vectors is [io-node-trace-conformance.md](./io-node-trace-conformance.md) (ja). The canonical reference for per-node firing timing is [timing-and-firing-contract.md](./timing-and-firing-contract.md). Concurrent tracking of multiple operations (out of scope here) is [multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja)
- **日本語版**: [async-execution-model.ja.md](./async-execution-model.ja.md)

---

## 0. TL;DR — invariants of the execution semantics

1. A node declares its **execution form** (one-shot / stream / hold / monitor, §2) in its design document (MUST)
2. For every **lane** that starts async work, it declares an **exclusivity mode** (latest / queue / exhaust / overlap, §5) (MUST)
3. Generation guards are designed as two concepts: **world generation** (the `dispose()` boundary) and **operation generation** (per lane) (§4). `dispose()` invalidates every lane (MUST)
4. **The first-class means of cancellation is bumping the generation.** `AbortSignal` and native handles are additional means for releasing resources; correctness rests on the generation (§6)
5. A timeout is "a cancellation whose reason is running out of time". Its result is an `error` envelope (`name: "TimeoutError"`); it does not raise the `cancelled` axis (§7)
6. Automatic retry MUST be **finite**. It MUST NOT retry after an **intentional stop** or a **permanent error** (§8)
7. Failures are never-throw, landing in the `error` property. The envelope MUST at minimum expose a readable `message`. **A user-initiated dismissal is not an error — it belongs on the `cancelled` axis** (§9)
8. State properties MUST have a same-value guard; event-natured values MUST NOT (guidelines §3.3). Any other deduplication is chosen from the decision table in §10
9. The reference state machine in §3 is **normative as internal semantics**; there is no obligation to expose a `status` enum as an observable (and if you do, it is additive and does not change protocol vocabulary)

---

## 1. Scope and non-goals

### 1.1 Scope

- The semantics of async execution within a single Core instance: start, supersede, complete, fail, cancel, time out, deduplicate
- The discipline of isolation between lanes in a Core that has several (independent units of exclusivity)

### 1.2 Non-goals (explicitly out of scope)

- **Protocol changes.** A dynamically keyed property (a surface like `loading.<operationId>`) does not exist in the wc-bindable vocabulary ([multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja) §4), and this document does not introduce one
- **Concurrent tracking of multiple operations (`parallel`).** A model that tracks several in-flight operations individually in one lane is new ground with no precedent across the existing 25+ packages (same doc, §1). Here it is defined only as a reserved word (§5)
- **Behavior changes in existing nodes.** This document ratifies and names what exists, following the no-regret principle of [state-redesign-council.md](./state-redesign-council.md) (ja)
- **Temporal shaping of inputs (debounce / throttle).** That is the user's responsibility (guidelines §1). Inside a node, shaping stops at microtask coalescing (`scheduled`, §3.1)
- **Sharing implementation code.** Only the norms are shared. Whether to share execution primitives (a helper bundling generations, timers, and retry) is an open question in §14

---

## 2. Execution form — four types

A new node MUST declare in its tag-design doc which execution form it is (and which combination, if composite). The form determines the reference state machine (§3), the default exclusivity mode (§5), and whether an error surface is needed.

| Form | Definition | Nature of completion | Existing examples |
|---|---|---|---|
| **one-shot** | a single operation: start → settle | terminal (re-runnable after settle) | fetch, upload, share, contacts, credential, eyedropper, the `start` establishment of idle, clipboard read/write, geolocation `getCurrentPosition`, storage load/save |
| **stream** | establish → a run of events → disconnect | never terminates (a disconnect is a state, not an end) | websocket, sse, broadcast, worker, timer, raf, geolocation watch, listen |
| **hold** | acquire → hold → release. **Two phases: desired / actual** | an external cause (OS, visibility) can drop actual alone | wakelock, camera |
| **monitor** | subscription only (`commands: []`) or a watch lane | live (tracking changes) or monotonically terminal | permission, network, defined (monotonically terminal), the watch surface of screen-orientation / fullscreen |

- Composite examples: geolocation = one-shot + stream + monitor(permission); clipboard = one-shot + monitor; notification = one-shot(request) + fire(notify) + monitor(relaying clicks)
- A queue-style command (speak) is a variant of one-shot (exclusivity mode `queue`, §5)

---

## 3. Reference state machines

A state machine is **normative about the transitions an implementation has to satisfy**. There is no obligation to expose it as an observable (§3.5); it is satisfied by mapping onto the existing observation vocabulary (`loading` / `value` / `error` / `cancelled` / `connected`, …).

### 3.1 one-shot

```
idle ──(trigger)──▶ scheduled ──(coalesce window opens)──▶ running ──▶ settled ──▶ idle (re-runnable)
                                                       settled = success | error | cancelled | timeout
```

- **`scheduled` is the coalesce window** — the stage that folds several triggers within one microtask into a single execution. A node without it goes straight from idle to running. Where coalescing exists it MUST be implemented on a microtask, honouring the "microtasks precede tasks" contract ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §3). The reference implementation is fetch's auto-fetch (same doc §1.2: microtask deferral plus same-url dedupe)
- Mapping onto the observation surface (existing vocabulary; no new property required):
  - `running` ⇔ `loading: true` (once per dispatch, raised before the await — a generalization of timing contract §1.1)
  - `success` ⇔ `value` updated (`error` follows the clear/sticky declaration of §9.2)
  - `error` ⇔ an `error` envelope (§9.2)
  - `cancelled` ⇔ `cancelled: true` (§9.3 — user-initiated dismissal only)
  - `timeout` ⇔ an `error` envelope with `name: "TimeoutError"` (§7)
- A settle happens **at most once**. Thanks to the generation guard (§4), a superseded or discarded execution MUST write nothing to the observation surface

### 3.2 stream

```
closed ──connect()/start()──▶ connecting ──▶ open ──(message / tick)*──▶ closed
                                  ▲                                        │
                                  └──── reconnecting (within the §8 budget)◀┘ (external causes only)
```

- A disconnect is a state, not an end. **An intentional close** (close/stop/dispose, WebSocket close code 1000) and **an external disconnect** are distinguished, and entering `reconnecting` from an intentional close is forbidden (MUST NOT — websocket's `_intentionalClose` is the precedent)
- `message` / `tick` are event-natured and are not same-value guarded (guidelines §3.3)
- For establishment commands (connect/start), the default exclusivity SHOULD be `exhaust` (idempotent no-op while running) (§5)

### 3.3 hold

```
released ──request()──▶ acquiring ──▶ held ──(external release)──▶ released
```

- **desired (the user's intent) and actual (what is actually held) MUST live in separate fields.** wakelock's `active` (desired) / `held` (actual) and camera's `_desired` / `active` are the precedents
- If actual drops for an external reason while desired is still set, the node MAY re-acquire automatically (budget per §8). **On a permanent refusal (permission denied and the like) it MUST drop desired** — no infinite re-acquisition loops

### 3.4 monitor

```
unresolved ──(first probe settles)──▶ live (tracking changes) or terminal (monotonic, e.g. defined)
```

- The settle of the first probe is `ready` (guidelines §3.8). Unsupported is folded into state rather than error (the permission precedent, guidelines §3.6)

### 3.5 Separating the state machine from the observation surface

- There is no obligation to expose the transition diagram as a `status` enum. The observation surface follows the existing decomposition style, "booleans plus derived getters" (guidelines §4.2)
- If it is exposed, it is additive (no change of meaning for an existing property), and CSS reflection follows the rules in [custom-state-reflection-design.md](./custom-state-reflection-design.md) (an enum with no derived boolean getter is not reflected)

---

## 4. The canonical form of the generation guard

Guidelines §3.4 says only "have a `_gen`". This section defines its **canonical form**. The spread across existing implementations — one counter (dispose only), one (per-op), two, three — is explained as a composition of two concepts.

### 4.1 world generation

- MUST bump on `dispose()`. Bumping on `observe()` is optional
- **Every async continuation** (a then, a callback, a timer, a retry timer, a listener registration) MUST capture the generation when it starts and compare it when it fires. Retry timers included (worker's capture of its restart timer is the precedent)
- Where there are separate counters per lane, `dispose()` MUST bump **all of them** — miss even one and that lane keeps writing stale values into a torn-down element ([multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja) §3)
- **Exemption**: a node whose every path is synchronous (the four sensor siblings, network, tilt, …) has no async continuation to compare against and needs no generation (precedents recorded in timing contract §8.2 / §9.4 / §10.3). The grounds for the exemption — that every path is synchronous — MUST be recorded in the timing contract

### 4.2 operation generation

- A lane whose exclusivity mode is `latest` (§5) **bumps on every operation start**, invalidating the continuations of the superseded older operation
- `overlap` / `exhaust` / `queue` lanes do not bump per operation (that is what the mode means). They only capture the generation; only dispose (and an explicit cancel) invalidates
- One counter MAY serve as both world and operation generation (fetch's `_gen` bumps on operation start *and* on dispose, covering both). But "does this lane bump per operation?" is an explicit design decision per lane, and the reason MUST be written in a field comment (share's "capture-only, bumped on dispose alone" and credential's "per-call bump" comments are the precedents)
- **A boolean flag MUST NOT be used instead** — dispose→observe flips it false→true again and old continuations slip through (guidelines §3.4)

### 4.3 Lanes

- A lane is an independent unit of exclusivity. **Generations and cancellations MUST NOT interfere across lanes** — starting or cancelling an operation in one lane must not invalidate what is in flight in another
- Examples: geolocation has three lanes (one-shot acquisition `_acqGen`, watch `_watchGen`, permission `_permGen`); clipboard has two (async op `_acqGen`, permission `_permGen`)
- Several commands MAY share one lane (credential's `get()`/`store()` share a single `_gen` and supersede each other). Where they do, the design document MUST state that supersession happens between those commands
- **A permission probe is a standard lane.** A node that monitors permission SHOULD isolate it as its own `_permGen` lane (precedents: geolocation / clipboard / listen / permission)

---

## 5. The vocabulary of exclusivity modes

Each lane MUST declare one of the following.

| Mode | Meaning | What happens to the older in-flight work | Precedents |
|---|---|---|---|
| **`latest`** | a new start supersedes the running execution (switchMap style) | aborted where possible (§6.2) and its result discarded by the generation bump | fetch, upload, camera(acquire), credential, eyedropper, idle(start), fullscreen, screen-orientation(lock), recorder(start) |
| **`queue`** | queued and run in order; an explicit cancel clears everything | kept alive (waits for its predecessor) | speak |
| **`exhaust`** | while running or establishing, a new start is an idempotent no-op | kept alive | timer/raf start (idempotent while running), sse (same url), broadcast (same name), worker (same src), wakelock (`_acquiring` flag), geolocation watch (idempotent while watching) |
| **`overlap`** | several in-flight operations are allowed but **not tracked individually**; each completion overwrites the observation surface in arrival order (last arrival wins). The generation is capture-only (invalidated by dispose alone) | kept alive (nothing is superseded) | share / contacts (in practice serialized by the OS modal), clipboard read/write, geolocation getCurrentPosition |
| **`parallel`** | several in-flight operations **tracked individually** | — | **reserved word; no precedent, out of scope** (the (a)/(b)/(c) choice in [multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja) comes first) |

- When in doubt: one-shot defaults to `latest`, a stream's establishment command to `exhaust` (SHOULD — these are the modes of the existing majority, and they close off the "an old request's result overwrites a newer one" problem by default)
- Choose `overlap` only where superseding carries no meaning (SHOULD): a modal operation the platform serializes (share), or an operation that completes quickly from a single supplier (clipboard). **The design document MUST state that last-arrival-wins overwriting can occur**
- `exhaust`'s "ignore" has to mean **idempotent** (converging on the same desired state), not silently dropped. Restarting with changed settings is done through `dispose()`→`observe()` or an explicit restart command (guidelines §3.5)
- websocket's `connect()` is classified as `latest` for the connection lane (a new connect closes and replaces the old connection). "Stream, therefore exhaust" is not the rule — declaring **per lane** is the discipline here

---

## 6. Cancellation

1. **The first-class means is bumping the generation (MUST).** Even where the native API offers no way to abort (geolocation's one-shot, Clipboard, Permissions, Web Share, …), generation comparison always guarantees that "a discarded execution writes nothing to the observation surface". That is what "cancellation" means in this model (it does not guarantee that the work itself stops)
2. Where a native means of aborting exists, it SHOULD be **used alongside** in order to release resources: `AbortController` (fetch / idle / eyedropper — all cases where the platform API takes a `signal`), `XMLHttpRequest.abort()` (upload), `close()` (websocket/sse/broadcast), `terminate()` (worker), `clearWatch()` (geolocation watch), `cancelAnimationFrame()` (raf — best-effort; correctness rests on the generation)
3. Where an `AbortController` is used, **the node owns it**. Taking an `AbortSignal` as an input is not required. Cleanup is done with an identity check ("null it out only while it is the one I currently hold"), so that a fast abort→restart does not let an old `finally` clear the new execution's controller (MUST — FetchCore / EyedropperCore / IdleCore cross-reference each other on this)
4. **A user-initiated dismissal (of a picker or modal) is a cancellation, not a failure** → it goes to the `cancelled` axis (§9.3)
5. `dispose()` = cancel every lane plus release resources. Anything deliberately left behind (notification does not close already-displayed notifications) has its reason recorded in a comment (guidelines §3.5)

---

## 7. Timeouts

- A timeout is **"a cancellation whose reason is running out of time"**. It MUST be implemented on the same path as cancellation (bump the generation, plus the native abort where one exists). Do not build a third, separate stop path
- Observation surface: an `error` envelope with `name: "TimeoutError"` (matching DOMException vocabulary) (MUST). **`cancelled` MUST NOT be raised** (it is not an intentional user dismissal)
- An API with a native timeout input SHOULD delegate to it rather than layering a second timer (geolocation passes `GeoOptions.timeout` straight through)
- A new one-shot node that **can pend indefinitely** (waiting on an external settle that is neither network nor user interaction) SHOULD consider offering a `timeout` input. Adding one to an existing node is optional (it can be introduced additively, defaulting to "no timeout" so current behavior is unchanged)
- Note: defined's `timeout` is the feature that resolves pending → missing, which is **a different concept** from the request timeout here (they merely share a name; it is not a deviation)

---

## 8. Retry and reconnection policy

A node with automatic retry (reconnect / restart / re-acquire / auto-restart) MUST describe the policy in its design document in terms of these four elements.

| Element | Meaning | Norm |
|---|---|---|
| `max` | the budget of retry attempts | **MUST be finite.** Unbounded retry is forbidden |
| `interval` | how long to wait before retrying | The default is a fixed interval (every node that has retry today uses a fixed one). Exponential backoff MAY be added additively as an opt-in input; when it is, the default stays fixed (protecting existing behavior) |
| `resetOn` | which "forward progress" signal restores the budget | SHOULD reset on a successful establishment (open) or on receiving a result (websocket resets on open; listen resets on receiving a result). A cumulative cap with no reset condition (worker) is also acceptable, but has to be stated |
| `excludeWhen` | conditions under which retry is forbidden | It MUST NOT retry after an **intentional stop** (close/stop/dispose, WebSocket close code 1000) or a **permanent error** (permission denied / `NotAllowedError` / not-allowed) |

Additional norms:

- **Distinguish transient from permanent errors** (SHOULD — camera's `NotReadableError` (transient: keep desired) versus `NotAllowedError` (permanent: drop desired))
- Automatic re-acquisition in a hold node happens only while desired is set. On a permanent refusal it MUST drop desired (§3.3)
- Where the platform has reconnection built in, delegate rather than duplicating it (SHOULD — sse delegates to EventSource's native reconnection and uses `readyState` to tell reconnecting from permanently CLOSED)
- The safe default for retry is **off** (SHOULD — listen's `maxRestarts=0` default; in some domains, such as an echo loop, retrying is itself harmful)
- A retry timer's continuation is subject to generation comparison too (MUST, §4.1)

---

## 9. The error envelope and the cancelled axis

### 9.1 never-throw (restated)

As in guidelines §3.6: public methods do not throw, and where they return a Promise it never rejects (every path resolves). This document takes that as given and defines **what shape** a failure is observed in.

### 9.2 The envelope

- The `error` property (and event detail) MUST at minimum expose a readable **`message: string`**. Carrying `name: string` too is desirable (SHOULD). The default shape for a new node is the existing `Wcs<Name>ErrorDetail { name, message }` family
- Domain-specific fields MAY be added (fetch's and upload's `{ status, statusText, body }` is ratified as an HTTP dialect)
- Existing nodes that pass a raw platform Error / Event straight through (share, websocket, fullscreen, …) are ratified. New nodes SHOULD normalize into the envelope — absorbing the variance in platform exception shapes is the node's job
- `unsupported` is **a state**, not an error (either the four-value permission surface or a dedicated flag) (guidelines §3.6)
- **Declare clear-versus-sticky (MUST)**: whether a successful settle clears `error` (geolocation clears on a successful fix) or it stays sticky until the next explicit start (the four sensor siblings do not clear on a successful reading) — both are acceptable, but each node declares which and records it in the timing contract. Leaving it undeclared is not acceptable
- How error equality is compared for the same-value guard is chosen from the table in §10

### 9.3 The cancelled axis

- **A user-initiated dismissal (of a picker, modal, or dialog) MUST NOT flow into `error`; it is observed as an independent boolean `cancelled`** — normalizing the precedents of share / contacts (`AbortError` → cancelled) and credential (`NotAllowedError` dismissal → cancelled)
- The exception name for a dismissal differs per platform (share raises `AbortError`, credential `NotAllowedError`). **Absorbing that variance and normalizing to `cancelled` is the node's job** (MUST). Where it cannot be told apart, fall back to the error side
- `cancelled` is cleared on the next start (the same reset discipline as loading)

---

## 10. Deduplication decision table

"The same command arrives twice", "the same value flows repeatedly" — handle each subject by choosing from the following.

| Subject | Means | Norm | Precedents |
|---|---|---|---|
| state properties (loading / permission / connected, …) | same-value guard (`===` reference comparison by default) | **MUST** (guidelines §3.3) | all nodes |
| event-natured values (message / tick / result / position fix / copied, …) | no guard (the same value twice is *two occurrences*) | **MUST NOT** guard (same doc) | all nodes |
| an error that is a fresh object on every settle | content comparison (`name` plus `message`, and the kind of value where needed) | MAY | wakelock (a fresh Error on every denial), sensor (a composite name+message key) |
| a list snapshot (voices / devices / an aggregate) | content comparison or a JSON snapshot key | SHOULD | speak `_voicesEqual` / camera `_devicesEqual` / defined `_publishedKey` |
| double delivery over two transports (the same event arriving by two routes) | dedupe by id, **with a FIFO-capped memory** (never grow unbounded) | the cap is **MUST** where this is used | notification `_seenIds` (double transport over BroadcastChannel and SW message, FIFO cap 50) |
| breaking a feedback loop in a two-way binding | an `Object.is` guard in the public setter | SHOULD | storage `set value` |
| collapsing input triggers (a run of changes into one execution) | microtask coalescing (`scheduled`, §3.1) | MAY; recording it in the timing contract is **MUST** | fetch auto-fetch (timing contract §1.2) |

---

## 11. Execution identity (operationId / requestId)

- Including correlation metadata (an id, a tag, …) in the event detail is MAY (notification's tag assignment `data.__wcsId` is the precedent)
- **No dynamic observable keyed by operationId (a surface like `loading.<id>`) is defined.** wc-bindable has no such vocabulary ([multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja) §4) and this document does not change the protocol
- A use case that needs request/response correlation picks one of: (1) collect them (aggregate into one observable and re-dispatch wholesale), or (2) correlate in userland (the node stays a thin bus — worker explicitly takes this route) (same doc §5 (a)(b)). Protocol extension (c) is outside this document

---

## 12. Inventory of existing nodes (informative, as of 2026-07-11)

This table **ratifies**; it is not normative. It describes the existing implementations in the vocabulary of this document. Deviations and notes are recorded after it.

| Package | Form | Lanes (generations) | Exclusivity | Means of cancellation | Retry | Timeout |
|---|---|---|---|---|---|---|
| fetch | one-shot | 1 (per-op bump) | latest | AbortController + generation | — | — |
| upload | one-shot | 1 (per-op bump) | latest | XHR.abort() + generation | — | — |
| websocket | stream | 2 (`_gen` + `_socketGen`) | connect=latest | close(), intent flag | fixed interval, cap, code 1000 excluded, reset on open | — |
| sse | stream | 2 (`_gen` + `_connGen`) | exhaust (same url) | close() | delegated to EventSource | — |
| broadcast | stream | 1 (open + dispose) | exhaust (same name) | close() | — | — |
| worker | stream | 1 | exhaust (same src) | terminate() | restartOnError, fixed interval, cumulative cap | — |
| timer | stream | 2 (`_gen` + `_runGen`) | exhaust (idempotent while running) | stop() | — | — |
| raf | stream | 1 (arming counter) | exhaust (idempotent while running) | stop() + cancelAnimationFrame (best-effort) | — | — |
| geolocation | one-shot + stream + monitor | 3 (`_acqGen`/`_watchGen`/`_permGen`) | acquisition=overlap (capture-only), watch=exhaust | clearWatch(), generation | — | native `timeout` passed through |
| clipboard | one-shot + monitor | 2 (`_acqGen`/`_permGen`) | overlap (capture-only, shared `_runOp`) | generation only (the API has no abort) | — | — |
| storage | synchronous one-shot + sync monitor | 1 (for the listener) | — (synchronous) | stopSync() | — | — |
| speak | queue | 1 (bumped on cancel and dispose) | queue | cancel() (clears all) | — | — |
| listen | stream (session) | permission lane + `_active` intent flag | exhaust (idempotent while active) | stop()/abort() | auto-restart (off by default, budget, reset on result, terminal errors excluded) | — |
| notification | one-shot + fire + monitor | 1 (observe + dispose) | overlap (tracked individually by tag) | close(tag)/closeAll() | only the show backend's TypeError fallback | — |
| wakelock | hold | 1 + `_acquiring` flag | exhaust (idempotent while acquiring) | release(), generation | visibility re-acquisition + lease renewal + coalesced retry (stops on denial) | — |
| camera | hold | 1 (bumped on acquire) | latest (switchMap; an orphan stream is stopped and discarded) | generation (orphan stopped) | visibility resume, transient/permanent distinction | — |
| recorder | session | 1 (bumped on start) | latest (start is idempotent while recording) | stop() | — | — |
| permission | monitor | 1 (`_permGen`) | — (query captures) | generation | — | — |
| defined | monitor (monotonically terminal) | 1 | — (monotonic) | generation + timeout clear | — | note: `timeout` resolves pending→missing (§7) |
| share | one-shot | 1 (**bumped on dispose only**) | overlap (the OS modal serializes) | none (dismissal→cancelled) | — | — |
| contacts | one-shot | 1 (bumped on dispose only) | overlap (same) | dismissal→cancelled | — | — |
| credential | one-shot | 1 (**per-call bump, shared by get/store**) | latest (supersedes across commands) | dismissal (`NotAllowedError`)→cancelled | — | — |
| eyedropper | one-shot | 1 (per-op bump) | latest | AbortController + generation | — | — |
| idle | one-shot establishment + monitor | 1 (bumped on start/stop/dispose) | latest (start supersedes) | AbortController + generation | — | — |
| fullscreen | one-shot + monitor | 1 (per-op bump) | latest | generation | — | — |
| screen-orientation | monitor + one-shot(lock) | lock lane (last wins) | lock=latest | generation invalidated by unlock()/dispose() | — | — |
| the four sensor siblings / network / tilt | monitor / stream | **none (exempt: every path is synchronous**, §4.1) | — | stop() | — | — |

**Recorded deviations and notes**:

- listen is controlled by an `_active` intent flag plus a restart budget rather than an operation generation. Ratified as intent management for a stream session (the async continuations that need a generation exist only on the permission lane)
- fetch's and upload's HTTP error envelope `{ status, statusText, body }` is ratified as the dialect of §9.2
- websocket / share / fullscreen putting a raw Error / Event into `error` is ratified under §9.2 (new nodes normalize into the envelope)
- All four nodes with retry (websocket / worker / listen / wakelock) use a fixed interval; there is still no adopter of exponential backoff (per §8's `interval` norm, introducing it would be opt-in)
- timer / raf / permission / the sensor family have no error surface at all (they have no persistent failure mode). §9 applies only to nodes that do

---

## 13. Addendum to the review convergence checklist

In addition to guidelines §10, a node with async execution does not merge until the following hold.

- [ ] The execution form (§2) and lane layout (§4.3) are declared in the tag-design doc
- [ ] Each lane's exclusivity mode (§5) is declared. For `latest`, it bumps per operation; otherwise the reason for capture-only is written in a field comment
- [ ] `dispose()` invalidates the generation of **every lane** (with a test)
- [ ] Cancellation rests on the generation, with a native abort as a best-effort companion (§6). Where an AbortController is used, cleanup goes through an identity check
- [ ] Where automatic retry exists, it is described with §8's four elements (max/interval/resetOn/excludeWhen) and is finite, excludes intentional stops, and excludes permanent errors (with tests)
- [ ] Where a `timeout` exists, its result is an error with `name: "TimeoutError"` and it does not raise `cancelled` (§7)
- [ ] The error envelope exposes `message` (plus `name`) (§9.2). Clear-on-success versus sticky is declared and recorded in the timing contract
- [ ] A user-initiated dismissal is normalized onto the `cancelled` axis (§9.3)
- [ ] Deduplication is chosen from §10's table, and where id dedupe is used it has a FIFO cap

---

## 14. Open questions

- **Exposing a `status` enum as an observable** (§3.5): if exposed, it has to be additive and aligned with the reflection rules in [custom-state-reflection-design.md](./custom-state-reflection-design.md). For now it is neither required nor forbidden
- **Actually adopting exponential backoff**: every node with retry today uses a fixed interval. If adopted, it would be an opt-in input (default fixed); which node goes first is undecided
- **The `parallel` exclusivity mode**: the strategy choice in [multi-promise-io-node-design.md](./multi-promise-io-node-design.md) (ja) (collect / correlate in userland / extend the protocol) comes first. This document reserves the word only
- **Sharing execution-primitive code**: this document shares norms, not implementation. Sharing a helper that bundles generations, timers, and retry (an `OperationLane` equivalent) would presuppose the copy-distribution approach that introduces no runtime dependency (the same as `wcBindable.ts`). Whether to do it is undecided
