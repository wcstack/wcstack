# The wc-bindable observable inventory

- **Written**: 2026-08-01
- **Status**: Phase 0 complete (the classification snapshot); the declaration additions of Phase 2 are done too (§6.1). Runtime behavior is unchanged
- **Baseline commit**: wcstack `6eea3a5b52ef032d2ed6f2d7824bb45e6c000935`
- **Parent design**: [React immutable snapshots and the wc-bindable I/O boundary](11-react-immutable-snapshot-boundary.md) (ja)
- **External spec snapshot**: `@wc-bindable/core@0.8.0`. The adapter implementations consulted are noted in §5.6
- **日本語版**: [12-wc-bindable-observable-inventory.ja.md](12-wc-bindable-observable-inventory.ja.md)

## 1. Purpose and scope

The observables that sit uniformly in `static wcBindable.properties` are classified into the following meanings, so
that an adapter can handle them without inferring from the value's type or the property name.

- **state** — a current value. An initial property read is meaningful, and the producer-side meaning holds until the next notification.
- **event** — an occurrence. Multiple occurrences have to be distinguished even with an identical payload.
- **handle** — a live / opaque resource. It has external state and a producer-specific lifecycle.

This inventory is a classification of meaning; it does not guarantee deep immutability of a payload. Even for an
object or array classified as `state`, what the current protocol guarantees is the property read and event delivery —
not a deep clone or deep freeze.

The motivation for classifying comes from the parent design's React immutable snapshots, but the result is
adapter-neutral. `@wc-bindable` publishes 18 framework / reactive-store adapters besides core and remote, each of
which maps the same `properties` array into a different receptacle (React local state, Vue `reactive`, TC39
`Signal.State`, RxJS `BehaviorSubject`, Qwik `useStore`, …). As §5.6 shows, without this classification, mistaking
state for event or handle breaks things in several adapters at once, each in its own way — not only in React.

What was surveyed:

1. The 41 built-in tags recorded in `packages/vscode-wcs/src/service/generated/builtinTags.generated.ts`.
2. `wcs-route`, `wcs-router`, and `RenderCore`, which have static declarations outside that catalog.
3. The DCC declarations `@wcstack/state` generates at runtime from `$bindables` (outside the fixed counts).

The generated catalog also includes `wcs-fetch-header`, `wcs-fetch-body`, and `wcs-infinite-scroll`, which have no
observables. There are 41 surfaces with fixed observables, and 231 properties in total.

## 2. How the classification was judged

- Even where a getter returns the latest value, `event` took precedence if the implementation explicitly guarantees repeated notification of an identical payload.
- `error` / `errorInfo` are `state`, since the current or last failure is readable from the getter. Whether an event surface for the occurrence of a failure itself is needed later is a separate question.
- Input echoes such as the Shell's `trigger` / `send` are `state`, since they hold a current value.
- `objectURL` is a string and therefore `state`, but the resource-lifetime risk is noted separately since the producer revokes the backing resource.
- Even a platform object is `state` unless it is a live capability the producer itself stops or swaps. Serializability and remote transport support are a separate axis.

The result is 210 `state`, 20 `event`, 1 `handle` — 231 in total.

> **Addendum (2026-08-03, when @wcstack/audio was added)**: the new `@wcstack/audio` has 11 tags and adds **not one** `handle`. While holding a live graph of `AudioNode`s internally, it exposes only `state` (context status, voice count, warnings, error) and `event` (noteOn / noteOff / analyser frame); Core owns and destroys the handles. It is the same shape as worker / websocket / broadcast, and introduces none of the per-adapter failure modes of §5.6 (signals' same-value dedupe, resource retention through RxJS replay, Qwik serialization). The reasoning is [ADR-14](14-handle-graph-wiring.md) G2.
This is not a decision to adopt the Phase 2 metadata schema; its placement, fallback, and public API are settled at the subsequent decision gates.

## 3. The classification of every surface

| package / surface | state | event | handle | Main caveats |
| --- | --- | --- | --- | --- |
| accelerometer / `wcs-accelerometer` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | a primitive sensor snapshot. |
| ambient-light-sensor / `wcs-ambient-light-sensor` | `illuminance`, `error`, `errorInfo` | — | — | a primitive sensor snapshot. |
| broadcast / `wcs-broadcast` | `error`, `errorInfo` | `message` | — | `message` dispatches every time, identical payload or not. The `BroadcastChannel` itself is not exposed. |
| camera / `wcs-camera` | `active`, `permission`, `audioPermission`, `deviceId`, `devices`, `error`, `errorInfo` | `ended` | `streamReady` | `streamReady` is a live `MediaStream`. Indistinguishable from an ordinary property in the current declaration. |
| camera / `wcs-recorder` | `recording`, `paused`, `duration`, `mimeType`, `blob`, `objectURL`, `error`, `errorInfo` | `recorded`, `dataavailable` | — | the `Blob` is a settled value. `objectURL` is revoked on the next record or on dispose. |
| clipboard / `wcs-clipboard` | `loading`, `error`, `readPermission`, `writePermission`, `monitoring`, `errorInfo` | `text`, `items`, `copied`, `cut`, `pasted` | — | `text` / `items` also have a latest-value getter, but re-reading the same content counts as a separate occurrence — a compatibility hotspot. |
| contacts / `wcs-contacts` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` is the retrieved contact data. |
| credential / `wcs-credential` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` is an opaque `Credential`. It can be held in a snapshot but is not necessarily serializable. |
| debounce / `wcs-debounce` | `value`, `pending` | `fired` | — | `fired` is a coalesced signal occurrence. |
| debounce / `wcs-throttle` | `value`, `pending` | `fired` | — | the same meanings as debounce, differing only in the event prefix. |
| defined / `wcs-defined` | `defined`, `pending`, `missing`, `count`, `total`, `error` | — | — | the array getters return copies; the event detail is a fresh snapshot. |
| eyedropper / `wcs-eyedropper` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` is the selected color string. |
| fetch / `wcs-fetch` | `value`, `loading`, `error`, `status`, `objectURL`, `errorInfo`, `trigger` | — | — | `value` passes an arbitrary payload by reference. `objectURL` is revoked on the next response or on dispose. |
| fullscreen / `wcs-fullscreen` | `active`, `error`, `errorInfo` | — | — | the live fullscreen element itself is not exposed. |
| geolocation / `wcs-geo` | `position`, `latitude`, `longitude`, `accuracy`, `coords`, `timestamp`, `watching`, `loading`, `error`, `permission`, `errorInfo`, `trigger` | — | — | the browser objects are normalized into plain snapshots. |
| gyroscope / `wcs-gyroscope` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | a primitive sensor snapshot. |
| idle / `wcs-idle` | `userState`, `screenState`, `active`, `error`, `errorInfo` | — | — | the current idle state. |
| intersection / `wcs-intersect` | `entry`, `intersecting`, `ratio`, `visible`, `observing`, `trigger` | — | — | `IntersectionObserverEntry` is normalized into a plain snapshot. |
| magnetometer / `wcs-magnetometer` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | a primitive sensor snapshot. |
| network / `wcs-network` | `effectiveType`, `downlink`, `rtt`, `saveData`, `supported` | — | — | the current connection snapshot. |
| notification / `wcs-notify` | `permission`, `granted`, `denied`, `prompt`, `unsupported`, `error`, `errorInfo` | `clicked`, `closed`, `shown` | — | notification lifecycle edges MUST NOT be same-value deduped. |
| permission / `wcs-permission` | `state`, `granted`, `denied`, `prompt`, `unsupported` | — | — | the current permission state. |
| picture-in-picture / `wcs-pip` | `active`, `error`, `errorInfo` | — | — | the PiP window handle itself is not exposed. |
| pointer-lock / `wcs-pointer-lock` | `active`, `error`, `errorInfo` | — | — | the locked element itself is not exposed. |
| raf / `wcs-raf` | `tick`, `elapsed`, `dt`, `running`, `suspended`, `trigger` | — | — | the current counter / timing snapshot per frame. |
| resize / `wcs-resize` | `entry`, `width`, `height`, `observing`, `trigger` | — | — | `ResizeObserverEntry` is normalized into a plain snapshot. |
| screen-orientation / `wcs-screen-orientation` | `type`, `angle`, `portrait`, `landscape`, `error`, `errorInfo` | — | — | the current orientation snapshot. |
| share / `wcs-share` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` is the last completed result. |
| speech / `wcs-speak` | `voices`, `speaking`, `paused`, `pending`, `error`, `errorInfo`, `unsupported` | `charIndex`, `spokenWord` | — | the boundary pair carries meaning in its order of occurrence. voices are normalized into plain `SpeechVoiceInfo`. |
| speech / `wcs-listen` | `interimTranscript`, `finalTranscript`, `listening`, `permission`, `error`, `errorInfo`, `unsupported`, `trigger` | `result` | — | `result` is a recognition occurrence, dispatched every time with no guard. |
| sse / `wcs-sse` | `connected`, `loading`, `error`, `errorInfo`, `readyState`, `trigger` | `message` | — | `message` is a separate occurrence even for an identical payload. The `EventSource` itself is not exposed. |
| storage / `wcs-storage` | `value`, `loading`, `error`, `errorInfo`, `trigger` | — | — | an object value is held by reference. The producer does not modify it after publication, but the ownership contract is not yet normative. |
| tilt / `wcs-tilt` | `alpha`, `beta`, `gamma`, `absolute`, `permissionState`, `error`, `errorInfo` | — | — | a primitive orientation snapshot. |
| timer / `wcs-timer` | `tick`, `elapsed`, `running`, `trigger` | — | — | the current counter / elapsed snapshot. |
| upload / `wcs-upload` | `value`, `loading`, `progress`, `error`, `status`, `errorInfo`, `trigger`, `files` | — | — | `value` is an arbitrary response; `files` is an array of opaque `File`s. |
| wakelock / `wcs-wakelock` | `held`, `error`, `errorInfo` | — | — | the `WakeLockSentinel` itself is not exposed. |
| websocket / `wcs-ws` | `connected`, `loading`, `error`, `errorInfo`, `readyState`, `trigger`, `send` | `message` | — | `message` is a separate occurrence even for an identical payload. The `WebSocket` itself is not exposed. |
| worker / `wcs-worker` | `error`, `errorInfo`, `running` | `message` | — | `message` is a separate occurrence even for an identical payload. The `Worker` itself is not exposed. |
| router / `wcs-route` | `params`, `typedParams`, `active` | — | — | a fresh params object is assigned on each match. |
| router / `wcs-router` | `navigateUrl`, `path` | — | — | the current navigation state. |
| server / `RenderCore` | `html`, `loading`, `error` | — | — | a headless server surface. Not a custom element tag. |

### Dynamic DCC

`packages/state/src/dcc/wcBindable.ts` dynamically generates a property and a `${tagName}:${propName}-changed` event
from each member of `$bindables`. They are not included in the fixed property count. A DCC member is a current value
with a getter and setter, so the default classification is `state`. Where a DCC comes to expose an event or handle in
future, an explicit declaration separate from `$bindables` will be needed.

## 4. Implementation audit of the eight priority areas

| Area | Post-publication mutation / stale commit | Resource ownership | Work from Phase 1 onward |
| --- | --- | --- | --- |
| camera | `devices` is reassigned as a fresh array. Stream acquisition carries a generation guard. | `CameraCore` owns the `MediaStream` and stops / disposes it. | a declaration that lets `streamReady` be identified mechanically as a `handle`. |
| recorder | the `Blob` and event detail are new on each completion. The chunk buffer is not exposed. | `RecorderCore` revokes the managed URL before the next recording and on dispose. | decide how long a past snapshot's URL stays valid. |
| fetch | the response is a guarded terminal commit. An arbitrary `value` is held by reference but the producer does not modify it afterwards. | `FetchCore` revokes the managed URL before the next response and on dispose. | make the ownership transfer of an arbitrary payload and the URL lifetime normative. |
| worker | a generation guard suppresses stale messages and restart timers. A message is the result of the platform's structured clone. | `WorkerCore` terminates the internal `Worker`. The handle is not exposed. | declare `message` as an `event`. |
| websocket | generation and connection ownership suppress stale socket callbacks. A message is an occurrence. | `WebSocketCore` closes the internal socket. The handle is not exposed. | declare `message` as an `event`. |
| broadcast | a generation guard suppresses messages after close. A message is the result of the platform's structured clone. | `BroadcastCore` closes the internal channel. The handle is not exposed. | declare `message` as an `event`. |
| clipboard | a read result is a fresh detail every time. The permission query and read/write carry generation guards. | Core disposes the permission listener and the DOM monitor listener. | separate the current-value use of `text` / `items` from the occurrence use. |
| credential | the `latest` operation lane suppresses stale completions. The producer does not modify the `Credential` reference. | no live resource is exposed. | state the adapter and remote policy for opaque / non-serializable state. |

In the priority areas, no implementation was found where the producer itself in-place mutates a published state object
or array. But for arbitrary payloads such as a fetch response, a storage value, or an upload response, the ownership
discipline including the consumer that received the reference is still not written into the protocol.

## 5. Compatibility hotspots found in Phase 0

### 5.1 The absence of metadata (resolved in Phase 2)

> **Update (2026-08-01)**: this hotspot was resolved in Phase 2. `semantics?: "state" | "event" | "handle"` was added
> to `IWcBindableProperty`, and the 20 events plus 1 handle below are annotated. The text below is kept as it stood
> when the decision was made.

At inventory time, `IWcBindableProperty` had only `name`, `event`, and an optional `getter`. A general adapter cannot
tell the 20 events and 1 handle apart from state. What is needed is additive metadata or a sidecar — not type
sniffing or a property-name allowlist.

This is not a nice-to-have: published adapters are already breaking in different ways. `@wc-bindable/signals` calls
`Signal.State.prototype.set` directly, so its default `Object.is` equality **loses occurrences with an equal value**.
`@wc-bindable/rxjs` holds a `BehaviorSubject` per property, so it **replays past occurrences** to a late subscriber
and retains the last value indefinitely. The former is a loss from treating an event as state; the latter is a
misfire in the opposite direction. Neither comes from the adapters' implementation quality but from the absence of
classification information. The 20 properties classified as `event` in §3 are exactly the scope of impact.

### 5.2 `streamReady`'s declaration disagrees with its description

camera describes the stream as "a direct channel, not a reactive value", while placing `streamReady` in the ordinary
`properties` array. To a current observer it is the same subscription surface as state, which makes it the first
candidate for a metadata PoC.

### 5.3 The current-value compatibility of events

Most properties classified as events also keep the last payload in a getter. clipboard's `text` / `items` in
particular have one property serving both the current-value use as React values and the occurrence use that must not
lose a re-read of the same content. Where an adapter comes to exclude events from values, it has to add a callback or
stream surface first and then migrate in stages.

The split between current-value use and occurrence use runs in opposite directions per adapter. A value-based store
(signals, VanJS) drops equal values, which breaks the occurrence use; a replay-based store (RxJS `BehaviorSubject`),
having leaned toward current-value use, re-delivers past occurrences. React's local-state transcription satisfies
both as long as the payload is a fresh object each time, so looking only at React never surfaces this hotspot.

### 5.4 Managed URLs

`objectURL` on fetch / recorder is a primitive string, yet the old URL loses its meaning at the next commit. Snapshot
identity alone does not solve it. It has to be decided per node whether to take consumer ownership of the Blob,
retain / release, or a best-effort current value.

In some adapters this shows up not as staleness but as a leak. `@wc-bindable/rxjs`'s `BehaviorSubject` retains the
last value whether or not anyone is subscribed, so it holds on to a URL string the producer has already revoked, and
to the `Blob` instance the `blob` property references, until unbind. It is the most observable instance of the
resource-lifetime problem the parent design's §1.3 described as "undetectable and unfixable through object identity
alone".

### 5.5 Opaque state

`Credential`, `File`, an arbitrary fetch / upload response and the like can be held as state but are not necessarily
serializable. They can flow into React local state, but SSR, DevTools, and remote adapters need a projection or a
capability failure.

In an adapter that presupposes resumability this becomes an immediate failure. `@wc-bindable/qwik` writes every
property into `useStore`, but Qwik requires its state to be serializable. Putting a non-serializable value there
makes serialization fail, and declaring it with `noSerialize()` makes it `undefined` after resume.
`streamReady` (a handle), `error` (a platform `Error`), `blob`, and `value` (a `Credential` / `File` / an arbitrary
response) all qualify. The existing policy of providing a serializable projection such as `errorInfo` pays off most on
this route, not in React.

### 5.6 Per-adapter failure modes

The table below summarizes which receptacle each adapter maps the same `properties` array into, and what breaks in the
absence of classification. `@wc-bindable/react` and `@wc-bindable/vue` are the npm 0.8.0 artifacts; the rest come from
reading the implementations on upstream `main`, whose versions may have drifted from the commit the parent design
pinned.

| Adapter | Receptacle | Failure without classification |
| --- | --- | --- |
| react | transcribed into `useState` through a callback; a new outer object per update | where the payload is fresh every time, state and event coincidentally coexist. A consumer comparing an equal payload in deps loses events |
| vue | one `reactive({...})` is created and properties are assigned into it | the outer identity problem cannot arise structurally. A plain object / array is proxied on read, so its identity changes (platform objects are unaffected) |
| signals | a `Signal.State` per property | `set()`'s default `Object.is` equality loses equal-value occurrences |
| rxjs | a `BehaviorSubject` per property | replays past occurrences to a late subscriber. Retains the last value indefinitely and holds on to handles / managed URLs |
| qwik | `useStore` | the serializability requirement makes handles / opaque state `undefined` after resume |
| angular | `{ name, value }` delivered through an `EventEmitter` | aggregation is on the consumer side. With no classification arriving, user code redoes the state-versus-event judgment every time |
| solid / preact / svelte, … | a new outer object, or a user-defined store | the same shape as React, or the receptacle becomes userland-dependent and the guarantees vanish |

While there is no metadata, no adapter can choose a default behavior. Once classification arrives, signals can drop
equality comparison for events, rxjs can choose a `Subject`, qwik can add `noSerialize()`, and vue can choose
`shallowRef` / `markRaw` — each entirely within the adapter's own implementation.

Note that where `event` / `handle` are taken out of values and moved to a separate surface, some frameworks cannot
substitute "the user listens to the element's events directly" for that surface. wcstack's event names contain a
colon, which an Angular template reads as `target:event` and cannot bind. So the parent design's decision gate 6
(adding a surface for event / handle) is not a React API design judgment but a requirement common to several
adapters. That constraint itself is a question of whether the bind takes rather than of value meaning, so it is
covered in [framework adapter binding constraints](13-framework-adapter-binding-constraints.md).

## 6. Phase 1 complete, and the next work

As Phase 1, the producer snapshot contract was added to
[the async I/O node authoring guidelines](../async-io-node-guidelines.md)
§3.3.1. No wholesale runtime change was made; the following became normative for new nodes and new observable
properties.

1. A producer does not in-place mutate a published state value.
2. Where the logical state changes, it assigns a fresh object / array before notifying.
3. An arbitrary payload does not force a clone; it is an ownership transfer the producer does not modify after publication.
4. Events and handles are distinguished from state-like properties.
5. A property read and an event payload represent the same logical state.

Alongside that, the input-side contract was added as §3.3.2 of the same guidelines. A norm about producers not
modifying their output cannot on its own close the route by which a value wrapped by the consumer's reactive store (a
Proxy from Vue `reactive`, Svelte `$state`, Qwik `useStore`, …) enters the producer through an input. No
framework-specific unwrapping is brought into Core; a failure at the structured clone boundary lands in `error` under
never-throw, and unwrapping is stated in the README as the user's responsibility.

## 6.1 Where Phase 2 landed (2026-08-01)

The placement was settled as **an additive optional field on the declaration**, per decision gate 1. A sidecar cannot
become a required input for runtime correctness, by the invariants of the
[`wcstack.manifest.json` schema](../wcstack-manifest-schema.md) (ja) itself, and so would not meet this document's
purpose of "an adapter choosing its receptacle at runtime".

What was done:

1. Added `semantics?: "state" | "event" | "handle"` and the `WcBindableSemantics` type to `IWcBindableProperty` in
   `/protocol/wc-bindable.ts` (the SSOT), and distributed them to the 38 generated copies through
   `scripts/sync-protocol-types.mjs` (CI's `--check` gate already exists).
2. Annotated the 21 properties (across 9 packages) classified as `event` / `handle` in §3:
   `message` on broadcast / sse / websocket / worker; camera's `ended` and `streamReady` (handle);
   recorder's `recorded` / `dataavailable`; clipboard's 5 properties; `fired` on debounce and throttle;
   notification's 3 properties; speech's `charIndex` / `spokenWord` / `result`.
3. Added `__tests__/wcBindableSemantics.test.ts` to each package, pinning the sets of `event` / `handle`.
4. Updated guidelines §3.3 and §3.3.1, making the `event` / `handle` declaration a MUST for new nodes.

`state` was left unannotated, per decision gate 2 (compatibility first). Unspecified means "unspecified", not `state`,
and a reader keeps the behavior it had when the field was absent. Runtime behavior and the protocol version are
unchanged.

### What remains

1. ~~Bypass `@wcstack/state`'s same-value guard for `semantics: "event"`~~ → done (§6.2).
2. Explicit annotation of all 231 properties including `state` (for DevTools / remote / SSR; no compatibility impact).
3. Pin the React adapter's current local-state transcription with a characterization test (the upstream repository).
4. Design the additional surface for event / handle and trial it without breaking the existing `[ref, values]` API (the upstream repository).
5. Decide managed URL lifetimes per node, separately from any adapter change.

## 6.2 The first consumer is `@wcstack/state` itself

The first thing that should consume Phase 2's annotations is not an external adapter but wcstack itself. Through
`config.sameValueGuard` (on by default), `@wcstack/state` **skips the set, the dependency propagation, and the DOM
application entirely when a primitive value is `Object.is`-equal** (`packages/state/src/proxy/methods/setByAddress.ts`).
Reference types pass through, so a JSON payload's `message` is a fresh object each time and unaffected — but
re-receiving the same string, an equal `charIndex`, and primitive occurrences such as `copied` / `fired` are currently
**lost**.

This is the same failure §5.1 pointed out for the signals adapter, and it can be reproduced, fixed, and regression-tested
entirely within wcstack.

**Done (2026-08-01)**. Since the guard lives on `setByAddress`'s general path, a one-shot token in
`packages/state/src/proxy/occurrenceWrite.ts` was placed as the route for conveying where a write came from.
`twowayHandler` brackets the commit of an occurrence property with `beginOccurrenceWrite()` / `endOccurrenceWrite()`,
and `setByAddress` calls `consumeOccurrenceWrite()` at the top and uses it in the guard decision on both the fast path
and the general path.

It is one-shot because setting a flag across the whole call stack of a write would also lose the guard for the
unrelated equal-value writes performed by a `$updatedCallback` or by dependency propagation running inside it. The
token is consumed at the first guard evaluation, so the effect is confined to the one intended write.

No config flag was added. `semantics` is a declaration introduced in this phase, and no existing declaration declared
`event`, so behavior changes only for newly declared properties — making it structurally opt-in.

## 7. Phase 0 completion criteria

- [x] Every surface with a fixed `static wcBindable.properties` is enumerated.
- [x] `state` / `event` / `handle` are classified per property.
- [x] camera, recorder, fetch, worker, websocket, broadcast, clipboard, and credential were checked down to the implementation.
- [x] Post-publication mutation, stale commits, and resource owners are recorded.
- [x] Runtime behavior and the protocol types are unchanged.

## References

- [React immutable snapshots and the wc-bindable I/O boundary](11-react-immutable-snapshot-boundary.md) (ja)
- [Framework adapter binding constraints](13-framework-adapter-binding-constraints.md)
- [The async I/O node authoring guidelines §3.3.1](../async-io-node-guidelines.md)
- [`@wc-bindable/signals`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/signals/src/index.ts)
- [`@wc-bindable/rxjs`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/rxjs/src/index.ts)
- [`@wc-bindable/qwik`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/qwik/src/index.ts)
- [Qwik — State (serialization and `noSerialize()`)](https://qwik.dev/docs/components/state/)
