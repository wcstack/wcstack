# Changelog

All notable changes to the wcstack packages are documented here. All published `@wcstack/*` packages and the `wcstack` entry package share one version and are released in lockstep; a release bumps every package whether or not it changed. The VS Code extension (`packages/vscode-wcs`) is versioned separately and keeps [its own changelog](./packages/vscode-wcs/CHANGELOG.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). What counts as a breaking change is defined in the root README under [Versioning and breaking changes](./README.md#versioning-and-breaking-changes). Upgrading from 1.x: read the [v1 → v2 migration guide](./docs/migration-v2.md) first.

Each GitHub Release also carries the Subresource Integrity digest of every package's `dist/auto.min.js` (and `sri.json`); see [docs/sri.md](./docs/sri.md).

## [Unreleased]

### Docs

- Scoped Custom Element Registries: the gating decision is now stated where adopters look. Phases 0 and 1 shipped in 1.31.0; **phase 2 (per-component local definitions) is deliberately not started until Firefox ships scoped registries** ([bugzilla 1874414](https://bugzilla.mozilla.org/show_bug.cgi?id=1874414)). Its whole value is "the same tag name means different components in different scopes", and a browser without the API degrades not gracefully but by silently binding the wrong component — a buildless, CDN-first stack cannot ship that. Phase 3 is not Firefox-gated. See [docs/scoped-custom-element-registries.md](./docs/scoped-custom-element-registries.md) §2.
- `@wcstack/state` README: an "i18n positioning" paragraph in the Locale section — why there is no i18n package and no live language switch, where the dictionary and the locale live (ES module volume; `<html lang>` and the router `basename`), the cost of `<base href>`, and the two alternatives that were weighed. Until now this lived only in `docs/i18n-design.md` §9.
- `docs/form-tag-design.md`: design note for a `<wcs-form>` I/O node (Constraint Validation API, `FormData` as a state projection, dirty / touched) — the reviewer-identified gap behind hand-written CRUD handlers. Not implemented; the note fixes the shape (rules stay in HTML attributes, results become state, `data-wcs` stays wiring) and lists the six decisions to make first.

### Added

- `@wcstack/router`: route guards can now **load data and redirect dynamically**. A guard function receives a third argument — a frozen `{ params, typedParams, searchParams, routeName }` snapshot of the match being entered — and may return, besides `true` / `false`: a **non-empty string** to cancel and redirect to that path (it wins over the static `guard=` attribute), or an **object** to enter the route and commit the object as the new output-only `<wcs-router>.data` member (`wcs-router:data-changed`, fired first in the commit order, `null` on navigations whose guards return no object; guards on a nested chain are shallow-merged parent → child). This gives routes a loader without a new phase: the guard was already the one asynchronous step before the route content swaps, so a page no longer shows the new route with empty content and a `<wcs-view-transition>` animates real content. Every falsy return still cancels, so existing guards are unaffected.
- `@wcstack/state`: `$errorCallback(error, info)` — an in-page error boundary for bindings. A binding whose application throws (a path getter or filter threw, a structural directive failed) was already isolated from the rest of the batch and reported with `console.error` and to DevTools; declaring this hook on the root state routes the report to the page instead. `info` is `{ path, bindingType, node }`, `this` is the writable state proxy (write the message into state and render it), the hook runs once per failed binding after `$updatedCallback`, is not awaited, and its own exceptions are isolated. DevTools keeps receiving `state:binding-apply-error` either way. Root-only. Exported type `IBindingErrorInfo`.
- `@wcstack/state`: `wcs/default-getter-mismatch` — a two-way binding on a `static wcBindable` property that omits `getter` now warns once per element and property when the event's `detail` cannot be what the property holds: `detail` is `undefined` while the element property has a value (a plain `Event`, or a forgotten `detail`), or `detail` is an object carrying a `<propName>` key while the property is not an object (a `{ value: … }` wrapper). The write is still applied as-is; occurrence properties (`semantics: "event"`) are exempt. Both #234 and #236 were diagnosed by staring at a page that had gone quiet — this makes the second class loud.

### Changed

- `@wcstack/storage` README: the "persist several inputs as one object" case now has a canonical pattern — an accessor pair (`get formSnapshot()` reading fields by path, `set formSnapshot(v)` restoring them) bound with `value#init=element` — fixed by an integration test against the real `@wcstack/state`. The `$trackDependency` + `trigger` shape is kept as the on-demand variant.
- `@wcstack/state` README: a "Dependency tracking boundaries" table collects the three rules that only show up when crossed (path reads through `this` — `this.form.name` tracks `form` only; reads inside a setter are untracked; the same-value guard is primitive-only), and the binding-authority section opens with the problem `#init=element` solves.
- `@wcstack/router` README: "Where route content lives" — route body by default, `<template data-wcs="if: …">` switching when the DOM must outlive the navigation, with what each costs.
- VS Code extension README: what the analyzer derives from a `$listKeys` entry, spelled out.

## [2.1.1] — 2026-09-06

### Changed

- Root and `@wcstack/state` READMEs brought up to date with v2; CDN snippets pinned to 2.1.0 (#228).
- VS Code extension: dedicated issue form and `bugs` / `qna` / `homepage` / `repository.directory` Marketplace metadata; `vsce package` passes base URLs so README links resolve inside the monorepo (#229).
- Root `CHANGELOG.md` and `docs/migration-v2.md` added.
- `@wcstack/state` README: documented what a two-way binding writes to state when a `static wcBindable` element fires its change event — `getter(event)`, defaulting to the wc-bindable protocol's `(e) => e.detail` (the whole `detail`, as-is), with the two conforming producer shapes and the `properties[].getter` override. No runtime change: the default is normative for every wc-bindable adapter (#236).
- `@wcstack/signals` README: documented what a property signal receives (`getter(event)`, defaulting to `e.detail`; the initial seed is the one property read) alongside the fix below (#240).
- VS Code extension (ships with the next extension release): the row shape of a list whose initial value is `[]` is now read from row-adding assignments (`concat({ … })`, `toSpliced`, `with`, spread), so `for`-row bindings on those fields no longer report `wcs/binding-path-missing` (#239, #241).

### Fixed

- `@wcstack/state`: assigning to a path that has both a getter and a setter no longer pins the assigned value in the getter cache. Reads after the write re-evaluate the getter, so a normalizing setter is reflected immediately and the getter's dependencies get registered even when the first write is an object (which bypasses the same-value guard). Before, an object assigned through e.g. `<wcs-storage data-wcs="value#init=element: snapshot">` left `snapshot` stale forever (#234).
- `@wcstack/signals`: `bindNode` now applies the wc-bindable default getter (`(e) => e.detail`) to a property that omits `getter`, for both `signals[name]` and `on(name)`. It used to read the element property on each event, diverging from the protocol's MUST, from `@wcstack/state`'s two-way bindings and from `@wc-bindable/core`, so the same element could bind correctly under one adapter and not the other. The initial seed still reads the property. No wcstack I/O node changes behaviour (every getter-less property dispatches its value as `detail`; `<wcs-audio>`'s `noteOn` / `noteOff`, which previously received the same-named command method, are fixed). A third-party element whose getter-less property dispatches a `detail` that is not the property value — or no `detail` at all — now receives that `detail`; declare an explicit `getter` to keep reading the property (#238, #240).

## [2.1.0] — 2026-09-05

### Changed

- `@wcstack/state`: changing `mount=` after the element has initialized now logs a console warning; it was silently ignored. Pre-initialization setup stays silent (#224).
- `@wcstack/state`: `$updatedCallback` no longer receives private mount-marker paths (`#m<id>`). Root and volume-relative delivery both skip them; mount visualization belongs to devtools `overlays()` (#224).
- `@wcstack/router`: the `focus=` and `announce=` getters are normalized to their valid values (`"heading"` / `"title"` or `null`), so `focus=""` or a typo falls back to the browser default reset instead of disabling focus management. When the target route has no visible heading, the router now reproduces the spec-default focus reset itself (`[autofocus]`, else blur to `body`) — focus no longer stays on the previous page's persistent-nav link. Hidden headings are skipped (#227).
- `@wcstack/router`: `<wcs-link>` mirrors `lang` and `dir` onto its inner anchor (#227).
- `@wcstack/devtools`: watch-fired / token-emit measurements are partitioned per state tree, so the coverage tab on a multi-tree page no longer conflates them; the State pane shows per-mount overlays from `overlays(rootNode)` and hides the section on runtimes without it (#225).

### Removed

- `@wcstack/state`: the `name` member of `IStateElement` and the `State.name` getter. It was always `"default"` in v2 and had no consumers. This is a public type-member removal; code that read `stateElement.name` must drop it (#224).

### Protocols

- devtools hook protocol (additive, optional): `state:watch-fired` and `state:token-emit` payloads carry the originating tree's `stateElement`. Old payloads keep working (#225).

### Docs

- i18n design: eight post-landing review findings recorded and resolved; the `router-i18n` example's `mergeAndFreeze` now copies and freezes one-sided subtrees instead of returning them by reference (#226). No package source touched.

## [2.0.0] — 2026-09-04

**State is one tree per root node. It is extended by mounting, not by naming.** The named-state dimension (`<wcs-state name>`, `path@name`) is removed across the runtime, SSR, devtools, manifest, testing, and CLI surfaces. Migration: [docs/migration-v2.md](./docs/migration-v2.md).

### Added

- `@wcstack/state`: `<wcs-state mount="path">` — a *volume*. Its data is grafted onto the root tree at the mount path and read with the `path.` prefix. Getters, `$watch`, `$listKeys`, `$updatedCallback`, and the lifecycle callbacks work relative to the mount. Load order between root and volumes does not matter (#222).
- `@wcstack/state`: `<my-c data-wcs="state: path">` mounts a whole subtree onto a component; its bindings are translated to absolute paths on the host tree at registration (one ledger, no bridging layer). Per-property `state.a: p` keeps working as a partial mount (#222).
- `@wcstack/state`: Light DOM `bind-component` components are written exactly like the Shadow form — no `name`, no `@`, and they can sit on every row of a list (#222).
- `@wcstack/state`: `wcs/mount-own-key-shadow` runtime warning when a mapped component's own data key is shadowed by a mapping (rule R1: own keys are private) (#222).
- `@wcstack/devtools`: hook protocol **v2** with `overlays(rootNode)` (mount records: marker, mount table, delta, private / getter keys) (#222).
- Release tooling: internal `@wcstack/*` dependency ranges are aligned to the released version at bump time, and lockfiles are synced after publish. Before this, `@wcstack/server@2.0.0` would have shipped depending on `@wcstack/state@^1.9.1` (#223).

### Changed (breaking)

| v1 | v2 | How you find out |
|---|---|---|
| `<wcs-state name="x">` | `<wcs-state mount="x">` | runtime fail-fast with guidance; lint error `wcs/named-state-deprecated` |
| `path@x` / `path@default` (in `data-wcs`, `{{ }}`, `<!--@@:-->`, spread, shorthand) | `x.path` / `path` | parse error with guidance; lint error |
| Plain (unwired) Light DOM `bind-component` | add a shadow root, or wire it from the host (`state: path`) | runtime raise with guidance |
| Mapped component's own-key default value | rule R1: own data keys are private and are not overridden by a mapping | `wcs/mount-own-key-shadow` warning |
| Several `<wcs-state bind-component>` wired to one component (different props) | one mount scope per component: merge the wiring or split the component | runtime raise |
| `setInitialState()` re-set on a tree that has grafted volumes or mounts | write the paths you want to change individually | runtime raise (a whole-tree re-set would silently break grafts, accessors, and the ledger) |
| Wildcard-terminal accessor on a mounted component (`get "tags.*"()` translated onto a list of the tree) | a getter on the host tree, or a component-private array | runtime raise |
| `$updatedCallback` receiving other states' paths (`path@name`) | a volume's `$updatedCallback` receives updates under its own prefix as **relative** paths | delivery shape changes |
| SSR `<wcs-ssr name>` / `Ssr.findByName` | name-less `<wcs-ssr>` / `Ssr.find(root)`; old name-carrying snapshots are still readable | — |
| `@wcstack/server` `extractStateData()` (deprecated) | `Ssr.extractStateData()` from `@wcstack/state` | import error |
| devtools hook protocol v1 (`keys` / `read` / `write` with a state name, `stateName` payloads) | protocol v2: `keys(rootNode)` etc., `overlays(rootNode)` | `version: 2` (first-wins) |
| Manifest `states[name].stateSchema` (`schemaVersion` 1) | one `stateSchema` (`schemaVersion` 2); volumes merge as subtrees via `wcs-schema emit --mount=<path>` | readers raise a migration-hint error |
| `@wcstack/testing` `state(name)` | `state()` | an argument throws with a migration hint |
| `wcs-schema --state=<name>` | `--mount=<path>` | usage error with a migration hint |

Declaration surfaces on a volume: `$streams` raises, and `$commandTokens` / `$eventTokens` / `$on` warn — move them to the root state. Everything else a volume declares works mount-relative.

### Performance

Measured on lists whose rows are components: create 1k rows −24%, update −45%, heap −1.5 KB per row. Pages without components or volumes are unchanged (measured gate).

### Fixed

Repairs from the pre-release quality loop, all with tests: `setInitialState` on a grafted tree raised instead of silently wiping; SSR snapshots of volumes were empty; a volume whose `src` failed to load wedged the whole tree and is now isolated; a `Δ=0` delta for `for` indices; own binding text `forPath`; the VS Code extension gained `wcs/mount-path-invalid` (#222).

## [1.33.0] — 2026-09-02

### Added

- **`@wcstack/testing`** (new package): the page-testing recipe as one import — `mount()` a page, `state()` accessor with `read` / `write`, `settle()`. `@wcstack/server` is a peer dependency and gained `waitForReady(root)` (#218).
- **`@wcstack/typescript`** (new package): `wcs-schema emit` / `check` compiles a TypeScript state file into the sidecar `stateSchema` and detects drift (#216); `wcs-tsc` runs `tsc` over `<wcs-state>` inline scripts in `.html` (#219).
- Every element package augments `HTMLElementTagNameMap`, so `document.createElement("wcs-fetch")` and `querySelector` are typed (#217).
- `@wcstack/lint`: `--strict` fails CI on warnings as well as errors; severities are unchanged (#214).
- `@wcstack/state`: `state: path` root mount for `bind-component` (built on the v1 mechanism; the v2 rewrite followed) (#221).

### Changed

- Validator (`@wcstack/lint`, VS Code extension): with a `wcstack.manifest.json` that declares the state's `stateSchema`, an unknown path is `wcs/path-nonexistent` (**error**) instead of `wcs/binding-path-missing` (warning). The manifest is discovered as the nearest `wcstack.manifest.json` above the HTML file (#215).

### Deprecated

- Named states (`<wcs-state name>`, `path@name`): lint warning `wcs/named-state-deprecated` pointing at `mount=`. Removed in 2.0.0 (#221).

### Fixed

- e2e workflow installs the server's runtime dependencies even when no dist is rebuilt (#220).

## [1.32.0] — 2026-08-29

### Added

- **`@wcstack/view-transition`** (new package): `<wcs-view-transition>` arbitrates view transitions for `router` route swaps and `state` list / branch updates through the transition-runner protocol; owns exclusion (`latest` / `queue` / `exhaust`) and the `view-transition-name` policy (#185).
- `@wcstack/state`: `$setAll` — in-place bulk write across a wildcard path with a mapper; arrays broadcast by default (#184).
- binder protocol (`@wcstack/state`, `@wcstack/router`): markup that arrives after startup gets bound (#191).
- `@wcstack/router`: `params` / `typedParams` / `searchParams` / `routeName` as output-only bindable properties on `<wcs-router>`, `replaceUrl`, and a documented firing order (#204).
- Server-side rendering of the initial route: `@wcstack/server` renders it, the client adopts the server DOM, and the new `ssr-snapshot` protocol orchestrates the snapshot pass (#205, #206, #207, #208).
- `@wcstack/router`: warning when stamped markup carries bindings that cannot work (#190); `<wcs-head>` links keyed by `hreflang` (#189).
- Accessibility (phases 0–7): the Navigation API's a11y delegation made explicit (#195); router fallback-mode scroll repair, `aria-current`, attribute forwarding on `<wcs-link>` (#196); `@wcstack/state` keyed reorders use `moveBefore` so focus survives (#197); opt-in `focus=` / `announce=` route policies (#198); `@wcstack/raf` opt-in `prefers-reduced-motion` gate (#199); demo uplift (#200); `wcs/aria-attr-unknown` diagnostic (#201); Accessibility sections in package READMEs and a screen-reader test guide (#194, #202, #203).
- `wcstack` entry package: `wcstack/auto` is now a real SPA-core bundle (state + router + fetch + storage + autoloader) instead of documentation only (#212).
- i18n: design record and reference implementation (`examples/router-i18n`) with the head locale-negotiation snippet; dictionaries are ES modules, no new package (#186, #188, #192).

### Changed

- `@wcstack/state`: `config.locale` defaults to `<html lang>` (previously `'en'`), and the filters' default locale is resolved per application. Pages whose `<html lang>` is not English see `|date` / `|time` / `|datetime` / `|locale` output change (#186, #187).
- `@wcstack/state`: `$getAll(path)` with `indexes` omitted defaults to the enclosing loop context (`[...$n]`); `[]` still means every match. Outside a loop with shared wildcards it throws instead of silently returning everything (#193).
- `@wcstack/router`: a query-only navigation to the same matched route is a *same-match*: guards do not re-run, content is not restamped, no view transition is requested, focus and scroll stay (#204).
- `docs/sri.md`: jsDelivr `/combine/` is forbidden — concatenated minified ESM does not parse and jsDelivr rules out SRI for it (#211).

### Removed

- `@wcstack/router`: `<wcs-route>`'s `static wcBindable` (`params` / `typedParams` / `active`). Binding to a route from `data-wcs` never worked; use the router's outputs. The `wcs-route:*` events are still dispatched (#204).

### Fixed

- `npm-trust-setup --verify` misread every package under npm 11 (#213); completeness guards for the copy-distribution sync scripts (#209); CI builds `@wcstack/state` from source before testing the VS Code extension and lint, so a state change can no longer pass CI while breaking them (#210).

## [1.31.0] — 2026-08-23

### Added

- `@wcstack/state`: path diagnostics and semantic checks for failures that used to be silent; a binding-apply throw is confined to that binding, and the rest of the batch, `$updatedCallback`, `$watch`, and `$streams` restarts still run (#179).
- Scoped Custom Element Registries, phases 0 and 1 (#181).

### Changed

- VS Code extension / lint: the non-reactive assignment family (`wcs/nested-assign`, `wcs/array-mutation`, `wcs/array-index-assign`) is reported at **error** severity (#180).

### Fixed

- `@wcstack/autoloader`: a failed lazy load no longer wedges every later load (the `whenDefined` wait was pending forever) (#182).
- Release workflow: lint smoke test severity drift unbroke the release and is now gated (#183).

## [1.30.0] — 2026-08-22

### Added

- VS Code extension: text channel (`{{ }}` / `<!--@@:-->`) parsed through the runtime's canonical parser (#174); spread size hint, `$N` loop scoping, nested-array path candidates (#176); spread on a `wcBindable`-less built-in tag is an error (#177).
- `@wcstack/state` / `@wcstack/devtools`: exact `$listKeys` prerequisite for wildcard watch coverage (#178).

### Fixed

- `@wcstack/state`: `clearParserCaches` also clears the filter-function cache (#175).

## Earlier releases

1.29.0 and earlier predate this file. Their contents are in the merged pull requests (`gh pr list --state merged`) and the git history; each GitHub Release page carries the SRI digests for that version.

[Unreleased]: https://github.com/wcstack/wcstack/compare/v2.1.1...HEAD
[2.1.1]: https://github.com/wcstack/wcstack/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/wcstack/wcstack/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wcstack/wcstack/compare/v1.33.0...v2.0.0
[1.33.0]: https://github.com/wcstack/wcstack/compare/v1.32.0...v1.33.0
[1.32.0]: https://github.com/wcstack/wcstack/compare/v1.31.0...v1.32.0
[1.31.0]: https://github.com/wcstack/wcstack/compare/v1.30.0...v1.31.0
[1.30.0]: https://github.com/wcstack/wcstack/compare/v1.29.0...v1.30.0
