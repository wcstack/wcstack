# The remediation design across the eight topics

- **Written**: 2026-07-14
- **Status**: an integrated design proposal (not adopted, not implemented)
- **Applies to**: `@wcstack/state`, the I/O Cores / Shells, DevTools, the VS Code extension, the wc-bindable adapters
- **Premise**: it does not replace [topics 1-8](README.md#the-topics) or the countermeasures already implemented; it integrates with them in stages
- **日本語版**: [09-remediation-design.ja.md](09-remediation-design.ja.md)

## 1. Conclusion

The centre of the remediation is not a huge new public protocol but the introduction of five small responsibilities.

| Responsibility | Role | Topics it mainly solves |
| --- | --- | --- |
| `BindableDeclarationReader` | validates and interprets a wc-bindable declaration in one place | 1, 6, 8 |
| `BindingSession` | owns definition, attach, initial sync, and teardown per binding | 1, 2, 3 |
| `PropagationContext` | tracks the cause, the edges traversed, and the write receipt of two-way propagation | 3, 5 |
| `OperationTicket` | manages the lane, generation, and commit rights of an async operation | 4, 5 |
| the sidecar manifest / application schema | exposes types, async policy, and platform capability to tooling | 4, 6, 7, 8 |

Their execution status goes to the existing DevTools hook as a side channel. Ordinary property values, event details, command arguments, and the initial-sync semantics of the wc-bindable core are unchanged.

The design splits into three planes.

| Plane | Composition | Invariant |
| --- | --- | --- |
| the data plane | `BindingSession`, `PropagationContext`, `OperationTicket` | the correctness of values and side effects never depends on a hook or a timeout |
| the contract plane | the wc-bindable declaration reader, the sidecar, capability probes | unknown optional information is ignored, and only the required capabilities are checked explicitly |
| the observation plane | the DevTools hook, validator diagnostics | it changes neither the order, the subscriber count, nor the payload of the data plane |

## 2. The first boundary to fix: `BindableDeclarationReader`

The state runtime currently checks `protocol === 'wc-bindable' && version === 1` separately on each path — two-way, event-token, spread, command, attribute mirror. Those are collected into a single reader. But the reader MUST NOT reinvent wc-bindable's discovery rules of its own accord.

```ts
interface ReadBindableResult {
  readonly target: WcBindableElement;
  readonly liveDeclaration: WcBindableDeclaration;
  knownProperties: ReadonlyMap<string, IWcBindableProperty>;
  declaredInputs: ReadonlyMap<string, IWcBindableInput>;
  declaredCommands: ReadonlyMap<string, IWcBindableCommand>;
}

function readBindableDeclaration(target: unknown): ReadBindableResult | null;
```

The runtime reader uses, as its validation gate, a conformance mirror generated or bundled into each published package from the canonical source in the repository. The mirror is kept matching a pinned upstream conformance vector and never diverges into a bespoke spec. The official `getWcBindableDeclaration(target)` is used as the reference implementation (the oracle) during development and in conformance tests, leaving no external runtime import in a published artifact. The current `protocol/wc-bindable.ts` is only the canonical source of the types, so a canonical implementation of the runtime reader plus generation and sync checking are added.

That guarantees the following.

1. The discovery path is exactly one — `target.constructor.wcBindable` — with no instance override or registry fallback added.
2. It checks that a consumer-side target has `addEventListener` / `removeEventListener`, and does not require `dispatchEvent`.
3. It accepts every integer `version` of 1 or above and ignores unknown optional fields.
4. It checks the schema and name duplication of the whole declaration, including `inputs` / `commands` and not just `properties`.
5. If a property access during discovery throws, it does not rethrow but treats the declaration as invalid.
6. The return value is the live declaration, and is never treated as a clone, frozen, or normalized snapshot.

`inputs` / `commands` are declarative interface metadata, and their mere presence never implies the `set` / `setWithAck` / `invoke` semantics of Extension 1. Ordinary assignment to a local Shell, and an explicitly Extension-1-capable remote / automation surface, branch through separate invocation resolvers.

Structured diagnostics are a development-time analyzer that never overrides the validation gate's result. What can be determined statically is the descriptor's shape, names, event strings, and getter types; "the event actually fires" and "the getter returns the right value" are the responsibility of the conformance tests. Since the analyzer may access executable metadata again, it runs only in an explicit development mode.

The shared type's `version: 1` is relaxed to `version: number`, with the runtime reader checking that it is an integer at or above the lower bound. A breaking binding contract is handled not by rejecting a higher version but with a different protocol identifier or an explicit extension.

`wcBindable` is not inert JSON but trusted executable metadata containing getter functions and property accesses at discovery time. Validation is not a sandbox; it sits within the same trust boundary as the component code that was loaded.

## 3. `BindingSession`: giving a binding an owner

### 3.1 What changes from today

Today the two-way listener, the event-token, the spread, and the initial apply each register their own `whenDefined()`. Under that scheme, the phase and the teardown owner of one binding are not settled in one place. And an initial event fired by `connectedCallback()` at upgrade can be lost before a listener is attached after the definition.

The public facade `initializeBindings()` is kept, and inside it a `BindingSession` is created per reactive root, plus a `BindingOwner` per Document / ShadowRoot / structural `Content`. The existing `scheduleDeferredApply`, the deferred spread, and each handler's own definition wait are collected into the session in stages.

### 3.2 The state machine

```text
discovered
  ├─ custom tag not defined ─> waiting-definition
  └─ defined ────────────────> ready-to-attach

waiting-definition ─> ready-to-attach ─> attaching ─> synchronizing ─> active
                                           ├─ init=none ────────────> active

any phase ── a contract error ─> failed
any non-terminal phase ── teardown ─> disposed
```

| Phase | What it does | The condition for leaving it |
| --- | --- | --- |
| `discovered` | provisionally records the path, the target node, and the explicit modifiers | the binding record is registered |
| `waiting-definition` | waits on the per-tag shared `whenDefined()` | definition, dispose, or a structural error |
| `ready-to-attach` | reads the declaration, settles the direction and initial authority, and joins the cohort of the same turn | the cohort's attach sweep begins |
| `attaching` | registers every producer → state listener in the cohort first | listener ownership is established for every record in the cohort |
| `synchronizing` | synchronizes either the snapshot or the state value once, per the authority | the initial sync completes |
| `active` | propagates subsequent events and state updates | teardown or a fatal contract error |
| `failed` | leaves a structured diagnostic and destroys the resources it owns | terminal |
| `disposed` | invalidates listeners, addresses, pending callbacks, and receipts | terminal |

The binding record does not change the public `IBindingInfo` and is held in a `WeakMap`.

```ts
type BindingPhase =
  | 'discovered' | 'waiting-definition' | 'ready-to-attach' | 'attaching'
  | 'synchronizing' | 'active' | 'failed' | 'disposed';

type InitialAuthority = 'state' | 'element' | 'auto' | 'none';
type ObservationPhase = 'not-applicable' | 'pending' | 'awaiting-connection' | 'synced';

interface BindingRecord {
  readonly id: number;
  readonly info: IBindingInfo;
  readonly generation: number;
  phase: BindingPhase;
  initialAuthority: InitialAuthority;
  syncOn: 'call' | 'connect';
  observationPhase: ObservationPhase;
  initialAttempt: number;
  eventSequence: number;
  readonly teardowns: Set<() => void>;
}
```

`phase` is the binding's ownership and `observationPhase` the completion state of the producer's initial observation; they are treated as a product. That expresses, for instance, an `active` binding whose listeners are running while it waits only on a `syncOn=connect` snapshot.

A `disposed` record is never reused. On reconnection or rediscovery, a record with a new, monotonically increasing `generation` is created. Every Promise continuation re-checks the generation it captured, the expected phase, `initialAttempt`, and `BindingOwner.isAlive(record)`. Exactly one matching continuation advances the phase. `isConnected` alone is not used as the liveness condition, since it would wrongly dispose a `DocumentFragment` before mount.

### 3.3 Waiting for the definition

The `DefinitionCoordinator` inside the session registers `whenDefined()` exactly once per (registry, tag) pair and manages the waiting records as a set. Records are removed from the set on dispose, so a tag that is never defined does not retain DOM nodes. It uses the global registry adapter today, and when a scoped custom-element registry arrives, only the coordinator's key and its `get` / `whenDefined` / `upgrade` calls need swapping.

When the definition completes, if a node the owner holds is still in a disconnected subtree, it calls the registry's `upgrade(node)` where available before reading the declaration and attaching listeners. Being connected and an instance being upgraded are never conflated. `initializeBindingsByFragment()` includes a transient owner handle in its internal result, which the created `Content` takes over. It is judged valid before mount and invalid after `Content.unmount()` or dispose.

`<wcs-defined>` continues to be what an application uses to observe the registration readiness, progress, and timeout of several tags. The correctness of the state runtime never depends on whether a `<wcs-defined>` is present in the DOM. The two use the same platform signal for different responsibilities.

- `<wcs-defined>`: aggregate readiness for the application.
- `DefinitionCoordinator`: individual activation inside the binding runtime.

`hidden` / `display:none` on `<wcs-defined>` hides only the display; it does not delay the connection of the observed nodes, their `connectedCallback()`, their bindings, or their I/O side effects. To gate the processing itself, make the execution condition of a command / effect depend on the `defined` state. The `DefinitionCoordinator` waits independently of `<wcs-defined>`'s timeout / missing, and activates the relevant binding even if the tag is defined later.

### 3.4 Attach-first and the initial snapshot

Rather than attaching and syncing defined records one at a time, records that became ready by the same microtask are processed as a cohort in two stages. The whole root is never made to wait for an undefined tag.

1. Check every record in the cohort with `readBindableDeclaration()`.
2. In the **attach sweep**, register every producer listener. A handler increments `eventSequence` synchronously and pushes the value extracted by the getter into a per-binding ordered inbox.
3. In the **producer sync sweep**, either deliver the initial property read into the inbox or arm the connection wait, per `syncOn`.
4. In the **authority sync sweep**, follow the resolved authority.
   - `state`: apply the latest state value to the local input with a `WriteReceipt` in the synchronous scope.
   - `element`: make the producer inbox's initial snapshot the candidate for a state commit.
   - `none`: do not commit the initial candidate to external state.
5. Only the records whose `settleInitial(expectedPhase, initialAttempt)` compare-and-set succeeds become active.

Thanks to that cohort barrier, if A's initial setter synchronously fires B's event, B — in the same ready cohort — is already subscribed. For a cohort defined later, level state is recovered through a snapshot of the current property.

Because BindingSession handles cohorts and authority, it does not call upstream `bind()` directly but implements the Level 1O observer lifecycle against its internal inbox. The initial read does not call a custom getter; it determines existence with `name in target` and delivers an explicit `undefined` too. The upstream conformance vectors run as-is as adapter tests.

If a record throws during listener registration, the initial read, or installing the connection observer, every cleanup that record has already registered runs in reverse order and it becomes `failed`. Cohort processing continues for the other records. If one cleanup throws, the rest continue best-effort and the secondary error is left only in a diagnostic. The upstream partial-delivery contract — that values already delivered into the inbox partway through the initial read are not rolled back — is maintained too.

### 3.5 `syncOn` for the producer snapshot

The initial authority is "which of state and element wins in the end", and wc-bindable's `syncOn` is "when the producer's initial property read is delivered into the inbox". They are kept on separate axes.

| `syncOn` | When the snapshot happens | If it races with an event before the snapshot |
| --- | --- | --- |
| `call` (default) | in the same synchronous session drain as the listener attach | the event payload becomes the final candidate |
| `connect` | when an unconnected `HTMLElement` is first connected | the property read is delivered after the earlier events, and the snapshot becomes the final candidate |

With `call` it is `seq0 → property read → seq1`, and if a synchronous event during the read changes the sequence, the snapshot does not become the final candidate and the event payload is kept. With `connect`, events before connection are also delivered into the inbox in arrival order, and the snapshot at connection is enqueued after them. The connection observer and dispose race through a CAS on `initialAttempt`, so the snapshot happens at most once.

`syncOn=connect` applies only to an unconnected DOM element; a headless target, a remote proxy, an environment without DOM APIs, and unknown values fall back to `call`, as upstream does. wcstack expresses it as the `#sync=connect` modifier — a consumer option — and never writes it into the wc-bindable declaration. The explicit mount of a structural `Content` and the registered Document / ShadowRoot observer serve as the connection signal; no per-binding document-wide observer is created.

`hasConnectedCallbackPromise` / `connectedCallbackPromise` are not this contract and are never awaited implicitly. `<wcs-defined>`'s Promise in particular waits for the observed targets to complete and can stay pending forever without a timeout. With the default `syncOn=call`, its six output properties can be read immediately and the binding does not wait for the observation to complete.

The producer's initial value is delivered into the internal inbox before the authority is decided. Under `init=state` that candidate is not committed to state — while staying diagnosable — and the state input write is the final value. Under `init=element` the candidate is committed to state. That resolves the initial conflict as a higher-level binding policy without erasing the observer's initial delivery.

If the initial state setter returns a synchronous notification, an equal value is suppressed as a receipt confirmation, and a different value is queued as the element's normalization result. An independent external event and a normalization result take precedence as changes after the initial write.

An initial event missed during upgrade can be recovered if the current property can be snapshotted after the event. Where the event itself carries discrete meaning and there is no current property, it is not replayed. event-token / command-token remain discrete events as before, and a blank shot before the definition is never auto-replayed.

### 3.6 Making the initial authority explicit

> **Implementation status (2026-07-16)**: the direction-aware initial sync of this section is implemented as
> `enableDirectionalInitialSync` and is **on by default** (the permanent opt-out flag remains). It includes the
> element-authority initial read for an output-only member and the `#init=` / `#sync=` modifiers. For details and
> remaining work see [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md).
>
> **A correction (2026-07-21)**: the initial implementation also used the resolved authority as the gate for the
> steady-state apply, **permanently** suppressing state→element for bindings with element / none authority (a
> divergence from this section's "a modifier on a two-way member governs the initial sync". `init=element` on a
> two-way member effectively became one-way, and the `<wcs-storage>`-style load-before-bind could not be solved with
> a modifier). `shouldApplyState` was split into two phases so that only the first consultation (the initial sweep /
> a first render / selecting a deferred initial apply) answers from authority, while the steady state blocks only for
> the contract of an output-only member and while a `sync=connect` connection snapshot is unresolved (the eighth item
> of 10 §D; `bindings.initialSyncPolicy.test.ts` / `integration.initialAuthority.test.ts`).

A conflict over the initial value cannot be resolved by timing alone. The default is decided first from the wc-bindable member direction, and only two-way members are the primary subject of an override through a binding modifier.

The direction resolver treats declaration metadata and target kind separately. `inputs` on a local Core / Shell represents an ordinary JS assignment surface, and that assignment presumes none of Extension 1's acks, ordering, or error mapping. On a remote / relay target, the mere presence of `inputs` does not license assignment; it goes through an explicitly Extension-1-capable surface.

| The member as declared | Default authority | Explicit specifications permitted |
| --- | --- | --- |
| `properties` only (an observable output) | `element` | `element`, `none` |
| `inputs` only, on a local assignment surface | `state` | `state`, `none` |
| both `properties` and `inputs` on a local assignment surface | `state`, for compatibility | `state`, `element`, `auto`, `none` |
| an Extension-1-capable surface | the input / output direction the resolver exposes | within the capability |
| event-token / command-token | `none` | never replayed |
| a native / manifest-less legacy element | the current direction inference | `state`, `element`, `auto`, `none` |

Where a member exists on no surface of a declared custom element, or where `init=state` is given for an output-only member, it is a contract error. That makes `<wcs-defined>`'s `defined` / `pending` / `count` and the rest element-authority with no modifier, so the value right after connection can always be pulled into state.

A modifier on a two-way member means the following.

| Specification | The initial sync | Use |
| --- | --- | --- |
| `init=state` | writes state's latest value into the element | the ordinary form, where the store is authoritative |
| `init=element` | puts the property snapshot taken after listener registration into state | SSR, a declarative default, a late upgrade |
| `init=auto` | element if the state slot is uninitialized, state otherwise | for a staged migration |
| `init=none` | no initial sync; handled from the next change | discrete inputs, external ownership |

```html
<x-input data-wcs='value#init=state: form.name'></x-input>
<x-clock data-wcs='value#init=element: clock.now'></x-clock>
<wcs-defined tags='x-chart' data-wcs='defined: ready; pending: pendingTags'></wcs-defined>
```

`auto` is decided not by a bare `value !== undefined` but by the state slot's initialized bit. A state address status API that distinguishes an explicitly committed `undefined` from uninitialized is introduced first, and `auto` selects element where uninitialized and state otherwise. On a runtime without that API, `auto` is not enabled.

The notation is a modifier in wcstack's existing path grammar and is not added to the wc-bindable core declaration. The current parser separates everything after `#` into the modifier slot, so `#init=state` is not read as a separate path. But the existing modifiers are flag-only, and an older runtime silently ignores an unknown `key=value`. The semantic interpretation of `key=value` plus parser tests are added, and the validator diagnoses the minimum runtime version required, preventing a silent ignore.

### 3.7 Teardown

`BindingSession.dispose()` destroys the following as belongings of the same record.

- DOM listeners and state address registrations.
- The continuations waiting on definition / `syncOn=connect` connection. Where a Promise or observer itself cannot be cancelled, they are invalidated by generation.
- Pending deferred applies, write receipts, and trace handles.
- The active record exposed to DevTools.

An `OperationTicket` is disposed by each I/O node's operation owner, not by the binding. Removing a binding alone never implicitly cancels I/O that the same node is running for another consumer.

For wcstack's own structural updates, the owner disposes explicitly when a node is replaced or removed. Against external DOM changes, there is one `MutationObserver` per Document / ShadowRoot, disposing subtrees that left the owner after the mutation batch completes. A move within a root is preserved by looking at the final containment, and a move between registered roots terminates the old record and adopts it into a new generation. This is kept separate from any facility for auto-discovering unknown added nodes.

If an implementation without an observer is chosen, an ownership mechanism that releases the strong references of pending records equivalently, plus an explicit API to call on external changes, are mandatory. A lazy `isConnected` check alone is no substitute, since the Promise for a tag that is never defined retains the node. In SSR and non-browser environments the owner's explicit lifecycle is used, and browser globals are never referenced at module evaluation time.

## 4. `PropagationContext`: following causality rather than echoes

> **Implementation status (2026-07-16)**: the causal propagation of this section is implemented as
> `enablePropagationContext` and is **on by default** (the permanent opt-out flag remains). It was defaulted after
> a zero-copy optimization (provenance bookkeeping only on two-way wires that can echo; one-way bindings are
> zero-cost) achieved a write-path overhead of ≤5%. For details see
> [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md).

Simple value comparison alone cannot distinguish a normalized value, the same object reference, and a diamond graph. Ignoring events wholesale, on the other hand, loses the element's normalization results too. So the updater's internal queue changes from holding addresses to holding update records carrying the value and the next context.

```ts
interface PropagationContext {
  readonly transactionId: number;
  readonly originBindingId: number;
  readonly visitedEdges: ReadonlySet<number>;
  readonly hop: number;
}

interface WriteReceipt {
  readonly bindingId: number;
  readonly bindingGeneration: number;
  readonly member: string;
  readonly transactionId: number;
  readonly synchronousScopeId: number;
  readonly writtenValue: unknown;
}
```

Transaction and edge IDs are unique within a session, and an edge ID includes the binding generation and the direction so it is never reused. For external display they are projected onto a (DevTools source ID, session ID, sequence) triple. The propagation rules are as follows.

1. Start a transaction for each external event or API update.
2. Suppress propagation only where the same transaction would traverse the same edge again.
3. Immediately before writing to the element, place a `WriteReceipt` carrying the member and the binding generation into the synchronous dynamic scope.
4. Suppress re-propagation as a confirmation only where an `Object.is`-equal notification comes back from the same member within the same setter call stack.
5. Where the element normalized the value and returned a different one, continue as a change traversing a new edge.
6. Where a transaction exceeds its hop limit, quarantine only that transaction's unprocessed records; already-applied values are not reverted. The updater throws nothing and leaves a structured diagnostic and a trace.

Value comparison stays an auxiliary optimization, with edge provenance as the basis for loop detection. `Object.is` on primitives is kept to reduce unnecessary setters and events, but a deep comparison of objects never becomes the runtime's default behavior.

A receipt is always destroyed in a `try/finally` when the setter's synchronous scope ends. An event arriving asynchronously MUST NOT be taken as a confirmation merely because its value resembles an old receipt's. Every property event is delivered into the internal inbox, and the receipt is used only to decide whether to send it from state back through the same edge. Several occurrences of an identical event-token payload are never deduped.

In a component that mutates the same object in place and notifies, reference comparison alone cannot tell a confirmation from a normalization. And a component that returns a fresh object in a separate task after the setter cannot have its causality with the original write reconstructed from the core events alone. In such a case, either the component honours a contract of "do not notify where semantically equal", or an explicit behavioral extension providing a member revision / cause token / equality is needed. A pending receipt bounded only by a time window is not adopted, since it would wrongly suppress legitimate user events.

### 4.1 Queue coalescing

Where a queue for the same address is last-write-wins, the value and the correctness context are taken as the pair from the last update as-is. Intersecting or unioning `visitedEdges`, or replacing it with a new synthetic transaction, is not done — it would lose the winner's traversal history.

The transaction IDs dropped by coalescing are associated with the winner as bounded trace metadata, and only where the hook is enabled. Anything beyond the limit is aggregated into `truncatedParentCount`, and the data-plane `PropagationContext` never carries an array for tracing. A reducer that merges values by computation either retains its input contexts individually or disables coalescing for that address.

The context is carried inside the state runtime and never mixed into a wc-bindable event detail or property value. The completion of an async operation does not restore the starting transaction's `visitedEdges` but starts a new transaction, with the originating cause left only in the trace parent. A trace context crossing a remote boundary is a future optional extension, shaped so the meaning of values does not change for a peer that does not support it.

## 5. `OperationTicket`: giving an async result the right to commit

An `AbortController` alone cannot prevent an uncancellable Promise, or a result that completed simultaneously with the abort, from committing. Async I/O is managed per lane, and the following ticket is issued when one starts.

```ts
type LanePolicy = 'latest' | 'queue' | 'exhaust' | 'overlap';
type TerminalOutcome = 'success' | 'error' | 'timeout' | 'aborted' | 'stale';

interface OperationTicket {
  readonly operationId: number;
  readonly ownerGeneration: number;
  readonly laneKey: string;
  readonly policy: LanePolicy;
  readonly supersedeEpoch?: number;
}

interface OperationAttempt {
  readonly operationId: number;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

interface LaneState {
  readonly policy: LanePolicy;
  latestEpoch: number;
  activeOperationId?: number;
  readonly activeOperationIds: Set<number>;
  readonly queue: OperationTicket[];
  inFlightCount: number;
}
```

| Policy | When a new request arrives | The commit condition |
| --- | --- | --- |
| `latest` | advance `latestEpoch`, make the old ticket stale, and abort where possible | only the active operation of the newest epoch |
| `queue` | push the ticket FIFO and start only the head | only the active operation at the lane's head |
| `exhaust` | while one is running, refuse to ticket the new request, or join it to the existing result | only the single active operation |
| `overlap` | add it to the active set and run concurrently | each operation in the active set |

`overlap`'s active set is internal bookkeeping for commit eligibility, the terminal CAS, teardown, and the in-flight count; it does not mean the `parallel` that would expose a per-operation observable. The external semantics stay as the existing norm: each completion overwrites the same observation surface in arrival order, last arrival winning. Generations are capture-only, invalidated only by dispose or an explicit cancel.

`ownerGeneration` represents each I/O Core's observe / reconnect / dispose lifecycle and is never shared with a BindingSession generation. A remote proxy's reconnect / pending responses are managed by yet another connection generation. A retry creates a new `OperationAttempt` under the same `operationId`, updating only the attempt number and the resource signal. `overlap`'s loading is derived from `inFlightCount > 0` rather than a single boolean setter, so it never goes false partway through several completions.

### 5.1 The commit guard

Immediately before an async result performs an externally visible setter, state update, or event dispatch, a shared `CommitGuard` checks the following. The determination is per policy; latest's epoch match is not required of everything.

1. The I/O owner's lifecycle generation matches.
2. The operation is before its terminal settle.
3. `latest` satisfies the current epoch, `queue` the active head, `exhaust` the active ID, and `overlap` membership of the active set.

Browser capability is normally a precondition checked before starting and is not part of the generic guard. Only a node whose validity genuinely changes mid-run — through a permission epoch, say — registers an additional node-specific guard. The binding generation is likewise a separate guard on the state adapter side.

Each operation has a one-time terminal CAS of `pending → committing → TerminalOutcome`. Only whichever of success, error, and timeout claims `committing` may write the public output. A timeout is not "invalidate first, then write the error": an eligible ticket claims the timeout outcome, commits a `TimeoutError` under the guard, and then performs the native abort and releases the lane. Supersede and dispose add no public error as a rule, leaving only a `stale-drop` / `aborted` trace.

Since a setter can fire a synchronous event that supersedes the same lane, the guard checks immediately before and immediately after each setter. An invalidation detected afterwards does not roll back side effects that already happened; it stops the remaining state / event commits of that operation. `AbortSignal` is for saving resources; owner generation, policy eligibility, and the terminal CAS are for correctness.

Where an async completion causes a state update, it starts a new `PropagationContext`. The starting transaction is stored only as the ticket's trace parent, and the old `visitedEdges` are never carried over to the commit side.

The first implementation target is narrowed to the `latest` policy of the fetch family. Until the shared abstraction stabilizes, it is not a required dependency of every I/O package; each node uses a small helper. wc-bindable remote's ordering, at-most-once, ack, timeout, and backpressure are guarantees of the transport boundary and compose as a separate layer from a UI-operation lane's `latest`.

### 5.2 The boundary with wc-bindable remote

- `set` is fire-and-forget at-most-once and is never auto-replayed on reconnect.
- `setWithAck`'s resolve is an ack that the assignment was applied — not a guarantee that side effects completed or state stabilized. On reject, the server may have applied it and only the ack been lost.
- `invoke` is a command call on an Extension-1-capable surface. It is never turned into at-least-once by auto-resending on a lost response; a non-idempotent command that needs retrying is deduplicated with an application-level idempotency token.
- The caller order / FIFO of one logical channel and the local lane policy are different things; remote FIFO alone does not prevent a stale UI commit.
- A timeout or `AbortSignal` only releases the client's pending wait; it does not stop the server's side effects. A slow response is dropped through the connection generation and the pending map.
- The pre-open, pre-sync, pending-invocation, and sync-update buffers each have their own limit and overflow policy.
- An ordinary wire value is limited to `JsonValue`. A top-level observable `undefined` uses a capability-gated out-of-band representation, and a nested `undefined` is never sent.
- `sync.capabilities` is a per-connection remote behavioral capability and is never conflated with the declaration's `inputs` / `commands`, a browser API capability, or a sidecar extension.
- The declaration fingerprint is for interface identity and resync, and is never used as a trace ID, for authorization, or for signing.

## 6. Making the DevTools trace a side channel

The existing DevTools hook is extended to send at least the following structured records.

| Category | The main events |
| --- | --- |
| binding lifecycle | `binding:discovered`, `binding:attached`, `binding:snapshot`, `binding:disposed` |
| propagation | `propagation:applied`, `propagation:coalesced`, `propagation:suppressed`, `propagation:hop-limit` |
| async I/O | `io:operation-started`, `io:operation-retried`, `io:operation-settled`, `io:stale-dropped` |
| contract | `contract:manifest-read`, `contract:unsupported-extension`, `platform:capability-missing` |

Every record carries a monotonic timestamp, a DevTools source ID, and a source-local sequence. Where applicable it also carries the trace / parent ID, the root / session / binding / edge ID, the operation ID, and the lane. The data-plane transaction and visited edges are numbered separately from the trace IDs, and the shape of the correctness context never changes with whether a hook is attached. An update caused synchronously by a command-token inherits the call scope's trace parent; an async completion uses a new data transaction and the existing operation's trace parent.

By default no property value, event detail, command argument, URL, header, or response body is stored. Only where needed does the user explicitly register a redactor / serializer. Serializers run on the trace drain side rather than the hot path, with limits on exceptions, depth, output byte count, and running time. Getter function bodies and live handles are never serialized.

The data hot path never calls subscribers synchronously; it only appends to a bounded ring buffer and schedules a drain. The consumer drain is separated onto a microtask or an animation frame, with each callback's exceptions isolated by the bridge. A buffer overflow drops only trace records, carrying the drop count on the next record. Where the hot path has no hook subscriber, no trace record object is created at all.

When DevTools attaches later, an additive per-source snapshot callback (`kind: state` / `kind: io` and so on) sends the baseline of existing sessions, binding phases, and active operations once, with differences from then on. An operation controller registers in the enumeration registry only while active, deregistering on settle or dispose. An older consumer ignores unknown source kinds and event namespaces. A subscriber's exceptions, latency, re-entry, and disconnection MUST NOT change the order or the results of the data plane.

That trace makes it possible to display one operation spanning several nodes as a single timeline: cause → binding edge → I/O ticket → commit / stale-drop. Distributed tracing with a remote peer never mixes bespoke fields into the core payload and is connected only where a future optional extension is agreed on both sides.

## 7. `wcstack.manifest.json`: putting the static contract in a sidecar

wc-bindable's `static wcBindable` is kept as the runtime fact the browser reads. Types, lane policy, and required browser APIs are not stuffed into the core declaration but placed in an optional sidecar. Four terms are kept separate:

- a behavioral extension: the official wc-bindable Extension 1 / 2.
- a manifest extension: the `wcstack.*` namespace inside the sidecar.
- a remote capability: a connection's `sync.capabilities`.
- a platform capability: a browser / runtime API and the conditions for using it.

A package component contract and an application state schema may share the same envelope version but are separate artifacts. Here is the package-side example.

```json
{
  "schemaVersion": 1,
  "kind": "package",
  "bindingProtocol": {
    "protocol": "wc-bindable",
    "minimumVersion": 1
  },
  "behavioralRequirements": {
    "required": [],
    "optional": ["wc-bindable/extension-1"]
  },
  "manifestExtensions": {
    "wcstack.types": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "observables": {
            "response": {
              "event": "wcs-fetch:response",
              "schema": { "type": ["object", "null"] }
            }
          },
          "inputs": {
            "url": { "schema": { "type": "string" } }
          },
          "commands": {
            "fetch": {
              "args": { "type": "array" },
              "result": {}
            }
          }
        }
      }
    },
    "wcstack.async": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "operations": {
            "fetch": { "lane": "request", "policy": "latest" }
          }
        }
      }
    },
    "wcstack.platformCapabilities": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "required": ["web.fetch"],
          "optional": ["web.abort-controller"]
        }
      }
    }
  }
}
```

An application artifact is `kind: application`, with a root `stateSchema`, the inputs / outputs of filters, and list contexts. Package and application are never merged into the same file; the validator resolves the package contract and checks it against the application's bindings.

Type expression is limited to an explicit subset of JSON Schema rather than arbitrary TypeScript strings. Initially the subset is `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`, and local `$ref`, with external `$ref` forbidden. The resolver detects cycles, and unknown keywords are not guessed at runtime but reported as an unsupported diagnostic in the IDE / CI.

Literal paths, array wildcards, nested list contexts, filter chains, and command arguments / results are checked against the schema, while a dynamically constructed path falls to `unknown` and never impedes runtime behavior. Where the sidecar has a member the runtime declaration does not, or the event names differ, it is a drift error in CI. The sidecar never overrides the runtime's live declaration. Likewise `wcstack.async` is a description for tooling, and the I/O Core's code is authoritative for the actual lane policy and commit guard. A missing or stale sidecar is never a reason to disable the runtime's contention prevention. `behavioralRequirements` likewise only describes the required extensions and never makes a target Extension-1-capable; the validator / adapter separately checks the results of runtime discovery and capability negotiation.

Even where a package uses TypeScript types as the authoring source, the published artifact is the same JSON schema emitted by a deterministic generator, with CI checking the regeneration diff. The discovery of an application artifact, package resolution, collisions between same-named tags / filters, and whether overriding is forbidden or allowed are pinned in the schema document; no implicit last-file-wins merge happens.

### 7.1 One validator

The DOM-independent parser, path resolver, and schema checker are carved out of `packages/vscode-wcs/src/service` as a pure library. The same validator core is called from:

- VS Code: diagnostics, completion, and hover while editing.
- the CI CLI: repository-wide checks of paths, modifiers, and manifest drift.
- the development runtime: an optional check against the declarations actually loaded.

A diagnostic carries a stable code, a source range, a severity, and the related tag / member / state path. Unknown types and dynamic paths are warnings or informational; a definite type mismatch, a nonexistent member, and a broken manifest are errors. That prevents rules known only to the IDE from diverging from rules known only to the runtime.

### 7.2 Determining capability

The sidecar enumerates the required capabilities statically, but what is actually possible is decided by feature detection immediately before use — never by the User-Agent.

```ts
interface PlatformAssessment {
  readonly availability: ReadonlyMap<string, 'available' | 'missing' | 'unknown'>;
  readonly permission: 'granted' | 'denied' | 'prompt' | 'not-applicable' | 'unknown';
  readonly readiness: 'idle' | 'ready' | 'degraded';
  readonly activity: 'inactive' | 'active';
  readonly preconditions: {
    readonly secureContext: 'satisfied' | 'required' | 'not-applicable';
    readonly userActivation: 'present' | 'required' | 'not-applicable';
  };
  readonly epoch: number;
  readonly lastError?: WcsIoErrorInfo;
}

interface WcsIoErrorInfo {
  readonly code: string;
  readonly phase: 'probe' | 'start' | 'execute' | 'decode' | 'commit' | 'dispose';
  readonly recoverable: boolean;
  readonly capabilityId?: string;
  readonly message: string;
}
```

Availability, permission, readiness, activity, and operation error are never folded into a single `ready / unsupported / error` enum. Where a required API is missing, the operation does not start; where an optional API is missing, it switches to the declared fallback and readiness becomes `degraded`. A permission / policy refusal, a network failure, a timeout, an abort, a decode failure, and an internal contract violation each get their own code.

A platform capability ID is a stable namespace such as the built-in `web.fetch`, with third parties using a reverse-DNS namespace. The registry maps each ID to a side-effect-free presence probe, its secure-context / activation / permission conditions where needed, and a browser-compatibility dataset key. The string `web.fetch` is never evaluated as a global property path.

Probes never run at module evaluation time. A baseline is taken at activation, and the conditions of use are re-checked immediately before each operation. Where the platform provides a notification — a permission change, device removal, visibility / BFCache — an observer updates the epoch and is removed on dispose. Only a node whose mid-run validity changes uses that epoch in a node-specific commit guard.

The runtime's `WcsIoError` separates the serializable info above from a non-cloneable `cause`, projecting only the info to DevTools / remote. The initial migration does not change the value shape of the existing error properties and events; the taxonomy goes to DevTools and an opt-in `errorInfo`. Replacing an existing output with `WcsIoError` has its compatibility judged per package and is a major change where necessary.

### 7.3 Not conflating the version axes

| Axis | Role | The compatibility rule |
| --- | --- | --- |
| npm SemVer | a package's distribution and API | SemVer per package |
| wc-bindable `version` | the core declaration format | accept every integer 1 or above; ignore unknown optional fields |
| a behavioral extension / remote capability | command execution and wire behavior | checked through the extension contract and the connection capability bits |
| a manifest extension `version` | the sidecar vocabulary of `wcstack.types` and the rest | check the supported range per namespace |
| the sidecar `schemaVersion` | the manifest envelope | the reader states the majors it supports |

Where a required behavioral extension is unsupported, only that feature becomes an activation error. An optional behavioral / manifest extension is ignored and core property binding continues. A breaking change to core semantics is never handled by guessing at a higher integer version but uses a new protocol identifier. Release tests keep a compatibility matrix of "new reader × old declaration", "old reader × new optional field", and "supported / unsupported extension" as fixed fixtures.

## 8. Staged introduction

The whole runtime is not rewritten at once; each phase is a release checkpoint. But since later phases depend on the earlier foundation, a rollback proceeds from the last phase as a rule — phases 0 / 1 are never reverted while later phases remain.

| Phase | Implementation | Completion criteria |
| --- | --- | --- |
| 0. foundation | a repository-local discovery mirror, conformance fixtures with the official helper as the oracle, a minimal platform guard, the version type | current v1 is unchanged, and version 2 plus unknown optional fields, an SSR import, and no external runtime import in the published ESM all pass |
| 1. lifecycle ownership | `BindingSession`, `DefinitionCoordinator`, records / teardown. The synchronous order stays compatible with today for now | no duplicated listeners or addresses, and the removal-during-undefined and reconnection tests pass |
| 2. initial sync | the ready cohort, `syncOn`, the direction decision table, the `init` modifier | the upstream observer vectors and the race tests including `wcs-defined` pass deterministically |
| 3. causal propagation | update records, `PropagationContext`, `WriteReceipt` | the echo, normalization, diamond, and coalescing tests pass |
| 4. async and trace | lane units for every policy, the fetch `latest` PoC, the terminal CAS, the async trace queue | zero stale commits; the hook-off performance gate passes |
| 5a. static contract | the sidecar schema, the validator core, VS Code / CI integration | the IDE's and CI's diagnostic codes and ranges agree |
| 5b. development-time checking | the opt-in runtime analyzer and manifest drift trace | runtime behavior and cost are unchanged while disabled |
| 6. capability | applying the probe / report / error taxonomy to the I/O packages in turn | the target browser matrix and the SSR import test pass |

Phase 1 keeps the signatures of the existing `initializeBindings()` and `initializeBindingsByFragment()` as a facade. Phase 2's output-only initial read and the new modifiers are compared against the existing examples and SSR snapshots under a feature flag before being defaulted. Through phase 3 the primitive same-value guard is kept, with a shadow diagnostic confirming that provenance and the result agree. Phase 4's lane policy starts with the fetch family and does not convert every node's own cancellation / retry contract at once. Phase 0's minimal platform guard provides only the existence check of a global plus an owner adapter, and is not conflated with phase 6's capability taxonomy.

> **Defaulting and roll-out status (updated 2026-07-17)**: the phase 0-6 PoC implementations are complete, and
> defaulting and roll-out are nearly complete too — phases 2/3 flipped to default `true`, phase 4's lane is on 6
> operation nodes, phase 6's errorInfo is applied to 27/35 nodes (3 deferred, 5 not applicable), 5a is gated as
> required in CI, and 5b is settled with explicit opt-in as the official spec. The remaining work (the release-time
> dist rebuild, the decision on the deferred nodes, the lane trace bridge) is tracked by the living document
> [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md).

The old and new paths of each phase MUST NOT be applied twice to the same binding. Ownership is switched per session, so that even on a rollback there is always exactly one owner of a listener, an address, and an operation ticket. The dependency order runs along two lines: `foundation → lifecycle → initial sync → propagation`, and `foundation → operation / trace → sidecar / capability`.

## 9. The main places that change

| Area | Today's entry point | The design change |
| --- | --- | --- |
| declaration interpretation | `packages/state/src/protocol/wcBindable.ts` and each check site | the repository-local conformance mirror becomes the runtime gate and the official helper the test oracle, plus the types and a dev analyzer |
| binding lifecycle | `bindings/initializeBindings.ts`, `collectNodesAndBindingInfos.ts` | the session, owner, records, and cohort drain go inside the facade |
| late definition | `apply/scheduleDeferredApply.ts`, the deferred spread, `event/twowayHandler.ts` | the individual `whenDefined()` calls move into the coordinator, unifying ownership of attach / sync |
| the update pipeline | `updater/updater.ts`, `proxy/apis/postUpdate.ts`, `proxy/methods/setByAddress.ts` | the address queue is extended into update records carrying a context |
| DOM apply | `apply/applyChangeToProperty.ts` and others | the receipt, binding generation, and propagation context are passed into the apply context |
| DevTools | `state/src/devtools/{types,sink,bridge}.ts` and `packages/devtools` | lifecycle / propagation / operation records plus the baseline snapshot are added |
| the async PoC | `packages/fetch/src/core/FetchCore.ts` | a `latest` ticket and a commit guard are introduced on the request lane |
| static validation | `packages/vscode-wcs/src/service` | the pure validator core is separated and shared by VS Code / CI / the dev runtime |
| browser variance | each I/O Core / Shell | the platform assessment and a compatible `WcsIoErrorInfo` projection are migrated per package |

`IBindingInfo` is kept as the collection result, with no session-specific mutable state added. The public component API, wc-bindable's property event payloads, and command arguments are outside this table of changes, preserving the wire contract for existing users.

## 10. The verification design

Ordering problems are never verified with a wall-clock sleep but with a controllable custom-element registry, Promises, microtask drains, and a fake transport. `BindingSession`'s reducer / transitions are model-tested, generating sequences of define, event, state write, dispose, and reconnect to check the following invariants.

1. Per record and generation, a listener, an address, and the initial sync happen at most once.
2. There exists no initial attempt that settled anywhere other than active / failed / disposed.
3. There is no commit to the DOM or to state from a disposed generation.
4. The same transaction and edge are never applied twice, and a differently normalized value is never lost.
5. An async ticket without commit rights never changes externally visible state.
6. Even where an install throws partway, every resource that record had registered is released best-effort.
7. A trace subscriber's throw, latency, or overflow never changes the data plane's results.

### 10.1 The mandatory cases per topic

| Topic | Mandatory regression tests |
| --- | --- |
| 1. definition order | one wait per (registry, tag); an invalid tag; an expando before define; several roots; removal while waiting; a define after root dispose; fragment upgrade / adopt |
| 2. initial delivery | the upstream observer vectors; `syncOn=call/connect`; dispose / reconnect before connect; an explicit `undefined`; an event during the read; a partial read throwing; A's setter → B's event |
| 3. echoes | a synchronous confirmation; a normalization difference; the same-object constraint; the extension requirement for a delayed fresh-object echo; occurrences of an identical payload; a diamond; last-wins coalescing |
| 4. async contention | `latest/queue/exhaust/overlap`; overlap's last-arrival-wins; no per-operation observable; the in-flight count; ignoring an abort; overtaking; a supersede mid-setter; the terminal CAS; a retry; a success after a timeout; a completion during dispose |
| 5. debugging | the parent chain; a late baseline; detach; ring overflow / drop count; a serializer throwing / hitting a limit; an unknown source; no remote trace capability; hook exception isolation |
| 6. path types | nested / array wildcard / list context; a filter chain; command arity; readonly; reserved / inherited names; a dynamic path; a malformed `$ref`; artifact merge / drift |
| 7. browser variance | a partially missing API; an insecure context; user activation; a permission change; a device busy / removed; visibility / BFCache; a late callback; SSR; error-info cloneability |
| 8. compatibility | version 1 / 2 / 0 / negative / non-integer / NaN; old and new readers × declarations; local / remote; Extension 1 unavailable; a reconnect / fingerprint change; a different protocol ID |

### 10.2 The integration cases using `<wcs-defined>`

- With every target tag already defined, `defined` / `count` can be snapshotted immediately even if the initial `change` fires before the binding attaches.
- With an undefined tag and `timeout=0`, `pending` can be pulled and the session becomes active even while `connectedCallbackPromise` stays pending.
- A late define after the timeout reflects `missing → count` exactly once, and the old continuation is a no-op.
- An output-only direction automatically becomes element authority, and the default `syncOn=call` does not wait on the observation-completion Promise.
- An explicit `syncOn=connect` waits only on the DOM connection, guaranteeing the order of pre-connect events → snapshot, and dispose before connect.
- The synchronous event from an `init=state` setter is classified as a confirmation or a normalization through the receipt.
- A `hidden` `<wcs-defined>` is connected and bound too; it is not an execution gate.

### 10.3 The performance and retention gates

Before adoption, the benchmarks of current main are pinned and at least the following become gates. The percentages are settled after the first baseline measurement, with a provisional limit of a 10% p95 regression for both initialization time and steady-state updates.

- With no DevTools hook, the allocation for trace records and payload serialization is zero.
- The platform `whenDefined()` is registered once per (session, tag).
- The collect → attach → sync of 10,000 bindings and the drain of 10,000 updates are measured separately.
- After 100 attach / dispose cycles, a heap test confirms the records, nodes, listeners, receipts, and tickets have become unreachable.
- The root observer is compared with an equivalent ownership implementation, measuring the steady-state cost with no external mutation, a mass removal, and a move between roots.
- The active operation source registry becomes empty after terminal / dispose and does not retain a Core merely for the sake of a late-attach baseline.
- Disabling provenance is not used as an escape route; where necessary, overhead is reduced with compact IDs, copy-on-write edge sets, and record pooling.

## 11. The decision gates before implementation

| Decision | Recommended initial value | When it is decided |
| --- | --- | --- |
| the final syntax of the `init` / `syncOn` modifiers | `#init=state` / `#sync=connect`. There is no syntactic collision with the current `#` slot; add `key=value` interpretation and a minimum-runtime-version diagnostic | before starting phase 2 |
| the producer initial read for output-only | adopted. The default is `syncOn=call`, with `connect` only when stated | phase 2 |
| the default authority for a two-way member | `state`, compatible with today. `auto` is an explicit opt-in | phase 2 |
| normalization differences | accepted as the element's settled value, kept separate from a receipt confirmation | phase 3 |
| async, same-reference echoes | not fully distinguishable from the core alone. Where a real case demands it, design a revision / cause extension separately | phase 3 |
| teardown on external DOM mutation | the root observer is the default candidate; where it is not taken, an equivalent mechanism for releasing strong references is mandatory | at the end of phase 1 |
| a component-specific readiness extension | not implemented in the initial release; designed once there are real cases the official `syncOn` cannot handle | after phase 2 |
| the sidecar's discovery and merge rules | separate the package artifact from the app artifact, and pin collisions in the schema document | before starting phase 5a |
| the public surface of the error taxonomy | keep the existing error shape, and start with DevTools / an opt-in `errorInfo` | phase 6 |
| the trace buffer | a bounded ring, with no payload by default. The limit is decided by a browser memory benchmark | phase 4 |

In particular, that component readiness is never auto-enabled by the mere presence of `connectedCallbackPromise` is an invariant, not a decision. And optional sidecar information is never promoted into a required input for runtime correctness.

## 12. Non-goals

- Replaying discrete events / commands that happened before listener registration from a persistent log.
- Fully classifying an async property event with no revision / cause into a legitimate user change versus a programmatic echo.
- Providing an exactly-once distributed transaction spanning the DOM, workers, and remote peers.
- Forcing deep object equality or an immutable data model onto every binding.
- Turning `<wcs-defined>` into an autoloader, a DOM connection barrier, or a binding scheduler.
- Polyfilling missing browser APIs across every package.
- Making a TypeScript-specific type notation mandatory in the browser runtime.
- Unifying the cancellation / retry policy of every I/O node in one release.
- Adding wcstack-specific trace, type, or lane fields to the wc-bindable core.

## 13. References

- [The topics](README.md#the-topics)
- [The order of tag definition and binding establishment](01-binding-initialization-order.md) (ja)
- [Delivering the initial state right after connection](02-initial-state-delivery.md) (ja)
- [Echo control in two-way bindings](03-two-way-echo-control.md) (ja)
- [Async execution and the wc-bindable boundary](04-async-execution-and-wc-bindable.md) (ja)
- [Observability, debugging, and the wc-bindable boundary](05-observability-and-wc-bindable.md) (ja)
- [Type safety for path strings](06-path-type-safety.md) (ja)
- [Absorbing browser capability variance](07-browser-capability-variance.md) (ja)
- [Protocol evolution and compatibility](08-protocol-evolution.md) (ja)
- [The `<wcs-defined>` design note](../defined-tag-design.md) (ja)
- [The DevTools hook protocol](../devtools-hook-protocol.md)
- [the wc-bindable SPEC (checked 2026-07-14, pinned commit)](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable Extensions (same pinned commit)](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [the wc-bindable remote README (same pinned commit)](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
