# State next major — building-block technology survey

**日本語**: [state-next-major-tech-survey.ja.md](./state-next-major-tech-survey.ja.md)

Surveyed 2026-09-20. Target: `@wcstack/state` 2.5.1 (main `6bff9f2c`, working branch `major/state-next`). Continues the [audit](./state-next-major-audit.md) (2026-09-18) and the [requirements](./state-next-major-requirements.md). Before phase 3 of requirements §9 ("compare prototypes"), each technology a prototype would be built from is measured on its own so that adoption can be argued from numbers. No source or distributed file was changed; every build goes to a temporary directory. **This document decides nothing.**

| ID | Technology | Question | Requirements |
|---|---|---|---|
| T1 | Static coupling between core and features | When split entries are added, which edges must be cut so the core stops dragging features in | G2, B13, N2 |
| T2 | Quote-aware lexer → AST → compatibility adapter | How many lines and KB a three-stage grammar layer costs, how much of the current grammar it accepts, how it reports the audit's inconsistencies, and whether the shipped output contract can be reproduced | B1–B5, D2 |
| T3 | Dependency-graph mechanisms | How "every row reads one scalar" behaves in time and memory under path-pattern edges, cells (signals) and a keyed index | D7, A3, A5 |
| T4 | DOM floor | How many ms the same table costs to create, append, update and clear with no runtime at all, and what `moveBefore` preserves | A3, audit §4.3 |
| T5 | The platform as of 2026-09 | Which standards can be relied on and which do not exist yet | D1, D3, §10 |
| T6 | Counters inside the real runtime | For each operation of the current runtime, how many expansions, address creations, getter evaluations, binding lookups, applies, row creations, diffs and pool moves happen, and where the time goes | A3, audit §4.3 |
| T7 | Stubbed-build remainder | How many KB of the current source remain once the feature groups are cut, and which modules and members hold them | A2, G1 |

## 1. Findings

1. **There are few cut points.** The core imports features through 49 value edges, and only three library modules (watch, stream, volume) plus the bootstrap in `auto.ts` run registration code when evaluated. `defineState.ts` has no value import at all, so a side-effect-free helper entry (N2) is one extra Rollup entry. What remains hard is a 28-module cycle spanning apply / bindings / structural / event / mount / SSR.
2. **A three-stage grammar is cheap in lines but does not save bytes.** The quote-aware lexer + AST is 258 lines and the compatibility adapter 69; on 539 distinct `data-wcs` values in the corpus they return output identical to the shipped parser for 523, down to the behaviour of the built filter functions. Every difference is an intended diagnostic or a laxity of the current parser. Bundled like for like, though, the grammar stage alone goes from the shipped 1.7 KB gzip (`bindTextParser/` on its own) to 3.2 KB for spike + adapter: diagnostics, arity checks and quote handling cost 1.5 KB. Most of the 16 KB `parser.esm.js` is filter functions and PathInfo, which a grammar rewrite does not touch. B4 is not an ambiguity: the README-documented `radio#ro` and `checkbox|int` are parsed as generic properties, and the runtime never routes them to their handlers.
3. **"Every row reads one scalar" is O(N) whatever the mechanism.** Both the path-pattern graph and signals cells evaluate 10,000 times for 10,000 rows. Only a subscription index keyed by the compared value reaches O(1), which is what D7 ("support optimized selection through an API") describes. Signals cells cost 2.3–9.9 KB per row, 14–17× the path-pattern graph, which puts numbers on the council's performance finding ③ ("cell-per-field explodes with element count").
4. **The current runtime's selection cost is a constant factor, and it now has a breakdown.** A tracked-getter selection change over 10,000 rows spends about 25 % on the write side (set trap → dependency walk → enqueue) and 75 % in the drain, of which four fifths is binding apply and half of that is getter reads. Per row it does one enqueue, two getter reads, three get traps, six address-object creations, one binding lookup and one apply; the mechanism model with the same O(N) shape did one evaluation and no allocation per row.
5. **Row creation cost is bookkeeping, not DOM cloning.** Of the 281 ms (median) list apply for creating 10,000 rows, row content creation takes 145 ms for the 9,000 new rows (16 µs each): template clone 2.5 µs (the same as the DOM floor), node-path resolution 1.9 µs (5 per row), binding records and event attachment 4.9 µs, ledger registration and binding-object copies about 6.5 µs. Activation follows at 105 ms (10.5 µs per row), and DOM insertion, diff and the rest take about 30 ms. Of roughly 26 µs per row, the DOM is 2–4 µs; the rest is record, ledger and activation bookkeeping. Creating 1,000 rows from the pool after a clear drops from 65 ms (first, cold) to 12–20 ms. Removing one row re-evaluates 11,000 rows because the getter reads the index, and the swap's double diff (2.3 ms) is smaller than its move work (4.7 ms). The write side costs 2.4 µs per set.
6. **Clear is 21 ms of engine plus 25–40 ms of detaching laid-out rows.** Measured inside the runtime, the clear's drain takes 19–25 ms. Whether clear measures about 25 ms or about 65–80 ms from outside is decided by whether the rows have ever been rendered (laid out). With no runtime, `replaceChildren()` takes 3.6 ms right after creation (no frame rendered) and 28 ms after two rAFs (rendered). A trace of the high mode shows no `Layout` and no GC events; everything sits inside the DOM calls the script makes. Users always see rendered rows, so the audit's 72.95 ms is the realistic value, and the engine's share of it is about 21–25 ms.
7. **The DOM floor is an order of magnitude below wcstack.** In Chromium, creating 1,000 rows costs 2.2–6.3 ms (wcstack 42.85 ms), updating 1,000 rows 1.9 ms (13.10 ms), appending 1,000 rows to 10,000 2.4 ms (66.00 ms). A re-run of the audit's benchmark agrees with the audit's medians within 10–30 %, so the shipped bundle's numbers are stable across runs. Firefox 151 creates 2.4× and clears 3.4× slower than Chromium; WebKit 26.5 is close to Chromium. `moveBefore` keeps focus and selection in Chromium and Firefox and does not exist in WebKit.
8. **Cutting every feature leaves a 44 KB gzip core, and 54 % of `State.ts` is feature wiring.** With devtools, the temporal features, recursion, component scopes, SSR and the formatting filters stubbed out, 147.6 KB minified (44.0 KB gzip) remain, 21 % of it in `State.ts` (18.8 KB) and `BindingSession.ts` (12.9 KB). At member level, 10.1 KB (54 %) of `State.ts` sits in members that reference webComponent / stream / watch / scan / dcc / stateLoader (`connectedCallback` 2.7 KB, `_initializeBindWebComponent` 2.3 KB, four volume members 2.3 KB, the `_state` setter 1.2 KB, and more); `BindingSession.ts` references no feature group at all and is the DOM adapter proper, with the row-plan and general paths duplicated at 2.0 KB against 4.9 KB. 55 % of `setByAddress.ts` touches dcc / devtools / webComponent / watch. A2's 35 KB amounts to about 30 KB minified to remove, which comes into view only with the wiring extracted (10–13 KB) and the duplicated paths unified.
9. **Design without waiting for the platform.** TC39 Signals is still Stage 1, DOM Parts has not shipped, and `moveBefore` and Scoped Custom Element Registries each lack either WebKit or Firefox. The reactive core and the template plan stay in-house; `moveBefore` is used behind feature detection. Conversely the Navigation API, import-map `integrity` and `AbortSignal.any()` are now in all three engines.

## 2. Conditions and limits

- Same machine as the audit (Intel Core Ultra 9 275HX, Node 22.19.0, TypeScript 5.9.3, terser 5.46.0). Browsers from Playwright 1.61.1: Chromium 149.0.7827.55, Firefox 151.0, WebKit 26.5.
- T1 analyses the JavaScript emitted by tsc. The tsconfig does not set `verbatimModuleSyntax`, so analysing the TypeScript source counts type-only imports written without `type` as value edges (68 edges and a 46-module cycle on the source, 49 and 28 on the emitted output). Lines are newline counts of the TypeScript source including comments and blanks: 257 modules, 29,294 lines.
- The T2 corpus is every `data-wcs="…"` matched by a regular expression in the HTML under `examples/`, `packages/*/examples/`, `packages/*/__e2e__/` and in `packages/*/README{,.ja}.md`. It includes prose fragments from READMEs (rejected by both parsers). The adapter comparison checks, beyond the binding projection, that every built filter function gives the same result (including the exception type) on eight probe values (`['X','Y']`, `'abc'`, `3`, `0`, `true`, `null`, `undefined`, `1234.567`). The size comparison bundles the shipped `src/bindTextParser/` on its own (imports leaving the directory external) against lexer + adapter on their own (PathInfo and filter functions injected).
- T3 is a **model of the mechanisms**, not the wcstack runtime. Every mechanism drives the same stub DOM and the same per-field binding record; only the reactive bookkeeping differs. Median of 7 runs, `--expose-gc`. Heap is the delta between after allocating the row data and after building. Signals is the distributed build in `packages/signals/dist`.
- T4 loads no runtime, uses the audit's table, CSS and `buildData.js`, and times the same way as the audit (operation → MutationObserver callback, so record creation is included). **Two Chromium runs differed** by 27.9 / 37.0 ms for creating 10,000 rows, 255.7 / 145.5 ms for the same at 4× CPU throttle and 267.6 / 180.1 ms for clearing at 4×; the tables show the second run (the JSON), and the 4× values are not used for ratios. At 1,000 rows the spread between variants (2.2–6.3 ms) is within timer resolution and GC noise. Firefox's `performance.now()` is 1 ms coarse.
- The audit's benchmark (`e2e/bench/jsfb-verify.mjs`, the shipped `auto.min.js`, 8 samples) was re-run on the same day ([browser-1x-rerun.json](./research/state-next/browser-1x-rerun.json)); its medians agree with the audit within 10–30 % (§6.3). The benchmark **reloads the page before every sample** (cold).
- The clear bimodality (§8.5) was separated with [audit-state-tech-warmth.mjs](../scripts/audit-state-tech-warmth.mjs), which uses the benchmark's timing function and takes cold (reload per sample) and warm (one page, back to back) samples, 6 each, while swapping one condition at a time (bundle, fixture, preceding operations, timing method, setup style, forced GC). The trace (§8.6) uses CDP `Tracing` with the `devtools.timeline`, `disabled-by-default-devtools.timeline`, `v8` and `disabled-by-default-v8.gc` categories, rolled up over the complete events on the marks' thread inside the `performance.mark` window. **Tracing slows execution** (creating 10,000 rows: 288 → 481 ms), so it is used for proportions only. The frame experiment (§8.6) uses a fresh page per sample, 6 samples.
- T5 reflects web-features 3.39.0 and BCD 8.1.2 on 2026-09-20. The full table with sources is in the [record](./research/state-next/platform-status-2026-09.md).
- T6 rebuilds the named entry into a temporary directory with a Rollup transform that wraps functions in counters. Stage 1 (expansion, addresses, reads, apply) instruments 11 modules; stage 2 (inside the list apply and the write path) 13; stage 3 (inside row content creation) 12. **The wrappers inflate elapsed time, and the stages wrap different sets, so elapsed times are not compared even between stages** (tracked-getter selection over 10,000 rows: stage 1 24.4 ms, stage 2 12.3 ms, audit 21.10 ms). Counts agree between stages and are exact. In stages 1 and 2, create, append and clear are single samples; in stage 3, create 10,000 / append / clear are medians of 3 and create 1,000 has 5 samples (the first creates content, the later ones reuse the pool). The fixture is the audit's; `tracked` is the audit's "ordinary tracked getter", `manual` the fixture's hand-written two-row notification.
- T7 stubs keep only the original module's export names, bound to `undefined`. Core call sites remain, so the bundles **cannot run and the sizes are an upper bound**. The full value (71.1 KB) matches the audit's minify experiment (71.2 KB). Per-module and per-member attribution is minified bytes from the source map, not gzip (gzip is about 30 % of minified for this remainder). A member's referenced groups are the source directories of the imported names used inside it; interface-looking names starting with `I` are ignored.

## 3. T1 — static coupling between core and features

### 3.1 Reach per entry

| Entry | Modules reached | Lines | Modules that run code when evaluated |
|---|---:|---:|---:|
| `exports.ts` | 227 | 28,211 | 10 |
| `auto.ts` | 228 | 28,221 | 11 |
| `bootstrapState.ts` | 222 | 27,327 | 10 |
| `components/State.ts` | 216 | 26,421 | 10 |
| `proxy/StateHandler.ts` | 177 | 19,792 | 7 |
| `updater/updater.ts` | 133 | 14,543 | 7 |
| `parser.ts` | 17 | 1,899 | 0 |
| `manifest.ts` | 10 | 1,609 | 0 |
| `defineState.ts` | 1 | 396 | 0 |

`defineState.ts` value-imports nothing but itself. The audit's "26.8 KB gzip for `defineState` alone" (§3.1) came from re-exporting out of the bundled `index.esm.js`, which keeps the side-effect modules; **an entry cut directly from the source is close to zero**. Of the 1,899 lines reached by `parser.ts`, 916 are `filters/`, because the parser builds filter functions at parse time (audit §7); the grammar stage alone is the 1.7–3.2 KB of T2.

### 3.2 Side effects at module evaluation

| Module | Line | Statement |
|---|---:|---|
| `watch/watchRuntime.ts` | 410 | `registerUpdateBatchListener(fireWatchOnUpdateBatch, …)` |
| `stream/streamRuntime.ts` | 241 | `registerUpdateBatchListener(restartStreamsOnUpdateBatch, …)` |
| `webComponent/volume.ts` | 415 | `setVolumeGraftHandler(graftIsolated)` |
| `auto.ts` | 9 | `await bootstrapState()` |
| `updater/updater.ts` | 304 | `updater = new Updater()` (singleton) |
| `event/{handler,twowayHandler,radioHandler,checkboxHandler}.ts` | 24 / 19 / 11 / 11 | `createHandlerBindingRegistry()` |

The first three are what G2 calls "stays after a mere import". If the callers (`updater` / `mountScope`) accept registrations instead, a feature is not evaluated unless imported.

Addendum (same day, §10.5): S2 moved the first three into `install()`, and the modules that run code at evaluation went from 11 to 8. The table stays as measured.

### 3.3 Edges from core into features (49)

| Feature | Edges | Main origins |
|---|---:|---|
| `webComponent` | 16 | `proxy/methods/getByAddress` → volumeShared / mount / overlay / exportIndex; `setByAddress` → volumeShared / exportIndex / overlay; `proxy/traps/get` → mount; `apply/applyChangeToFor` → mountScope; `event/handler` → mount; `list/loopContextByNode` → mount |
| `devtools` | 12 | all into `devtools/sink` (`bootstrapState` into bridge) |
| `recursion` | 8 | `proxy/apis/{getAll,setAll,trackDependency}`, `proxy/traps/get` → expand / bind |
| `components` | 5 | 4 into `Ssr.ts` (exports / hydrateBindings / buildSsrDocument / registerComponents), 1 into `State.ts` |
| `stream` | 3 | `getByAddress` → argsTrace / streamNamespace; `traps/get` → streamNamespace |
| `watch` | 2 | `setByAddress` → prevValues; `updater` → chainDepth |
| `dcc` | 2 | `setByAddress` / `postUpdate` → dispatchBindableEvent |
| `scan` | 1 | `updater` → eventReset |

Fifteen edges converge on three files: `getByAddress`, `setByAddress`, `traps/get`. That is the same place as B6's "single write boundary"; a hook receptacle there removes the webComponent / stream / watch / dcc edges together. `devtools` is one sink, so a no-op sink in the core is enough.

Addendum (same day, §10.5): S1 reduced the 12 `devtools` edges to 1, and S2 added 3 from `bootstrapState.ts` into watch / stream / volume, for 41 in total.

### 3.4 The cycle

Over value imports there is one cycle: 28 modules in 8 groups.

| Group | Members |
|---|---|
| `apply` | applyChange, applyChangeFromBindings, applyChangeToFor, applyChangeToIf, scheduleDeferredApply |
| `bindings` | BindingSession, binder, collectNodesAndBindingInfos, getParseBindTextResults, initialSync, initializeBindings |
| `structural` | activateContent, collectStructuralFragments, createContent, fragmentInfoByUUID, getFragmentNodeInfos, rowPlan |
| `event` | handler, twowayHandler, radioHandler, checkboxHandler, eventTokenHandler |
| `(root)` | buildBindings, hydrateBindings, stateElementByName |
| `binding` | getAbsoluteStateAddressByBinding |
| `components` | Ssr |
| `webComponent` | mountScope |

Its core is the recursion "build bindings → build rows → build the bindings inside a row", which is a cycle by design (templates nest). What needs cutting is not the cycle but the presence of `Ssr` and `mountScope` in it. The 18 modules of `proxy` / `updater` / `watch` / `stream` / `scan` / `recursion` that the source analysis placed in the cycle are there through type-only imports; rewriting them as `import type` removes them statically too.

## 4. T2 — quote-aware lexer → AST → compatibility adapter

Spike: [bindTextLexerSpike.mjs](../scripts/research/bindTextLexerSpike.mjs). One pass over the characters; inside quotes `; : | # , ( )` are not structural. It never throws, collects diagnostics with positions, and builds no filter function. Compatibility adapter: [bindTextAdapterSpike.mjs](../scripts/research/bindTextAdapterSpike.mjs) (69 lines), which assembles the shipped `IParsedBinding` from the AST; PathInfo and filter functions are injected.

### 4.1 The audit's reproduction cases

| Input | Shipped parser | Spike |
|---|---|---|
| `join(';')` `join('\|')` | error | accepted (B1) |
| `join('unterminated)` | accepted | `E_QUOTE_UNTERMINATED` (B2) |
| `value#ro#wo: x` | keeps only `ro` | `E_MODIFIER_SEPARATOR` (B2) |
| `else: ignored` | drops the right side | `E_ELSE_STATE_PART` (B2) |
| `join(a,b)` | accepted; cache key collides with `join('a,b')` | `E_FILTER_ARITY`; key is `["join",["a","b"]]` (B3) |
| `eq(1,2)` `eq()` | accepted | `E_FILTER_ARITY` (B3) |
| `radio#ro: x` | type `prop` | type `radio` with modifier `ro` (B4) |
| `checkbox\|int: values` | type `prop` | type `checkbox` with input filter `int` (B4) |
| `for#x: items` | accepted | `E_MODIFIER_NOT_ALLOWED` |
| `value#init: w` | accepted | `E_MODIFIER_VALUE` |
| `join('a') extra` | accepted | `E_FILTER_TRAILING` |
| `textContent:` | accepted (empty path) | `E_PATH_REQUIRED` |
| `x\|nope` | throws at parse time | `W_FILTER_UNKNOWN` (function resolution is a later stage; the adapter throws when resolving) |
| `only: x` `online: x` | event | event (B5 is a namespace decision that lexing cannot make) |

The damage behind B4: [applyChange.ts:43](../packages/state/src/apply/applyChange.ts#L43) picks the `radio` apply function by `bindingType`, and [checkboxHandler.ts:81](../packages/state/src/event/checkboxHandler.ts#L81) attaches the handler only when `bindingType === "checkbox"`. The README-documented `radio#ro` and `checkbox|int` come out of the shipped parser as `prop`, so neither reaches its handler. No test or example contains either form.

### 4.2 Corpus (150 files, 539 distinct values)

| Verdict | Lexer (projection only) | Adapter (projection + filter behaviour) | What |
|---|---:|---:|---|
| Identical | 523 | 523 | zero behaviour differences across the 8 filter probes |
| Rejected by the spike only | 6 | 6 | README placeholders (`if: …`, `for:`, `textContent:`) and prose |
| Rejected by the shipped parser only | 2 | 0 | the lexer only warns about `debounce(1000)`; the adapter throws when resolving the function, like the shipped parser |
| Rejected by both | 8 | 10 | prose fragments the regular expression picked out of READMEs, plus a non-existent filter |

The spike dropped no real usage. Once, a spike defect rejected `state: .` (the relative path naming the row itself); it was fixed and the corpus re-run.

### 4.3 Size of the grammar stage (minified, bundled under the same conditions)

| Subject | Bytes | gzip | Brotli |
|---|---:|---:|---:|
| Shipped grammar stage (`src/bindTextParser/` alone; outside imports external) | 3,863 | 1,693 | 1,452 |
| Spike lexer alone | 6,197 | 2,764 | 2,463 |
| Spike + compatibility adapter | 7,485 | 3,236 | 2,908 |
| For reference: shipped `parser.esm.js` (with PathInfo, filter functions and caches) | 58,038 | 15,978 | 13,053 |

Quote handling, positioned diagnostics, arity checks and structural cache keys cost about 1.5 KB gzip. Most of `parser.esm.js` (the 916 lines of `filters/` and PathInfo) lies outside the grammar stage, so rewriting the grammar does not shrink it. D2's "parse the old grammar into the new AST during the migration" works with this adapter (69 lines) as the compatibility surface.

### 4.4 Open points

- The `on` prefix (B5), and when filter functions are resolved (throw at parse time, or look up a registry when the binding plan is built). The latter bears directly on custom filters and on split-loading readiness (requirements §10).
- Backslash escapes inside quotes are new meaning; the shipped parser has no such notion.
- The format in which positioned diagnostics are shared with lint and `vscode-wcs`.

## 5. T3 — dependency-graph mechanisms

Three mechanisms were run against the same stub DOM ([graph-mechanisms.json](./research/state-next/graph-mechanisms.json)). P is the shape of the current design (one edge per path pattern, expanded to every row on write, getter evaluated per row and applied only when the value changed); S holds one `computed` and one `effect` per row over `@wcstack/signals`; K indexes subscribers by the key they compare against.

### 5.1 Time (median ms)

| Rows | Mechanism | build | selection change (evaluations) | manual two-row notify | update every 10th | replace all |
|---:|---|---:|---:|---:|---:|---:|
| 1,000 | P | 0.244 | 0.102 (1,000) | 0.001 (2) | 0.023 | 0.141 |
| 1,000 | S | 2.985 | 0.411 (1,002) | — | 0.047 | 1.692 |
| 1,000 | K | 0.267 | 0.000 (2) | — | 0.017 | 0.068 |
| 10,000 | P | 0.462 | 0.441 (10,000) | 0.000 (2) | 0.126 | 0.405 |
| 10,000 | S | 14.921 | 1.603 (10,002) | — | 0.341 | 19.829 |
| 10,000 | K | 0.927 | 0.000 (2) | — | 0.109 | 0.845 |

For S the equality cut-off keeps effect bodies to two rows, but every row's `computed` recomputes. "Replacing with signals does not remove the dependency" (audit §4.2) holds; only the DOM writes disappear.

### 5.2 Memory (10,000 rows, bytes per row, after GC)

| Bound fields | P | S | K |
|---:|---:|---:|---:|
| 1 | 160 | 2,260 | 335 |
| 10 | 593 | 9,858 | 767 |

### 5.3 Relation to the real runtime

The browser measurement in audit §4.2 gives 1.00 ms (1,000 rows) / 21.10 ms (10,000 rows) for the tracked getter and 0.10 ms for the manual two-row notification. The P model, with the same O(N) shape, gives 0.10 / 0.44 ms. T6 (§8) breaks the difference down: it is not the shape of the expansion but the per-row constant (six address objects, two getter reads, three get traps, a binding lookup and an apply) that makes up the roughly 50×.

Implication for D7: the O(N) of an ordinary getter stays whatever mechanism is chosen. O(1) is needed only for "rows decided by a value comparison", and that is provided as a different subscription shape, a keyed index — the API form of what the fixture writes by hand with `$untrackDependency` plus two row writes.

## 6. T4 — DOM floor

No runtime, median of 7 ([dom-floor.json](./research/state-next/dom-floor.json)). The comparison column is wcstack 2.5.0 from audit §4.1 (Chromium).

### 6.1 Chromium 149

| Operation | Variant | DOM floor ms (min–max) | wcstack ms |
|---|---|---:|---:|
| Create 1,000 rows | template clone + child-index resolution + fragment | 3.90 (3.7–5.1) | 42.85 |
| 〃 | `importNode` | 2.80 | |
| 〃 | clone + `querySelectorAll` | 2.20 | |
| 〃 | clone + TreeWalker | 2.50 | |
| 〃 | clone + binding record allocation | 3.90 | |
| 〃 | `innerHTML` | 6.30 | |
| 〃 | `createElement` | 5.90 | |
| Create 10,000 rows | clone + child index + fragment | 37.0 (33.6–47.1) | — |
| 〃 | clone, no fragment | 31.3 (16.9–44.6) | |
| 〃 | clone + binding record allocation | 23.5 (18.1–42.6) | |
| 〃 | reuse from pool | 18.1 (17.1–25.9) | |
| 〃 | `innerHTML` | 55.9 | |
| 〃 | `createElement` | 40.0 (25.1–63.4) | |
| Append 1,000 to 10,000 | clone + fragment | 2.40 (2.0–4.7) | 66.00 |
| Clear 10,000 | `replaceChildren()` | 38.4 (5.1–48.6) | 72.95 |
| 〃 | `textContent = ''` | 42.9 (5.8–48.0) | |
| 〃 | `innerHTML = ''` | 30.1 (4.7–45.6) | |
| 〃 | `Range.deleteContents()` | 42.9 (9.0–55.4) | |
| 〃 | `remove()` from the end | 37.3 (12.0–57.0) | |
| Update every 10th (1,000 rows) | `Text.data` / `nodeValue` / `textContent` | 1.90 / 2.00 / 2.00 | 13.10 |
| Select (class toggle) | `classList` / `className` | 0.00 | 0.10 (manual) |
| Swap two rows (1,000) | `insertBefore` ×2 / `moveBefore` ×2 | 0.00 / 0.00 | 1.30 |
| Remove one row (1,000) | `remove()` | 0.10 | 3.15 |
| CPU 4×: create 10,000 / append 1,000 / clear 10,000 | clone / clone / `replaceChildren` | 145.5 / 17.2 / 180.1 | — / 320.7 / 329.6 |

### 6.2 Firefox 151 and WebKit 26.5 (headline operations only)

| Operation | Chromium 149 | Firefox 151 | WebKit 26.5 |
|---|---:|---:|---:|
| Create 1,000 rows (clone) | 3.9 | 6.0 | 4.0 |
| Create 10,000 rows (clone) | 37.0 | 89.0 | 49.0 |
| Append 1,000 to 10,000 | 2.4 | 9.0 | 5.0 |
| Clear 10,000 (`replaceChildren`) | 38.4 | 130.0 | 40.0 |
| Swap `insertBefore` / `moveBefore` | 0.0 / 0.0 | 1.0 / 0.0 | 0.0 / none |

### 6.3 Re-run of the audit's benchmark (shipped `auto.min.js`, median of 8 samples, ms)

| Operation | Audit (2026-09-18) | Re-run (2026-09-20) | Re-run min–max |
|---|---:|---:|---:|
| Create 1,000 rows | 42.85 | 40.05 | 34.4–60.8 |
| Replace all 1,000 rows | 24.35 | 17.2 | 12.8–26.7 |
| Update every 10th (10,000 rows) | 13.10 | 12.95 | 10.7–15.9 |
| Select (manual, 1,000 rows) | 0.10 | 0.10 | 0.1–0.2 |
| Swap two rows (1,000) | 1.30 | 0.90 | 0.8–1.3 |
| Remove one row (1,000) | 3.15 | 2.85 | 2.5–3.5 |
| Append 1,000 to 10,000 | 66.00 | 57.7 | 42.4–71.0 |
| Clear 10,000 | 72.95 | 69.8 | 53.5–88.4 |

- The create gap (about 7–19× at 1,000 rows in Chromium) is binding initialisation and row registration. The spread at 10,000 rows (33.6–47.1, and 19.8–45.5 in the earlier run) is GC, consistent with the audit's "row creation and initialisation allocation" candidate. T6 stage 3 shows about 20 µs of bookkeeping per row against 2.5 µs of DOM cloning.
- The DOM floor's clear splits into a 30–43 ms median and a 5–12 ms minimum according to whether the rows have been rendered (§8.6). The 30–40 ms gap to the runtime's 70 ms is the cost of detaching laid-out rows, not an engine cost.
- Append is 2.4 ms for the DOM against 57.7–66.0 ms for wcstack; T6 confirms that the gap is in row creation, initialisation and activation, not in the expansion.
- The `moveBefore` probe: `insertBefore` loses the `<input>`'s focus (value and selection survive) and gives the custom element one disconnected and one connected callback. `moveBefore` keeps focus and selection in both Chromium and Firefox, but a custom element that does not define `connectedMoveCallback` still receives disconnected / connected, as specified. WebKit 26.5 has no `moveBefore`. Using it for keyed moves therefore needs feature detection with an `insertBefore` fallback, and raises a separate decision about adding `connectedMoveCallback` to the I/O nodes.

## 7. T5 — the platform as of 2026-09

The full 24-row table with sources is [platform-status-2026-09.md](./research/state-next/platform-status-2026-09.md). Only the rows that bear on the design are listed here.

| Feature | Status | Implication for the next major |
|---|---|---|
| TC39 Signals | Stage 1 (no progress since 2024-06; `signal-polyfill` stopped at 0.2.2) | The reactive core stays in-house. Shaping the API after TC39 (the signals package) remains viable |
| DOM Parts / Template Instantiation | not shipped; the successor proposal is "not ready for review" | Template plan and row instances stay in-house |
| `Element.moveBefore()` | Chrome 133 / Firefox 144, no WebKit (confirmed in T4) | Use behind feature detection with an `insertBefore` fallback; do not depend on its state preservation as a contract |
| Scoped Custom Element Registries | Chrome 146 / Safari 26, Firefox Nightly only | Cannot be a premise for the autoloader or DCC |
| Import-map `integrity` | all three engines | SRI can cover dynamically loaded chunks of a split distribution (requirements §10, [sri](./sri.md)). Multiple import maps are behind a flag in Firefox |
| Navigation API | Baseline Newly with Firefox 147 / Safari 26.2 (2026-01) | Input to how long the router keeps its popstate fallback |
| `AbortSignal.any()` / `timeout()` | about to be Widely (2026-09-19 / 10-18) | Adoptable as the standard cancel vocabulary (the council's route C asset) |
| `Temporal` | Chrome 144 / Firefox 139, Safari in STP only | Date filters stay on `Intl` |
| Explicit Resource Management (`using`) | Chrome 134 / Firefox 141, Safari preview | Not usable for the public shape of a dispose API |
| Observable | Chrome only, Mozilla negative | The event → signal bridge stays in-house |
| `setHTMLUnsafe` / `parseHTMLUnsafe` | Newly 2025-09 | Usable for declarative shadow DOM parsing in SSR hydration |
| Sanitizer `setHTML()` | Chrome 146 / Firefox 148, no Safari | Cannot be the default for `html:` bindings |
| Invoker commands (`command` / `commandfor`) | Newly 2025-12 | Vocabulary can collide with the command-token protocol; keep in mind when renaming |
| Declarative Shadow DOM | Widely 2026-08 | Safe as an SSR premise |

## 8. T6 — counters inside the real runtime

The audit's fixture was driven against temporary builds with counters injected (Chromium 149). Stage 1 counts expansion, addresses, reads and applies ([runtime-counters.json](./research/state-next/runtime-counters.json)); stage 2 counts inside the list apply and on the write path ([runtime-counters-list.json](./research/state-next/runtime-counters-list.json)); stage 3 counts inside row content creation ([runtime-counters-content.json](./research/state-next/runtime-counters-content.json)). `tracked` is the ordinary tracked getter, `manual` the fixture's hand-written two-row notification. Times include the wrappers and are not compared between stages.

### 8.1 Stage 1: expansion, addresses, reads, apply

| Operation (rows) | Elapsed ms | walk count / ms | enqueue | getter reads / evaluations | addresses created (state / abs / tree) | applies | apply ms | drain ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Create 1,000 | 34.1 | 1 / 4.6 | 4,001 | 7,004 / 6,004 | 12,003 / 11,002 / 14,002 | 3,001 | 25.9 | 27.5 |
| Create 10,000 | 277.7 | 1 / 20.5 | 40,001 | 70,004 / 60,004 | 120,003 / 110,002 / 140,002 | 30,001 | 246.4 | 251.3 |
| Select, tracked (1,000) | 1.8 | 1 / 0.4 | 1,001 | 2,003 / 2,003 | 2,003 / 2,002 / 2,002 | 1,000 | 1.2 | 1.5 |
| Select, tracked (10,000) | 24.4 | 1 / 4.6 | 10,001 | 20,003 / 20,003 | 20,003 / 20,002 / 20,002 | 10,000 | 16.7 | 19.7 |
| Select, manual (10,000) | 0.1 | 4 / 0.0 | 4 | 14 / 12 | 12 / 8 / 8 | 2 | 0.0 | 0.0 |
| Update every 10th (10,000) | 11.0 | 1,000 / 0.2 | 1,000 | 6,002 / 3,002 | 5,002 / 4,000 / 4,000 | 1,000 | 3.0 | 4.0 |
| Append 1,000 (10,000 → 11,000) | 67.0 | 1 / 5.2 | 4,001 | 7,004 / 6,004 | 12,003 / 11,002 / 14,002 | 3,001 | 53.6 | 54.8 |
| Swap two rows (11,000) | 13.5 | 1 / 4.5 | 3 | 9 / 9 | 8 / 6 / 6 | 3 | 8.5 | 8.6 |
| Remove one row (11,000) | 43.8 | 1 / 12.9 | 11,000 | 22,002 / 22,002 | 22,001 / 22,000 / 22,000 | 11,000 | 21.3 | 25.5 |
| Clear (11,000 → 0) | 37.9 | 2 / 1.4 | 2 | 5 / 5 | 4 / 4 / 4 | 1 | 29.9 | 29.9 |

Time spent reading getters: 9.7 ms for the 10,000-row selection, 23.1 ms for creating 10,000, 5.8 ms for the append, 9.7 ms for the removal, 2.3 ms for the update.

### 8.2 Stage 2: inside the list apply and on the write path

"Write side" is the time from entering the set trap to returning from it (the synchronous part: `setByAddress`, the dependency walk and the enqueues).

| Operation (rows) | Elapsed ms | write side ms | of which walk ms | drain ms | list apply ms | diff count / ms | list indexes created | row contents count / ms | row init count / ms | activate / deactivate | pooled | get traps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Create 1,000 | 53.1 | 7.9 | 7.1 | 42.4 | 40.6 | 2 / 0.9 | 1,000 | 1,000 / 21.1 | 1,000 / 7.4 | 1,000 / 0 | 0 | 5,004 |
| Create 10,000 (1,000 reused from the pool) | 335.0 | 29.9 | 29.7 | 298.4 | 285.8 | 2 / 2.5 | 10,000 | 9,000 / 128.3 | 9,000 / 39.7 | 10,000 / 0 | 0 | 50,004 |
| Select, tracked (10,000) | 12.3 | 3.2 | 3.0 | 9.3 | — | 1 / 0.2 | 0 | 0 | 0 | 0 / 0 | 0 | 30,003 |
| Update every 10th (10,000) | 8.9 | 2.4 | 0.4 | 2.7 | — | 0 | 0 | 0 | 0 | 0 / 0 | 0 | 3,003 |
| Append 1,000 (10,000 → 11,000) | 44.1 | 3.5 | 3.5 | 33.0 | 32.2 | 2 / 2.8 | 1,000 | 1,000 / 14.3 | 1,000 / 5.1 | 1,000 / 0 | 0 | 5,005 |
| Swap two rows (11,000) | 8.5 | 2.4 | 2.4 | 5.9 | 5.9 | 2 / 2.3 | 0 | 0 | 0 | 0 / 0 | 0 | 12 |
| Remove one row (11,000) | 28.1 | 8.3 | 8.3 | 15.1 | 2.2 | 2 / 2.5 | 0 | 0 | 0 | 0 / 1 | 1 | 33,002 |
| Clear (11,000 → 0) | 26.8 | 1.0 | 1.0 | 21.1 | 21.1 | 3 / 1.1 | 0 | 0 | 0 | 0 / 999 | 999 | 5 |

### 8.3 Stage 3: inside row content creation (row-plan path)

Create 10,000 / append / clear are medians of 3 samples. Create 1,000 lists its 5 samples in order (the first creates 1,000 contents; the later ones reuse the 1,000 rows the preceding clear put in the pool, so content creation is 0).

| Operation (rows) | Elapsed ms | list apply ms | contents count / ms | of which template clone ms | of which node-path resolution count / ms | of which row bindings and records ms (event attach count / ms) | activation ms (of which plan rows ms) | list index ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Create 1,000, first | 64.8 | 50.9 | 1,000 / 29.2 | 5.4 | 5,005 / 4.3 | 12.5 (2,000 / 2.1) | 16.5 (4.4) | 0.9 |
| 〃 2nd–5th (pool reuse) | 27.2 → 22.3 → 12.4 → 11.7 | 22.3 → 9.5 | 0 / 0 | 0 | 0 | 0 (2,000 / 1.7 → 0.9) | 15.2 → 7.5 (5.8 → 3.6) | 0.3 → 0.2 |
| Create 10,000 (9,000 new) | 302.1 | 280.8 | 9,000 / 144.8 | 22.6 | 45,000 / 17.5 | 44.4 (20,000 / 11.6) | 105.3 (26.9) | 1.0 |
| Append 1,000 (10,000 → 11,000) | 45.3 | 33.6 | 1,000 / 16.6 | 2.4 | 5,000 / 2.5 | 5.3 (2,000 / 1.4) | 16.3 (5.2) | 0.1 |
| Clear (11,000 → 0) | 27.7 | 20.9 | 0 | 0 | 0 | 0 | 0 | 0 |

### 8.4 Reading

- **Selection, tracked, 10,000 rows**: in stage 2, 12.3 ms = write side 3.2 (walk 3.0) + drain 9.3 (binding apply 7.1; the 2.2 around it is the updater's de-duplication and binding-set resolution). By stage 1's proportions, 9.7 of the 16.7 ms apply is getter reads. Per row: 1 enqueue, 2 getter reads, 3 get traps, 6 address creations (2 state, 2 absolute, 2 tree path), 1 resolved address, 1 binding lookup, 1 apply. The roughly 50× against T3's P model (1 evaluation, 0 allocations per row) is this per-row constant.
- **Create (10,000 rows, per row)**: the 281 ms list apply is 28 µs per row: content creation 16 µs (template clone 2.5, node-path resolution 1.9, binding records and event attachment 4.9, ledger registration and binding-object copies about 6.5) + activation 10.5 µs (plan-row registration 2.7; the other 8 µs is the initial apply of three bindings. **Correction**: this first read "loop-context and session binding"; counting `applyChange` and the reads in §10.7 showed it is the initial render, 7 reads and 3 applies per row) + DOM insertion, diff and the rest about 3. The DOM floor is 2–4 µs per row, so the clone itself is at the floor; of the remaining 24 µs about 16 µs is bookkeeping and about 8 µs the initial apply. Stage 1's counts give 4 enqueues, 7 reads, 6 evaluations, 37 address objects and 3 applies per row.
- **Pool and JIT**: creating 1,000 rows that the clear put in the pool falls from 27 to 12 ms over successive samples, a fifth of the cold 65 ms. With the shipped bundle too, warm create-1,000 is 13–20 ms against 35–65 ms cold (§8.5). Rows beyond the pool limit (1,000) are always created anew, so the effect is absent at 10,000 rows.
- **Append**: expansion is held to the 1,000 new rows (the same counts as creating 1,000; diff expansion works). The apply, 33.6 ms = contents 16.6 + activation 16.3 + rest. Stage 1's 53.6 ms (twice creating 1,000) did not reproduce in stages 2 and 3; single-sample GC spread. **The earlier "28 ms proportional to the existing rows" is withdrawn.** Warm appends of the shipped bundle carry GC spikes of 140–470 ms (§8.5).
- **Removing one row**: walk 8.3 ms (diff included, 11,000 enqueues), row-binding apply 10.4 ms, list apply 2.2 ms. Moved rows re-evaluate only the "getters that read the index" (`walkDependency`'s movedRows), but this fixture's `selected` getter reads `$1`, so every row qualifies. The DOM floor is 0.1 ms.
- **Swapping two rows**: the diff runs once in the walk and once in the apply (2.3 ms together, the audit's "double diff", §4.3). The remaining 4.7 ms is row moves, list-index retire / revive and DOM moves, and is larger than what sharing the diff would save.
- **Update every 10th**: 1,000 sets cost 2.4 ms on the write side (2.4 µs each; walks 0.4 ms in total). Stage 1's reading of 7 µs included the address-creation wrappers and is corrected. Drain 2.7 ms; the remaining roughly 4 ms is the fixture's loop and the get traps of `+=`.
- **Clear**: the list apply takes 19–25 ms (4 samples across stages 2 and 3); deactivation, session dispose and pooling touch 999 rows (the pool limit), and the other 10,000 rows are dropped with their ledgers. Whether clear measures 27 ms or 70 ms from outside is decided by whether the rows have been rendered (§8.5, §8.6).

### 8.5 Separating the clear bimodality ([warm-vs-cold-*.json](./research/state-next/), shipped bundle unless stated, median of 6 samples, ms)

The counter harness reported clear at 27–30 ms, the benchmark at 70 ms. Conditions were swapped one at a time with the benchmark's own timing function. Cold reloads the page before every sample; warm keeps one page.

| Bundle / fixture / preceding sequence / timing / setup / GC | Clear cold | Clear warm | Create 1,000 cold / warm | Append cold / warm |
|---|---:|---:|---:|---:|
| `auto.min.js` / manual / plain / benchmark / real click / none (the benchmark's condition) | 67.3 | 62.0 | 50.5 / 19.8 | 50.1 / 58.7 |
| unminified `index.esm.js` / manual / plain / benchmark | 67.7 | 53.1 | 35.4 / 13.1 | 47.0 / 66.4 |
| counter-instrumented build / manual / plain / benchmark | 68.1 | 68.2 | 65.4 / 22.4 | 60.4 / 59.5 |
| `auto.min.js` / tracked / plain / benchmark | 67.3 | 73.3 | 53.1 / 19.2 | — |
| `auto.min.js` / manual / the counter harness's sequence (11,000 rows) / benchmark | 77.1 | 78.6 | — | — |
| `auto.min.js` / manual / plain / counter-harness observer (tbody) | 57.9 | 68.2 | 52.1 / 18.9 | 58.0 / 58.0 |
| `auto.min.js` / manual / plain / next macrotask | 68.2 | 69.7 | 106.1 / 68.2 | 61.0 / 229.2 |
| `auto.min.js` / manual / plain / benchmark / synthetic-click setup | 64.2 | 66.2 | 41.7 / 20.4 | 60.9 / 61.6 |
| `auto.min.js` / manual / plain / benchmark / real click / forced GC | 72.6 | 69.1 | — | 68.2 / 221.6 |
| counter-instrumented build / tracked / counter sequence / counter observer / synthetic click (everything combined) | 79.4 (min 25.2) | 82.7 | — | — |

- Under every condition the clear median is 53–83 ms; the counter harness's 27–30 ms does not reproduce. Only one cold sample with every condition combined hit 25.2 ms. The cause is identified in §8.6.
- Page warmth matters only for creating 1,000 rows (cold 35–65 → warm 13–22 ms: pool reuse and JIT). The benchmark measures cold, so its 40 ms is the value for "content created every time".
- Warm appends carry GC spikes of 140–470 ms, and a forced GC beforehand made them worse. Append and clear are compared on cold medians; warm is not used.

### 8.6 Trace and frame experiment: the bimodality is the detachment of laid-out rows

- With a CDP trace attached to the counter harness (stage 3), the clear's elapsed time rises to 57–76 ms and its internal drain to 51–67 ms, and the window rolls up to `FunctionCall` 53–70 ms, `Layout` 0, GC 0 ([runtime-counters-content-trace.json](./research/state-next/runtime-counters-content-trace.json)). The difference is not a separate rendering-pipeline event; it sits inside the DOM calls the script makes.
- Frame experiment ([frame-vs-clear.json](./research/state-next/frame-vs-clear.json), fresh page per sample, median of 6 samples, ms, min–max in brackets):

| Page | create → clear immediately (same task) | create → rAF ×2 → clear | create → `setTimeout(0)` → clear |
|---|---:|---:|---:|
| No runtime, `replaceChildren()` timed synchronously | 3.6 (3.2–3.8) | 28.1 (24.9–37.7) | 35.8 (2.7–43.1) |
| Shipped runtime, click → MutationObserver | 66.7 (27.2–71.0) | 49.5 (47.5–74.7) | 52.4 (48.1–55.5) |

- Without a runtime, the clear splits into 3.6 ms and 28 ms according to whether a frame was rendered. Once rendered, the rows carry layout objects, and detaching them costs about 25–40 ms. A `setTimeout(0)` sometimes renders a frame and sometimes not (2.7–43.1), which also explains T4's clear bimodality (minimum 5, median 38).
- The shipped runtime hits the high mode in 5 of 6 samples even when clearing immediately (the low mode is one sample at 27.2). Something in the runtime's creation path may force layout; this is unconfirmed. The natural reading of the counter harness's run of low values is that in those runs the rows were cleared before a frame rendered, consistent with the harness switching to the high mode as soon as tracing (which slows execution and lets a frame in) is attached.
  - Addendum (§10.6): confirmed with a trace that includes the `blink` category. Nothing during creation forces a layout (zero layout-class events); the high mode of the immediate clear is decided by whether a V8 scavenge (22–35 ms) lands inside the clear's window.
- Conclusion: users always see rendered rows, so **the high mode is the realistic value**. The engine's share is the drain's 19–25 ms; the remaining roughly 40 ms is the platform cost of detaching 10,000 laid-out rows. A3's "25 % improvement" should use the benchmark's cold, rendered value (70 ms) as the denominator and state that only the engine's share (about 30 % of it) is improvable.

## 9. T7 — stubbed-build remainder

The named entry was built with the modules of each feature group replaced by stubs that keep only the export names, then minified and compressed ([split-stub-sizes.json](./research/state-next/split-stub-sizes.json)). Groups are cut cumulatively.

| Groups cut (cumulative) | Stubbed modules | Minified bytes | gzip | Brotli | gzip saved |
|---|---:|---:|---:|---:|---:|
| none (full) | 0 | 243,535 | 71,063 | 60,088 | — |
| devtools | 2 | 239,836 | 69,764 | 59,030 | 1,299 |
| + temporal (watch / scan / stream) | 15 | 212,990 | 62,113 | 52,724 | 7,651 |
| + recursion | 21 | 198,409 | 57,788 | 49,124 | 4,325 |
| + component scopes (webComponent / dcc) | 34 | 169,126 | 49,338 | 42,398 | 8,450 |
| + SSR (Ssr / buildSsrDocument / hydrate) | 37 | 158,581 | 46,605 | 40,143 | 2,733 |
| + formatting filters (filters) | 39 | 147,630 | 44,028 | 38,037 | 2,577 |

### 9.1 Attribution of the remaining 147,630 bytes (source map, minified bytes)

| Group | Bytes | Share | Largest files |
|---|---:|---:|---|
| `bindings` | 21,323 | 14.4 % | BindingSession.ts 12,883; initialSync.ts 2,452 |
| `components` | 18,771 | 12.7 % | State.ts 18,761 |
| `proxy` | 18,743 | 12.7 % | setByAddress.ts 4,806; StateHandler.ts 2,212; traps/get.ts 1,980; getByAddress.ts 1,594 |
| `apply` | 16,024 | 10.9 % | applyChangeToFor.ts 3,890; applyChangeToProperty.ts 2,110; applyChange.ts 2,051; applyChangeFromBindings.ts 1,880 |
| `event` | 11,937 | 8.1 % | twowayHandler.ts 3,784; eventTokenHandler.ts 1,478; handler.ts 1,436; checkboxHandler.ts 1,320 |
| `(root)` | 11,665 | 7.9 % | pathDiagnostics.ts 3,567; config.ts 1,626; stateElementByName.ts 1,428 |
| `list` | 10,412 | 7.1 % | createListDiff.ts 1,947; createListIndex.ts 1,760; mergeKeyedList.ts 1,410 |
| `structural` | 9,161 | 6.2 % | createContent.ts 3,465; collectStructuralFragments.ts 2,178 |
| `bindTextParser` | 5,222 | 3.5 % | expandSpread.ts 1,907; parseBindTextsForElement.ts 1,300 |
| `dependency` | 4,373 | 3.0 % | walkDependency.ts 3,547 |
| `address` | 3,995 | 2.7 % | PathInfo.ts 1,732 |
| `protocol` / `updater` / `contract` / `binding` / `stateLoader` / `command` / `mustache` / `propagation` | 2,217 / 2,126 / 1,863 / 1,822 / 1,759 / 1,431 / 1,026 / 911 | 9.0 % | contractAnalyzer.ts 1,863; wcBindableReader.ts 1,318 |
| stubs and rest | about 1,300 | 0.9 % | |

### 9.2 Member-level attribution (full build, minified bytes, [member-attribution.json](./research/state-next/member-attribution.json))

`State.ts`: 18,714 bytes, 127 members. **Members that reference feature groups (webComponent / dcc / stream / watch / scan / stateLoader / command / recursion) hold 10,142 bytes (54 %).**

| Member | Bytes | Feature groups referenced |
|---|---:|---|
| `connectedCallback` | 2,742 | stream, watch, webComponent |
| `_initializeBindWebComponent` | 2,343 | webComponent |
| `_state` getter / setter | 1,201 / 1,201 | setter: command, event, list, recursion, scan, stream, watch |
| `_initializeVolume` | 1,074 | webComponent |
| `setInitialState` | 1,055 | (apply only) |
| `_loadStateFromSource` | 697 | stateLoader |
| `reportVolumeWithoutRoot` | 687 | (diagnostic text) |
| `disconnectedCallback` | 625 | command, stream, watch, webComponent |
| `setPathInfo` | 545 | (address only) |
| `_initializeDCC` | 503 | dcc, stateLoader |
| `_initialize` / `_failInitializeLoudly` / `attributeChangedCallback` / `_acquireVolumeSlot` / `constructor` | 468 / 398 / 347 / 339 / 334 | `_failInitializeLoudly` and `_acquireVolumeSlot`: webComponent |

Grouped by responsibility: volume / mount / DCC wiring (`_initializeBindWebComponent`, `_initializeVolume`, `reportVolumeWithoutRoot`, `_initializeDCC`, `_failInitializeLoudly`, `_acquireVolumeSlot`, `mergeVolumeListKeys`, `_releaseVolumeSlot`, `addVolumeWatchPaths`) is about 5,900 bytes (31 %); lifecycle (connected / disconnected / attributeChanged / `_initialize` / constructor) about 4,700 bytes, with connected / disconnected starting and stopping stream / watch directly; declaration processing (`_state` get / set, `setPathInfo`, `defineTreeAccessor`, `_rebuildPathInfo`) about 3,300 bytes; loading from external sources and SSR about 900 bytes.

`BindingSession.ts`: 12,886 bytes, 60 members. **No member references a feature group** (only bindings / event / platform / binding / list / address / apply). It is the DOM adapter proper, with the plan path (`initializeRow` 827, `activatePlanRows` 721, `addKnownRowBinding` 271, `knownMapFor` 219 = about 2,000) alongside the general path (`initialize` 566, `activate` 568, `settleInitialRecord` 558, `attachAfterDefinition` 608, `deferUntilDefined` 485, `registerAddress` 522, `rebindAddresses` 503, `attachListeners` 466, `shouldApplyState` 412, `settleConnectedSnapshot` 248 = about 4,900), followed by the MutationObserver handling (`handleAddedNode`, `handleRemovedNode`, `BindingOwner.handleMutations`, `handleMutations` = about 1,240). A record has 25 fields.

`setByAddress.ts` (4,827 bytes): `setByAddressCore` 1,921 references dcc / devtools / webComponent and `notifySwappedList` 602 references watch, so **55 % touches feature groups**; B6's single write boundary and T1 §3.3's hook receptacle correspond to these two functions. `applyChangeToFor` (4,063 bytes) has its main function at 2,466 referencing webComponent (mountScope). `twowayHandler.ts` (3,808 bytes) has its handler at 1,310 referencing devtools and `warnDefaultGetterMismatch` at 719 holding diagnostic text.

- The 54 % of `State.ts` and 55 % of `setByAddress.ts` sit where T1's cut list points (volume / mount / DCC / stream / watch wiring and the devtools sink). Replacing them with feature-side registration moves up to 10 KB (minified) out of `State.ts` alone and 10–13 KB out of the core overall.
- At this remainder's compression ratio (about 30 %), 35 KB gzip corresponds to about 117 KB minified, so about 30 KB has to go. Extracting the wiring (10–13 KB), moving the diagnostic text (`pathDiagnostics.ts` 3.6 KB, `reportVolumeWithoutRoot` 0.7 KB, `warnDefaultGetterMismatch` 0.7 KB; about 5 KB) to a dev build, separating the wc-bindable contract analysis (`contractAnalyzer`, `wcBindableReader`, `expandSpread`, `protocol`; about 7 KB) into the adapter, and unifying `BindingSession`'s two paths (2–3 KB) together bring 30 KB into view.
- The stubs leave the core's call sites in place, so actually cutting the edges would be slightly smaller. Conversely, loading the cut features as separate chunks makes the total exceed the full bundle (requirements §10: splitting lowers compression). The savings are consistent with the source-map attribution in audit §3.2.

## 10. Prototypes measured (§11 items 1–5)

Items 1–5 of §11 were taken in order (the "§11 item n" in the headings is the numbering at the time; §11 has since been rewritten from the results). Items 1, 2 and 3 leave the repository untouched: they run against a sandbox copy of `packages/state` in the scratch directory (10.1, 10.2, 10.4). The wiring separation became a separate design draft (10.3, [state-next-major-wiring-design.md](./state-next-major-wiring-design.md)); only its stages S1 and S2 were implemented in the repository's `packages/state` (10.5, uncommitted).

### 10.1 Keyed subscription `$eq(path, key)` (§11 item 1)

Prototype: [keyedPrototypePatch.mjs](../scripts/research/keyedPrototypePatch.mjs) (applied to the sandbox; it fails unless every anchor matches exactly once) plus a new module in the sandbox, `dependency/keyedDependency.ts` (73 lines; 99 now, with the lazy unsubscription of the addendum). `$eq(path, key)` reads `path` without creating a dependency edge, subscribes the evaluating getter's row address under the key "does `path` equal `key`", and returns `Object.is(value, key)`. On the write side, only the rows subscribed under the old value (as read by the same-value guard) and the new value are cache-invalidated and enqueued (one line in each of `setByAddress`'s fast and general paths). No pattern edge exists, so no whole-list expansion happens.

- All 304 test files / 3,650 tests pass in the sandbox (no change to existing behaviour). `auto.min.js` grows by 296 bytes gzip.
- Fixture variants: `keyed` is `get "data.*.selected"() { return this.$eq("selectedIndex", this.$1); }`; `keyedId` is `this.$eq("selectedId", this["data.*.id"])` with `onSelect` writing the row id.

| Bundle / variant | Select, 1,000 rows | Select, 10,000 rows | Remove one row, 1,000 / 10,000 | Swap, 1,000 | Selection after removals |
|---|---:|---:|---:|---:|---|
| shipped / manual (hand-written two-row notification) | 0.10 | 0.30 | 2.6 / 38.5 | 0.5 | stays with the index |
| shipped / tracked (tracked getter) | 1.80 | 20.05 | 3.4 / 34.5 | 1.0 | stays with the index |
| prototype / tracked | 2.00 | 20.2 | 4.9 / 34.5 | 1.1 | stays with the index |
| prototype / keyed (`$eq` on `$1`) | 0.10 | 0.20 | 4.3 / 45.7 | 1.1 | stays with the index |
| prototype / keyedId (`$eq` on the row id) | 0.10 | 0.25 | 4.1 / 46.5 | 4.6 | **follows the id** |

([keyed-prototype.json](./research/state-next/keyed-prototype.json); the benchmark's timing; warm, median of 10 samples, ms; after every selection the page is checked for exactly one selected row, the clicked one.)

- Selection over 10,000 rows drops from 20 ms to 0.2 ms, the same level as the fixture's hand-written optimisation (0.3 ms). D7's "support optimized selection through an API" holds in the form of `$eq`, without asking users for `$untrackDependency` plus two row writes.
- Removing one row stays at 34–47 ms in every variant; `$eq` does not reduce it. The cost is not getter re-evaluation but the bookkeeping of moved rows (list-index re-assignment, ledgers, DOM moves). `keyedId`, keyed on the row id, keeps the selection on the same row across removals, but its swap rises to 4.6 ms (the dynamic dependency on `data.*.id`; not investigated).
- Prototype limits: Map keys compare with SameValueZero. Subscriptions of disposed rows were kept at first; the addendum adds lazy unsubscription.

Addendum (§11 item 1, continued). The stage-2 counters (the same instrumentation as §8.2) were applied to the prototype build ([runtime-counters-list-tracked-proto.json](./research/state-next/runtime-counters-list-tracked-proto.json) / [-keyed-proto.json](./research/state-next/runtime-counters-list-keyed-proto.json) / [-keyedId-proto.json](./research/state-next/runtime-counters-list-keyedId-proto.json); an instrumented build, so elapsed ms exceed the benchmark's timing).

| Variant / operation | Elapsed ms | enqueue | get traps |
|---|---:|---:|---:|
| tracked / select, 10,000 rows | 13.1 | 10,001 | 30,003 |
| keyed / select, 10,000 rows | 0.1 | 3 | 10 |
| keyedId / select, 10,000 rows | 0.2 | 3 | 11 |
| tracked / swap | 6.4 | 3 | 12 |
| keyed / swap | 11.4 | 3 | 14 |
| keyedId / swap | 75.0 | 11,001 | 44,007 |
| tracked / append 1,000 | 46.4 | 4,001 | 5,005 |
| keyedId / append 1,000 | 112.4 | 14,001 | 46,006 |
| tracked / remove one row | 30.1 | 11,000 | 33,002 |
| keyed / remove one row | 57.6 | 11,000 | 44,001 |

- The 20 ms → 0.2 ms of selection is the expansion disappearing (enqueue 10,001 → 3: `selectedIndex`, the old row, the new row); the getter evaluation itself remains.
- Why `keyedId`'s swap rises: the getter reads `this["data.*.id"]` with tracking, so a pattern edge `data.*.id → data.*.selected` exists, and a list replacement (swap, append) expands that edge over every row (`keyed` reads only `$1` and stays at enqueue 3). Unless the row id is also handed to the key without a dependency (taking a path, as in `$eq("selectedId", "data.*.id")`), a replacement wipes out the benefit of the keyed subscription. The requirements need "a row-local (indexed) dependency is never promoted to a pattern edge".
- Removing one row enqueues 11,000 even in `keyed`: the removal changes `$1` of every row, every getter re-evaluates, and the `$eq` re-registration (moving Map entries) adds 1–2 µs per row (drain 39.3 ms against 16.2 ms in the instrumented build; 45.7 against 34.5 in the benchmark's timing). A design that separates row identity from the index (§11 item 2) is the precondition.
- Subscriptions of disposed rows are now skipped lazily at notification time through `isRetiredListIndex` ([keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts), 99 lines; all tests pass). The timing table above is from the build before that change; addendum 2 re-times everything.

Addendum 2 (items 1 and 2 of the rewritten §11). A variant that hands the row id to the key without a dependency edge was added as `keyedIdUntracked` (the getter is `this.$eq("selectedId", this.$untrackDependency(() => this["data.*.id"]))`, the same read a runtime-level `$eq(path, keyPath)` would perform). Every variant was re-timed on the build with lazy unsubscription; the swap now selects row 2 (one of the two rows swapped) first, swaps 5 times, and checks that exactly one row stays selected and whether it followed the id or the index ([keyed-prototype.json](./research/state-next/keyed-prototype.json) updated; `auto.min.js` +323 bytes gzip; warm, median of 10 samples, ms).

| Bundle / variant | Select, 1,000 rows | Select, 10,000 rows | Remove one row, 1,000 / 10,000 | Swap, 1,000 | Selection after swap / removals |
|---|---:|---:|---:|---:|---|
| shipped / manual | 0.2 | 0.2 | 3.5 / 39.7 | 0.9 | stays with the index |
| shipped / tracked | 2.0 | 20.4 | 2.8 / 38.2 | 1.0 | stays with the index |
| prototype / manual | 0.2 | 0.2 | 4.1 / 40.6 | 1.1 | stays with the index |
| prototype / tracked | 1.9 | 21.7 | 3.3 / 32.8 | 1.0 | stays with the index |
| prototype / keyed (`$eq` on `$1`) | 0.1 | 0.2 | 5.0 / 43.5 | 1.2 | stays with the index |
| prototype / keyedId (`$eq` on a tracked id) | 0.2 | 0.25 | 3.9 / 48.0 | 4.1 | **follows the id** |
| prototype / keyedIdUntracked (`$eq` on a dependency-free id) | 0.2 | 0.2 | **1.5 / 12.7** | **1.0** | **follows the id** |

Stage-2 counters ([runtime-counters-list-keyedIdUntracked-proto.json](./research/state-next/runtime-counters-list-keyedIdUntracked-proto.json); elapsed ms of the instrumented build):

| Operation | tracked | keyedId | keyedIdUntracked |
|---|---:|---:|---:|
| Select, 10,000 rows: enqueue / get traps | 10,001 / 30,003 | 3 / 11 | 3 / 13 |
| Swap: enqueue / elapsed | 3 / 6.4 | 11,001 / 75.0 | 1 / 9.0 |
| Append 1,000: enqueue / elapsed | 4,001 / 46.4 | 14,001 / 112.4 | 4,001 / 46.1 |
| Remove one row: enqueue / elapsed | 11,000 / 30.1 | 11,000 / 54.5 | 1 / 13.8 |
| Remove one row, breakdown (keyedIdUntracked) | — | — | walk 3.8 (includes the diff and list-index re-assignment, 4.0), drain 3.5 (applyFor 3.4), the rest is the event path |

- Reading `data.*.id` with tracking creates the dynamic edge `data.*.id → data.*.selected` (`checkDependency`), and the walk of a list replacement expands it over every row (swap 11,001, append 14,001, removal 11,000). With a dependency-free read the replacement's walk ends at `data` itself: selection stays at 0.2 ms, swap 4.1 → 1.0 ms, removing one row 48 → **12.7 ms** (1.5 ms at 1,000 rows). The selection follows the same row (id) through swaps and removals, and exactly one row is selected after every operation.
- This answers §11 item 2, "what a design that separates row identity from the index removes": of the 33–48 ms of a removal, about 25–35 ms is re-evaluating the index-dependent getter (one that read `$1`) on the 10,999 rows whose position changed (walk 9 ms + drain 16 ms). Keying by id removes it entirely; what remains is the diff and list-index re-assignment (4 ms), DOM detachment and apply (3.5 ms) and the event path. A selection that stays with the index (`tracked` / `keyed`) cannot avoid that re-evaluation.
- Authoring candidates: a path as the second argument inside the getter (a separate name such as `$eqPath(path, keyPath)` to keep it apart from `$eq(path, value)`), or a declaration `$keyed: { "data.*.selected": ["selectedId", "data.*.id"] }`. Entered as the candidate answer to D7 in [state-next-major-requirements.md](./state-next-major-requirements.md) §4 and §6.

### 10.2 A folded row-record bookkeeping shape (§11 item 2)

Reworking `BindingSession` is too large a change, so the DOM-floor page reproduces the runtime's current bookkeeping shape (per binding a 10-field copy of the slot template, a 25-field record and 6 ledgers; per row a content object and 5 ledgers) and a folded shape (one object per row holding nodes, values, list index and the mutable fields; 2 ledgers), swapping only the bookkeeping over the same DOM clone ([domFloorPage.js](../scripts/research/domFloorPage.js) `createShaped`, [fold-shape.json](./research/state-next/fold-shape.json), fresh page per sample, median of 7, heap as the delta after forced collections).

| Shape | 1,000 rows ms | 10,000 rows ms | Heap bytes per row (10,000) |
|---|---:|---:|---:|
| none (DOM clone and text writes only) | 5.0 | 42.8 | 119 |
| current (the runtime's bookkeeping shape) | 9.5 | 101.9 | 1,288 |
| folded | 5.5 | 47.5 | 237 |

- The current shape costs 5.9 µs and about 1.2 KB per row, the folded shape 0.5 µs and about 120 bytes (over the DOM floor). The 5.4 µs per row difference is about a fifth of the 28 µs per row measured for creation in T6; the roughly 1 KB per row of heap corresponds to about 10 MB of the 35 MB the audit measured for 10,000 rows (§4.4).
- The remaining cost (plan-row registration 2.7 µs, the initial apply of about 8 µs (correction in §8.4), node-path resolution 1.9 µs, event attachment 1.2 µs) lies outside this shape and does not disappear by folding. This model's "folded" shape also drops the per-node ledgers (interested / known); in the real runtime those carry the observer semantics, and folding the record alone does not take them (§10.7).

### 10.3 Wiring separation design (§11 item 3)

A draft is in [state-next-major-wiring-design.md](./state-next-major-wiring-design.md): the receptacles the core keeps (read/write boundary hook, drain listener, lifecycle hook, declaration hook, devtools sink, volume graft handler, SSR), explicit and idempotent registration through the features' `install()`, the `/core`, `/features/*` and `/define` entries, the readiness barrier, a size estimate from T7 (extracting the wiring alone leaves about 40–41 KB gzip; 35 KB needs the diagnostic text, the wc-bindable analysis and the unification of `BindingSession` stacked on top), and stages (inverting the devtools sink and moving the listener registrations into `install()` can ship in 2.6.x). It decides nothing.

### 10.4 Hoisting the activation lookups (§11 item 3)

[activationPrototypePatch.mjs](../scripts/research/activationPrototypePatch.mjs) was applied to the sandbox (with the `$eq` prototype in place). `BindingSession.activatePlanRows` repeats, per binding, the lookups `registerAddress` needs (node → loop context, binding → list index, root → state element, path → tree path); the prototype resolves them once per row and caches each slot's wildcard depth and tree path on the row plan in WeakMaps. Slots without a wildcard fall back to the existing `registerAddress`. All 3,650 tests pass.

Stage-3 counters (the same instrumentation as §8.3, [runtime-counters-content-tracked-proto-before.json](./research/state-next/runtime-counters-content-tracked-proto-before.json) / [-after.json](./research/state-next/runtime-counters-content-tracked-proto-after.json), median ms):

| Operation | activatePlan before → after | activate before → after | Elapsed before → after |
|---|---:|---:|---:|
| Create 1,000 rows (5 samples, first one cold) | 3.5 → 2.9 | 7.9 → 10.4 | 14.7 → 17.4 (first 63.7 → 66.8) |
| Create 10,000 rows (3 samples) | 26.5 → 24.4 | 114.0 → 109.1 | 305.5 → 311.7 |
| Append 1,000 rows (3 samples) | 3.4 → 4.2 | 13.7 → 15.6 | 40.1 → 44.5 |

- `activatePlan` drops by 2 ms at 10,000 rows and the elapsed times move both ways, within sample noise. **Hoisting does not take it.** Of the 10.5 µs per row of activation, only the plan-row registration (2.7 µs) is what hoisting targets; the other 8 µs is the initial apply of three bindings (correction in §8.4, counted in §10.7). The 2.7 µs is the ledger write of `addBindingByPattern` and the `getListIndexByBindingInfo` resolution, which hoisting the lookups does not reduce. The record-less row prototype is §10.7.

### 10.5 Wiring separation, stages S1 and S2 implemented (§11 item 4)

S1 and S2 of the design draft ([state-next-major-wiring-design.md](./state-next-major-wiring-design.md) §8) are implemented in the repository's `packages/state`. Uncommitted; no behaviour change.

- **S1 (H6)**: `devtools/sink.ts` moved to `platform/devtoolsSink.ts` (`git mv`); imports rewritten in 14 core files, `devtools/bridge.ts` and 14 test files. Core → `devtools` edges: 12 → 1 (`bootstrapState.ts → devtools/bridge.ts`).
- **S2 (H2, H7)**: the evaluation-time registrations in `watch/watchRuntime.ts`, `stream/streamRuntime.ts` and `webComponent/volume.ts` became idempotent `installWatchRuntime()` / `installStreamRuntime()` / `installVolumeGraft()`, which `bootstrapState()` calls before `registerComponents()`. The features' first-use points (`startWatch`, `startStreams`, the queue path of `graftOrQueueVolume`) call the same `install` too, as a guard for code that defines the elements without `bootstrapState()` (the tests do). This departs from the draft's "only the entry calls it"; the 3.0 readiness barrier (H5) makes it removable.
  - The first version installed the three from Vitest's `setupFiles` and failed 267 tests: the setup file evaluates the real module graph first, so each test's `vi.mock` (58 files) no longer takes effect. Installing at first use fixed it and the setup file is empty again.
- Verification: lint clean; 304 files / 3,650 tests pass; coverage 99.62 / 98.78 / 100 / 99.78 (thresholds 99.5 / 98.5 / 100 / 99.5).
- T1 re-measured ([coupling.json](./research/state-next/coupling.json)): modules running code at evaluation 11 → 8 (watch / stream / volume gone). Core → feature edges 49 → 41 (devtools −11; `bootstrapState.ts` → watch / stream / volume +3; those three sit in the entry and leave `/core` in 3.0).
- **Helper-only import** ([helper-import.json](./research/state-next/helper-import.json), [audit-state-tech-helper-import.mjs](../scripts/audit-state-tech-helper-import.mjs); the audit's §3.1 method: re-export one name from the bundled `index.esm.js` → Rollup tree-shake → terser. "Before" is the checked-in `dist/index.esm.js`, "after" is today's `src/exports.ts` bundled in memory with the same config):

| Re-export | Before (minified bytes / gzip) | After (minified bytes / gzip) | Evaluation-time calls kept |
|---|---:|---:|---|
| `defineState` only | 89,237 / 26,706 | 6,238 / 1,943 | before: `registerUpdateBatchListener` ×2, `createNotFilter()` → after: `createEmptySet()`, `createNotFilter()` |
| `VERSION` only | 89,220 / 26,711 | 6,227 / 1,949 | same |

  The audit's "26.8 KB for `defineState` alone" (§3.1) is now 1.9 KB. What kept it was the two watch / stream listener registrations (they reach `State` through the `updater` singleton); the volume handler injection was already dropped by Rollup as an assignment nothing reachable reads. The remaining 6 KB is two call initialisers that cannot be proven pure. Requirements G2 and N2, "a side-effect-free helper entry", are met at this stage without waiting for the entry split.
  - Addendum (item 5 of the rewritten §11): the eight remaining evaluation-time call initialisers (`updater = new Updater()`, the four event registries, `createNotFilter()`, `createEmptySet()`, `parseCommentNode`'s `new RegExp`) are annotated `/*#__PURE__*/`. Each is an empty constructor or a plain Map / Set / RegExp allocation, so behaviour is unchanged (lint clean, 3,650 tests pass). [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) now counts an annotated initialiser as an allocation, the only module running code at evaluation is `auto.ts`, and [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) is tightened to `evaluatedModules: ["auto.ts"]`. The helper-only import of `defineState` drops from 6,238 / 1,943 to **589 bytes / 309 gzip** (`VERSION` only: 315 gzip) with zero evaluation-time calls kept ([helper-import.json](./research/state-next/helper-import.json) updated).
- **CI**: [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) gained `--check`, run in `ci.yml`'s state job against [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) (the 8 modules allowed to run code at evaluation, at most 41 core → feature edges, `defineState.ts` reaching 1 module). A violation exits 1; a baseline that can be tightened prints a note. Confirmed to fail against a tightened baseline.

### 10.6 The low-priority `blink` trace (§11 item 5)

[audit-state-tech-blink.mjs](../scripts/audit-state-tech-blink.mjs). Shipped `auto.min.js`, fresh page per sample, a CDP trace with `blink`, the timeline stack traces and invalidation tracking added, around "create 10,000 rows → clear immediately in the same task"; layout-class events and the self-time breakdown of both windows ([blink-trace.json](./research/state-next/blink-trace.json), 5 samples; creation is slow under tracing, 400–630 ms).

| Sample | Clear ms | of which script self time | of which scavenge (young-generation GC) | GC events |
|---|---:|---:|---:|---:|
| 0 | 22.4 | 20.6 | 0 | 0 |
| 1 | 71.6 | 33.5 | 34.9 | 22 |
| 2 | 46.3 | 21.7 | 22.0 | 23 |
| 3 | 33.6 | 30.5 | 0 | 0 |
| 4 | 49.0 | 23.6 | 23.2 | 23 |

- `Layout` / `UpdateLayoutTree` count zero in both windows in all five samples. Nothing during creation forces a layout.
- The high mode of "create → clear immediately" (65–71 ms in §8.5) is decided by whether a V8 scavenge lands inside the clear's window: 22–34 ms with no GC, 46–72 ms with one. Right after creation the 10,000 rows' fresh objects are still in the young generation, and the clear's own allocations trigger their collection. Script self time is 20–33 ms in every sample, consistent with §8.6's "engine about 21 ms".
- So the two modes of the clear have different causes by condition: after a rendered frame it is detaching laid-out rows (§8.6; 28 ms even for the bare DOM); without a frame it is the scavenge. The conclusion of §8.6 stands; the GC side is the territory of a design that allocates less per row (§10.2).

### 10.7 Rows without records (item 3 of the rewritten §11)

[rowRecordPrototypePatch.mjs](../scripts/research/rowRecordPrototypePatch.mjs) was applied to the sandbox (with the `$eq` prototype, the activation hoisting removed). A plan row's session is one session per row, so the per-binding 25-field record and its three ledger writes (`recordByBinding`, `records`, `optionsByBinding`) became one record per row (slot arrays: phase, flags, address / pattern registration, teardowns) plus one reverse session lookup per binding. `getRecord`, `shouldApplyState`, `addTeardown`, `disposeBinding`, `dispose`, `destroyRecords`, `rebindAddresses`, `forEachActiveBindingNode` and `getBindingSession` answer from the row record. Type check and all 3,650 tests passed at the first attempt.

Stage-3 counters with `applyChange` and `getByAddress` added ([runtime-counters-content-tracked.json](./research/state-next/runtime-counters-content-tracked.json), shipped source) compared with the prototype ([-rowrecord-full.json](./research/state-next/runtime-counters-content-tracked-rowrecord-full.json)) and two bound variants that break the semantics and only measure the ceiling (b1: no per-node ledgers `interested` / `known` per binding; b2: b1 plus no pattern-ledger registration of slots. [-rowrecord-b1.json](./research/state-next/runtime-counters-content-tracked-rowrecord-b1.json) / [-b2.json](./research/state-next/runtime-counters-content-tracked-rowrecord-b2.json)); create 10,000 rows, median of 3, ms:

| Build | Elapsed | Content creation | of which row records | Activation | of which plan-row registration |
|---|---:|---:|---:|---:|---:|
| shipped source | 324.2 | 146.3 | 41.0 | 107.5 | 28.4 |
| prototype (row record) | 324.5 | 154.0 | 45.2 | 126.5 | 29.5 |
| b1 (+ no node ledgers) | 411.7 | 149.3 | 31.6 | 184.6 | 43.4 |
| b2 (+ no pattern registration) | 326.4 | 118.1 | 24.7 | 114.6 | 3.7 |

- **Folding the record does not reduce anything in the real runtime** (row records 41 → 45 ms, elapsed 324 → 325). What remains per binding is the two per-node observer ledgers (`interestedSessionsByNode`, `knownBindingsByNode`: the MutationObserver's delivery targets, which carry semantics), the reverse session lookup and the pattern-ledger registration (`addBindingByPattern`, `getListIndexByBindingInfo`); the 25-field record itself is cheap in V8. The 5.4 µs per row that §10.2's model estimated was the shape with those ledgers dropped as well.
- Even at the ceiling (b2), row records 41 → 25 ms and registration 28 → 4 ms add up to 41 ms = 4 µs per row, and the elapsed time stays within sample noise (±10 ms). b1's elapsed 412 is a sample with a GC on it and is not used for the component comparison. **Re-keying the row ledgers by row takes at most 4 of the 28 µs per row.**
- Heap ([heap-per-row.json](./research/state-next/heap-per-row.json), [audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs), 10,000 rows, delta after forced collections): shipped 3,631 bytes per row (34.6 MB, matching the audit's 35 MB in §4.4) → prototype 3,454 bytes per row. The records account for 177 bytes per row (5 %); §10.2's "about 1 KB per row" also included the ledgers. The remaining 3.4 KB per row is addresses, cache entries, list indexes, dependency ledgers and binding objects, and needs its own measurement.
- Benchmark timing ([warm-vs-cold-file-tracked-plain-jsfb.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb.json)): create 1,000 rows cold 53.4 / warm 19.0, append cold 61.5, the same level as the shipped bundle (§8.5).
- Conclusion: within the 28 µs per row of creation, design leverage lies not in the bookkeeping (≤ 4 µs) but in the initial apply (about 8 µs: 7 reads and 3 applies; correction in §8.4) and in clone, node-path resolution and event attachment (about 5.5 µs). For the initial apply the candidate is a "plan-level initial render" that writes a plan row's values per slot without going through the proxy and `applyChange`; §11 item 3 is replaced accordingly.

### 10.8 The cost of the read/write boundary hook (H1) (item 4 of the rewritten §11)

[addressHookPrototypePatch.mjs](../scripts/research/addressHookPrototypePatch.mjs) was applied to a second sandbox of the current source (with S1 and S2). The feature branches stay in place; only the receptacle is added at the top of `getByAddress`, `setByAddressCore` and the get trap's string-property path: registered hooks are called in order and the first result other than `NOT_HANDLED` wins (`core/addressHooks.ts`). Variants: **none** (no hook registered, one array-length check), **inactive3** (`bootstrapState()` registers three hooks per receptacle, each reading one boolean of the state and returning `NOT_HANDLED`, i.e. a feature that is installed but unused by this state), **gated3** (inactive3 plus a flag on the state element, `hasAddressHooks === true`, checked before the loop, i.e. hooks attached per state at declaration time). All 3,650 tests pass (none).

Benchmark timing ([hook-cost-none.json](./research/state-next/hook-cost-none.json) / [-inactive3.json](./research/state-next/hook-cost-inactive3.json) / [-base.json](./research/state-next/hook-cost-base.json) (the current source without the hook) / [-protoctl.json](./research/state-next/hook-cost-protoctl.json) (the sandbox of §10.1); `--only tracked`, selection over 10,000 rows, warm, median of 10, ms): shipped 19.3–20.6, base 20.2, protoctl 20.7, none 14.7, inactive3 18.2. none's 14.7 sits below the others with its whole range (12.4–17.1), but nothing about adding a receptacle makes code faster, so it is read as a property of that run (JIT tier). This timing moves ±10 % between runs and cannot decide design §7-4's "under 1 %".

Micro-benchmark ([audit-state-tech-hookcost.mjs](../scripts/audit-state-tech-hookcost.mjs), [hook-cost-micro.json](./research/state-next/hook-cost-micro.json)): inside a state method, one million reads of `this.selectedIndex` (get trap → `getByAddress` → cache) and 100,000 same-value writes (set trap → `setByAddress` → same-value guard). Fresh page per sample, the minimum of five runs per page, nine pages. Pages split by JIT tier into a fast group (about 43 ns per read) and a slow one (60–80 ns), so the minima (fast group) are compared:

| Build | Read ns (min / median) | Write ns (min / median) | Pages in the fast group |
|---|---:|---:|---:|
| shipped | 42.1 / 65.3 | 43 / 62 | 3 / 9 |
| base (current source, no hook) | 42.9 / 44.2 | 41 / 44 | 5 / 9 |
| none (receptacle only) | 43.2 / 58.4 | 43 / 53 | 2 / 9 |
| inactive3 (three hooks in a global array) | 60.1 / 64.1 | 56 / 60 | 0 / 9 |
| gated3 (gated by a flag on the state) | 43.0 / 45.8 | 42 / 44 | 5 / 9 |

- The receptacle alone (one length check) costs nothing measurable on reads or writes (+0.3 ns). **With three installed hooks in a global array, a read costs +17 ns (+40 %) and a write +15 ns even though this state uses none of them.** Over a 10,000-row selection (30,003 get traps, 10,001 reads) that is about 0.7 ms, 3–4 %, above §7-4's 1 %.
- Gated by a per-state flag (gated3) it equals base (+0.1 ns). So H1's hooks must not be a global array scanned on every call; they are **attached per state at declaration time (or gated by a feature mask)**, at the cost of today's D18 check (`hasMounts === true`). Reflected in the design's §3, H1.

### 10.9 Row shape and the GC of the clear (item 6 of the rewritten §11)

[audit-state-tech-gcshape.mjs](../scripts/audit-state-tech-gcshape.mjs), [gc-shape.json](./research/state-next/gc-shape.json). The DOM-floor page's three shapes (§10.2) create 10,000 rows and clear them with `replaceChildren()` timed synchronously in the same task, under a trace with `v8.gc`; GC inside the creation window and the clear window, median of 5 per shape:

| Shape | Create ms | GC during creation ms (events) | Clear ms | GC during the clear |
|---|---:|---:|---:|---:|
| none | 50.0 | 4.6 (68) | 4.3 | 0 (every sample) |
| current | 109.1 | 20.1 (142) | 4.6 | 0 |
| folded | 54.9 | 5.3 (69) | 4.4 | 0 |

- `replaceChildren()` allocates nothing, so no scavenge lands in the bare DOM's clear window. The scavenge in the shipped runtime's clear (§10.6) is triggered by the clear's own drain allocating (diff, dispose, ledgers), and what it copies is the row bookkeeping left in the young generation by the preceding creation.
- The shape matters on the creation side: the current shape spends 20 ms in GC during creation (1.2 KB × 10,000 rows ≈ 12 MB of young allocations), the folded shape 5 ms, the same as none. Allocating less per row should shrink the clear's scavenge in proportion to what it copies, but bookkeeping is about 1 KB of the runtime's 3.4 KB per row (§10.7), so the 22–35 ms of the clear does not vanish.

### 10.10 Keyed subscription, round 3: `$eqPath` / `$eqIndex`, dispose-tied unsubscription, diff-side re-keying (round-3 §11 items 1 and 2)

[keyedRound3Patch.mjs](../scripts/research/keyedRound3Patch.mjs) (paired with the third version of [keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts)) was applied to the sandbox.

- **Authoring forms**: `$eqPath(path, keyPath)` reads the key from a path without a dependency edge (the `$untrackDependency` form of §10.1 addendum 2 folded into the runtime). `$eqIndex(path, level = 1)` keys on the row's index (`$1`) without recording the getter as index-dependent. `$eq(path, value)` is unchanged.
- **Unsubscription**: a retired row's subscriptions are dropped where the diff retires its list index (right after `retireListIndexes` in `createListDiff`); the lazy check at notification time is gone.
- **Diff-side re-keying**: when `syncListIndexes` changes a list index's `.index`, the row's `$eqIndex` subscriptions move to the new key, and only rows whose path's last written value equals the old or the new index are dirtied and enqueued; no other moved row re-evaluates its getter.
- Tests [proxy.keyedRound3.test.ts](../scripts/research/proxy.keyedRound3.test.ts) (5: `$eqPath` selection, replacement, unsubscription after removal, nested wildcards; `$eqIndex` removal and swap re-evaluating at most two rows) added; the sandbox's 3,655 tests pass.

Benchmark timing ([keyed-round3.json](./research/state-next/keyed-round3.json), warm, median of 10, ms) and stage-2 counters ([runtime-counters-list-keyedIdPath-proto.json](./research/state-next/runtime-counters-list-keyedIdPath-proto.json) / [-keyedIndex-proto.json](./research/state-next/runtime-counters-list-keyedIndex-proto.json)):

| Variant | Select, 10,000 | Remove one row, 1,000 / 10,000 | Swap | Selection follows | Removal enqueue / get traps (counters) |
|---|---:|---:|---:|---|---:|
| tracked (same run) | 21.2 | 2.6 / 33.3 | 1.1 | index | 11,000 / 33,002 |
| keyedIdUntracked (§10.1 addendum 2) | 0.25 | 1.4 / 14.7 | 1.0 | id | 1 / 5 |
| **keyedIdPath** (`$eqPath`) | 0.2 | 1.3 / **13.6** | 1.1 | id | 1 / 5 |
| **keyedIndex** (`$eqIndex`) | 0.2 | 1.8 / **17.5** | 1.1 | **index** | **3 / 11** |

- `$eqPath` performs like the `$untrackDependency` form; only the spelling is tidier.
- `$eqIndex` keeps **the selection on the index** and still takes removing one row from 33 to 17.5 ms and the enqueues from 11,000 to 3 (`data`, the row at the old index, the row at the new index). The answer to round-2 §11 item 2, whether re-keying on the diff side avoids the re-evaluation, is **yes**. The remaining gap to keyedIdPath (+4 ms) is re-keying the 10,999 moved rows (one Map move each; the diff goes 4 → 7.6 ms).
- Requirements N6's authoring form becomes the three calls `$eq(path, value)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level)`; a `$keyed` declaration is deferred, since a call inside the getter suffices.
- Addendum: the three forms were ported into the repository the same day (§11 item 1). The product version adds two things: a call outside a getter only returns the comparison without subscribing, and the retire hook does not even touch a Map until something has been registered.

Addendum 2 (the next day, `$eqIndex` in O(1); round-4 §11 item 2): at the innermost level (the getter's own row level) `$eqIndex` no longer subscribes per row; it keeps **one watcher per list (keyed by the list's IListIndex array)** ([indexWatcherPatch.mjs](../scripts/research/indexWatcherPatch.mjs)). A write enqueues the rows at `indexes[old]` and `indexes[new]`; a diff moves the watcher to the new array when the array changes and enqueues only the row that was at the last value and the row that is now there. No Map operation per moved row and no unsubscription on retirement (there is no per-row state). Outer levels (`level < wildcardCount`) keep the per-row subscription. 3,661 tests pass in the sandbox; ported into the repository as well.

| Variant | Select, 10,000 | Remove one row, 10,000 | Removal enqueue / diff ms (counters) |
|---|---:|---:|---:|
| keyedIndex (per-row subscription + diff-side re-keying, §10.10) | 0.2 | 17.5 | 3 / 7.6 |
| keyedIndex (one watcher per list, [keyed-round4.json](./research/state-next/keyed-round4.json)) | 0.25 | **14.5** | 3 / 5.9 |
| keyedIdPath (same run) | 0.2 | 13.5 | 1 / — |

### 10.11 Attribution of creating 10,000 rows: heap by type, profile by function (round-3 §11 item 3)

Before prototyping the plan-level initial render, two attributions show what would pay off.

**Heap** ([audit-state-tech-heapsnapshot.mjs](../scripts/audit-state-tech-heapsnapshot.mjs), [heap-snapshot-attribution.json](./research/state-next/heap-snapshot-attribution.json) (shipped `auto.min.js`) / [-proto.json](./research/state-next/heap-snapshot-attribution-proto.json) (the shipped unminified `index.esm.js`, readable names); heap snapshots before and after creating 10,000 rows, nodes aggregated by type and constructor name, the difference per row):

| Type (count per row) | bytes per row |
|---|---:|
| native (DOM nodes and their wrappers, 131) | 9,706 |
| array (backing stores of Map / Set / WeakMap and element arrays of objects, 8) | 1,649 |
| Object (5 binding objects, 5 records, options, content ledgers and so on, 16) | 816 |
| string (2.3) | 136 |
| WeakMap (**6**) | 96 |
| StateAddress (4) | 96 |
| AbsoluteStateAddress (4) | 80 |
| Array (5) | 80 |
| ListIndex, Content, BindingSession (1 each), Set (2), WeakRef (1) | 176 |

- Of the 13.0 KB per row, 9.7 KB is the DOM side (native); the JS side is 3.3 KB per row, consistent with §10.7's GC delta of 3.6 KB (the difference is how the GC is forced).
- Half of the JS side (1.65 KB) is **collection backing stores**: each row creates 6 WeakMaps and 2 Sets (mostly the per-row `BindingSession` with its 3 WeakMaps and 2 Sets), more than the records (part of the 816 B of Objects). §10.7's prototype folded the records but kept the per-row session, which is why it saved only 177 B. **One session per list (`for` binding) instead of one per row** is the largest JS-heap lever (about 1.3 KB per row, 40 % of the JS side).
- The addresses (4 StateAddress + 4 AbsoluteStateAddress = 176 B per row) and the 5 binding objects are what a plan-level initial render can move from the row to the plan.

**Profile** ([audit-state-tech-profile.mjs](../scripts/audit-state-tech-profile.mjs), [profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json); CDP Profiler, 100 µs samples, unminified bundle, the sum of three pages aggregated as self time per function. Creation stretches to 511 ms under the profiler (300 ms normally), so read the values as ratios):

| Group | µs per row (profiled) | Main functions |
|---|---:|---|
| (program) (native, unattributed) | 63.8 | DOM implementation, ICs and so on |
| Ledger writes (WeakMap / WeakSet / Set) | 8.9 | `markNodeRegistered` 1.9, `addInterestedSession` 1.8, `setLoopContextByNode` 1.4, `resolveInitializedBinding` 1.2, `addBindingByPattern` 0.7, … |
| DOM native calls | 7.8 | `importNode` 4.3, `insertBefore` 1.6, `appendChild` 1.1, `addEventListener` 0.9 |
| GC | 7.2 | |
| Content creation | 6.4 | `resolveNodePath` 3.2, `getCustomElement` 1.2, `Content` 0.9 |
| Initial apply | 6.0 | `applyChange` 2.2, `applyChangeToText` 1.2, `_applyChange` 1.6 |
| Address creation and lookup | 5.3 | `createAbsoluteStateAddress` 1.2, `getStateAddressByBindingInfo` 1.1, `createStateAddress` 1.1, `getAbsoluteStateAddressByBinding` 0.8, `getListIndexByBindingInfo` 0.8 |
| Row initialisation and activation (session) | 3.2 | `initializeRow` 2.3 |
| Reads (proxy / cache) | 2.0 | `getCacheEntryByAbsoluteStateAddress` 0.5, `_getByAddress` 0.5 |
| walk / diff / updater | 1.6 | |

- The largest JS-attributed group is **ledger writes** (8.9), dominated by per-binding and per-node `set`s into WeakMaps / WeakSets, then the DOM, GC, content creation (`resolveNodePath` 3.2 of it), the initial apply and address creation.
- Inside the "initial apply of 8 µs per row", **address creation and lookup (5.3) and `applyChange`'s gates (including `getCustomElement` 1.2)** outweigh the reads (2.0). The plan-level initial render therefore pays off through two things, building each slot's address once from the row's list index (no per-binding StateAddress / AbsoluteStateAddress allocation) and skipping the `getCustomElement` check on plan rows (plan eligibility already excludes custom elements); the read path need not change.
- `resolveNodePath` at 3.2 µs per row (5 nodes) is walking the cloned row to its nodes, the same item as the 1.9 µs measured on the DOM floor in §6; marking the template and taking the nodes with one `querySelectorAll` is a T4 candidate.

### 10.12 Attribution of the clear's allocations (round-3 §11 item 6)

[audit-state-tech-allocsample.mjs](../scripts/audit-state-tech-allocsample.mjs). The clear right after creating 10,000 rows is sampled with CDP's allocation sampling (every 4 KB) and the allocations are summed by function as self size ([alloc-sample-clear-shipped.json](./research/state-next/alloc-sample-clear-shipped.json) (the shipped source, unminified) / [-proto.json](./research/state-next/alloc-sample-clear-proto.json) (the sandbox with §10.7's row records and §10.10); the sum of three pages per run):

| Function (self size) | shipped | row-record prototype |
|---|---:|---:|
| Allocated per clear | **8.06 MB** | **6.76 MB** |
| `next` (iterator result objects: `for...of` over Sets / arrays) | 3.06 MB (37 %) | 1.86 MB (27 %) |
| `tryDestroy` (iterating `_childNodeArray` and the bindings, observer-skip marks) | 1.82 MB | 1.81 MB |
| `add` (growth of the WeakSet / Set behind `markObserverSkipOnRemove`) | 0.83 MB | 0.84 MB |
| `delete` (rehashing as the pooled rows leave the ledgers) | 0.69 MB | 0.59 MB |
| `destroyRecords` | 0.54 MB | 0.56 MB |
| `values` / `from` (iterators, `Array.from`) | 0.62 MB | 0.55 MB |

- What fills the young generation inside the clear's window is not the teardown of the row bookkeeping itself but **iteration-protocol garbage** (`for...of` over `this.records` and `deleteIndexSet`, `Array.from(this.records)`) and **Set / WeakSet churn** (a per-node observer-skip mark, the ledger removal of the 1,000 rows entering the pool). That is the trigger of the scavenge landing in the clear's window (§10.6).
- The row record (§10.7) turned `destroyRecords` into an index loop and cut `next` by 1.2 MB. The rest is `tryDestroy`'s iteration and the observer-skip marks; **index loops, one skip mark per content, and skipping ledger removal on the wholesale path** should bring the clear's allocation under 1 MB. If the allocation no longer fills the nursery, the scavenge does not land in the clear's window and the clear approaches §8.6's "engine about 21 ms" (the garbage is collected by a later allocation, so the cost moves out of the window rather than disappearing).

Addendum (same day, index-loop prototype): [clearAllocPatch.mjs](../scripts/research/clearAllocPatch.mjs) applied to the sandbox (the two `for...of` loops of `tryDestroy` become index loops, `applyChangeToFor`'s delete loop becomes `Set.forEach`, the iteration of an empty record Set is skipped; semantics unchanged, 34 related tests pass).

| Build | Allocated by the clear | Samples with a scavenge inside the clear's window | Clear ms (5 samples) |
|---|---:|---:|---|
| shipped (§10.6) | 8.06 MB | 3 / 5 (22–35 ms) | 22, 34, 46, 49, 72 |
| index loops ([alloc-sample-clear-proto-loops.json](./research/state-next/alloc-sample-clear-proto-loops.json), [blink-trace-proto-loops.json](./research/state-next/blink-trace-proto-loops.json)) | **3.52 MB** | **1 / 5** (17.7 ms) | 22, 22, 32, 34, 38 |

- Iterator garbage `next` 3.06 → 1.27 MB, `tryDestroy`'s own allocation 1.8 MB → 0. The remaining 3.5 MB is the growth of the observer-skip WeakSet (`add` 0.82 MB), the ledger removal of the 1,000 pooled rows (`delete` 0.58 MB) and the iteration inside `deactivateContent` / `unmount` for the pooled rows (the rest of `next`). A scavenge lands in the window in 1 of 5 samples instead of 3, at 17.7 ms when it does. **Getting under 1 MB needs one skip mark per content and skipping the pooled rows' ledger removal on the wholesale path.**

Addendum 2 (the next day, round-4 §11 item 6): [clearAllocPatch2.mjs](../scripts/research/clearAllocPatch2.mjs). The observer-skip marks became **a count per parent** instead of a WeakSet entry per node (a full clear removes every row with one `textContent = ''`, so all rows sit in one mutation record; writing "this many removals are the framework's" on the parent once lets the observer skip that record whole; a record the count does not cover falls back to the per-node marks). The `for...of` loops of `unmount` / `deactivateContent` / `unbindLoopContextToContent` / `_teardownBindings` became index loops as well. Semantics unchanged, 3,661 tests pass.

| Build | Allocated by the clear | Samples with a scavenge inside the clear's window | Clear ms (5 samples) |
|---|---:|---:|---|
| shipped (§10.6) | 8.06 MB | 3 / 5 | 22, 34, 46, 49, 72 |
| index loops | 3.52 MB | 1 / 5 | 22, 22, 32, 34, 38 |
| + per-parent skip count ([alloc-sample-clear-proto-loops2.json](./research/state-next/alloc-sample-clear-proto-loops2.json), [blink-trace-proto-loops2.json](./research/state-next/blink-trace-proto-loops2.json)) | **2.11 MB** | **0 / 5** | **18.7, 18.3, 17.8, 19.7, 17.9** |

- Every sample now clears in 18–20 ms, §8.6's "engine about 21 ms". The observer callback (`AsyncTask Run`) went from 1.7–2.9 ms to 0.2 ms. The remaining 2.1 MB is the pooled rows' ledger removal (`delete` 0.45 MB) and iteration (`next` 0.78 MB, `add` 0.57 MB); skipping the pooled rows' ledger removal on the wholesale path would reduce it further, but for keeping the scavenge out of the window it is already enough. Both patches change no semantics and can ship in 2.6.x.

### 10.13 Plan-level initial render (round-4 §11 item 3 (b))

[planRenderPatch.mjs](../scripts/research/planRenderPatch.mjs) applied to the sandbox (with row records, the keyed subscription and the clear's index loops). When a plan row is activated, a slot whose state path is a plain leaf under the row (no getter on any prefix, no wildcard in the tail, not an event / index binding) takes its value from the row object, read once through the proxy (`state[getByAddressSymbol](loopContext)`), and hands it to `applyValueToBinding` (the DOM-writing tail of `_applyChange`, split out). Getter slots (`data.*.selected`) keep `applyChange`. States with `$updatedCallback` or with `**` take the ordinary path (the former needs the per-binding address aggregation, the latter's expanded getters are not in `getterPaths`). Whether a prefix is a getter is checked per row against `getterPaths` (the set is rebuilt on a reset, so it is not cached). All 3,661 tests pass (the first version failed 8 on recursion and resets, fixed by those two rules).

Before and after in the same sandbox (stage-3 counters [runtime-counters-content-tracked-proto-planrender-before.json](./research/state-next/runtime-counters-content-tracked-proto-planrender-before.json) / [-after.json](./research/state-next/runtime-counters-content-tracked-proto-planrender-after.json), median ms):

| Operation | Elapsed before → after | Activation before → after | Reads per row | Applies per row |
|---|---:|---:|---:|---:|
| Create 10,000 rows | 313.1 → **281.0** (−10 %) | 124.1 → 111.2 | 7 → 4 | 3 → 1 |
| Create 1,000 rows (warm, pool reuse) | 22.2 → **16.1** | 14.9 → 10.6 | 7 → 4 | 3 → 1 |
| Append 1,000 rows | 38.5 → 39.3 | 12.6 → 12.2 | 7 → 4 | 3 → 1 |

- Profile ([profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json) re-taken on the prototype build): window 511 → 452 ms; by group, the initial apply 6.0 → 4.2, address creation 5.3 → 3.6, reads 2.0 → 1.3, content creation 6.4 → 5.0 (the `getCustomElement` check of the leaf slots is gone) µs per row.
- Benchmark timing ([warm-vs-cold-file-tracked-plain-jsfb-planrender.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb-planrender.json)): create 1,000 rows cold **53.4 → 53.4** (unchanged), warm 19.0 → 17.4, append cold 61.5 → 63.1. **The audit benchmark's metric, the cold creation of 1,000 rows, does not move**: cold is dominated by the JIT and first-time allocation, which trimming the per-binding constant does not reach. The gain is in large creations (10 % at 10,000 rows) and warm runs.
- Conclusion: of the 28 µs per row of creation, the initial-apply side yields about 3 µs per row. Moving the cold 1,000-row figure needs a look at what runs for the first time (JIT warm-up, the first template clone, the initial growth of the ledgers) rather than at the per-binding work.

### 10.14 One session per list (round-4 §11 item 3 (a))

[sessionPerListPatch.mjs](../scripts/research/sessionPerListPatch.mjs) applied on top of the row record (§10.7) and the plan-level initial render (§10.13). `BindingSession` holds a Set of row records and one session, keyed by the `for` binding's node, is shared by all of its rows. The content-side row operations (`unmount` / `unmountInPlace` / `tryDestroy`) became row-scoped `disposeBindings` / `destroyRow`, and a shared session's definition-wait tasks follow the rule "tasks on the row's nodes are cancelled with the row; when no live row is left, all are cancelled" (the two wholesale integration tests pass under it). All 3,661 tests pass.

| Metric | Up to the plan render (§10.13) | + one session per list |
|---|---:|---:|
| Heap ([heap-per-row-session-per-list.json](./research/state-next/heap-per-row-session-per-list.json), 10,000 rows, bytes per row) | 3,630 (shipped) | **3,033** (−597, −16 %) |
| Create 10,000 rows (stage-3 counters, median ms) | 281 | 294 ([second run](./research/state-next/runtime-counters-content-tracked-proto-session-per-list-2.json); the [first](./research/state-next/runtime-counters-content-tracked-proto-session-per-list.json) read 424 with samples 273 / 424 / 494, a GC outlier) |
| Create 1,000 rows cold / warm (benchmark timing) | 53.4 / 17.4 | 50.0 / 18.2 |

- §10.11 estimated the per-row session as the owner of the 1.65 KB per row of backing stores; what came out is 0.6 KB per row. The per-row session holds 5 collections (3 WeakMaps, 2 Sets), about 600 bytes; the remaining WeakMaps (3 of the 6 per row) and array backing stores belong to module-level ledgers (the per-loop-context list-index cache, the content ledgers). §10.11's estimate is corrected.
- Time is unchanged (the difference is within sample noise). The shared session's per-node WeakMap (`knownBindingsByNode`) grows to 50,000 entries without a measurable penalty.
- The sandbox with the three stages stacked (row record → plan render → shared session) now stands at: create 10,000 rows 313 → 294 ms, warm create 1,000 rows 22 → 16 ms, heap 3.6 → 3.0 KB per row, clear 18–20 ms with no scavenge (§10.12). Cold create 1,000 rows stays at 50–53 ms.

### 10.15 What the cold creation of 1,000 rows is made of, and the shipping inputs for the three stages (the rest of round-4 §11 item 3)

**The cold breakdown**: [audit-state-tech-profile.mjs](../scripts/audit-state-tech-profile.mjs) gained `--op create1k --warm`: on a fresh page the first run (cold) is profiled, then the page is cleared and the same operation profiled again (warm), and the self time per function is listed cold against warm (average of 9 pages, values under the profiler; [profile-create1k-coldwarm-shipped.json](./research/state-next/profile-create1k-coldwarm-shipped.json) (shipped source) / [-proto.json](./research/state-next/profile-create1k-coldwarm-proto.json) (the sandbox with the three stages)):

| Group (shipped source, ms per 1,000 rows) | cold | warm | cold's excess |
|---|---:|---:|---:|
| Window (elapsed) | 66.2 | 27.9 | 38.3 |
| (program) (native, unattributed) | 55.7 | 61.4 | −5.7 |
| GC | 10.0 | 0.1 | **9.9** |
| DOM native calls (`importNode` 5.2, …) | 9.7 | 4.7 | **5.0** |
| Content creation (`resolveNodePath` 3.2, `Content` 1.5, `createContent` 0.9, …) | 7.5 | 0.6 | **6.9** |
| Ledger writes (`markNodeRegistered` 1.2, …) | 4.9 | 1.8 | 3.1 |
| Session (`initializeRow` 2.1) | 3.5 | 1.0 | 2.5 |
| Reads / addresses / apply / walk | 19.5 | 12.3 | 7.2 |

- Warm reuses the 1,000 rows the clear put into the pool and therefore **skips content creation entirely** (clone, node-path resolution, records, ledgers). Of cold's 38 ms excess, about 18 ms is that (DOM 5 + creation 7 + ledgers 3 + session 2.5), about 10 ms is the young-generation GC triggered by the creation's allocations, and about 7 ms is the first-run cost on the read / address / apply side (JIT tier and IC warm-up). The audit benchmark's cold 1,000 rows of 50 ms is "warm's steady 17 ms + content creation + GC + warm-up", which is why a design that trims the per-binding constant (§10.13) did not move it.
- The three-stage sandbox goes cold 66.2 → 58.4 (−12 %), GC 10.0 → 5.5, and the benchmark's cold 1,000 rows 53.4 → 50.0. What helped is the reduced allocation (GC); cloning and node-path resolution (DOM 9.4, creation 8.6) remain.
- Design candidates for cold: (1) allocate even less per row (GC); (2) cloning and node-path resolution (`importNode` + `resolveNodePath` = 8 ms of cold; T4 candidates: a marked template read with one `querySelectorAll`, `cloneNode` with precomputed child indices); (3) pre-warming the pool (creating N contents before the first render; the shortest path from cold to warm, at the price of creating rows that may never be used).

**Shipping inputs for the three stages** (not a decision):

| Stage | Files touched (changed lines) | Public-surface change | Effect | Placement |
|---|---|---|---|---|
| Clear allocation 1 + 2 (§10.12) | `createContent` 30, `applyChangeToFor` 14, `observerSkip` 22, `BindingSession` 6, `activateContent` 4, `bindLoopContextToContent` 4 | none (internal loops and how the marks are kept) | clear 22–72 → 18–20 ms, the scavenge leaves the window | **2.6.x** (no semantic change; one boundary test for the observer's count consumption) |
| Plan-level initial render (§10.13) | `activateContent` 88, `applyChange` 6, `createContent` 3, new `planByContent` 10 | `applyValueToBinding` exported (internal) | 10,000 rows −10 %, warm 1,000 rows −27 % | **2.6.x candidate** (local; states with `$updatedCallback` or `**` are gated to the ordinary path) |
| Row record (§10.7) + shared session (§10.14) | `BindingSession` 372, `createContent` 30, `initializeBindings` 10 | `BindingSession` gains `disposeBindings` / `destroyRow` / `isRowSession` / `currentRowPlan`, `getRecord` returns a synthesized view for row bindings, the shared session's deferred-task rule | heap −16 %, time unchanged | **3.0** (touches `BindingSession`'s core and public surface; belongs with the audit's §7 "separate the template plan from row instances") |

All three pass the sandbox's full suite of 3,661 tests (no test was changed).

## 11. What to measure next

1. Done: the keyed subscription (`$eq` / `$eqPath` / `$eqIndex`, dispose-tied unsubscription, diff-side re-keying) is ported into the repository's `packages/state` (`src/dependency/keyedDependency.ts`, the get trap, `setByAddress`, `createListDiff`, the `defineState` types, the VS Code extension's preamble, the "Keyed selection" section of both READMEs, 11 tests in [proxy.keyed.test.ts](../packages/state/__tests__/proxy.keyed.test.ts)). 3,661 tests pass, coverage within thresholds, the coupling and size gates pass. Uncommitted. The next day an SSR hydration test was added (server render → after hydration the subscriptions are re-registered and follow a selection write). Exposing subscriptions to DevTools comes with 3.0's protocol version bump (requirements D17); updating the `$` API list of `wcstack-skill` is work in that other repository.
2. Done: `$eqIndex`'s innermost level became one watcher per list, taking removing one row from 17.5 to 14.5 ms (the level of the id key); ported into the repository as well (§10.10 addendum 2).
3. Done: (b) the plan-level initial render (§10.13), (a) one session per list (§10.14), and the cold 1,000-row breakdown (§10.15: the 38 ms excess = content creation the pool hides 18 + GC 10 + warm-up 7, profiled values). Next, of the three cold levers (less allocation, the T4 forms of cloning and node-path resolution, pre-warming the pool), try cloning and node-path resolution on the DOM-floor page. The designer decides where the three stages ship, from the table in §10.15.
4. S3's three slices (stream / recursion, dcc, watch / scopes) are implemented in the sandbox (implementation record in design §8-2: all 3,668 tests pass, core → feature edges 41 → **14**, 12 receptacle kinds, read cost within noise, the full `auto` bundle +1.3 KB gzip — awaiting decision D19). D19 is decided as recommendation (a) (requirements §6), and S4 is complete after eight slices (volumes §8-3, `$streams` / `$watch` §8-4, `$scan` §8-5, bind-component and mounts §8-6, `$recursion`, the last imports and the failed-root landing §8-7, the DCC connect §8-8). `State.ts` goes 1,683 → 1,220 lines and its feature imports 24 → 1 (type-only), with no value import left; no read, write or connect hot-path edge is left. S5's first slice (the five edges that are neither install nor SSR, design §8-9) and second (separating SSR = H8, §8-10) take core → feature edges 17 → 12 → **10, all of them entry edges** (8 installs, `exports → ssr/Ssr`, `registerComponents → components/State`); the cycle shrinks from 31 to 28 modules. The third slice (the split entries, §8-11) adds `installFeatures` and `@wcstack/state/core`: **the core alone is 43,779 B gzip** (features add scopes +15.4, temporal +8.3, recursion +4.8, ssr +3.1, devtools +1.9 KB; 73,504 B for all of them; [split-entry-sizes.json](./research/state-next/split-entry-sizes.json)). That equals the stubbed upper bound of 44.0 KB — the wiring extraction did not shrink the core, so A2's 35 KB needs the other three stages of §5. One core chunk holds (no feature entry carries a core module); split delivery costs +13 % in chunking. Edges read 62 → **6** after the audit's classification was corrected. It was **ported into the product the same day** (design §8-12): `./core` / `./features/*` / `./define` in `exports`, the split build in the real rollup config, two CI gates (no re-bundled core, the core entry's closure size), and the README / SRI documentation. `features/formats` (D16's filter registry) followed the same day (design §8-13; the core alone goes 43,779 → 42,705 B gzip). What is left are the two stages of §5 that A2 needs (unifying `BindingSession`, diagnostics to a dev build). The coupling audit measures a prototype with `--pkg <sandbox>`.
5. Done: [audit-state-tech-helper-import.mjs](../scripts/audit-state-tech-helper-import.mjs) gained `--check --max-gzip 1024`, and `ci.yml`'s state job now gates "re-export of `defineState` only ≤ 1 KB gzip" (309 bytes today). What remains of requirements N3 is the full / auto gzip thresholds, to be set from the release figures separately.
6. Done: index loops plus the per-parent skip count take the clear's allocation from 8.06 to 2.11 MB, keep the scavenge out of the window in all five samples, and clear in 18–20 ms (§10.12 addendum 2). The two patches were ported into the repository's `packages/state` the next day (uncommitted; all tests pass, with the boundary test [bindings.observerSkipRemovedChildren.test.ts](../packages/state/__tests__/bindings.observerSkipRemovedChildren.test.ts) for the observer's count consumption added).

## 12. Reproduction and artefacts

```powershell
# repository root
npm ci --prefix e2e
npm ci --prefix packages/state
npx --prefix e2e playwright install firefox webkit    # only when measuring beyond Chromium
node scripts/audit-state-tech-coupling.mjs            # emits with tsc into a temporary directory and analyses that
node scripts/audit-state-tech-coupling.mjs --source   # analyses the TypeScript source (over-counts type imports)
node scripts/audit-state-tech-lexer.mjs               # lexer spike against the shipped parser
node scripts/audit-state-tech-adapter.mjs             # AST → IParsedBinding adapter comparison and grammar-stage sizes
node scripts/audit-state-tech-graph.mjs               # re-launches itself with --expose-gc
node scripts/audit-state-tech-dom.mjs                 # Chromium / Firefox / WebKit
node scripts/audit-state-tech-counters.mjs            # stage 1: expansion, addresses, reads, apply
node scripts/audit-state-tech-counters.mjs --list     # stage 2: inside the list apply and the write path
node scripts/audit-state-tech-counters.mjs --content [--trace]  # stage 3: inside row content creation (--trace adds a CDP trace)
node scripts/audit-state-tech-warmth.mjs [--bundle auto|index|<file>] [--fixture manual|tracked] [--sequence plain|counters] [--method jsfb|counters|task] [--setup input|sync] [--gc-before]
node scripts/audit-state-tech-frame.mjs               # rendered frame or not, versus clear cost (bare DOM and shipped runtime)
node scripts/audit-state-tech-split.mjs               # stubs feature groups, measures and attributes the named entry
node scripts/audit-state-tech-members.mjs             # member-level attribution and referenced feature groups
node scripts/audit-state-tech-fold.mjs                # row creation cost and heap per bookkeeping shape (none / current / folded)
node scripts/audit-state-tech-coupling.mjs --check    # CI gate: exits 1 on a violation of scripts/state-coupling-baseline.json
node scripts/audit-state-tech-helper-import.mjs       # what a helper-only import leaves (checked-in dist against today's src)
node scripts/audit-state-tech-blink.mjs [--samples N] [--bundle <file>] [--out <name>]   # trace with the blink category: Layout / GC breakdown of create → immediate clear
node scripts/audit-state-tech-heap.mjs [--proto <file>] [--fixture manual|tracked]   # retained heap of 10,000 rows (bytes per row), shipped against a prototype
node scripts/audit-state-tech-hookcost.mjs <label>=<file> ... [--samples N]          # micro-benchmark of reads and writes through the proxy (hook cost)
node scripts/audit-state-tech-gcshape.mjs [--samples N]                              # GC of create → immediate clear per bookkeeping shape (DOM-floor page)
node scripts/audit-state-tech-heapsnapshot.mjs [--proto <file>] [--top N]            # heap of 10,000 rows attributed by type / constructor (pass an unminified build for names)
node scripts/audit-state-tech-profile.mjs [--bundle <file>] [--op create1k|create10k|append1k|select10k] [--warm]   # CDP Profiler self time per function (--warm also profiles a second run on the same page, cold against warm)
node scripts/audit-state-tech-allocsample.mjs [--bundle <file>] [--samples N]          # allocation sampling of the clear's window (self size per function); output renamed to -shipped / -proto
node scripts/audit-state-tech-helper-import.mjs --check --max-gzip 1024               # CI gate: re-export of defineState only stays under 1 KB gzip
node scripts/check-state-size.mjs --check [--update]                                 # CI gate: gzip of auto.min.js / index.esm.js within +3 % of the release baseline (requirements N3 / D18)
# e2e directory: re-run of the audit's benchmark
node bench/jsfb-verify.mjs --label next-major-rerun --out ../docs/research/state-next/browser-1x-rerun.json --port 4297
# $eq prototype: copy packages/state (src, __tests__, scripts, configs, a junction to node_modules, the root
# tsconfig.json) into a sandbox, then
node scripts/research/keyedPrototypePatch.mjs <sandbox>/packages/state   # dependency/keyedDependency.ts goes in first
(cd <sandbox>/packages/state && npx rollup -c && npx vitest run)
node scripts/audit-state-tech-keyed.mjs --proto <sandbox>/packages/state/dist/index.esm.js
node scripts/audit-state-tech-counters.mjs --list --pkg <sandbox>/packages/state --fixture tracked|keyed|keyedId|keyedIdUntracked|keyedIdPath|keyedIndex   # stage 2 on the prototype build (-<fixture>-proto.json)
# round 3 (§10.10): put the third keyedDependency.prototype.ts in place first, then patch, add the test and time
node scripts/research/keyedRound3Patch.mjs <sandbox>/packages/state   # copy proxy.keyedRound3.test.ts into __tests__
node scripts/audit-state-tech-keyed.mjs --only tracked,keyedIdUntracked,keyedIdPath,keyedIndex --proto <sandbox>/packages/state/dist/index.esm.js --out keyed-round3.json
# plan-level initial render (§10.13): stage 3 before and after the patch renamed to -planrender-before / -after; warmth and profile on the prototype build
node scripts/research/planRenderPatch.mjs <sandbox>/packages/state
# one session per list (§10.14): on top of the row record; heap / stage 3 / warmth on the prototype build (outputs renamed to -session-per-list)
node scripts/research/sessionPerListPatch.mjs <sandbox>/packages/state
# the clear's allocations (§10.12 addenda 1 and 2)
node scripts/research/clearAllocPatch.mjs <sandbox>/packages/state
node scripts/research/clearAllocPatch2.mjs <sandbox>/packages/state
# S3 first slice (implementation record in design §8-2): applied to a second sandbox of the current source; the coupling audit takes --pkg
node scripts/research/s3StreamSlicePatch.mjs <sandbox2>/packages/state
node scripts/research/s3FeatureSlicePatch.mjs <sandbox2>/packages/state   # slice 2 (recursion, dcc, watch)
node scripts/research/s3ScopesSlicePatch.mjs <sandbox2>/packages/state    # slice 3 (scopes) — the three are idempotent and applied in order
node scripts/research/s4VolumeLifecyclePatch.mjs <sandbox2>/packages/state  # S4's first slice (design §8-3, stacked on S3's three)
node scripts/research/s4TemporalDeclarationPatch.mjs <sandbox2>/packages/state  # S4's second slice (design §8-4)
node scripts/research/s4ScanContextPatch.mjs <sandbox2>/packages/state       # S4's third slice (design §8-5)
node scripts/research/s4BindComponentPatch.mjs <sandbox2>/packages/state     # S4's fourth slice (design §8-6)
node scripts/research/s4RecursionDeclarationPatch.mjs <sandbox2>/packages/state  # S4's fifth slice (design §8-7)
node scripts/research/s4TrimStateImportsPatch.mjs <sandbox2>/packages/state   # S4's sixth slice (same)
node scripts/research/s4FailedRootPatch.mjs <sandbox2>/packages/state         # S4's seventh slice (same)
node scripts/research/s4DccLifecyclePatch.mjs <sandbox2>/packages/state       # S4's eighth slice (design §8-8)
node scripts/research/s5CoreEdgesPatch.mjs <sandbox2>/packages/state          # S5's first slice (design §8-9)
node scripts/research/s5SsrSplitPatch.mjs <sandbox2>/packages/state           # S5's second slice (design §8-10; SSR moves to src/ssr/)
node scripts/research/s5SplitEntriesPatch.mjs <sandbox2>/packages/state       # S5's third slice (design §8-11; the split entries) — the fourteen are idempotent and applied in this order
node scripts/research/measureSplitEntries.mjs <sandbox2>/packages/state       # split-entry-sizes.json (single-file bundles, the dist-split closures, the core's attribution)
node scripts/audit-state-tech-coupling.mjs --pkg <sandbox2>/packages/state   # coupling-proto.json (per-slice copies: coupling-proto-s3slice{2,3}.json; for S4, coupling-proto-s4volume / -s4 / -s4final / -s4dcc.json; for S5, -s5edges.json / -s5ssr.json / -s5entries.json)
node scripts/audit-state-tech-hookcost.mjs base=<sandbox-plain>/packages/state/dist/auto.min.js s3slice3=<sandbox2>/packages/state/dist/auto.min.js --samples 9   # hook-cost-micro-s3slice{2,3}.json
# activation hoisting prototype: take stage 3 before (-before) and after (-after) the patch, renaming the output
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked
node scripts/research/activationPrototypePatch.mjs <sandbox>/packages/state
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked
# rows without records (§10.7): restore BindingSession.ts first, then patch, test, build, count and measure the heap
node scripts/research/rowRecordPrototypePatch.mjs <sandbox>/packages/state
(cd <sandbox>/packages/state && npx vitest run && npx rollup -c)
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked   # renamed to -rowrecord-full
node scripts/audit-state-tech-heap.mjs --proto <sandbox>/packages/state/dist/index.esm.js
# cost of the H1 hook (§10.8): applied to a second sandbox of the current source; three builds, none / --inactive 3 / --gated --inactive 3
node scripts/research/addressHookPrototypePatch.mjs <sandbox2>/packages/state [--inactive 3] [--gated]
node scripts/audit-state-tech-keyed.mjs --only tracked --proto <sandbox2>/packages/state/dist/index.esm.js --out hook-cost-<variant>.json
node scripts/audit-state-tech-hookcost.mjs base=<plain dist> hookNone=<none dist> hookInactive3=<inactive3 dist> hookGated3=<gated3 dist> --samples 9
```

Do not run the timing scripts (dom / counters / warmth / frame / fold / keyed / blink / jsfb) concurrently.

- [coupling.json](./research/state-next/coupling.json) / [coupling-source.json](./research/state-next/coupling-source.json)
- [lexer-spike.json](./research/state-next/lexer-spike.json) / [adapter-spike.json](./research/state-next/adapter-spike.json), spikes [bindTextLexerSpike.mjs](../scripts/research/bindTextLexerSpike.mjs) / [bindTextAdapterSpike.mjs](../scripts/research/bindTextAdapterSpike.mjs)
- [graph-mechanisms.json](./research/state-next/graph-mechanisms.json)
- [dom-floor.json](./research/state-next/dom-floor.json), page side [domFloorPage.js](../scripts/research/domFloorPage.js), [browser-1x-rerun.json](./research/state-next/browser-1x-rerun.json), `warm-vs-cold-<bundle>-<fixture>-<sequence>-<method>[-sync][-gc].json`, [frame-vs-clear.json](./research/state-next/frame-vs-clear.json), [blink-trace.json](./research/state-next/blink-trace.json)
- [platform-status-2026-09.md](./research/state-next/platform-status-2026-09.md)
- [runtime-counters.json](./research/state-next/runtime-counters.json) / [runtime-counters-list.json](./research/state-next/runtime-counters-list.json) / [runtime-counters-content.json](./research/state-next/runtime-counters-content.json) / [runtime-counters-content-trace.json](./research/state-next/runtime-counters-content-trace.json), trace roll-up [cdpTrace.mjs](../scripts/research/cdpTrace.mjs)
- [split-stub-sizes.json](./research/state-next/split-stub-sizes.json) / [member-attribution.json](./research/state-next/member-attribution.json)
- Prototypes: [keyed-prototype.json](./research/state-next/keyed-prototype.json), the patch [keyedPrototypePatch.mjs](../scripts/research/keyedPrototypePatch.mjs), the new module [keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts) (placed as `src/dependency/keyedDependency.ts` in the sandbox; round 3 is [keyedRound3Patch.mjs](../scripts/research/keyedRound3Patch.mjs), [proxy.keyedRound3.test.ts](../scripts/research/proxy.keyedRound3.test.ts) and [keyed-round3.json](./research/state-next/keyed-round3.json)), [fold-shape.json](./research/state-next/fold-shape.json), stage-2 counters `runtime-counters-list-<fixture>-proto.json`, the activation hoisting patch [activationPrototypePatch.mjs](../scripts/research/activationPrototypePatch.mjs) with `runtime-counters-content-tracked-proto-{before,after}.json`, rows without records [rowRecordPrototypePatch.mjs](../scripts/research/rowRecordPrototypePatch.mjs) with `runtime-counters-content-tracked{,-rowrecord-full,-rowrecord-b1,-rowrecord-b2}.json` and [heap-per-row.json](./research/state-next/heap-per-row.json)
- Design draft: [state-next-major-wiring-design.md](./state-next-major-wiring-design.md). S1 / S2 results [helper-import.json](./research/state-next/helper-import.json), CI baseline [state-coupling-baseline.json](../scripts/state-coupling-baseline.json), H1 hook cost [addressHookPrototypePatch.mjs](../scripts/research/addressHookPrototypePatch.mjs), `hook-cost-{none,inactive3,base,protoctl}.json`, [hook-cost-micro.json](./research/state-next/hook-cost-micro.json)
- GC of the clear: [gc-shape.json](./research/state-next/gc-shape.json)
- Plan-level initial render: [planRenderPatch.mjs](../scripts/research/planRenderPatch.mjs), `runtime-counters-content-tracked-proto-planrender-{before,after}.json`, [warm-vs-cold-file-tracked-plain-jsfb-planrender.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb-planrender.json)
- One session per list: [sessionPerListPatch.mjs](../scripts/research/sessionPerListPatch.mjs), [heap-per-row-session-per-list.json](./research/state-next/heap-per-row-session-per-list.json), `runtime-counters-content-tracked-proto-session-per-list{,-2}.json`
- The cold breakdown: [profile-create1k-coldwarm-shipped.json](./research/state-next/profile-create1k-coldwarm-shipped.json) / [-proto.json](./research/state-next/profile-create1k-coldwarm-proto.json)
- Attribution of creation: [heap-snapshot-attribution.json](./research/state-next/heap-snapshot-attribution.json) / [-proto.json](./research/state-next/heap-snapshot-attribution-proto.json), [profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json)
- The clear's allocations: [alloc-sample-clear-shipped.json](./research/state-next/alloc-sample-clear-shipped.json) / [-proto.json](./research/state-next/alloc-sample-clear-proto.json) / [-proto-loops.json](./research/state-next/alloc-sample-clear-proto-loops.json) / [-proto-loops2.json](./research/state-next/alloc-sample-clear-proto-loops2.json), the index-loop patch [clearAllocPatch.mjs](../scripts/research/clearAllocPatch.mjs) and the per-parent skip count [clearAllocPatch2.mjs](../scripts/research/clearAllocPatch2.mjs), [blink-trace-proto-loops.json](./research/state-next/blink-trace-proto-loops.json) / [-loops2.json](./research/state-next/blink-trace-proto-loops2.json)
