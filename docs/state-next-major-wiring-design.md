# State next major — wiring separation design (draft)

**日本語**: [state-next-major-wiring-design.ja.md](./state-next-major-wiring-design.ja.md)

Drafted 2026-09-20. Status: **draft, not a decision.** S1 and S2 were implemented the same day (§8-1, uncommitted). It answers the [requirements](./state-next-major-requirements.md) D1 (b) "staged replacement of core / DOM adapter", G2 "cut the feature coupling", B13 "split entries with explicit, idempotent registration", N2 "side-effect-free helper entry" and A2 "base + DOM under 35 KB gzip". The evidence is the [building-block survey](./state-next-major-tech-survey.md), T1 (static coupling) and T7 (stubbed-build remainder and member attribution).

This document breaks "a core that does not statically import features" into receptacles (hooks) in the core and registration by the features. The grammar and the protocols (`data-wcs`, wc-bindable, command-token, event-token, transition-runner) do not change.

## 1. Where things stand (measured)

- 49 value edges from the core into features (survey §3.3): `webComponent` 16, `devtools` 12, `recursion` 8, `components/Ssr` 5, `stream` 3, `watch` 2, `dcc` 2, `scan` 1. Fifteen of them converge on three files: `proxy/methods/getByAddress`, `setByAddress`, `proxy/traps/get`.
- Three places run registration code at module evaluation: `watch/watchRuntime.ts:410`, `stream/streamRuntime.ts:241`, `webComponent/volume.ts:415` (survey §3.2). They are why "importing only `defineState` keeps about 27 KB gzip".
- 54 % of `State.ts` (18.8 KB minified) is members that reference volume / mount / DCC / stream / watch / scan / stateLoader; 55 % of `setByAddress.ts` is functions touching dcc / devtools / webComponent / watch (survey §9.2). `BindingSession.ts` references no feature.
- With every feature cut, the core is still 44 KB gzip (147.6 KB minified). A2's 35 KB needs about 30 KB minified removed; extracting the wiring as designed here yields 10–13 KB (survey §9.2).

## 2. Principles

1. **The core knows no feature.** It owns receptacles only; with none registered, the hot path pays one "array length is 0" check (the D18 pattern already used by `hasMounts === true` / `hasRecursion === true`).
2. **Registration is explicit and idempotent.** A feature module exports `install(registry)` and does nothing at evaluation. The full / auto entries call every `install`, so existing users see nothing. Users of the split entries install what they need. Installing the same feature twice equals once.
3. **Missing features are never silently ignored.** If a declaration (`$watch` / `$scan` / `$streams` / `**` / `mount=` / DCC) needs a feature that is not installed, initialisation throws (the readiness barrier of requirements §10).
4. **The core owns the ordering contract.** The order inside a drain (render hook → scan → watch → streams restart) is defined by priority constants in the core; features register with those constants.
5. **One core chunk.** Split entries never re-bundle the core; they share one core chunk (requirements B13). A second load from a different URL is detected and warned.

## 3. Receptacles

| # | Receptacle | Edges / members it replaces | When it is called | When empty |
|---|---|---|---|---|
| H1 | **Read/write boundary hook**: `registerAddressHook({ read, write, get })` | `getByAddress` → volumeShared / mount / overlay / exportIndex / argsTrace / streamNamespace; `setByAddress` → volumeShared / exportIndex / overlay / dispatchBindableEvent; `traps/get` → mount / streamNamespace / recursion expand & bind (27 edges) | At the top of `getByAddress` / `setByAddress` / the get trap, hooks run in registration order; the first non-`NOT_HANDLED` result wins | One length check, then the ordinary path |
| H2 | **Drain listener**: the existing `registerUpdateBatchListener(listener, priority)` | `watchRuntime.ts:410`, `streamRuntime.ts:241`, `updater` → scan's eventReset / watch's chainDepth | At the end of a drain, as today. **The call moves from module evaluation into `install()`** | No listeners |
| H3 | **Lifecycle hook**: `registerLifecycle({ onDeclarations, onConnected, onDisconnected, onStateReplaced, onInitializeFailed })` | `State.connectedCallback` (starting stream / watch), `disconnectedCallback` (stopping), `_initializeBindWebComponent`, `_initializeVolume`, `_acquireVolumeSlot`, `_releaseVolumeSlot`, `mergeVolumeListKeys`, `addVolumeWatchPaths`, `_failInitializeLoudly`, `reportVolumeWithoutRoot`, `_initializeDCC`, `_loadStateFromSource` (about 10 KB minified) | In each `State` lifecycle step, hooks run in registration order | No hooks; a `mount=` / DCC / `src=` attribute raises H5 |
| H4 | **Declaration hook**: `registerDeclaration(key, handler)` | The `_state` setter's interpretation of `$watch` `$scan` `$streams` `$commandTokens` `$eventTokens` `**` (1.2 KB) | The reserved keys of the state object are scanned and handed to their handlers | A reserved key without a handler raises H5 |
| H5 | **Readiness barrier** | (new) | In H3 / H4, a required but uninstalled feature throws `[wcs/feature-not-installed] "$streams" needs @wcstack/state/features/temporal` | — |
| H6 | **Devtools sink** | The 12 imports of `devtools/sink` from the core | The core owns `let devtoolsSink = null` and `setDevtoolsSink()`; the devtools module imports the core and sets it (dependency inverted) | One `null` check |
| H7 | **Volume graft handler** | `setVolumeGraftHandler(graftIsolated)` at `volume.ts:415` | The existing registration API. **The call moves from module evaluation into `install()`** | No handler |
| H8 | **SSR / hydrate hook** | `exports` / `hydrateBindings` / `buildSsrDocument` / `registerComponents` → `Ssr.ts`, and `Ssr` inside the apply / bindings cycle | The core keeps only an `ssrMode` flag and the hydration receptacle; the `Ssr` module registers | No receptacle |

H1 return contract: `read(stateElement, address, receiver) → { handled: true, value } | NOT_HANDLED`, `write(stateElement, address, value, receiver) → { handled: true, result } | NOT_HANDLED`. Hooks are ordered by registration; the first `handled` wins. Features install in the current branch priority (`hasGraftedVolumes` → `hasMounts` → `hasRecursion` → ordinary).

**Where the hooks live (settled by survey §10.8)**: the receptacle alone is free, but installed hooks kept in a global array and scanned on every call cost +17 ns per read (+40 %) and +15 ns per write even in a state that uses none of them, 3–4 % of a 10,000-row selection, above §7-4's 1 %. Hooks are therefore **attached per state element at declaration time** (the `_state` setter looks at the reserved keys, `mount=` and `**` and lines up only the hooks that state requires). A state without features leaves through one boolean check as with today's D18 (measured +0.1 ns), and `install` only places hooks in a registry without touching the hot path.

## 4. Entries (proposal)

| Entry | Content | Compatibility |
|---|---|---|
| `@wcstack/state` | Core with every feature installed. Same public API as today | unchanged |
| `@wcstack/state/auto` | The same plus the bootstrap. Self-contained, SRI contract ([sri](./sri.md)) as today | unchanged |
| `@wcstack/state/core` | Core (proxy, address, dependency, updater, bindings, apply, structural, event, list, bindTextParser, the skeleton of `State`). No features | new |
| `@wcstack/state/features/temporal` | `install` for watch / scan / streams | new |
| `@wcstack/state/features/scopes` | `install` for volume / mount / overlay / DCC | new |
| `@wcstack/state/features/recursion` | `install` for `**` | new |
| `@wcstack/state/features/ssr` | `install` for `Ssr` / hydrate | new |
| `@wcstack/state/features/devtools` | sets the sink | new |
| `@wcstack/state/features/formats` | registers the formatting filters (implemented, §8-13; filter functions are resolved at binding-plan time) | new |
| `@wcstack/state/define` | `defineState` and types only; zero value imports (survey §3.1) | new (N2) |

Usage (split):

```js
import { bootstrapState, installFeatures } from "@wcstack/state/core";
import temporal from "@wcstack/state/features/temporal";
import scopes from "@wcstack/state/features/scopes";
installFeatures([temporal, scopes]);   // idempotent
await bootstrapState();
```

Buildless users pin `@wcstack/state/core` and `features/*` to one CDN version in the import map. Rollup produces one core chunk with multi-entry plus `manualChunks`; `features/*` import that chunk (CI forbids re-bundling the core: source-map attribution checks that no `features/*` output contains `proxy/` code).

## 5. Size estimate (from survey T7)

| Stage | Expected core, minified | Basis |
|---|---:|---|
| Today (upper bound with features stubbed) | 147.6 KB (44.0 KB gzip) | survey §9 |
| H1–H8: wiring moved to the features | 135–138 KB (about 40–41 KB gzip) | `State.ts` wiring 10 KB, `setByAddress` and other branches 1–3 KB (§9.2) |
| + diagnostic text into a dev build | 130–133 KB | `pathDiagnostics` 3.6 KB, `reportVolumeWithoutRoot` 0.7 KB, `warnDefaultGetterMismatch` 0.7 KB |
| + wc-bindable contract analysis into the adapter | 123–126 KB | `contractAnalyzer`, `wcBindableReader`, `expandSpread`, `protocol`, about 7 KB |
| + one path in `BindingSession` | 120–124 KB (about 36–37 KB gzip) | plan path 2.0 KB against general path 4.9 KB |

A2's 35 KB (about 117 KB minified) is the level reached, if at all, only with all four stages stacked. This design alone (H1–H8) does not get there. Folding the row record (survey §10.2) helps time and memory more than size. **Corrected by measurement (2026-09-21)**: the second stage (extracting the wiring) did not shrink the core (§8-11), and the fourth (unifying `BindingSession`) lost its premise after R2 and R3 ([row runtime design](./state-next-major-runtime-design.md) §6-1). The third stage's contract analyzer is already absent from the core.

## 6. Compatibility and contracts

- **The surface is unchanged**: HTML grammar, declaration keys, `$` API, protocols. The public face of `@wcstack/state` and `/auto` is unchanged.
- **The ordering contract is written down**: the priority of drain listeners (render → scan → watch → streams restart) and exception isolation become a documented core contract (requirements §10).
- **Readiness**: using a declaration without its feature installed throws at initialisation on the split entries; never on `auto`.
- **Double instances**: the core chunk shares one registry under `Symbol.for("wcstack.state.core")`; a second copy from another URL warns.
- **SRI**: the single-file contract of full / auto stays. The split form covers each chunk with the import map's `integrity` (all three engines, survey §7).

## 7. Verification

1. **Static**: run the survey's [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) in CI and pin zero value edges from the `core` entry into `watch` / `scan` / `stream` / `recursion` / `webComponent` / `dcc` / `devtools` / `components/Ssr`, and zero evaluation-time registrations.
2. **Size**: add `core` and `full` gzip thresholds to the N3 size CI.
3. **Behaviour**: the existing 3,650 tests stay green on the `full` entry. Add tests for the explicit error when a declaration is used on `core` alone, and for `install` idempotence.
4. **Performance**: measure with the audit's benchmark and the survey's counters (T6) what the added hook check costs on the hot paths (get trap, `getByAddress`, `setByAddress`). One length check per call; the target is under 1 % on a 10,000-row selection change (30,003 get traps).

## 8. Stages

| Stage | Content | Ships in | Behaviour change |
|---|---|---|---|
| S1 | H6, invert the devtools sink dependency (12 edges) | 2.6.x (implemented, §8-1) | none |
| S2 | Move the H2 / H7 registration calls from evaluation into `install()`; full / auto call them | 2.6.x (implemented, §8-1) | none (ordering contract documented) |
| S3 | H1 read/write boundary hook (27 edges) | 3.0 (implemented, §8-2) | none (one check on the hot path) |
| S4 | H3 / H4 lifecycle and declaration hooks, H5 readiness barrier | 3.0 (implemented, §8-3 to §8-8) | split entries only (uninstalled throws) |
| S5 | H8 SSR separation, entry split, single core chunk, CI | 3.0 (implemented, §8-9 to §8-12) | new entries only |

S1 and S2 can ship early without breaking anything (the same column as N1–N3 in requirements §4). S3 onwards ride the major. **S3 to S5 were ported into `packages/state` on 2026-09-21** (§8-12, uncommitted); what is left is `features/formats`, which waits for D16's filter registry.

### 8-1. Implementation record for S1 and S2 (2026-09-20, uncommitted)

Measurements are in survey §10.5.

- **S1**: `devtools/sink.ts` → `platform/devtoolsSink.ts` (`git mv`). `devtools/bridge.ts` now imports the core side; core → `devtools` edges 12 → 1 (`bootstrapState.ts → devtools/bridge.ts`, an entry edge that moves to `features/devtools` in 3.0).
- **S2**: `bootstrapState()` calls `installWatchRuntime()` / `installStreamRuntime()` / `installVolumeGraft()` (all idempotent) before `registerComponents()`. **Departure from the draft**: the features' first-use points (`startWatch`, `startStreams`, the queue path of `graftOrQueueVolume`) call the same `install` too, as a guard for code that defines the elements without `bootstrapState()` (the tests do); it goes away once H5's readiness barrier exists. Installing from Vitest's `setupFiles` was not an option: the setup file evaluates the real module graph first and disables each test's `vi.mock` (267 failures).
- Result: 3,650 tests pass, coverage within thresholds. Modules running code at evaluation 11 → 8, core → feature edges 49 → 41. Re-exporting only `defineState` leaves 1.9 KB gzip after tree-shaking instead of 26.7 KB (requirements G2 and N2 are met at this stage).
- **The CI of §7-1**: `audit-state-tech-coupling.mjs --check` with the baseline [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) runs in `ci.yml`'s state job. The baseline is "the modules allowed to run code at evaluation, at most 41 core → feature edges, `defineState.ts` reaching 1 module"; §7-1's "zero edges" is tightened as S3–S5 land.
- **Same-day addendum (PURE annotations)**: the eight remaining evaluation-time call initialisers (the `updater` singleton, the four event registries, `createNotFilter()`, `createEmptySet()`, `new RegExp`) are annotated `/*#__PURE__*/`; the only module running code at evaluation is now `auto.ts` (the baseline is tightened to `["auto.ts"]`). Re-exporting only `defineState` leaves 309 bytes gzip (survey §10.5 addendum). §7-1's "zero evaluation-time registrations" is reached.

### 8-2. The shape of S3 (proposal, not started)

The concrete form of S3 after survey §10.8 (hooks in a global array cost 3–4 %, a per-state gate costs nothing). Not implemented; two points need the designer's decision.

- **Where the hooks live**: the `State` element carries `addressHooks: { read: ReadHook[]; write: WriteHook[]; get: GetHook[] } | null`; the `_state` setter reads the declarations (reserved keys, the `mount=` attribute, `**`, DCC) and lines up, from the registry, only the hooks of the features this state requires. The hot path leaves through one `stateElement.addressHooks === null` check (the cost of today's `hasMounts === true`, measured +0.1 ns). `install()` only puts implementations into the registry (feature name → hooks) and never touches the hot path.
- **Moving the 27 edges**: the branches of `getByAddress` / `setByAddress` / the get trap move one to one into per-feature hook modules (`features/scopes/addressHooks.ts` = volume / mount / overlay / export, `features/temporal/addressHooks.ts` = the stream namespaces and argsTrace, `features/recursion/addressHooks.ts` = materialize / bind). The **order** of the branches stays as today (volume → mount → recursion → ordinary), fixed by the registry's registration order.
- **Undecided**: (1) the API that attaches hooks at declaration time (automatic in the `_state` setter, or explicit through an `installFeatures` argument). The former only needs the declaration, but requests that live outside it (the `mount=` attribute, DCC) then need a second pass in `connectedCallback`. (2) When the "no hook present" diagnostic (the readiness barrier, H5) fires, as for devtools (H6).
- **Verification**: all 3,650 tests green on the full entry; reads within +1 ns in the survey's [audit-state-tech-hookcost.mjs](../scripts/audit-state-tech-hookcost.mjs); core → feature edges 41 → 14 in [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) (the 27 disappear).

**Implementation record of the first slice (2026-09-21, stream, sandbox)**: after decisions D12 / D13, [s3StreamSlicePatch.mjs](../scripts/research/s3StreamSlicePatch.mjs) applied the shape above to the stream feature.

- `core/addressHooks.ts`: a registry feature name → hook implementation (`registerFeatureHooks`, called by install), the per-state hook bundle (`IAttachedHooks`), and `requireFeature` (throws by declaration name when the feature is not installed, D13).
- `State`: an `addressHooks` property and `attachAddressHooks(feature, declaration)`. The `_state` setter attaches after `installStreamRuntime()` when it finds `$streams` (in the full entry State still imports the stream runtime statically, so the barrier can only fire on a split entry once H3 is extracted). Hooks stay attached for the element's lifetime (when a re-set drops `$streams`, the remaining `$streamStatus` / `$streamError` bindings read the namespace's null, as before).
- `stream/addressHooks.ts`: `getByAddress`'s `collectStreamDependency` and its `$streamStatus` / `$streamError` namespace branches, and the get trap's two cases, moved into read / get hooks; `installStreamRuntime()` puts them into the registry.
- The receptacles in the core: `getByAddress` (after `checkDependency` and the recursion materialisation), the top of `setByAddressCore` and the top of the get trap's string-property path look at `stateElement.addressHooks` and leave through one check when it is null.
- Result: all 3,668 tests pass (one test-side adaptation: the `stream.argsTrace` mock state element attaches the hooks). Core → feature edges 41 → **38** (the three hot-path core → stream edges are gone; only the entry edge `bootstrapState → streamRuntime` remains). The read micro-benchmark reads base 43.6 / slice 45.6 ns (minima 43.4 / 42.2), within sample noise.
**Implementation record of the second slice (recursion, dcc, watch; [s3FeatureSlicePatch.mjs](../scripts/research/s3FeatureSlicePatch.mjs)) and the third (scopes = mounts and volumes; [s3ScopesSlicePatch.mjs](../scripts/research/s3ScopesSlicePatch.mjs)) (2026-09-21, same sandbox)**: the remaining 24 edges moved the same way; core → feature edges 38 → 27 → **14**, exactly the design's target (the 14 that remain = the 4 entry edges of `bootstrapState`, 4 SSR, 1 `registerComponents → State`, 3 on the apply side, 2 drain listeners of the `updater`). All 3,668 tests pass after each slice.

- **One kind of receptacle was not enough.** A single "take over at the top" point cannot move the 27 edges one to one; the core ended up with 12 call points (the table in `core/addressHooks.ts`): `read` (top of getByAddress, before the cache), `readMissing` (the tree lacks the key; null parent when there is no parent), `write` (top of setByAddress), `writeMissing` (the fast path finds no key on the parent; writes to public getters), `writeObserve` (the old value is known), `written` (after a write or `$postUpdate`), `swapped` (a row moved in an element swap), `get` (top of the get trap's string-property path, now also given `target`), `indexShift` (the `$n` shift), `handlerScope` (the arity of a handler's indexes), `updated` (after `$updatedCallback`), `suppressPathDiagnostic` (binding-time diagnostic suppression). Every one leaves through a single null check of `addressHooks` on a state without hooks. Only two receptacles are not per state (the resolver in `list/loopContextByNode` that hops from a mounted ShadowRoot to its host, and the registration listeners of `stateElementByName`), and both run once at a boundary.
- **When hooks attach** (D12 made concrete): `$recursion`, `$watch` / `$scan` (including a volume's merged watch paths) and `$streams` in the `_state` setter; `$bindables` when the element becomes a DCC's binding target (`setBindableEventMap`); mounts when a record is registered (`markHasMounts`); volumes at slot reservation and grafting (`markHasVolume` / `markHasGraftedVolumes`). A volume reserved before its root registers is attached by the root-registration listener that `installVolumeGraft` wires.
- **Hooks stay attached for the element's lifetime**, so a feature whose declaration can vanish on a re-set (recursion) checks `hasRecursion` at the top of its hooks and falls back to the core's path. `$trackDependency`'s rejection of `**` applies whether or not the feature is declared, so it stays in the core (one line on `define`'s constant). So that a throwing write hook on a public getter never pins the assigned value in the cache, the core sets the flag before calling the hook (fixed by E10).
- **Four test-side adaptations** (mock state elements that expect a feature's behaviour attach its hooks: `stream.argsTrace`, the DCC cases of `proxy.setByAddress`, the volume case of `proxy.apis.updatedCallback`, and the `integration.volumeMount` test that reserves a slot directly on the ledger). The eight moved branches the integration suite no longer reaches (the readiness barrier's throw, idempotent installs, the recursion hook passing through after a re-set, the scopes hooks passing through on a state they do not apply to, `written` after `$postUpdate`) are pinned by the boundary test `core.addressHooks.test.ts`. Coverage is 99.62 / 98.6 / 100 / 99.8 (3,676 tests, within thresholds); besides the repo's pre-existing gaps only four branches of the scopes hooks remain (the `$n` shift on a state without mounts, the diagnostic while disconnected), to be added to the boundary test when this lands in the product.
- **Read cost** ([hook-cost-micro-s3slice2.json](research/state-next/hook-cost-micro-s3slice2.json), [hook-cost-micro-s3slice3.json](research/state-next/hook-cost-micro-s3slice3.json)): slice 2 reads base 42.5 / 41.3 ns (minima 41.8 / 40.3), writes 44 / 41 ns, within sample noise (a state without features no longer pays the DCC map lookups and the recursion check on writes). Slice 3 (all three slices together) reads the same: base 43.1 / 41.5 ns (minima 41.8 / 40.3), writes 44 / 41 ns. §7-4's "reads within +1 %" holds.
- **Size (a new decision point, requirements D19)**: with all three slices the full `auto.min.js` is 71.6 KB gzip, **+1.3 KB (+1.9 %)** over the same working tree without them (70.3 KB, which already carries N6 and the clear patches). That crosses the +3 % gate over the release baseline of 68.7 KB (70.8 KB). It is the 12 receptacle loops plus the glue of the four feature hook modules; on the split entries it works towards a thinner core, but on the full bundle it is a net increase. Rollup's circular-dependency warnings are the same two as before (through `stateElementByName`), none added.

### 8-3. Implementation record of S4's first slice (2026-09-21, volumes, sandbox)

H3 (lifecycle hooks) and H5 (the readiness barrier) applied to the volume (`mount=`) feature first ([s4VolumeLifecyclePatch.mjs](../scripts/research/s4VolumeLifecyclePatch.mjs), stacked on S3's three slices).

- **Four receptacles** (`core/lifecycleHooks.ts`): `connecting` (claim the connect), `reconnecting` (claim the re-connect of an initialized element), `disconnecting` (claim the disconnect), `replacingState` (refuse a state replacement). They are asked in ascending `order`, not registration order, which pins the previous branch order (DCC 10 → volume 20 → bind-component 30) as a number.
- **`connecting` returns null for "not mine"**, and the promise of the initialization it now owns only when it claims. A plain state with no claimant (the vast majority) therefore gains no microtask boundary. This came out of the implementation: `Promise<boolean>` would put one await into every element's connect.
- **The element's internal surface is five members**: `connectedRootNode`, `clearConnectedRootNode`, `markInitialized`, `settleInitialization`, `loadStateFromSource`. The volume's five private fields became a per-element ledger (a WeakMap) in the feature, and `State` no longer has the concept of a volume.
- **The readiness barrier** (H5 / D13): a `mount=` element nobody claims means the scopes feature is not installed, and it throws by the attribute's name. On full / auto `bootstrapState()` installs it, so it never fires.
- **Result**: all 3,676 tests pass (two test-side adaptations: tests that drove the private `_initializeVolume` directly now call the hook's `connecting`). `State.ts` goes 1,683 → **1,542 lines** (−141). `auto.min.js` grows 0.4 KB gzip (71.6 → 72.0 KB, inside D19's accepted margin).
- **Remaining**: `State.ts` still has 24 feature imports (bind-component / mounts 12, stream 4, watch 4, recursion 3, dcc 2). The split entries (S5) only stop dragging the features into `core` once those move to the same receptacles.

### 8-4. Implementation record of S4's second slice (2026-09-21, declaration hooks, sandbox)

H4 (declaration hooks) applied to temporal's `$streams` and `$watch` ([s4TemporalDeclarationPatch.mjs](../scripts/research/s4TemporalDeclarationPatch.mjs)).

- **"Walk the reserved keys and hand each to its handler" was not available.** The `_state` setter is the most order-sensitive code in the package: which validation runs before the generation bump and which after is itself pinned by tests (`integration.stateGenerationReset.test.ts`). The receptacle became a set of **phases** (`core/declarationHooks.ts`): `apply` (after the new `getterPaths` / `setterPaths` are collected, which `$streams`'s collision check reads), `register` (after `_rebuildPathInfo` and `$scan`'s registration), `activate` (a re-set while connected, and the tail of a connect) and `deactivate` (disconnect). A feature implements only the phases it needs, and the core calls each one where its branch used to be.
- **`deactivate` is asked in descending order.** With `apply` / `register` / `activate` ascending and teardown reversed, "watch is enabled before streams and torn down after them" — previously written into `State` — holds through two numbers (watch 10, streams 20).
- **The start-up guards moved to the features.** Detachment during `$connectedCallback`'s await, the generation match for "disconnect then immediately reconnect", the SSR exclusion and `$streams`'s double-start guard all left the core's `if`s for stream's and watch's `activate`. The core passes only the generation it captured for that connect, or null for a start from the declaration side. `_streamsStartedGeneration` went from a private field of `State` to a per-element ledger in the stream feature.
- **`$scan` deliberately stays in the core in this slice** (the next one moved it — §8-5).
- **Result**: all 3,676 tests pass on the first run (no test-side adaptations). `State.ts` goes 1,683 → **1,464 lines** (−219 across S4's two slices). `auto.min.js` is 72.4 KB gzip (+2.1 KB over the working tree, inside what D19 (a) accepts). Rollup's circular-dependency warnings are the same two as before, none added.
- **The five scripts reproduce the same tree when applied in order** (S3's three, then S4's two), verified by replaying them onto a fresh copy: not one byte differs from the sandbox.

### 8-5. Implementation record of S4's third slice (2026-09-21, the context bag, sandbox)

The question §8-4 left open — `$scan` validates before the generation bump and needs values other declarations produce — is answered by a **context bag** on the receptacle ([s4ScanContextPatch.mjs](../scripts/research/s4ScanContextPatch.mjs)).

- **The context bag** (`IDeclarationContext`) is a small hand-off that lives for one `_state` set. The core publishes what it computed (`$eventTokens`'s names, the recursion registry) and `$scan`'s validation reads it; the parsed entries go into the bag too and travel validate → applyEarly → register. Features pass values without importing one another, so a declaration's dependencies are expressed by `order` and the bag alone.
- **Two more phases**: `validate` (before the generation bump, reading only `value`, so a re-set that throws there does not advance the generation) and `applyEarly` (right after the `__state` swap and before `$on` is wired — `$scan`'s outputs must be materialized before `_rebuildPathInfo` and its subscriptions before `$on`, D11). Declarations now have six phases: validate → applyEarly → apply → register → activate → deactivate.
- **`order` also fixes the register sequence**: scan 8 < watch 10, so `$scan`'s dependency registration still precedes `$watch`'s, which is what puts a scan-only state on the drain's firing list.
- **Result**: all 3,676 tests pass. `State.ts` is 1,463 lines. Core → feature edges go 14 → **15**, because `bootstrapState` gained one install edge for scan. That is an entry edge of the kind the design accepts (5 of the 15 are installs), and `installFeatures([...])` takes them over in the split form. `auto.min.js` is 72.6 KB gzip.
- **The six scripts reproduce the same tree when applied in order** (verified by replaying onto a fresh copy).

### 8-6. Implementation record of S4's fourth slice (2026-09-21, bind-component and mounts, sandbox)

The largest block of the element's wiring (`_initializeBindWebComponent`, ~190 lines, plus the connect, reconnect and disconnect branches) moved into the feature ([s4BindComponentPatch.mjs](../scripts/research/s4BindComponentPatch.mjs)).

- **The "claim or don't" shape did not fit.** `bind-component`'s initialization *always* runs on such an element and only short-circuits the rest of the connect (building an independent tree) *when it built a mount scope*. The first slice's `connecting` (a promise when it claims, null otherwise) cannot express that, so the receptacle gained a `preparing` phase: "do your pre-initialization work, and say whether you have **fully taken over** this element".
- **The 190 lines were not retyped; the script extracts them from `State.ts` and rewrites them.** Only the `this.` references are mapped onto the feature's ledger and the element's internal surface, and the script fails if a single `this.` survives. The move reads as a reviewable diff and cannot silently drop a line.
- **One subtle behaviour trap, caught by the tests.** There used always to be an `await this._initializeBindWebComponent()` at this point, even for a plain state, which put one microtask boundary in the sequence. "Optimising" that await away when nothing prepares made paths that depend on the boundary time out (two tests, inline-script loading). A connect happens once per element, so the await costs nothing and **always awaiting** is correct. `connecting` (the first slice) was a synchronous attribute check before, so returning null there stays right — each phase matches the shape it replaced.
- **Result**: all 3,676 tests pass (18 test-side adaptations across three files: calls that drove the private method now go through the hook's `preparing`). `State.ts` goes 1,683 → **1,277 lines** (−406 across S4's four slices). Feature imports go 24 → **7** (recursion 3, DCC 2, two scopes installs). `auto.min.js` is 72.7 KB gzip and rollup's circular warnings stay at two.

### 8-7. Implementation record of S4's fifth and sixth slices (2026-09-21, `$recursion` and the last imports, sandbox)

The last declaration, `$recursion`, and the thin imports still on `State.ts` ([s4RecursionDeclarationPatch.mjs](../scripts/research/s4RecursionDeclarationPatch.mjs), [s4TrimStateImportsPatch.mjs](../scripts/research/s4TrimStateImportsPatch.mjs)).

- **The context bag became a hand-off between features.** `$recursion` puts the registry it built into the bag and `$scan`'s validation reads it, so the core no longer knows that one declaration feeds another; all it publishes is `previousState` and the token names.
- **Two more phases, eight in total**: `validateEarly` (before the core's own token / `$listKeys` parsing, where `$recursion` always was) and `preCommit` (every validation done, the generation not yet bumped — the old generation's cleanup and the swap). The choice was "name the point that already existed" over "assume the order does not matter": the order contract is pinned by tests and collapsing it on a guess breaks it.
- **`installScopeHooks()` / `installDccHooks()` left the element.** Installing a feature is the entry's job (`bootstrapState()`) or the feature's own (DCC installs where it binds), not a belt-and-braces call from the element. That let the readiness barrier work as intended, and one unit test that drives `setBindableEventMap` directly instead of through `defineDCC` failed — **the barrier firing correctly** — so the test installs the feature itself, exactly as a split entry's page would.
- **`RecursionRegistry` is now a type-only import**, so it is no longer a value edge.
- **Result**: all 3,676 tests pass. `State.ts` goes 1,683 → **1,252 lines** (−431 across S4's six slices). Feature imports go 24 → **3** (one of them type-only). The two value imports left are DCC's `defineDCC` and the failed-root landing (`clearFailedRootNode` / `failPendingVolumes`), each of which needs a receptacle of its own.
- **Core → feature edges are 16**: 6 installs, 4 SSR (S5's H8), 3 on the apply side, 2 drain listeners and `registerComponents → State`. **Not one read, write or connect hot-path edge remains.** The install edges are what `installFeatures([...])` takes over in the split form.


**Seventh slice (2026-09-21, the failed-root landing)**: telling the volumes that wait on a root that it failed to initialize, and clearing the mark when the failed element itself leaves the DOM, were the last two calls from `State` into a feature ([s4FailedRootPatch.mjs](../scripts/research/s4FailedRootPatch.mjs)). Two receptacles, `initializeFailed` and `initializeFailureCleared`, replace them and the core keeps only what is its own (`markBindingsUnavailable`). All 3,676 tests pass. **`State.ts` is down to two feature imports — the type-only `RecursionRegistry` and DCC's `defineDCC` — so exactly one value import remains.**

### 8-8. Implementation record of S4's eighth slice (2026-09-21, the DCC connect, sandbox)

The last value import on `State.ts`, DCC's `defineDCC`, is gone ([s4DccLifecyclePatch.mjs](../scripts/research/s4DccLifecyclePatch.mjs)).

- **The first slice's `connecting` fitted as is.** A `<wcs-state>` inside a `[data-wc-definition]` host builds no tree of its own: it loads its source, defines the host's custom element from the template, and is done — exactly "claim this connect, or return null". It sits at order 10, ahead of the volume (20) and bind-component (30), which keeps the old branch order by number. The branch and `_initializeDCC` moved to `dcc/dccLifecycle.ts`.
- **Two members joined the element's internal surface**: `failInitializeLoudly` (a DCC load failure lands like `_initialize`'s — #257 — while a volume's does not, so wrapping the core's `await claimed` in that landing was not an option) and `markTreeless` (the old `_dcc` flag, which the reconnect branch reads so that it does not re-register the element as the root node's tree). The latter is a core notion — "initialized without a tree of its own" — so the flag stays on `State` as `_treeless`, and DCC is its first user.
- **The readiness barrier gained the DCC form** (same place and order as `mount=`): an unclaimed `<wcs-state>` inside a `[data-wc-definition]` host fails with `a <wcs-state> inside a [data-wc-definition] host needs the "dcc" feature`. `bootstrapState()` calls `installDccLifecycle()`, so it never fires on full / auto. The boundary test `core.lifecycleHooks.test.ts` (4 tests) pins both barriers and the `order` contract (ascending, not install order; re-registering a name replaces it). The `mount=` barrier had no test until now.
- **Two leftovers from earlier slices were picked up**: `isLifecycleFeatureRegistered` / `isDeclarationFeatureRegistered`, which nothing called (the only two functions keeping coverage below 100 %), are removed, and the first slice's `CLAIMED = Promise.resolve()` gets `/*#__PURE__*/`. The latter is a call at module evaluation, which the CI coupling gate (only `auto.ts` may run code at evaluation) would reject on the port.
- **Result**: all 3,680 tests pass. The only test-side change is one install line in `dcc.State.test.ts` (a unit test that skips `bootstrapState()`, so it installs the feature itself, as a split entry's page would). Coverage 99.61 / 98.51 / 100 / 99.8, within thresholds. `State.ts` goes 1,252 → **1,220 lines** (−463 across S4's eight slices) and its feature imports 24 → **1, the type-only `RecursionRegistry`: no value import is left**. SSR (`Ssr`) stays outside the count as before and is cut by S5's H8. Core → feature edges go 16 → 17 (one more install edge, `bootstrapState → dcc/dccLifecycle`, making 7 install edges, which `installFeatures([...])` takes over in the split form). The coupling gate (`--check`) passes on the sandbox (only `auto.ts` runs code at evaluation). `auto.min.js` goes 72,850 → 73,024 B gzip (+174 B); rollup's circular warnings stay at 2.
- **The eleven scripts, applied in order, reproduce the same tree** (replayed onto a fresh copy of the repository's `packages/state`: src and tests match the sandbox byte for byte).

### 8-9. Implementation record of S5's first slice (2026-09-21, the edges that are neither install nor SSR, sandbox)

Of the 17 core → feature edges left after S4, the five that are neither an install (7), nor SSR (4), nor `registerComponents → State` (1) moved behind receptacles ([s5CoreEdgesPatch.mjs](../scripts/research/s5CoreEdgesPatch.mjs)). They needed three receptacles that the table in §3 did not have.

- **Enqueue listeners** (the enqueue side of H2): on every write's enqueue, `updater` called the `$watch` chain counter (`watch/chainDepth`) and the `on` scan's pending reset (`scan/eventReset`) directly. `registerEnqueueListener` is new, and the watch and scan installs register with it. The two are independent, so unlike drain listeners they carry no priority. With neither installed, an enqueue costs one length-0 check.
- **A receptacle for custom-element property bindings** (`core/componentApplyHooks.ts`): `apply` read bind-component's two ledgers directly (completed / declared in `completeWebComponent`, the pre-completion write memos in `preCompletionWrites`). They are now behind one receptacle, which the bind-component install (`installBindComponentLifecycle`) fills. When it is empty, a property binding on a custom element is a plain property write and nothing is recorded: the memos' only readers live inside bind-component, so recording them would be wasted. The implementation sits in a light module that depends on the two ledgers only (`webComponent/componentApply.ts`), so that a unit test can put the receptacle in place without evaluating the heavy lifecycle module.
- **`rowReused`, the 13th per-state hook kind**: a row reused in place never leaves the DOM, so no `connectedCallback` arrives for it. Re-mounting the scopes inside such a row moved into the scopes hooks. A state with neither mounts nor volumes has no hooks and leaves on the null check. Scopes hooks are also attached to volume-only states, so the hook itself still leaves when there is no mount, as before (boundary test `webComponent.rowReused.test.ts`).
- **Found on the way: `bind-component` had no readiness barrier.** With the scopes feature missing, `preparing` had no taker and returned null, and the attribute was silently ignored: the element became a plain state (a path that exists only in split entries). It now fails by name. It sits inside the same try as bind-component's other configuration errors, so it lands per #257 (it rejects `connectedCallbackPromise` and emits one diagnostic).
- **Result**: all 3,687 tests pass. The test-side change is one line in each of three files that puts the receptacle in place, plus 7 new boundary tests. Coverage 99.61 / 98.51 / 100 / 99.8, within thresholds. Core → feature edges go 17 → **12** (7 installs, 4 SSR, `registerComponents → State`). `auto.min.js` goes 73,024 → 73,036 B gzip (+12 B); rollup's circular warnings stay at 2. The twelve scripts, applied in order, reproduce the same tree.
- **Not measured**: the enqueue change replaces "call the same two functions directly" with "loop over the same two functions", which the existing read/write micro-benchmark cannot see (a same-value write returns before the enqueue). In the split core the array is empty, which saves two calls per write.

### 8-10. Implementation record of S5's second slice (2026-09-21, separating SSR = H8, sandbox)

SSR left the core ([s5SsrSplitPatch.mjs](../scripts/research/s5SsrSplitPatch.mjs)): the ~960 lines of `components/Ssr.ts`, `hydrateBindings.ts` and `buildSsrDocument.ts` moved to `src/ssr/`, and the core kept only what is its own.

- **The core keeps SSR's *mode***: `inSsr()`, the `@@wcs-*` comments the apply side writes, `ssrPropertyStore`. H8 leaves that there deliberately — it is a manner of rendering, not a module dependency. What crosses to the feature are the three points the `enable-ssr` attribute reaches, folded into one receptacle (`core/ssrHooks.ts`): `hydrate` (root registration), `loadState` (reading the `<wcs-ssr>` data at the top of `_initialize`) and `emitSnapshot` (the server writing `<wcs-ssr>` once the bindings are ready).
- **A feature's tag is registered as a definer**: `registerComponents` defines `<wcs-state>` only, and a feature leaves its tag with `registerComponentDefiner`. Definers run **before** the state tag — the `<wcs-ssr>` of an SSR page is read by a state element's connect, so if the state ran first against a non-upgraded element there would be no `stateData`. (The old code defined `Ssr` before `State` for the same reason; the order is now part of the receptacle's contract.)
- **Readiness barrier**: declaring `enable-ssr` without the SSR feature fails by name (`the "enable-ssr" attribute needs the "ssr" feature`). `_loadFromSsrElement` runs inside `_initialize`, so it lands per #257.
- **Result**: all 3,692 tests pass (two test-side changes: one more export on a `registerComponents` mock, and a test that expects `<wcs-ssr>` now calls `installSsr()`; boundary tests `core.ssrHooks.test.ts` with 3 cases plus 2 for the definer). Coverage 99.61 / 98.52 / 100 / 99.8, within thresholds. Core → feature edges go 12 → **10, and every one of them is an entry edge** (`bootstrapState`'s 8 installs, `exports → ssr/Ssr`, `registerComponents → components/State`). Rollup's cycle shrank from 31 to **28 modules** (`hydrateBindings` left it); the warning count stays at 2.
- **The full bundle grows by 390 B gzip** (73,036 → 73,426) — the receptacle and the install, which the full form always pays. Whether the split core actually sheds SSR's 960 lines is measured by the next slice, from a real tree-shaken entry rather than a stubbed build.
- **The thirteen scripts, applied in order, reproduce the same tree.**

### 8-11. Implementation record of S5's third slice (2026-09-21, the split entries, sandbox)

With the receptacles in place, the features got entries of their own so that a page can compose them ([s5SplitEntriesPatch.mjs](../scripts/research/s5SplitEntriesPatch.mjs)).

- **The descriptor and `installFeatures`** (`core/features.ts`): a feature entry default-exports `{ name, install }` and a page installs the ones it wants. **Idempotence belongs to the feature's own `install`** (each already has its `installed` flag). A version that also remembered names in the core was written and dropped: it duplicates the same fact and adds an observable difference — "the second `bootstrapState()` never reaches the feature's install" — which an existing test caught. The core simply calls them in order.
- **The barrier names the entry** (`core/featureEntries.ts`): what a page needs is the import to add, and the internal feature names (watch / scan / stream) do not map one-to-one onto entries (temporal). One table, shared by all three barriers.
- **Bootstrap split in two**: `core/bootstrapCore.ts` (config, tag registration, binder — no install at all) and the unchanged `bootstrapState()` (`installFeatures(ALL_FEATURES)` then `bootstrapCore()`). Full and auto behave exactly as before.
- **`@wcstack/state/core` does not merely build — it runs**: `entries.core.test.ts` pins that binding, updating and list rendering work on a page with no feature installed.
- **Size (measured, single-file bundles, gzip -9; [split-entry-sizes.json](research/state-next/split-entry-sizes.json), produced by [measureSplitEntries.mjs](../scripts/research/measureSplitEntries.mjs))**: the core alone is **43,779 B** (147,356 minified). Adding a feature costs scopes +15,368, temporal +8,324, recursion +4,806, ssr +3,080, devtools +1,949 B; everything together is 73,504 B (about the full `auto.min.js`, 73,561). **The measured core equals the "features stubbed" upper bound of 44.0 KB from survey §9**: the 10–13 KB that §5 expected the wiring extraction to shave did not appear — that wiring was already counted on the feature side in the stubbed build, and the receptacles add their own bytes back. §5's conclusion stands: A2 (35 KB) is out of reach for this design alone.
- **Where the core's weight is** (source-map attribution, minified bytes): `bindings/BindingSession.ts` 13.0 KB, `components/State.ts` 12.6 KB, `filters/builtinFilters.ts` 4.7 KB, `proxy/methods/setByAddress.ts` 4.6 KB, `apply/applyChangeToFor.ts` 4.0 KB, `pathDiagnostics.ts` 3.6 KB; by group, bindings 14.7 %, proxy 12.9 %, apply 10.8 %, components 8.5 %. **Not one byte of the contract analyzer or of devtools is left in the core.** The next levers for A2 are the ones §5 lists (unifying `BindingSession`, diagnostics to a dev build, `features/formats`).
- **One core chunk (requirement B13) holds**: in the multi-entry build (`rollup.split.config.js` → `dist-split/`), **no feature entry carries a core module** (by source-map attribution: scopes has only webComponent / dcc, temporal only stream / scan, …). The core sits in shared chunks (`chunks/binder.js` and friends) that every feature imports.
- **What chunking costs**: the same core is 43.8 KB gzip as one file and **49,535 B across the 8 files** of the split form (+13 %), because each file is gzipped on its own; with every feature it is 84,609 B against 73,504. **The split form is for pages that leave features out; a page that uses everything is lighter with full / auto**, as before.
- **The coupling audit's classification was wrong**: `components/State.ts` — the core's own element — counted as a feature, because the group `components` was on the feature list for `components/Ssr.ts`. Features are now also recognised per module (`FEATURE_MODULES = { components/Ssr.ts }`) and `components` is back on the core side. The repository's edge count therefore reads 41 → **62** (the same code, attributed correctly; [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) re-recorded). **The sandbox goes 62 → 6**, and those six are the full entry's own (`bootstrapState → features/*` and `exports → ssr/Ssr`).
- **A new CI gate**: the audit now supports `reachability: { "entries/core.ts": { "noFeatures": true } }` — the core entry fails if it reaches any feature group. It goes into the baseline when `src/entries/core.ts` ships; it passes on the sandbox today.
- **Result**: all 3,697 tests pass, coverage 99.61 / 98.52 / 100 / 99.8. `auto.min.js` goes 73,426 → 73,561 B gzip (+135). The fourteen scripts, applied in order, reproduce the same tree.
- **Not done yet**: adding `./core`, `./features/*` and `./define` to `package.json`'s `exports`, wiring the split outputs into the real `rollup.config.js`, the import-map + SRI shape, and `features/formats` (which waits for D16's filter registry).

### 8-12. The port into the product (2026-09-21, `packages/state`)

The fourteen S3/S4/S5 scripts were applied to `packages/state`, turning the sandbox prototype into the product. **What a sandbox cannot carry** — the `exports` map, the real build, the CI gates — was added here.

- **Entries**: `package.json`'s `exports` gains `./core`, `./features/*` and `./define`. `.` (full) and `./auto` are unchanged.
- **Build**: `rollup.config.js` gains the multi-entry split build (`dist/split/` — `core.js`, `features/*.js`, `chunks/*.js`, minified, with source maps and hash-free chunk names), its declarations (`dist/split/**/*.d.ts`), and `dist/define.js` (**49 bytes** minified — an identity function and types) with `dist/define.d.ts`. The source maps are not optional: the "no feature re-bundles the core" gate reads them.
- **Two CI gates**: [check-state-split.mjs](../scripts/check-state-split.mjs) (every `features/*` shares the core's chunk and carries no core code of its own — requirement B13) and the core entry added to [check-state-size.mjs](../scripts/check-state-size.mjs) as its **closure** (`core.js` plus the chunks it pulls in), because the entry file alone is a 1 KB shell and would be a meaningless number. The coupling baseline is tightened to `maxCoreToFeatureEdges` 6 and `reachability: { "entries/core.ts": { "noFeatures": true } }`.
- **Cleanup**: the unused imports the slices left behind (six in `State.ts`, two namespace constants in `getByAddress`, three type imports in the declaration modules) are gone; lint is clean again, and the same cleanup is part of the scripts (§8-11, step 7).
- **Other packages**: `@wcstack/server`, `router`, `wcstack` and the e2e fixtures only touch `@wcstack/state`'s public surface and `dist/auto.min.js`, so moving `components/Ssr.ts` to `ssr/Ssr.ts` reaches none of them (`exports.ts` still re-exports `Ssr`).
- **Docs**: a split-entries section in both READMEs, and [sri](./sri.md) §5.1 for the import map + `integrity` shape.
- **Result**: all 3,697 tests pass, coverage 99.61 / 98.52 / 100 / 99.8, lint clean, build green, and all four gates pass (6 edges, 311 B gzip helper entry, sizes, no re-bundled core). The built `dist` measures `auto.min.js` 73,561, `index.esm.js` 329,418, and the split core closure 49,535 B gzip across 8 files.

### 8-13. `features/formats` (2026-09-21, the filter registry, `packages/state`)

D16's decision — "filter functions are resolved at binding-plan time; only the grammar stage stays in the core and the formatting filters move to `features/formats`" — is implemented. It was the last entry left in §4's table.

- **The stages separated**: the parse stage (`bindTextParser/parseFilters.ts`) now produces **only names and arguments** (`IParsedFilter`). The function is looked up at binding-plan time (`bindings/planFilters.ts`) from the registry (`core/filterRegistry.ts`), and only `IBindingInfo` carries `filterFn` (`IFilterInfo extends IParsedFilter`).
- **Two plan sites**: the ordinary path's `getBindingInfos` (per node) and the row plan `structural/rowPlan.ts` (once per template). The second fits the row plan's own idea — bake the row-invariant resolutions into the slot — so filters are not resolved per row.
- **The diagnostic moved**: an unknown filter now fails at **binding-plan time** instead of at parse time, with the same wording (`[wcs/filter-unknown]` and its did-you-mean) as lint. A tooling process that uses only the parser holds no implementations, so it cannot decide "unknown" at the parse stage at all — the move was forced by the split, not chosen for taste.
- **The core owns one filter, `not`**: `if` / `else` are assembled as bindings with `not` appended, so it must exist on a page without `features/formats`. `structural/createNotFilter.ts` returns the parse-stage shape (a name and arguments) and nothing else.
- **Where the implementations live**: `filters/builtinFilters.ts` and `filters/errorMessages.ts` moved to `src/formats/` (`git mv`); `filters/` keeps the types and `filterMeta` (the metadata the manifest and tooling read). `manifest.ts` lists the filter names from the implementation, which is the single source of truth, so it imports `formats/builtinFilters` — one more entry edge, and the baseline is now 8.
- **Size**: the core alone goes 43,779 → **42,705 B gzip** (147,356 → 143,050 minified). `features/formats` costs +1,272 B. The full `auto.min.js` goes 73,561 → 73,968 (+407, the registry's indirection). The split core's closure goes 49,535 → 49,148 B.
- **Result**: all 3,704 tests pass (three test files adapted: the 7 cases that assumed parse-time resolution were rewritten to the new contract, and `core.filterRegistry.test.ts` was added as the boundary test). Coverage, lint and all four gates pass.

### 8-14. `features/diagnostics` (2026-09-21, development-time diagnostics, `packages/state`)

§5's "diagnostic messages to a dev build" is implemented as **a feature**, not as a second build.

- **Why this shape**: a buildless package with separate dev and production files (URLs) makes every user pick a URL, which breaks the one-line CDN premise. Riding the existing `installFeatures` mechanism keeps full and `auto` exactly as before (diagnostics included), and lets only a page that chose `@wcstack/state/core` leave them out — which is also the entry A2 is measured on.
- **Only the diagnostics that do not stop execution moved**: `pathDiagnostics.ts` held two kinds of thing. The binding-time existence check (a `console.warn` for a typo'd path — a development aid that changes no behaviour) moved to `src/diagnostics/pathChecks.ts`. **The messages of thrown errors** (the index count of `$resolve`, the wildcard rank, a missing root path…) and the candidate collection their did-you-mean uses stay in the core: an error must fail with a readable message whether or not any feature is installed.
- **The receptacle** (`core/diagnosticsHooks.ts`): three points, `check` / `reset` / `markExported`; with nothing installed they do nothing. **There is no readiness barrier** — missing diagnostics is not a broken declaration but a quiet production page, which is where this feature differs from the others.
- **Size** (single-file bundles, gzip; [split-entry-sizes.json](research/state-next/split-entry-sizes.json)): the core goes **43,810 → 43,204 B** (146,805 → 144,750 minified, −2.0 KB); `features/diagnostics` costs +758 B. The split form's closure barely moves, 50,283 → 50,320 B: what the check took out was eaten by the per-file gzip overhead of the shared chunks the split newly carved between the core and the features (the messages, `errorGuidance`, the receptacle). **A split-delivery number can fail to drop, depending on how the shared code is cut.**
- **Result**: all 3,741 tests pass (two boundary tests: a core-only page does not warn about a typo'd path, and `installFeatures([diagnostics])` makes the same typo warn by name). Coverage 99.64 / 98.50 / 100 / 99.81; all four gates pass (one more install edge, so the coupling baseline is 9).
- **Where A2 ends**: with every lever of §5 used, the core is 43.2 KB gzip. The remaining 8 KB to 35 KB cannot be closed in this structure ([row runtime design](./state-next-major-runtime-design.md) §9).

### 8-15. Where the attribute readiness barriers land (2026-09-21, requirements D23, `packages/state`)

§9's open item, "landing the attribute barriers", is aligned as requirements D23 decided. The `mount=` and DCC barriers only threw out of `connectedCallback`, leaving `connectedCallbackPromise` pending — on a `/core` page that forgot scopes, `renderToString`, `mount()` and `getBindingsReady` waited forever.

- **DCC**: the barrier now lands where a DCC load failure does (`dcc/dccLifecycle.ts`): `_failInitializeLoudly`, one diagnostic, `connectedCallbackPromise` rejected. A DCC's `<wcs-state>` owns its shadow's tree, so the tree becomes unavailable (as with a load failure).
- **`mount=`**: `_failInitializeLoudly` takes an `ownsTree` argument; when it is false, marking the root (`markBindingsUnavailable`) and notifying pending volumes (`runInitializeFailed`) are skipped. A volume does not own the tree, and a volume connected before its root finds nobody on the root node yet, so the default landing would mark the not-yet-arrived root's node unavailable (as §9 noted).
- **Other volume failures are unchanged**: `_initializeVolume`'s failures still resolve the promises and then raise (pinned by `integration.initFailureDiagnostics.test.ts`; the slot lifetime is a separate issue). Only the barrier rejects, because a forgotten feature is a configuration the page author must fix, and a test entry such as `mount()` must not let it through quietly.
- **Tests**: the two cases in [core.lifecycleHooks.test.ts](../packages/state/__tests__/core.lifecycleHooks.test.ts) now check the landing (`connectedCallbackPromise` rejected, one diagnostic, and the tree's marking — set for DCC, not for `mount=`). Putting `mount=` back on the default landing makes the latter fail. All 3,743 tests pass; coverage unchanged.

## 9. Decided and undecided

Decided (2026-09-21, requirements §6 D12, D13, D15, D16):

- **The API shape of `install`**: `installFeatures([...])` is the default. Thin per-feature side-effect entries can be added later as a convenience of D3's split form.
- **When filter functions are resolved**: from a registry at binding-plan time. Only the grammar stage (1.7–3.2 KB gzip, survey §4.3) stays in the core; the formatting filters move to `features/formats`. The "unknown filter" diagnostic moves from a parse-time throw to the binding-plan stage.
- **Attaching H1 hooks**: the `_state` setter assembles the state element's `addressHooks` from the declarations (reserved keys, `**`, DCC); the `mount=` attribute is picked up in `connectedCallback` as a second pass (§8-2).
- **When the readiness barrier fires**: it throws in the `_state` setter (at declaration time). Never on `auto` / full.
- **The +1.3 KB gzip that S3's receptacles add to the full bundle** (requirements D19, §8-2's record of slices 2 and 3): re-record `scripts/state-size-baseline.json` from the 3.0 build and accept it. Whether to fold the 12 loops into one shared runner is decided after measuring it when S3 lands on the 3.0 vehicle.

Decided (2026-09-21, second round; the two items below used to be listed as undecided):

- Unifying `BindingSession`'s two paths and the concrete design of the row record, the shared session and the plan-level initial render (survey §10.7, §10.13, §10.14) are outside this design and implemented as R1–R5 → [the row runtime design](./state-next-major-runtime-design.md) (R1–R5).
- **Landing the attribute barriers** (found in §8-8; **decided on 2026-09-21 as requirements D23, "align them"** — DCC lands where its load failure does, and `mount=` gets a landing of its own that rejects `connectedCallbackPromise` without taking the root down; implemented in §8-15): the `mount=` and DCC barriers only throw out of `connectedCallback`, leaving `connectedCallbackPromise` pending, whereas a declaration barrier fails inside `_initialize` and so lands per #257. Aligning them needs a landing that does not drag the root in: `_failInitializeLoudly` cannot serve `mount=` as is (for a volume connected before its root, it would mark the not-yet-arrived root's node unavailable and fail the other pending volumes with it). The path exists only in split entries, so it is decided with S5. The `bind-component` barrier added in §8-9 sits inside the same try as bind-component's other configuration errors, so it lands; the DCC barrier could equally land the way a DCC load failure does.

Undecided: none.
