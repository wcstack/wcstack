# 10. Defaulting and roll-out status, and what remains

Last updated: 2026-07-16

Phases 0-6, as defined in `09-remediation-design.md` §8 "staged introduction", are **complete as PoC implementations**.
This is the living document tracking what comes after that: the progress of **opt-in → default and the roll-out across the I/O family**.
The norms live in the design docs (01-09); this document sticks to status tables and task lists.

- **日本語版**: [10-defaulting-rollout-status.ja.md](10-defaulting-rollout-status.ja.md)

## 1. Where we are

The phase implementations (PoC) are all complete, 0 through 6. The current stage is defaulting and roll-out.

| Phase | Implementation | Defaulting / roll-out status |
| --- | --- | --- |
| 0 foundation | types / conformance mirror / platform guard | running by default with no flag (done) |
| 1 lifecycle ownership | `BindingSession` / record / teardown | running by default with no flag (done) |
| 2 initial sync | `enableDirectionalInitialSync` / `#init=` `#sync=` | **default `true` (flipped 2026-07-16)**. The permanent opt-out flag remains |
| 3 causal propagation | `enablePropagationContext` / `WriteReceipt` | **default `true` (flipped)**. The permanent opt-out flag remains |
| 4 async lane / trace | `OperationLane` / commit guard / terminal CAS | rolled out to **6 operation nodes** (the remaining candidates are non-contending or session-based and out of scope = done). Whether DevTools trace applies across the board needs checking (§F) |
| 5a static contract | validator core / the `wcs-validate` CLI | implemented. **Gated as required in CI, done (§B, 2026-07-16)** |
| 5b development-time checking | the `enableContractAnalyzer` analyzer | implemented. **Explicit opt-in settled as the official spec (§C; on-by-default in dev is rejected)** |
| 6 capability | probe / report / error taxonomy | applied to **27 of 35 I/O nodes** (+19, 2026-07-16; making the view family bindable put error on the observation surface too). The remaining 8 = 3 deferred (permission/network/defined, the user's call) plus 5 not applicable. Details in §A |

### Flags now defaulted (`packages/state/src/config.ts`)

- `enableDirectionalInitialSync: true` — Phase 2. An output-only `wcBindable` member reads its initial value element→state, while a two-way or input member keeps state→element. The setup-path cost is under 5% of the initial render (the producer-value observer is registered only on two-way wires that can echo).
- `enablePropagationContext: true` — Phase 3. The write-path cost is essentially zero for a one-way binding (causal bookkeeping only on two-way wires that can echo).
- `enableContractAnalyzer: false` — Phase 5b. The only one still opt-in (§C).

Per decision 3, **none of the flags is removed; they remain as permanent opt-outs**.

### Operation nodes with the lane applied (6)

`fetch` (latest) / `share` (exhaust) / `contacts` (exhaust) / `eyedropper` (latest) / `credential` (latest) / `upload` (latest).
The canonical sources are `io-core/{operation-lane,platform-capability}.ts`, with `scripts/sync-io-core.mjs` distributing generated copies into each `src/core/` (copy-distribution, no new npm dependency). CI checks for regeneration drift with `sync-io-core.mjs --check`.

### Nodes with errorInfo applied (27, as of 2026-07-16)

- The initial 8: the 6 lane nodes plus 2 non-contending ones (`clipboard` / `geolocation`).
- +19 (this session, all `CAPABILITY_ONLY`): `storage` / `accelerometer` / `gyroscope` / `magnetometer` / `ambient-light-sensor` / `notification` / `wakelock` / `tilt` / `screen-orientation` / `worker` / `broadcast` / `idle` / `websocket` / `sse` / `camera` (2 cores) / `speech` (2 cores) / `fullscreen` / `picture-in-picture` / `pointer-lock` (for the view family, error became bindable too).
- Verification: each package's test:coverage (100% or within thresholds) plus lint plus build, re-run independently; `sync-io-core --check` = 33 generated files consistent; zero git dist diff. The READMEs (en/ja) document errorInfo for all 27 nodes. Details in §A.

---

## 2. What remains

### A. Phase 6 — rolling out the errorInfo taxonomy [decided: roll out to every applicable node. **Complete: 27/35 applied plus 3 deferred plus 5 not applicable (2026-07-16)**]

> Below is the chronological log of the roll-out (progress counts are as of that moment). For the end state see "Final classification of the remaining nodes".

**Policy decided (2026-07-16)**: apply it **to every applicable I/O node in turn**, as `09` §8 phase 6 intended (see below for the scope correction).

**Progress 13 / 35** (+storage +accelerometer +gyroscope +magnetometer +ambient-light-sensor). The **remaining 15 nodes** where errorInfo applies:

> websocket, sse, broadcast, worker, notification, wakelock, camera, speech, defined,
> fullscreen, picture-in-picture, pointer-lock, screen-orientation, idle, tilt

(For the 5 where errorInfo does not apply plus the 2 on hold, see the scope correction below.)

**⚠ 2nd scope correction (2026-07-16, on examining error observability)**: of those 15, **the 3 view-family nodes (fullscreen / picture-in-picture / pointer-lock) have `error` as an imperative getter only** (`_setError` merely does `this._error = error`, **dispatching no event and declaring nothing in wcBindable**). The sensor/storage/clipboard template of "bindable errorInfo (a property with an event)" does not apply directly. **A design decision is needed**: (a) mirror error into errorInfo as an imperative getter too (no event, not declared in wcBindable — the minimal change, and consistent), or (b) introduce an error event and make errorInfo bindable (solving the family's "error event not dispatched" backlog at the same time). ⇒ **the 3 view-family nodes are on hold** (to be picked up once the error-event policy is decided).
- ⇒ Of those 15, the **12 bindable-error nodes** (with `name:"error"` plus an event: websocket / sse / broadcast / worker / notification / wakelock / camera / speech / defined / screen-orientation / idle / tilt) are the ones that go straight through on the sensor/storage template. **Those 12 come first.**

**bindable-error batch 1 complete (nodes 14-17, 2026-07-16, parallel subagents plus independent verification)**: `notification` / `wakelock` / `tilt` / `screen-orientation`. **Progress 17 / 35**. Each subagent **verified the real Core and caught divergences from the designed taxonomy** (the memory-hazard function):
- `notification` (whose `.error` is already a code): against my assumption of 4 codes, it found and added **a fifth, `no-service-worker`** (the missing SW in `_showViaSw`), from the Core. 111 tests, 100%.
- `wakelock` (a raw `Error`): **unsupported is a silent no-op and never goes through `_setError`** → the `capability-missing` branch was correctly omitted as dead code. NotAllowedError→not-allowed, everything else→wakelock-error. 77 tests, 100%.
- `tilt` (a `{error: e}` wrap, DeviceOrientation): no unsupported path (where requestPermission is absent it resolves as granted) → NotAllowedError→not-allowed, everything else→tilt-error. 72 tests, 100%.
- `screen-orientation` (a mix of `{message:"unsupported"}` and caught errors): adopted the **storage-style explicit discriminator `_setError(error, name?)`**. **The memory's "NotSupportedError→NotAllowedError correction" was wrong** — it demonstrated that the README and tests use NotSupportedError ("not branching on name; treated as one outcome") → NotAllowed|NotSupported|Security→not-allowed, AbortError→aborted (recoverable), everything else→orientation-error. Also added never-throw hardening for `Promise.reject(undefined)` (`_errorInfoMessage`). 87 tests, 100%.
- **The lesson, reconfirmed**: a taxonomy has to be designed by reading each node's real error surface closely (the error names, the silent paths, what the docs say); a shared assumption is not to be trusted. sync-io-core --check = 23 generated files consistent, zero git dist diff. **8 bindable-error nodes left**: websocket / sse / broadcast / worker / camera / speech / defined / idle.

**bindable-error batch 2 complete (nodes 18-22, 2026-07-16, parallel subagents plus independent verification)**: `worker` / `broadcast` / `idle` / `websocket` / `sse`. **Progress 22 / 35**. Again each subagent verified the real Core and corrected the assumptions:
- `worker` (`{name,message}`): found that the name "TypeError" is not validation-exclusive (an absent `Worker` also gives a TypeError, "not a constructor") → **discriminate on the message**: absence (TypeError/ReferenceError)→capability-missing, validation→invalid-argument, everything else→worker-error. Since `dispose()` does not go through `_setError`, an explicit null clear of errorInfo was added. 117 tests.
- `broadcast` (`{name,message}`): demonstrated that `_unsupportedError().name` is **"NotSupportedError"** (not "unsupported"). DataCloneError→invalid-argument, everything else→broadcast-error. 97 tests.
- `idle` (a mix of `{message}` and `{error:e}`): a storage-style discriminator plus one level of message unwrapping for `{error:e}`. unsupported→capability-missing, NotAllowedError→not-allowed, everything else→idle-error. 79 tests.
- `websocket` (a mix of `{message}`, caught errors, and Events): an explicit discriminator `_setError(error, code?)`. url→invalid-argument, a send while not connected→invalid-state, a construction failure or error Event→connection-error (recoverable). 131 tests.
- `sse` (a mix of Errors and Events): found that **the Core distinguishes fatal (readyState CLOSED) from transient (CONNECTING, reconnecting)**, and limited recoverable=true to that one case. url→invalid-argument, everything else→connection-error. 106 tests.
- sync-io-core --check = 28 generated files consistent, zero git dist diff. errorInfo now exported from **22 packages**.
- **3 applicable ones left (each needing individual work)**: `camera` (2 cores, CameraCore+RecorderCore, MediaStream is special) / `speech` (2 cores, ListenCore+SpeakCore) / `defined` (its error surface is not a separate event but inside `wcs-defined:change`, with no `_setError` = needs investigation). Plus the **3 view-family and 2 capability-only nodes on hold** (the scope correction above).

**The 2-core family complete (nodes 23-24, 2026-07-16, parallel subagents plus independent verification)**: `camera` / `speech`. **Progress 24 / 35**.
- `camera` (CameraCore + RecorderCore, `deriveMediaErrorInfo` in the shared `mediaCapabilities.ts`): classifies the `.name` from getUserMedia/MediaRecorder. unsupported→capability-missing, NotAllowed/Security→not-allowed, NotFound→not-found, NotReadable→not-readable, Overconstrained and **NotSupported** (a Recorder construction failure, found from the Core)→invalid-argument, NoStreamError→invalid-state, Abort→aborted (recoverable), everything else→media-error. 161 tests, 100%.
- `speech` (ListenCore + SpeakCore, two derives in `speechCapabilities.ts`): `.error` is already a W3C code. Listen (no-speech/audio-capture/network/not-allowed/aborted/language-not-supported…) and Speak (canceled/interrupted/audio-busy/audio-hardware/network/synthesis-*/…) are classified separately. 188 tests.
- sync-io-core --check = 30 generated files consistent, zero git dist diff. **errorInfo implemented in 24 packages (16 nodes added)**.

### Final classification of the remaining nodes (2026-07-16)

**27 applied** (the existing 8 + storage + 4 sensors + notification/wakelock/tilt/screen-orientation + worker/broadcast/idle/websocket/sse + camera/speech + **the 3 view-family nodes**). **The remaining 8 = 3 deferred (the user's call) plus 5 not applicable**:

| Node | Classification | Status |
| --- | --- | --- |
| fullscreen / picture-in-picture / pointer-lock | **view family, complete (made bindable)** | **The user's call = (b), make it bindable (2026-07-16)**. Where `error` had been an imperative getter only, an `error` event (`wcs-<ns>:error`) plus an `errorInfo` event (`:error-info-changed`) were introduced and declared in wcBindable — **solving the family's "error event not dispatched" backlog at the same time**. fullscreen was done by hand as the reference (making error observable plus errorInfo, an explicit `kind` discriminator, taxonomy = capability-missing / invalid-argument / not-allowed (gesture, recoverable) / `<node>`-error) → pip and pointer-lock mirrored it through parallel subagents. The READMEs (en/ja) had their "error is not bindable" claim corrected. 100% coverage, lint, and build confirmed green independently for each. Adding the events is additive and backward-compatible, leaving the existing imperative `el.error` intact. |
| permission / network | **capability-only, deferred** | **The user's call = defer.** They have no error surface, only a `supported`/`unsupported` boolean. An errorInfo would be `capability-missing` alone, overlapping the existing boolean, of limited value. |
| defined | **special, deferred** | **The user's call = defer.** Its `error` is a string inside the snapshot ("no tags specified" / accumulated timeouts), with no `_setError` and no caught exception. |
| timer / raf / debounce / intersection / resize | **not applicable (settled)** | They have neither errors nor a failure capability. errorInfo is not applied. |

**README backfill complete (2026-07-16, parallel subagents)**: errorInfo is documented in the READMEs of all 16 newly added nodes (en `README.md` plus ja `README.ja.md`, and for camera/speech both elements). Added to the output list, the observable-property table, the wcBindable snippet (where the README has one), and the taxonomy explanation in Design Notes. Each node's taxonomy was cross-checked against its capabilities file to confirm it matches the implementation (e.g. `wakelock` has no capability-missing; `screen-orientation`'s event is `wcs-orientation:error-info-changed` — the namespace, not the tag name). Including the 3 view-family nodes, **READMEs documenting errorInfo = all 27 nodes** (fullscreen/pip/pointer-lock had their "error is not bindable" claim corrected). **The only task left = item D (the pre-release dist rebuild plus the state-dependency regression)**, to be done at release time.

**The 4 sensor-family siblings complete (nodes 10-13, 2026-07-16)**: `accelerometer` was implemented by hand as the reference (the sensor-style template, i.e. the clipboard style where the error detail's `.error` carries the Error.name and no name capture is needed), and `gyroscope` / `magnetometer` / `ambient-light-sensor` were mirrored strictly from accelerometer by **parallel subagents**. The taxonomy is identical across all four (`unsupported`→capability-missing/probe, `SecurityError`|`NotAllowedError`→not-allowed/start, `NotReadableError`→not-readable/execute, everything else→sensor-error/execute, all recoverable=false), verified by grep. **Since a sensor keeps its error sticky (there is no clear path in the public API), the contract that errorInfo is cleared to null in sync with error is pinned by a white-box `_setError(null)` test** (covering the `error === null` branch). 100% coverage, lint, and build confirmed green by independent re-runs for each (73/74/72 tests excluding accel). sync-io-core --check = 19 generated files consistent. **Remaining: adding errorInfo to the sensor-family READMEs** (to be handled together with the family's cross-cutting debt, [[sensor-family-crosscut-debt]]).

**storage = node 9, complete (the reference node, 2026-07-16)**: applied the CAPABILITY_ONLY template to a command-driven monitor node. taxonomy = `invalid-argument` (validation: a bad type, an unset key; phase start) / `quota-exceeded` (QuotaExceededError, recoverable) / `not-allowed` (SecurityError) / `storage-error` (anything else caught, execute). **The design lesson**: storage discards the caught exception's `Error.name` in `_toStorageError`, so unlike geolocation (whose error carries a code) it needs a route to carry the name into the errorInfo classification. **The public `error` shape stays unchanged**, and the classification goes through an optional argument on `_setError(error, name?)` plus an `_errName(e)` helper (a non-Error → `""` → storage-error; validation has no name → invalid-argument). A latent bug that would "misclassify a non-Error throw as invalid-argument" is eliminated by making `_errName` the single chokepoint. 148 tests, 100% coverage, lint / build / sync-check green. **A roll-out template for caught-exception nodes** (two styles are now established: clipboard, where the error carries a name, and storage, where the name is carried by a separate route).

- `09` §8 phase 6 says "apply to the I/O packages in turn" = every I/O package was assumed.

**⚠ Scope correction (2026-07-16, on investigating the actual error surfaces)**: "all 27" implicitly assumed uniform applicability, but a grep-level examination of the real Cores' error surfaces splits the remaining nodes into three categories. errorInfo exists to **classify actual failures**, per Phase 6's intent, so attaching it to a node with no failure surface would fabricate "failures that never happen".
- **errorInfo applies (there is an error or failure surface) = 19**: `websocket` `sse` `broadcast` `worker` `notification` `wakelock` `camera` `speech` `defined` `screen-orientation` `idle` `tilt` `accelerometer` `gyroscope` `magnetometer` `ambient-light-sensor` (all with a `name:"error"` property) plus `fullscreen` `picture-in-picture` `pointer-lock` (which have `_setError`, with error on a separate surface).
- **Capability only (a `supported`/`unsupported` boolean, no error surface) = 2**: `permission` (`unsupported`) / `network` (`supported`). An errorInfo here would be `capability-missing` alone, which rather overlaps the existing boolean and is of limited value. **Policy: on hold** (decide individually later whether a capability-missing-only errorInfo has value).
- **errorInfo not applicable (neither errors nor a failure capability) = 5**: `timer` `raf` `debounce` (pure timing, they do not fail) / `intersection` `resize` (observers, no runtime error and no `supported` prop). **errorInfo is not applied** (documented as not applicable).
- ⇒ The effective target is **19 nodes** (plus 2 on hold plus 5 not applicable). "Roll out to all" is read as "all applicable nodes", and the work proceeds against those 19.
- The method is established: the `CAPABILITY_ONLY` template of `clipboard` / `geolocation`. With the `_setError`-centralized approach (touching no error call site, and doing `derive*ErrorInfo(name/code→taxonomy)` → `_commitErrorInfo` inside `_setError`), the generated `platformCapability` is excluded from coverage and only the `WcsIoErrorInfo` type is used (the runtime functions tree-shake away).
- One caveat: `camera` is the special node handling a live `MediaStream` (which never goes through serializable state).

**The work breakdown per node (2026-07-16, from reading the geolocation template closely)**: (1) add `CAPABILITY_ONLY` to `PACKAGE_FILES` in `sync-io-core.mjs` → regenerate; (2) add the error codes plus `deriveXxxErrorInfo` to `xxxCapabilities.ts` (**this is the only place a per-node taxonomy judgment is needed**; e.g. geolocation copies spec codes 1/2/3 and makes only permission-denied recoverable=false); (3) add the `errorInfo` bindable property plus `_errorInfo` plus a getter plus `_commitErrorInfo` to Core, and wire derive+commit into `_setError`; (4) add the `errorInfo` getter to the Shell; (5) export the `WcsIoErrorInfo` type plus `WCS_XXX_ERROR_CODE` from `exports.ts`; (6) errorInfo tests; (7) exclude the generated `platformCapability.ts` from coverage; (8) update the README and design doc. **The structure is boilerplate; only the taxonomy (step 2) is a judgment. Apply the memory hazards at each node (match cancel error names to that node's real API; do not take a shared doc's units or code descriptions at face value).**

### B. Phase 5a — gating `wcs-validate` as required in CI [complete 2026-07-16]

**Implemented**: added an independent `wcs-validate` job to `.github/workflows/ci.yml`. It builds vscode-wcs and runs `wcs-validate --errors-only` over the HTML and manifests of `examples/` plus `packages/` (pruning node_modules/dist/coverage/.tsc-out), **failing the build if any error severity appears**. The decision "gate all HTML on errors only" was adopted (0 errors today across 66 scoped files → a low-risk regression guard).
- Added `--errors-only` (alias `--quiet`) to the CLI: it prints only error lines and counts warnings/info (so false-positive warnings originating in external state do not fill the CI log). `runValidation` gained an `errorsOnly` option (display only; count and exitCode unchanged) plus a dedicated test. vscode-wcs's 276 tests are green.
- vscode-wcs is not a `@wcstack/*` package and is outside the detect-changes matrix, so it became an independent job, as `protocol-types-sync` did.

Below is the verification record that led to the decision:

- The validator core and the `wcs-validate` CLI were implemented. `.github/workflows/ci.yml` had **only** `sync-io-core.mjs --check` and no `wcs-validate` run.
- Add a step to ci.yml that fails the build on a manifest drift / path / modifier violation.
- The completion criterion "the IDE's and CI's diagnostic codes and ranges agree" (`09` §8 5a) is met. Only the CI gate was left.

**Verification (2026-07-16, a CLI trial run) — what to validate needed deciding**:
- The repo has **0** `wcstack.manifest.json` files (so the manifest drift check currently has nothing to check).
- Running the CLI over the **648 HTML files** in `examples/` plus `packages/` yields **effectively 0 errors** (the single error was `packages/vscode-wcs/coverage/.../templateSyntax.ts.html`, a false positive on a coverage artifact; excluding coverage/dist/node_modules gives 0).
- But the examples (`state-notification-chat`, say) emit many `wcs/binding-path-missing` **warnings**, because the state is loaded through an external script or CDN and cannot be resolved statically (a limit of the validator, not a bug in the example). The exit code is 1 only on errors, so warnings do not fail the build — but they would bury the CI output in false positives.
- ⇒ **A decision was needed on what to validate**. The options: (a) gate all HTML on errors only (0 today, low risk, but noisy with warnings); (b) prepare self-contained fixtures with inline state and gate on those (clean, but they have to be written); (c) generate a manifest from the I/O nodes' `static wcBindable` and drift-check it (most faithful to the intent of "manifest drift", and the most work).

### C. Phase 5b — explicit opt-in becomes the official spec for `enableContractAnalyzer` [decided 2026-07-16]

- **Decision: on-by-default in dev is not adopted; explicit opt-in (`default false`) is the official spec.**
- Why: wcstack is buildless and zero-config, with no reliable dev/prod determination equivalent to NODE_ENV. Auto-enabling on a hostname heuristic (localhost and friends) or on "not minified" could misfire and put cost into production. An explicit dev flag (`window.__WCS_DEV__` or similar) still needs the user to set it manually, which breaks zero-config. ⇒ The current `default false` plus `setConfig({ enableContractAnalyzer: true })` is settled as the safest design.
- Reflected in: [config.ts](../../packages/state/src/config.ts), where this intent is stated on `enableContractAnalyzer`. Since "no runtime behavior or cost change while disabled" (`09` §8 5b) is already met, no further implementation is needed as long as it stays opt-in. Among the state flags, directional and propagation are on by default, and the analyzer alone is deliberately opt-in.

### D. Build and release hygiene — rebuilding each package's dist [at release time]

- **Corrected by verification on 2026-07-17**: the dist of `state` and `fetch` is **current** (a rebuild produced a zero-byte diff; the state dist includes `enableDirectionalInitialSync: true` and `enablePropagationContext: true`). The original claim that "the state dist is stale" was wrong.
- The dist of `share` / `contacts` / `eyedropper` / `credential` / `upload` / `clipboard` / `geolocation` was confirmed to contain the Phase 4/6 output (errorInfo) as well (by marker inspection). The original list of "src changes not reflected in dist" was wrong as a whole.
- `router`, on the other hand, has today's wcBindable fix (below) unreflected in its dist (a rebuild was confirmed to produce a diff, and the dist was left alone in line with the release-time policy). In addition, some dist files have not picked up the regeneration of `protocol/wcBindable.ts` (`version: 1` → `version: number`) (confirmed through the rebuild diffs of `debounce` / `network` / `router`). **A single wholesale rebuild of every package at release time is the safe move.**
- By design this is resolved by the release build, but the published artifacts currently predate the flags. Before the release:
  1. Rebuild each package (`rimraf dist` → `tsc` → `rollup -c`)
  2. **Regression-check `router` / `signals` / `server` / `examples`, which depend on `state`** (the new defaults take effect once the dist is updated)

**The examples regression check is complete (2026-07-17, local dist plus a real browser)**: item 2 above was done ahead of time, and **six examples that actually break under the new defaults were found and fixed** (five in the first pass; the sixth, `packages/state/examples/spread`, in a second sweep over all examples). Because examples read the CDN (the published v1.20.0), that breakage would not have surfaced until the release.
- **One root cause was a package bug**: `router`'s `wcBindable` declared the settable `navigateUrl` only in `properties` (judged output-only → `shouldApplyState` **permanently suppressed** the state→element write → programmatic navigation from state died). Fixed by adding it to `inputs` (matching §3.6's "in both properties and inputs → state, for compatibility"). Confirmed by a counterfactual in a real browser (before: clicking left the URL unchanged; after: it navigates). `path` stays output-only, since its setter does not navigate.
- **The other five were patterns on the examples side**: state seeded a "conveniently shaped initial value" into an output-only slot (`value: []`, `debouncedQuery: ""`), the element authority's real initial value (`null` / `undefined`) overwrote it, and the getter fell over. **Unified on the form where the seed matches the element's real initial value and the display goes through a derived, null-safe getter** (state-search / router-spa / fetch pagination / fetch users-crud). `<wcs-debounce>`'s `value` is the same shape (`DebounceCore._value = undefined`), which only surfaced under an e2e run. The sixth, `packages/state/examples/spread`, is a teaching example in the opposite direction (its point is state seed → element display), so the four members of its inline fake-fetch were declared in inputs too, making them two-way and preserving state authority, with the contractual difference from a real I/O node stated in a comment.
- **A side effect**: the manual pull for `<wcs-network>` in `state-sse-dashboard` (the workaround for the lost initial snapshot) was deleted, since Phase 2 solves it structurally. The automatic pull was demonstrated in a real browser (the `netSupported` seed of `false` is replaced with `true` and the tile renders).
- ⇒ **The lesson**: "give an output-only member an initial value on the state side" stops working with Phase 2 on by default. It has to go into the migration guide for existing apps. Since the validator statically requires an array type for a `for:` path, that plus a null seed means **pointing it at a derived getter** is necessary (`wcs-validate` did in fact catch this mistake).
- **The seventh (2026-07-17, found after the v1.21.0 release) = the second package bug**: DCC's `createWcBindable` (`packages/state/src/dcc/wcBindable.ts`) generates only `properties` and no `inputs`, so every `$bindables` member was judged output-only → besides permanently suppressing the parent state → DCC write, the DCC's own initial values flowed back into the parent state through `commitProducerValue`. The only authority an output-only member permits is `element|none`, and `init=state` throws, so the user had no workaround. The fix = adding `inputs: bindables.map((name) => ({ name }))` (branch `fix/dcc-bindable-inputs`; the usage in the README's "Binding to DCC Properties" is what this affects).
  - The structural reason it was missed: a DCC's declaration is **generated dynamically at runtime** and does not appear in a grep sweep for `static wcBindable`. The e2e (`__e2e__/dcc/index.html`) had the parent's `cnt: 0` and the DCC's `count: 0` seeded to the same value, which made the backflow invisible, and it never tested the parent→DCC direction → closed by an asymmetric seed (`cnt: 5`) plus an increment button on the parent side. The regression tests are `bindings.initialSyncPolicy.test.ts` (pinning authority=state and no backflow with the real `createWcBindable`) plus `dcc.wcBindable.test.ts` (the invariant that properties and inputs are the same set).
  - Making the norm explicit: "a settable member is declared in both `properties` and `inputs`" was added to the state README (en/ja) as a new section, "Binding Authority (`#init=` / `#sync=`)" (as of v1.21.0 the README had no section explaining `#init=`/`#sync=` at all, and the norm lived only in `09` §3.6 in this directory).
- **The eighth (2026-07-21, unreleased) = the third Phase 2 divergence**: `shouldApplyState` used the resolved authority **as the gate for the steady-state apply too**, permanently suppressing state→element for bindings with element / none authority. `09` §3.6's norm is that "authority governs the initial sync only" (for a two-way member, `init=element` = "put the snapshot into state", `init=none` = "handle it from the next change"), so this diverged. The real damage: `#init=element` / `#init=auto` on a two-way member effectively became one-way, which meant the load-before-bind clobber of `<wcs-storage>` (`state-binding-init-races.md` §1) could not be solved with a modifier (the pull works but subsequent saves die). It is the third face of the same "permanent suppression" as router's `navigateUrl` (the first) and DCC's `createWcBindable` (the seventh), except that the previous two were fixes on the declaration side while this one fixes the gate itself.
  - The fix = splitting `shouldApplyState` into two phases: the record carries `initialApplyDone`, and only **the first consultation** after settle (the initial sweep filter of `initialize()`, a row's first render, the selection of a deferred initial apply) answers from authority and consumes it; the steady state blocks only for (1) the contract of an output-only member (mirroring `policy.outputOnly` into the record) and (2) while a `sync=connect` connection snapshot is unresolved (`observationPending`). A failed record is explicitly false. The permanent suppression for output-only, the conformance of DCC/router, and the behavior of the existing tests are all unchanged.
  - Regression tests: `bindings.initialSyncPolicy.test.ts` (steady-state true for two-way `init=element`/`auto`/`none`, steady-state false for output-only, false before resolution and true after for `sync=connect`) plus `integration.initialAuthority.test.ts` (the storage-style scenario on real state: the initial pull of `#init=element`, then a state change through an input reaching the element / not reaching it for output-only). The README's (en/ja) Binding Authority section was corrected to "authority governs the initial sync only" (the old text had made the implementation's permanent suppression normative).
  - This lets the permanent fix in `state-binding-init-races.md` §1 (option A, a medium-term item) be completed with `value#init=element:` — one modifier. The storage README §5 idiom and the `$connectedCallback` pull in `examples/state-cross-tab-todo` / `state-color-palette` can be simplified after the release (the examples read the published CDN version, so they stay as they are until then).
  - **[Complete 2026-07-24] that simplification was done** (the fix is in v1.22.0, so the "stay as they are until the release" reason expired). The storage README (en/ja) §1/§4/§5 were rewritten to `value#init=element:`, and the `$connectedCallback` pull was removed from the two examples. **The manual pulls in the monitor nodes were removed at the same time**: every observable property in the network and screen-orientation READMEs (en/ja) is output-only, so the default authority is `element` and the manual pull was never needed (`timing-and-firing-contract.md` §7.1/§10.1/§10.2/§11.2 were also corrected to "the event does not arrive but the value does"). A new real-browser regression was added: `e2e/tests/monitor-initial-snapshot.spec.ts` (since `<wcs-network>`'s `supported` settles once on connect and no change follows, a regression in the pull leaves the seed at `false` — making it a regression detector).

- **[Post-release TODO, added 2026-08-01] catching up the wcstack-app skill**: the skill lives in the separate
  [wcstack/wcstack-skill](https://github.com/wcstack/wcstack-skill) repository, carries the **verified release** as
  a marker in its `SKILL.md` frontmatter `wcstack-version`, and every scaffold reads
  `https://esm.run/@wcstack/<pkg>/auto` (= the published version). It is therefore an artifact of the same class as
  the examples: making it track an unreleased main would put its marker out of step with reality and describe
  behavior the CDN does not serve. The skill's own README states it takes "PRs that fix drift against a
  **released** wcstack version". ⇒ **Apply it all after the release.**
  - The current marker is **1.22.6** and the latest on npm is **1.23.0** (checked 2026-08-01). Since it is already
    one release behind, catching up after the next release means handling the 1.22.6 → new version diff in one go.
  - Little of what originates in docs 11-13 in this directory is likely to matter. The `semantics` declaration is a
    producer-side surface and largely irrelevant to an app-building skill, and property upgrade and the
    framework-integration procedure are irrelevant to HTML-first app building. **The one thing that does matter is
    occurrence propagation** (a property with `semantics: "event"` reaches state even for an identical primitive),
    so any gotcha-table entry that presumes a same-value guard needs updating.
  - When catching up, update `SKILL.md`'s `wcstack-version` and the version text in the README at the same time.

### E. Documentation and normative updates [complete 2026-07-16]

- Implementation-status callouts have been added to the header of `03-two-way-echo-control.md`, and to `09` §3.6
  (directional) / §4 (propagation) / §8 ("on by default, permanent opt-out", with a link to this document). The body
  text remains as written when the flags were introduced, but the callouts act as the normative pointer to the
  current state.

### F. Items to confirm [resolved 2026-07-16]

- The application status of Phase 4 `09` §6 "the async trace queue (a DevTools side channel)" was verified.
  **Conclusion: lane trace is uniformly dormant across all six lane nodes, fetch included**, and the asymmetry of
  "only fetch has it" does not exist.
  - `io-core/operation-lane.ts` has an optional `trace?: (event: OperationTraceEvent) => void` and generates no trace
    record at all when it is not passed (the hook-off zero-allocation gate of §10.3). That capability is inlined into
    each package's generated copy (byte-identical).
  - But **all six nodes** (`fetch` / `share` / `contacts` / `eyedropper` / `credential` / `upload`) construct it as
    `new OperationLane(key, policy, { withSignal })` and **pass no `trace` option** → the lane's `_trace` is always
    undefined.
  - `packages/state`'s `devtoolsSink` receives state-side events (`state:binding-added` / `state:update-batch` /
    command token / contract analyzer) but **has no type for the lane's `io:operation-*` events, and the bridge
    between the two is unimplemented**.
  - ⇒ There is no half-applied state (trace on fetch alone). Bridging lane trace → state devtoolsSink is an
    **untouched follow-up** (a consistent gap) and not a blocker for defaulting. When DevTools integration is
    implemented, wire `trace` uniformly across the six nodes and add the lane event types to devtoolsSink.

---

## 3. Recommended order

The original recommended order 1-4 (decide policy A → gate B in CI → decide on the C analyzer → roll out A) and E are
**all complete or settled (2026-07-16)**. What remains:

1. **D (the release build plus the dependency regression)** — done in one go at release time (the examples regression was done ahead of time on 2026-07-17, §D)
2. **Catching up the wcstack-app skill** — done **after the release** (the end of §D). It is an artifact that reads the published CDN version, so staying as-is until the release is correct, exactly as with the examples
3. **The individual decisions on the 3 deferred nodes** — permission / network (whether a capability-only errorInfo has value), defined (redesigning its error surface)
4. **The lane trace → devtoolsSink bridge** — an untouched follow-up (§F; not a blocker for defaulting)

---

## Appendix: verified facts (re-verified 2026-07-17)

- errorInfo implemented in **27 packages** = `grep -rl errorInfo packages/*/src/exports.ts` (the initial figure before the roll-out was 8).
- 6 packages carry a generated lane copy = `packages/*/src/core/operationLane.ts`. `sync-io-core.mjs --check` = 33 generated files consistent.
- The architecture-hardening-related steps in CI are `sync-io-core.mjs --check` plus the independent **`wcs-validate`** job (added in §B; it gates the HTML of examples plus packages on error severity, currently 0 errors).
- Added 2026-07-17: the independent **`bindable-conformance`** job (`scripts/conformance-bindable-inputs.mjs`) — it checks the invariant "a settable wcBindable member is declared in `inputs` too" by cross-referencing the **evaluated declarations** (importing the dist bundle) against prototype-chain setters (41 packages / 79 classes / 441 members). Unlike a source lint it covers dynamically generated declarations too, and it was demonstrated to catch `navigateUrl` against v1.20.0's router (a permanent guard for the router navigateUrl and DCC `$bindables` type drift). Since the committed dist lags src, release.yml also re-runs the same script right after the post-bump rebuild and before publishing, as a complement. Deliberate output-only members (`Router.path` / `StorageCore.value`) are recorded in an in-script allowlist with reasons. A declaration factory that does not appear in the dist exports (DCC's `createWcBindable`) is pinned by a state unit test.
- The Phase 2 flip is in commit `aaeb784` (whose message understates it as "geolocation errorInfo" and mixes in the state change).
