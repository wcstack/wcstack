# Classification taxonomy for the @wcstack/state engine rewrite

Context: the author is rewriting the `@wcstack/state` engine from scratch as a **separate package** that is continuously compared against the current one. Provisional decisions:
1. **No new grammar** — `data-wcs` syntax, `$` APIs, path-string getters stay as they are.
2. **Core includes mount/volume and `$eq`** (plus the obvious basics). Everything else is to be decided.
3. Separate package, always compared against the current engine.
4. Targets: core ≤ 20 KB gzip; creating 1,000 rows within 2× of raw DOM.

Your job is to CLASSIFY, not to decide. Tag what each item protects, with evidence. Do not modify any file in the repository.

## Axis 1 — feature tags (use exactly these IDs)

Presumed core (decided or obviously basic):
- `C.grammar` — data-wcs parsing, modifiers (`#ro` `#wo` `#init=` `#sync=` …), mustache `{{ }}`, comment bindings, dot shorthand, spread syntax parsing, parse errors
- `C.state` — proxy get/set, nested paths, arrays/immutable-update rules, readonly proxy, same-value guard, `$1`…`$n`, `$resolve`, `$getAll`, `$setAll`, `$postUpdate`/`$notify`-style APIs
- `C.getter` — path getters / setters, top-level computed, chaining, wildcard getters, dependency tracking, `$trackDependency` / `$untrackDependency`, cycle detection, getter cache
- `C.list` — `for` rendering, keyed diff, pooling, `$index`, reorder/LIS, row reuse, nested lists
- `C.if` — `if` / `elseif` / `else`
- `C.bind` — applying values to DOM: text, property, attribute, class, style, radio, checkbox, select, two-way input, SVG, spread application, empty-value (null/undefined) display rules
- `C.event` — `on*:` handlers, handler arguments, event → state writes
- `C.filter` — the filter pipeline and non-formatting built-in filters (comparison, arithmetic, boolean, string ops, type conversion)
- `C.filter-format` — formatting filters (number/currency/percent/date/time/locale) — the current `features/formats`
- `C.update` — batching/updater/drain, microtask scheduling, read-after-write consistency, apply ordering
- `C.init` — `<wcs-state>` element, state loading (inline JSON / `<script>` / `src` / `json` / `setInitialState` / `defineState`), bootstrap, readiness promises, config
- `C.lifecycle` — `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback` / `$errorCallback`
- `C.mount` — `mount=` attribute, volumes (`<wcs-state mount="path">`), own-key shadowing, mount modifiers  (DECIDED CORE)
- `C.eq` — keyed selection `$eq` / `$eqPath` / `$eqIndex`  (DECIDED CORE)

Undecided (tag them; the author decides later):
- `X.wcbindable` — binding to custom elements that declare `static wcBindable` (I/O nodes): `inputs`, attribute mirror, binding authority `#init=`/`#sync=`, directional initial sync, `properties[].getter`, custom-element upgrade/definition waiting
- `X.cmdtoken` — command token: `$commandTokens`, `command.<m>:`, `$command`
- `X.evttoken` — event token: `$eventTokens`, `eventToken.<p>:`, `$on`
- `X.component` — `bind-component` (Shadow/Light DOM components holding state), `state.x:` injection, whole-object mount `state: path`, exported getters, component scopes
- `X.dcc` — Declarative Custom Components (`data-wc-definition`, `$bindables`, `$commands`)
- `X.ssr` — SSR, `<wcs-ssr>`, hydration, snapshot, `enable-ssr`
- `X.stream` — `$streams`
- `X.watch` — `$watch`
- `X.scan` — `$scan`
- `X.recursion` — `$recursion` / `**`
- `X.listkeys` — `$listKeys`
- `X.elemwrite` — writes to a list element (`list.*` element replacement/swap identity model, #4 family)
- `X.propagation` — causal propagation context (`enablePropagationContext`), write receipts, echo suppression hop limits
- `X.devtools` — DevTools source/bridge/sink
- `X.viewtransition` — transition-runner hand-off, `view-transition-name` naming
- `X.diagnostics` — path diagnostics, error guidance, dev warnings, `features/diagnostics`
- `X.i18n` — locale handling
- `X.trustedtypes` — Trusted Types
- `X.binder` — the binder protocol
- `X.split` — split entries, `installFeatures`, feature registry, hooks/receptacles (delivery mechanism of the current engine)
- `T.tooling` — non-runtime: manifest, parser entry, contract analyzer, filter metadata, version, exports shape, lint/editor support
- `I.internal` — tests an internal mechanism of the current engine with no user-observable contract of its own (address interning, PathInfo derivations, cache entries, WeakMap ledgers, BindingSession internals, row plans, topological ranks…)

A file usually has several tags. Give each tag an approximate test count (sum ≈ the file's test count).

## Axis 2 — portability to a new engine
- `BB` black-box: drives only through DOM + `<wcs-state>` + the public API (`exports`/`auto`/`define`/`config`). Could run against the new package by swapping the import.
- `GB` gray-box: drives through DOM / public behaviour, but imports internal modules for setup or inspection (e.g. `bootstrapState` from src, `stateElementByName`, `components/State` types, a ledger peek). Portable with a small adapter; state what the adapter would need.
- `WB` white-box: calls internal functions/classes directly and asserts their outputs/structures. Not portable. If it protects a user-visible contract, say which one so it can be re-expressed as a black-box test.

## Axis 3 — signals (free-form flags, only when evidence exists)
- `defect:#NNN` — pins a fix for an issue number (from titles/comments)
- `B-item:Bn` — pins a 3.0 breaking-change decision (B1–B14, see docs/state-next-major-requirements.md)
- `flag:<name>` — exercises a config/feature flag, esp. both on/off paths (e.g. `sameValueGuard`, `enablePropagationContext`, `enableDirectionalInitialSync`)
- `compat` — compatibility alias / legacy behaviour
- `perf` — performance/allocation assertion rather than behaviour
- `workaround` — guards a workaround or special case that exists because of how the current engine is built
- `deprecate?:<reason>` — you see concrete evidence the behaviour is a removal candidate (superseded, contradictory, documented as legacy, rarely meaningful). Be conservative.
