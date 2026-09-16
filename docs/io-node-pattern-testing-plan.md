# I/O node pattern testing implementation plan

**Status**: Implementation proposal (2026-09-15). The new tests, runner, and CI jobs described here have not been implemented with this document.

**日本語版**: [io-node-pattern-testing-plan.ja.md](./io-node-pattern-testing-plan.ja.md)

## 1. Approach and scope

Define flag transitions, value changes, update order, and asynchronous completion as **initial conditions + ordered actions + checkpoints + expected outputs + forbidden outputs**. Map existing tests to a case inventory, then add missing combinations as table-driven tests.

Start with `fetch` and `debounce`: Core behavior, Shell attribute/property wiring, then connections between nodes through `data-wcs`. Group inputs that interact semantically instead of generating the Cartesian product of every input of every tag.

This plan does not change public APIs or protocols. Derive expectations from the current references:

- Package READMEs: [fetch](../packages/fetch/README.md), [debounce](../packages/debounce/README.md)
- [I/O node guidelines](./async-io-node-guidelines.md)
- [Async execution model](./async-execution-model.md)
- [Timing and firing contract](./timing-and-firing-contract.md)

This makes the vector structure in §5 and phased rollout in §9 of the [trace conformance draft (ja)](./io-node-trace-conformance.md) concrete. It neither adopts that draft nor certifies `trace` conformance. Do not establish new semantics solely from current implementation output. Record discrepancies and unspecified behavior, and resolve expectations before making them a gate.

## 2. Existing assets and gap analysis

| Existing asset | Observed coverage | Additional inventory work |
|---|---|---|
| [fetch.test.ts](../packages/fetch/__tests__/fetch.test.ts) | Same-turn `url` / `manual` writes, equal-URL suppression, reconnect, trigger, body reset | Map flag transitions, update orders, execution paths, and missing cases |
| [fetchCore.phase4.test.ts](../packages/fetch/__tests__/fetchCore.phase4.test.ts), [operationLane.test.ts](../packages/fetch/__tests__/operationLane.test.ts) | Existing asynchronous lane checks | Map success, failure, cancellation, and late completion to action sequences |
| [debounceCore.test.ts](../packages/debounce/__tests__/debounceCore.test.ts) | Leading/trailing, pending, cancel/flush, timers after dispose | Map all four configurations against input count and boundary times |
| [integration.commandBinding.test.ts](../packages/state/__tests__/integration.commandBinding.test.ts) | Command binding to a synthetic element | Add wiring through actual I/O tags |
| [Shared upgrade tests](../protocol/upgrade-properties.test.ts) | upgradeProperties checks using synthetic objects | Check writes before actual tag upgrade and resulting execution counts |
| [Structural checks](../scripts/conformance-io-nodes.mjs), [input declaration checks](../scripts/conformance-bindable-inputs.mjs) | Implementation structure and declarations | Keep temporal runtime checks in a separate suite |

These are findings from representative files, not a completed audit of all cases. Preserve existing tests while mapping them. When migrating a test, retain its event and effect assertions as well as value assertions.

## 3. Classify inputs and outputs first

For each tag, inventory public names, Core/Shell mappings, input paths, defaults, normalization, firing conditions, and references. Use `wcBindable` to help enumerate the surface; derive semantics from READMEs and contracts through review.

| Category | Example | Distinction to test |
|---|---|---|
| Automatic execution control | Fetch `manual` | ON/OFF does not necessarily mean stop/cancel |
| Firing configuration | Debounce `leading` / `trailing` | Combinations including both OFF; changes during pending work |
| Execution request | Fetch `trigger=true`, debounce `trigger(...)` | Boolean assignment versus method call; repeated requests |
| Value input | `url`, `source`, `body` | Equality, replacement, empty values, reset after consumption |
| Output state | `loading`, `pending` | Observe transitions at checkpoints; do not write as inputs |
| Occurrence | `response`, `settled`, `fired` | Equal-payload event counts and getter values during dispatch |

Do not embed the following tag-specific differences into a common runner:

- Fetch `manual` uses attribute presence. `manual="false"` is ON; removing the attribute is OFF. Treat property `false`, attribute string `"false"`, and a bound boolean as separate input paths.
- In the current [Fetch Shell](../packages/fetch/src/components/Fetch.ts), setting only `manual=false` does not schedule automatic fetch. A microtask scheduled by connection or URL update reads the current `manual` value. Add an explicit case for this distinction and supplement the README if its explanation is incomplete.
- Neither `manual=true` nor `trigger=false` should be interpreted as aborting an in-flight request. Use the cancellation operation defined by the tag.
- Fetch emits `loading-changed(true)` per request, whereas debounce suppresses equal `pending-changed` values. Do not impose one event-count rule on all boolean outputs.
- The Shell uses `no-trailing` to negate trailing; throttle uses `no-leading` to disable its default leading behavior. Do not generate HTML attribute names directly from Core option names.

## 4. Selecting patterns

| Axis | Required candidates |
|---|---|
| Flag | Initial ON/OFF; OFF→ON, ON→OFF, ON→ON, OFF→OFF |
| Value | Unset→A, A→B, A→A, A→empty, A→empty→A; `null` / `undefined` / `0` / `false` only where relevant |
| Interaction | Value change while OFF then ON; value change while ON; flag and value updated together |
| Order | Value then flag, flag then value; one synchronous segment versus a microtask boundary |
| Lifecycle | Before connection, after connection, writes before upgrade, disconnect, reconnect |
| Async | Success, failure, cancellation, both completion orders after starting A then B, late completion after stopping |
| Time | Before, at, and after a deadline; callback before/after an action at the same timestamp |
| Input path | Property, attribute, command, `data-wcs`; only paths actually exposed |

Selection procedure:

1. Cover the four transitions of each flag and the four configurations of interacting flag pairs.
2. Add equal/replaced/empty values and update order. Explicitly cover known interactions with three or more factors, such as fetch `manual × url × trigger`.
3. Enumerate cancellation, late completion, and reconnect sequences. Pairwise coverage alone does not cover order-dependent failures.
4. Use pairwise generation only for remaining independent configuration dimensions. Record constraints, seed, and concrete cases so a failure can become a fixed regression case.

Record reasons for non-applicability. Do not classify unimplemented, unspecified, or runner-unsupported cases as non-applicable or passing. Neither case counts nor code coverage establish pattern completeness by themselves.

## 5. Case format and runner

Start with package-local TypeScript data and `it.each`. Do not initially introduce a public JSON/YAML format, a DSL that interprets arbitrary scripts, or a new public package.

Each case carries the following information. Suite defaults are allowed, but failure reports must expand them into a readable case.

| Field | Content |
|---|---|
| `id`, `title` | Stable ID and Japanese test title |
| `basis`, `status` | Specification section, existing test; specification-backed / characterization / unresolved |
| `layer`, `appliesTo` | Core / Shell / binding; tag and input path |
| `initial` | Configuration, values, connection state, fake API and clock |
| `steps` | Ordered writes, connections, resolve/reject, callbacks, clock advancement, checkpoints |
| `observedSurface` | Events, getters, API calls, and resource releases in scope |
| `expected` | Per-checkpoint snapshots, event sequences, effect counts and arguments |
| `forbidden` | Disallowed events, writes, and API calls |
| `normalization` | Error comparison, payload snapshots, handle identity rules |
| `settleBoundary`, `allowAdditional` | End of observation and extra-output permission, default false within the observed surface |

This internal format is not a complete conformance vector under draft §5. Add `contractVersion`, `conformanceLevel`, extension support, and related metadata when implementing that mapping. A partial `observedSurface` must not be reported as full public-surface coverage.

Example data, not an executable runner API:

```text
id: debounce.core.trailing.latest-value
basis: debounce README; debounceCore.test.ts
status: specification-backed
layer: Core
initial: fresh instance; leading=false; trailing=true; wait=100; no maxWait; clock=0
observedSurface: pending, value, pending-changed, settled
steps:
  setSource(A) at t=0
  checkpoint(start): pending=true; value=undefined
  advance clock to t=50; setSource(B)
  advance clock to t=149
  checkpoint(before): pending=true; value=undefined; no settled
  advance clock to t=150
  checkpoint(done): pending=false; value=B
expected events, in order:
  pending-changed(true)
  settled({ value: B })
  pending-changed(false)
forbidden: settled(A); any extra event on the observed surface
normalization: primitive equality; copy event payloads at dispatch
settleBoundary: t=150 after due timer callbacks return
allowAdditional: false
```

Separate the runner and tag adapter as follows:

- Runner: sequential steps, sequence-numbered records, checkpoint comparison, forbidden-output checks, failure reporting.
- Adapter: public setters/commands, fake API creation and completion controls, getter reads, payload normalization, disposal.
- Case: expected values and contractual order. Never compute expectations from private fields or the implementation's branching logic.
- Initially reorganize existing test functions with minimal helpers. Extract a recorder only after two packages demonstrate shared needs; do not first build a large runner that imposes tag semantics.

Require total order only where the contract does. Explicitly mark groups that allow arbitrary order. Capture event payloads and related getters inside listeners, so later mutations cannot rewrite recorded history. Preserve handle identity rather than cloning handles; verify symbolic IDs, reference equality, and release counts.

## 6. Initial implementation cases

The IDs below are proposed. During implementation, attach existing-test mappings and the basis for each adopted expectation.

### 6.1 Fetch

| ID suffix after `fetch.` | Conditions and actions | Main expectation |
|---|---|---|
| `shell.auto.final-inputs` | Connected, no request yet; set URL=A and manual=true in both orders in one synchronous segment | No automatic request; initialization Promise, when present, still completes |
| `shell.auto.latest-url` | Auto mode; URL=A→B in one synchronous segment | Zero requests before the microtask; one request for B after evaluation |
| `shell.auto.equal-url` | Rewrite A after its automatic request succeeds/fails | No additional request; distinguish explicit requests |
| `shell.auto.empty-roundtrip` | A already fetched; URL=A→empty→A, within/across boundaries | No automatic resend; a different URL=B starts a request |
| `shell.manual.transition` | Set URL=A with manual=true; finish scheduled work; set only manual=false | Current behavior: zero requests. Confirm semantics against subsequent URL update/reconnect |
| `shell.trigger.explicit` | manual=true, URL=A; repeat trigger=true | Execute each request; false assignment neither executes nor cancels |
| `shell.trigger.empty-url` | trigger=true with empty URL, then set URL and trigger | Initially no request/completion event, initial false retained; subsequent request executes |
| `core.latest.late-settle` | Start A then B; return success/failure in both completion orders | Invalidated A cannot overwrite outputs under the latest contract |
| `shell.lifecycle.disconnect` | Disconnect while auto-fetch is queued/in flight; deliver old callback; reconnect | No start if still queued; cancel if started; no stale commit; same-URL reconnect executes |
| `shell.body.consume` | Start POST with body=A; set body=B before completion | Send A and reset input at start; old completion must not clear B |

For `trigger.explicit`, establish sequential requests first, then separately examine overlapping requests and the order of each `trigger-changed`. Do not assume `trigger` is an aggregate busy flag for all currently valid operations. URL/manual coalescing belongs to the Shell; do not invent Core setters to reproduce it.

### 6.2 Debounce / throttle

For debounce with `wait=100` and no `maxWait`, supply one A at t=0 or A→B at t=0,50. This table shows only `settled`; executable cases also record `pending` and getters.

| leading | trailing | One A | A→B |
|---|---|---|---|
| OFF | OFF | No firing | No firing |
| OFF | ON | A at t=100 | B at t=150 |
| ON | OFF | A at t=0 | A at t=0 |
| ON | ON | A at t=0, once | A at t=0; B at t=150 |

Name these eight cases `debounce.core.edges.*` and run applicable rows through the `source` value path and `trigger(...args)` signal path. Extend in this order:

1. Just before, at, and after `wait`. Split input at the deadline into before-callback and after-callback cases.
2. Equal inputs within one burst and across separate bursts. Do not automatically omit occurrences because input values are equal.
3. Cancel, flush, dispose, and old timer callbacks. Check retention of previously emitted values and absence of duplicate flush output.
4. Changes to leading/trailing/wait while work is pending. If application timing is unspecified, record characterization and resolve the contract before fixing expectations.
5. Continuous input with `maxWait`, mixed `source`/`trigger`, throttle defaults and negated attributes. Do not apply the no-maxWait table unchanged to throttle.

## 7. Tag and binding integration tests

Core tests own processing and events; Shell tests own attribute conversion/reflection, connection, and upgrade; binding tests own initialization, two-way updates, and propagation between nodes. Test layer-specific risks instead of copying every case into all three layers.

The first real-node scenario is: input state → debounce.source → debounce.value → state deriving a URL → fetch.url → fetch.value/loading → state / DOM.

- After initialization, rapid A→B→C input produces exactly one request for the final URL.
- Updates producing the same URL do not cause another automatic request; an explicit command can resend it.
- Fetch response/loading reaches state and DOM without write-back causing another request.
- Unmount while debounce is pending or fetch is in flight; old notifications must not update removed bindings.

Record initialization races before awaiting initial readiness. For ordinary state changes, follow the [state testing recipe](../packages/state/README.md#testing-your-page): await `getBindingsReady(root)` and use `createStateAsync("writable")`. Direct element assignments alone do not test the binder.

[Testing mount/settle](../packages/testing/README.md) can support assertions after stabilization. Cases observing initialization coalescing or in-flight requests should mount in stages and use adapter completion controls. If readiness awaits an automatic fetch, do not await the entire mount before resolving the fake response that it needs.

## 8. Deterministic asynchronous control

- Replace APIs with fakes and control resolve/reject per request A/B. Include a fake that can deliver late completion despite abort, so stale-result rejection is exercised.
- Advance fake clocks to specific deadlines. Avoid unlimited run-all for RAF, retries, or continuous observation.
- Distinguish immediately after synchronous work, after a queued microtask, after a specific Promise reaction, and after callbacks due at a specified time. Arbitrary counts of `await Promise.resolve()` or real-time sleeps are not a universal completion boundary.
- Each adapter defines what a checkpoint awaits. Use public operation Promises and fake callbacks; any finite drain needs a limit, termination condition, and timeout diagnostics.
- Absence of output is a claim up to a finite time/Promise/callback boundary. Inject a late callback after disposal before asserting it is ignored.
- Use a fresh instance per case. Disconnect elements and release resources while fakes remain active, then restore listeners, mocks, clocks, and configuration. Avoid Custom Elements registration collisions.
- Do not run fake-timer/API cases concurrently within the same realm.

Passing in happy-dom does not guarantee browser-specific permission, user activation, real layout, or device behavior. Track those cases separately as browser integration; do not count them as headless passes.

## 9. Placement and CI

Proposed paths, not files that already exist:

```text
packages/fetch/__tests__/patterns/core.test.ts
packages/fetch/__tests__/patterns/shell.test.ts
packages/fetch/__tests__/patterns/cases.ts
packages/fetch/__tests__/patterns/adapter.ts
packages/debounce/__tests__/patterns/...
packages/fetch/__tests__/patterns/binding.test.ts
test-support/io-patterns/recorder.ts   # After both pilots establish a shared shape.
```

Existing Vitest includes discover tests under `__tests__`. Keep initial helpers within each package. When extracting shared code, use `test-support/io-patterns/` as its single source; do not add test-only dependencies to production `io-core` or `src/protocol`. Shared helpers return records without importing Vitest; assertions use each package's Vitest installation. Never directly edit synchronized generated files.

The fetch package owns the real-tag binding pilot. When that work starts, declare state/debounce as local development dependencies and update the lockfile; do not depend on undeclared sibling `node_modules`. If consuming package exports, build state/debounce from source before running tests so stale committed dist cannot produce a misleading pass.

[Current CI](../.github/workflows/ci.yml) mainly selects packages from changes under `packages/<name>/`. In the same change that extracts shared helpers:

- Select all consumer package tests when `test-support/io-patterns/**` changes.
- Select the binding pilot for changes to fetch/state/debounce, binding fixtures, relevant shared protocol/IO-core sources, runner, or CI definitions; install/build its dependencies first.
- Update the consumer inventory and change detection whenever a new tag joins.

A new CI job is not required before the package-local pilots. Include those in ordinary `npm test`, then expand detection when sharing code or integrating packages. Follow existing static validation policy; intentionally invalid HTML/manifests belong in temporary runtime fixtures.

## 10. Phases, deliverables, and completion criteria

| Phase | Work | Completion criteria |
|---|---|---|
| 0: Inventory | Classify fetch/debounce inputs and map cases | Every candidate has a basis, layer, existing/new/unresolved/non-applicable status and reason |
| 1: Unit pilots | Core/Shell cases in §6, package-local recorder | Specification-backed cases pass with event counts, intermediate snapshots, forbidden outputs, and finite boundaries |
| 2: Binding pilot | Real tags and state in §7; initialization, write-back, teardown | Pass against fresh builds; detect extra requests and feedback loops |
| 3: Shared infrastructure | Extract duplicated recorders; map consumers to CI | Helper-only changes run affected tests; unknown steps fail or report unsupported |
| 4: More tags | Expand to representatives of communication, observation, continuous work, managed resources | Per-tag applicability inventories; untested tags are not included in an overall pass |

Each implementation PR runs its case tests and the affected package's ordinary tests, coverage, lint, and build. Shared changes run all consumers; integration changes include dependencies. Do not introduce a root `package.json`.

Local commands after the proposed files exist, from each package directory:

```sh
npx vitest run __tests__/patterns/core.test.ts __tests__/patterns/shell.test.ts
npm test
npm run test:coverage
npm run lint
npm run build
```

Before completing the pilots, verify detection strength: temporarily allow an extra automatic fetch, substitute the first value for debounce's trailing value, or publish an invalidated result, and confirm that the relevant cases fail. Restore each change and rerun against normal code. Do not add runtime test switches.

Reports include `case ID / tag / layer / status / basis / failure checkpoint`. Distinguish pass, fail, unimplemented, unresolved, unsupported, and non-applicable. Present code coverage alongside the case inventory, and show the first difference between expected and actual traces on failure.

The first implementation PR should cover **fetch automatic execution/manual/URL ordering and equality cases, plus debounce's eight base cases**. Establish mappings to existing tests and a recorder that observes forbidden outputs before proceeding to asynchronous races and connections between nodes.
