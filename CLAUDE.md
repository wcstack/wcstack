# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

ユーザーへの応答は常に日本語で行うこと。

- Code, identifiers, and commit messages are in English.
- Source comments are mixed English / Japanese — follow the language of the surrounding file.
- Test descriptions are written in Japanese.

## Project Overview

**wcstack** (Web Components Stack) is a monorepo of focused TypeScript packages for building Web Components-based SPAs. The design philosophy is standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, buildless, with zero runtime dependencies (the exception is `@wcstack/server`, which depends on `@wcstack/state` and `happy-dom`). Each package is a self-contained custom element (or core utility) that can be dropped onto a page via CDN/Import Map and composed like LEGO bricks.

**This is the `research/state-engine` branch — the `@wcstack/state` 4.0 rewrite.** Since the R1 swap `packages/state` holds the 4.0 engine (developed as `packages/state-next`, which is gone). Everything specific to it is in [research/state-engine (4.0 engine)](#researchstate-engine-40-engine); a few sections elsewhere in this file still describe 3.x and are rewritten in the documentation pass.

## Repository Layout

- `packages/` — one directory per package (see Monorepo Structure).
- `protocol/` — canonical sources of the cross-package protocols (`wc-bindable`, `wc-bindable-reader`, `upgrade-properties` + its test, `transition-runner`, `binder`, `ssr-snapshot`). `scripts/sync-protocol-types.mjs` copies them into `packages/<pkg>/src/protocol/` (the test into `__tests__/`).
- `io-core/` — canonical IO-core helpers (`operation-lane`, `platform-capability`). `scripts/sync-io-core.mjs` copies them into `packages/<pkg>/src/core/`.
- `config-templates/` — canonical `rollup.config.js` / `eslint.config.js`. `scripts/sync-package-configs.mjs` writes the `@wcstack/*` copies; packages in its `DEVIATIONS` keep a hand-written file (or none, like `lint`), and `packages/wcstack` (a hand-kept copy) and `packages/vscode-wcs` are outside the sync.
- `scripts/` — the sync scripts, `sync-readme-agents-banner.mjs` (the AI-agents line under each package README's H1), the `@wcstack/state` size / coupling gates (`check-state-*.mjs`), `conformance-*.mjs`, `generate-sri.mjs`, and `audit-state-*` measurement tooling.
- `e2e/` — Playwright real-browser tests over the local `packages/*/dist` (own `package.json`; `.github/workflows/e2e.yml`).
- `examples/`, `docs/` — see below. `CHANGELOG.md` follows Keep a Changelog; `packages/vscode-wcs` keeps its own.

Generated copies carry a do-not-edit banner: edit the canonical source and re-run the sync script. CI's `protocol-types-sync` job runs each sync script with `--check` and fails on drift.

## Monorepo Structure

Each package lives under `packages/` and is built and tested on its own. There is no root-level `package.json` or workspace orchestration (the root `package-lock.json` is an empty stub) — run commands inside a package directory. All published packages (`@wcstack/*` and `wcstack`) share one version and are released in lockstep: `release.yml` bumps every package to the same version whether or not it changed. Its `version_type` is `patch` / `minor`, or `release` (X.Y.Z-rc.N → X.Y.Z) — npm `latest`, from main only; a new major reaches `latest` only through `release`, so `major` is always refused — or `premajor-rc` (X.Y.Z → X+1.0.0-rc.1) / `prerelease-rc` (rc.N → rc.N+1) — npm `next`, a GitHub prerelease, internal `@wcstack/*` deps pinned to the exact rc, run only from `research/state-engine` or a `release/*` branch and pushed back to it. `scripts/compute-next-version.mjs` computes the version, the tag the release notes start from (the last stable tag for a stable release, never an rc) and refuses every other run before the build (`node --test scripts/compute-next-version.test.mjs`): the 4.0 engine (`behaviorOptions` in `packages/state/dist/wcs-manifest.json`) under a major below 4 or the 3.x engine under 4+, a stable release off main, a prerelease elsewhere, a bump that does not fit the current version, a `prerelease-rc` once `v<X.Y.Z>` is tagged, a target already tagged. **The branch is frozen while a release runs**: the run stops before publishing if the branch moved after the dispatch, and a push to it during the publish fails the release's own push. One release runs at a time (`concurrency`). A target npm already has but no tag records — a partial release, where a run published and stopped before its push — is refused; recovering needs a human (the bump commit existed only on the runner, and npm versions cannot be republished). The CHANGELOG keeps the next major's draft under `[Unreleased]` for the whole rc series; only the final release renames it `[X.Y.Z] — date`. `packages/vscode-wcs` is versioned separately.

**Core / framework packages:**
- **`@wcstack/state`** (`<wcs-state>`; `<wcs-ssr>` carries SSR hydration data) — Reactive state management with declarative data binding via `data-wcs` attributes. Reactive proxy, computed properties, list rendering with diffing, conditional rendering, wildcard paths, filter pipeline.
- **`@wcstack/router`** (`<wcs-router>`, `<wcs-route>`, `<wcs-outlet>`, `<wcs-layout>`, `<wcs-layout-outlet>`, `<wcs-link>`, `<wcs-head>`, `<wcs-guard-handler>`) — Declarative SPA routing on the Navigation API (popstate fallback). Typed path params (`:id(int)`, `:slug(slug)`), nested layouts, head management (`<wcs-head>`), route guards, basename support.
- **`@wcstack/autoloader`** (`<wcs-autoloader>`) — Auto-detects and dynamically imports undefined custom elements by scanning the DOM and Import Map entries with `@components/` prefixes. Uses MutationObserver for dynamically-added elements.
- **`@wcstack/signals`** — Signals-based lightweight reactive core (an alternative to `state`, not a replacement) with async-IO resource adapters and a `wc-bindable` → signal bridge.
- **`@wcstack/view-transition`** (`<wcs-view-transition>`) — View Transition arbiter. A policy tag (renders nothing, binds no data) that makes `router` route swaps and `state` list/branch updates animate; it owns exclusion (`latest` / `queue` / `exhaust`) and the `view-transition-name` policy. `state`/`router` never import it — they find it through the transition-runner protocol on a global symbol. See [docs/view-transition-design.md](docs/view-transition-design.md).

**I/O node components** — declarative wrappers over a Web platform API, exposed via the `wc-bindable-protocol` so they interoperate with `state`/`signals`:
- **`@wcstack/fetch`** (`<wcs-fetch>`, `<wcs-fetch-header>`, `<wcs-fetch-body>`, `<wcs-infinite-scroll>`) — Async data fetching
- **`@wcstack/storage`** (`<wcs-storage>`) — localStorage / sessionStorage binding
- **`@wcstack/upload`** (`<wcs-upload>`) — File upload with progress
- **`@wcstack/websocket`** (`<wcs-ws>`) — Real-time WebSocket comms
- **`@wcstack/sse`** (`<wcs-sse>`) — Server-Sent Events (EventSource, one-way streaming)
- **`@wcstack/broadcast`** (`<wcs-broadcast>`) — Cross-tab messaging (BroadcastChannel)
- **`@wcstack/worker`** (`<wcs-worker>`) — Dedicated Web Worker primitive
- **`@wcstack/timer`** (`<wcs-timer>`) — Interval / timeout primitive
- **`@wcstack/raf`** (`<wcs-raf>`) — requestAnimationFrame frame-source primitive (first-class `dt`, `suspended` two-phase output)
- **`@wcstack/debounce`** (`<wcs-debounce>`, `<wcs-throttle>`) — Signal coalescing
- **`@wcstack/clipboard`** (`<wcs-clipboard>`) — Clipboard read / write
- **`@wcstack/geolocation`** (`<wcs-geo>`) — Geolocation API
- **`@wcstack/permission`** (`<wcs-permission>`) — Permissions API monitor
- **`@wcstack/notification`** (`<wcs-notify>`) — Desktop notifications (Service Worker support)
- **`@wcstack/midi`** (`<wcs-midi>`) — Web MIDI input/output (one tag for both directions; message decoding with velocity-0 note-off normalization)
- **`@wcstack/audio`** (`<wcs-audio>` + 10 node tags) — Web Audio graphs written as markup. Nesting is the signal chain, `out=`/`param=` route by id, `<wcs-voice poly="N">` gives polyphony. The patch is a **descriptor** (`Patch` plain object) that `AudioGraphCore` consumes; `AudioNode` handles never cross the protocol boundary. See [ADR-14](docs/architecture-hardening/14-handle-graph-wiring.md)
- **`@wcstack/intersection`** (`<wcs-intersect>`) — IntersectionObserver visibility
- **`@wcstack/resize`** (`<wcs-resize>`) — ResizeObserver element-size
- **`@wcstack/wakelock`** (`<wcs-wakelock>`) — Screen Wake Lock
- **`@wcstack/camera`** (`<wcs-camera>`, `<wcs-recorder>`) — Camera capture + media recording (binds live `MediaStream` handles directly to elements, never through serializable state)
- **`@wcstack/speech`** (`<wcs-speak>`, `<wcs-listen>`) — SpeechSynthesis (TTS) + SpeechRecognition (STT)
- **`@wcstack/defined`** (`<wcs-defined>`) — Custom-element readiness gate (`customElements.whenDefined` with timeout-based load-failure detection)
- **`@wcstack/fullscreen`** (`<wcs-fullscreen>`) — Fullscreen API
- **`@wcstack/picture-in-picture`** (`<wcs-pip>`) — Picture-in-Picture for video
- **`@wcstack/pointer-lock`** (`<wcs-pointer-lock>`) — Pointer Lock API
- **`@wcstack/screen-orientation`** (`<wcs-screen-orientation>`) — Screen Orientation monitor / lock
- **`@wcstack/idle`** (`<wcs-idle>`) — Idle Detection API
- **`@wcstack/network`** (`<wcs-network>`) — Network Information monitor
- **`@wcstack/media-query`** (`<wcs-media-query>`) — `matchMedia` monitor (`query` attribute → `matched` / `media` / `supported`; the output is `matched`, not `matches`, because `Element.prototype.matches()` exists)
- **`@wcstack/share`** (`<wcs-share>`) — Web Share API
- **`@wcstack/contacts`** (`<wcs-contacts>`) — Contact Picker API
- **`@wcstack/credential`** (`<wcs-credential>`) — Credential Management API
- **`@wcstack/eyedropper`** (`<wcs-eyedropper>`) — EyeDropper color picker
- **`@wcstack/tilt`** (`<wcs-tilt>`) — Device Orientation (tilt) events
- **`@wcstack/accelerometer`** (`<wcs-accelerometer>`) — Accelerometer sensor
- **`@wcstack/gyroscope`** (`<wcs-gyroscope>`) — Gyroscope sensor
- **`@wcstack/magnetometer`** (`<wcs-magnetometer>`) — Magnetometer sensor
- **`@wcstack/ambient-light-sensor`** (`<wcs-ambient-light-sensor>`) — Ambient Light sensor

**Other packages:**
- **`wcstack`** (unscoped entry package, `packages/wcstack`) — The npm entry point and the SPA-core bundle: `wcstack/auto` ships `dist/auto.min.js` bundling state + router + fetch + storage + autoloader by inlining the members' published `/auto` entries with Rollup (`exports` has only `./auto` — deliberately no `index.esm.js`). It must build after all members; release.yml appends it last to the build order. Its README doubles as the AI authoring guide (`npm view wcstack readme`). See docs/distribution-robustness-impl-plan.md.
- **`@wcstack/server`** — Server-side rendering for wcstack components (`renderToString()` on happy-dom).
- **`@wcstack/devtools`** (`<wcs-devtools>`) — In-page DevTools overlay (state trees, wiring, update timeline). It reaches the runtimes only through the DevTools Hook Protocol (`globalThis.__WCSTACK_DEVTOOLS_HOOK__`, [docs/devtools-hook-protocol.md](docs/devtools-hook-protocol.md)) and never imports `@wcstack/state`.
- **`@wcstack/lint`** (bin `wcs-validate`) — Static-contract validator CLI. No source of its own: `npm run build` builds `packages/vscode-wcs` and copies its `dist/cli.cjs` (`scripts/build.mjs`).
- **`@wcstack/typescript`** (bins `wcs-schema`, `wcs-tsc`) — `wcs-schema` derives the manifest `stateSchema` from a typed state file; `wcs-tsc` type-checks `<wcs-state>` inline scripts in HTML. Its build also builds `packages/vscode-wcs` and copies `schema-core.cjs` / `tsc-core.cjs` (`scripts/build-schema-core.mjs`).
- **`@wcstack/testing`** — Headless test helpers (`mount()` / `settle()` / `fire()` / `installDom()`) for Vitest + happy-dom. Its build first rebuilds `packages/state`, `router` and `server` from source (`scripts/build-deps.mjs`), rewriting their committed dist.
- **`packages/vscode-wcs`** (`wcstack-intellisense`) — VSCode extension providing TypeScript language features for `<wcs-state>` inline scripts in HTML, and the canonical validator core behind `wcs-validate`. Versioned independently from the published npm packages.

## Build & Development Commands

All commands run from within a specific package directory (e.g., `packages/state/`):

```bash
npm run build            # Clean dist, compile TypeScript, bundle with Rollup
npm run clean            # Remove dist/ (where defined)
npm test                 # Run tests once (vitest run)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage (enforces thresholds)
npm run lint             # ESLint on src/
```

Exceptions:
- `packages/lint`: `test` / `test:coverage` run `scripts/smoke-test.mjs`, `lint` is `node --check` on its two scripts, no `test:watch`.
- `packages/vscode-wcs`: no `clean` or `lint`; `build` is `node esbuild.config.js`.
- `packages/server` adds `test:e2e` (`vitest.e2e.config.ts`).
- `packages/state`: see [The 4.0 engine](#the-40-engine-packagesstate) (adds `typecheck` and `golden`).

To run a single test file:
```bash
npx vitest run __tests__/someFile.test.ts
```

## Build Pipeline

Each package follows the same build flow: `rimraf dist .tsc-out` → `tsc` → `rollup -c`, with these exceptions:
- `typescript` appends `scripts/build-schema-core.mjs`; `testing` prepends `scripts/build-deps.mjs` (see Other packages).
- `lint` is `scripts/build.mjs` and `vscode-wcs` is `node esbuild.config.js` — neither runs tsc / Rollup.
- `state` is `node build.mjs` (esbuild + terser; tsc never emits and Rollup only bundles the `.d.ts`; it also writes `dist/wcs-manifest.json`) — see [The 4.0 engine](#the-40-engine-packagesstate).

Rollup produces two outputs from `src/exports.ts`:
- `dist/index.esm.js` — ESM bundle, and what `exports["."]` resolves to (minified in `@wcstack/state` — requirement N1)
- `dist/index.d.ts` — Bundled type declarations (via rollup-plugin-dts)

`@wcstack/state` also emits `dist/split/**` (the `/core` and `/features/*` entries), `dist/define.js`, `dist/parser.esm.js` and `dist/manifest.esm.js`.

Most packages add a third entry from `src/auto.ts` — `dist/auto.min.js`, exposed as `exports["./auto"]`. It lets a page activate the component with a single `<script>` tag (no manual registration), and is **bundled self-contained with no static imports**, so one `integrity` attribute covers the whole runtime. `src/auto.ts` must import only from `./exports`; a relative import of a sibling dist file would silently destroy that property. See [docs/sri.md](docs/sri.md).

There is deliberately no `dist/index.esm.min.js`: it appeared in no `exports` map, and its only consumer was the old auto stub. A minified named-export bundle is still built only where there is no self-contained auto bundle: `@wcstack/signals` (no `src/auto.ts` by design) and `@wcstack/server`. Neither appears in an `exports` map.

Two gates guard `@wcstack/state`; CI's `state` job runs both after the build, and each takes `--check` (the default) or `--update`:
- `scripts/check-state-size.mjs` reads `packages/state/dist` only. The gzip (level 9, each file on its own) of `index.esm.js`, `auto.min.js`, `split/core.js` with its chunks, each `split/features/*.js` beyond the core and `split/auto.js` beyond the core may not exceed `scripts/state-size-baseline.json` by more than 3 %, plus an entry's optional `slack` in bytes (kept across `--update`; none is set). Two absolute limits live in the script, not the baseline: **`dist/core.min.js` ≤ 20,000 B** (the 4.0 core target) and `dist/define.js` ≤ 1,024 B (`/define`, the helper entry, has no runtime). The 3.x probe, a `defineState`-only import of `.`, is gone: in 4.0 it keeps about 21 KB. The baselines were re-recorded from the 4.0.0-rc.4 dist (2026-10-06), the release that shipped the core slimming (code moved into formats and diagnostics on purpose). `core.min.js` is 19,500 B — 500 B under its absolute limit; a core change should still pay for itself. The split core is 23,655 B (limit 24,365 B), `index.esm.js` 49,971 B (51,470 B) and `auto.min.js` 46,927 B (48,335 B). The add-ons run from `list-keys` at 931 B to `scopes` at 8,870 B (formats 1,387 B, diagnostics 7,189 B), and `split/auto.js` is 602 B.
- `scripts/check-state-coupling.mjs` bundles `src` with esbuild in memory and needs `packages/state`'s `node_modules`. It checks that each add-on's outputs beyond the core chunk carry only that add-on's modules, that `split/auto.js` carries no add-on code, that the core entries (`core.ts`, `core-entry.ts`, `split-auto.ts`) reach no add-on, and that `public/defineState.ts` imports nothing. It also holds three lists in `scripts/state-coupling-baseline.json`: the core → add-on imports (only the full and tooling entries), the core modules each add-on imports, and the modules that run code when evaluated (`auto.ts`, `split-auto.ts`, `core-entry.ts`, and `public/parser.ts`, which turns its renderer on). The add-on modules are `src/{temporal,scopes,recursion,ssr,devtools,diagnostics}/`, `src/filters/formats.ts` and `src/features/*`; the add-on list is read from `build.mjs`'s `FEATURES`.

Re-record both baselines with `--update` as part of each release. The size gate refuses to record past an absolute limit; the coupling gate refuses while a rule without a baseline fails. Between releases, treat a failure as a real signal rather than a stale baseline.

Every published package's `dist` is committed (`packages/vscode-wcs`'s is not), but only rebuilt at release, so between releases it lags `src`. `packages/vscode-wcs` reads `@wcstack/state` through a `file:../state` symlink, i.e. the *committed* `packages/state/dist` (the 4.0 engine since the R1 swap; see [vscode-wcs and the tooling](#vscode-wcs-and-the-tooling-read-the-40-engine)). A parser or manifest change does not reach the extension, the `wcs-validate` CLI, `@wcstack/typescript`'s `schema-core.cjs` / `tsc-core.cjs`, or the vsix until `npm run build` is run in `packages/state` — meanwhile the extension runs the parser of the last engine build (missing `wcs/binding-syntax` diagnostics; `wiringLens` hover / definition / references / inlay hints and `bindingSyntaxValidator` silent on the affected forms). **Build the engine package before packaging the extension (`npm run package`), and re-run the vscode-wcs tests afterwards**, since newly-appearing diagnostics can change existing expectations. CI's `wcs-validate` job builds the engine from source first.

Two more traps around committed dists: `npm run build` in `packages/testing` rebuilds `state`, `router` and `server` in place and dirties their committed dist (restore with `git checkout -- packages/<pkg>/dist` when that was not the intent); and `packages/vscode-wcs/src/service/generated/builtinTags.generated.ts` + `packages/vscode-wcs/wcs.html-data.json` are generated from the committed dists by `packages/vscode-wcs/scripts/emit-builtin-tags.mjs` (release.yml regenerates them; CI runs `--check`) — never edit them by hand.

## research/state-engine (4.0 engine)

This branch rewrites `@wcstack/state` for 4.0. The plan and the record of the work are in `docs/state-engine-rewrite/` (start with [v4-remaining.ja.md](docs/state-engine-rewrite/v4-remaining.ja.md)); [docs/migration-v4.md](docs/migration-v4.md) / `.ja.md` is the 3.x → 4.0 guide.

### The 4.0 engine (`packages/state`)

- **Build**: `npm run build` runs `build.mjs`. esbuild bundles each entry with the internal property names listed in `mangle.mjs` shortened (`mangleProps`), then `minify.mjs` runs terser over the runtime bundles and every split file; rollup-plugin-dts emits only the `.d.ts`. tsc never emits (`tsconfig.json`: `noEmit: true`, `rootDir: "."`, no `outDir`). There is no `WCS_STATE_UNMINIFIED`: the runtime bundles are always minified. `dist/` is committed, like every published package's (the build is deterministic). But `src/version.ts` imports `package.json`, and esbuild hashes that input into the name of the chunk holding `VERSION`: any edit to `packages/state/package.json` (the `files` list included) renames that chunk, so a fresh build then differs from the committed dist in the chunk name and in terser's identifiers, with the same behaviour. The release rebuild (which bumps the version anyway) absorbs it; do not commit such a rebuild between releases.
- **Outputs**: the same `exports` layout as 3.x — `dist/index.esm.js`, `dist/auto.min.js`, `dist/split/{core,features/*,chunks/*}.js`, `dist/define.js`, `dist/manifest.esm.js` + `dist/wcs-manifest.json`, `dist/parser.esm.js` and the `.d.ts` files (`__tests__/public-surface.test.ts` compares the surface with 3.5.4's, frozen in `__tests__/fixtures/state-3.5.4`) — plus two files no `exports` entry names: `dist/split/auto.js` (the split build from one `<script type="module">`, loading add-ons from `./features/` beside it) and `dist/core.min.js` (the core alone). The split files are one esbuild build, so core and add-ons share the shortened names and must come from the same build; the tooling entries (`define`, `manifest`, `parser`) are not name-shortened.
- **Core size target: ≤ 20,000 B gzip of `dist/core.min.js`** (19,500 B after the 2026-10-06 slimming: 500 B of room). `scripts/check-state-size.mjs` enforces it as an absolute limit (see the size gates above). Tests do not check it, so run the gate after a core change.
- **`mangle.mjs`**: read its header before adding a name. A name the DOM, a protocol, a config key, a public method, DevTools, an author's object, or a string lookup reaches must not be listed. `__tests__/bundle.test.ts` / `split.test.ts` run the conformance scenarios on the mangled, tersed builds.
- `src/auto.ts` imports `./element`, `./hooks` and `./features/all`, not `./exports`; esbuild bundles it from source, so `dist/auto.min.js` is still self-contained.
- **Commands**: `build`, `clean`, `test`, `test:watch`, `test:coverage` (99.5 / 98.5 / 100 / 99.5, as 3.x), `lint`, `typecheck` (`tsc --noEmit`), `golden` (re-records `__tests__/golden/current-3.3.0.json` from the 3.x dist `WCS_GOLDEN_DIST` names; it refuses a 4.0 dist, so the golden is frozen). No `__tests__/setup.ts`. Benchmarks: `npx vitest run --config bench/vitest.perf.config.ts`, `bench/run-all.sh` (`CURRENT_BUNDLE` names the 3.x bundle to compare with).
- **Cross-package tests**: the 3.x side of the parity tests is frozen — `public-surface.test.ts` reads `__tests__/fixtures/state-3.5.4`, the JSON goldens in `__tests__/golden/` do not change, and `scripts/ssr-3x.mjs` refuses a 4.0 dist (`WCS_3X_PACKAGES` names 3.x packages to render with). `regression-3x-binder-router.test.ts` reads the committed `packages/router/dist`. `packages/router/__tests__/routeRange.state.test.ts` imports `../../state/src`, so a state change can break the router suite.
- **Version**: every package is at 4.0.0-rc.4 (npm `next`, tag `v4.0.0-rc.4`; `latest` is still 3.5.4). The engine compares `<wcs-ssr version>` with its own by major.minor, so it reads any 4.0.x SSR output as its own and discards 3.x snapshots (`__tests__/ssr-3x.test.ts` pins `VERSION` to 4.0.0).
- **Layout**: `engine.ts` (the reactive core; path patterns in `pattern.ts`, lists and rows in `list.ts`, the dirty strategy in `strategy/`), `element.ts` (`<wcs-state>`), `dom/` (binding plans, views, binder, mounts, wc-bindable), `parser/` (the `data-wcs` grammar, a port of 3.x `bindTextParser/`), `filters/`, `token.ts`, `hooks.ts` (the slots the add-ons fill), and one directory per add-on (`temporal/`, `scopes/`, `recursion/`, `ssr/`, `devtools/`, `diagnostics/`) with its entry under `features/`.
- **Differences from 3.x that touch the protocols**:
  - binder — 4.0 renders top-level `for:` / `if:` of inserted content only when the caller passes `bind(subtree, { range: true })` ([docs/binder-protocol-design.md](docs/binder-protocol-design.md), migration-v4 §3.9); 3.x ignores the second argument.
  - command-token — 4.0 calls `target[method](...args)` (`dom/wc.ts`) instead of `Token.emit` → `Reflect.apply`, and does not call a detached element; arguments are still passed verbatim and not awaited.
  - `@state` — still a parse error (`parser/parseStatePart.ts`, message 32), but the migration-hint prose lives only in the diagnostics add-on (`diagnostics/messages.ts`): a `/core` page without `features/diagnostics` prints only the message number and the offending text.
- **CI**: a PR touching `packages/state/` gets the `state` `ci` matrix job (lint → build → the size and coupling gates → typecheck → test:coverage; a PR that touches only those gates or their baselines in `scripts/` selects it too), and `wcs-validate` builds it on every PR.

### vscode-wcs and the tooling read the 4.0 engine

- `packages/vscode-wcs` depends on `"@wcstack/state": "file:../state"` (as on main), the 4.0 engine since the swap. `@wcstack/lint`, `@wcstack/typescript` and the vsix bundle it, so they carry the 4.0 rules, and every page in the repository must pass them.
- **CI**: the `wcs-validate` job builds `packages/state` from source before vscode-wcs, lint and typescript. But `ci.yml` and `e2e.yml` run only on pull requests to `main` (`on: pull_request: branches: [main]`), and this branch has none, so **none of these gates run on it — run them locally**.
- **Release** (decision R8; the rules are in the release paragraph under Monorepo Structure): cut each rc from this branch with `prerelease-rc` — `gh workflow run release.yml --ref research/state-engine -f version_type=prerelease-rc` — and merge nothing into it while the run is going. (The first rc was `premajor-rc`. 4.0.0-rc.1 went out partial on 2026-10-04: 31 of the 49 packages reached npm before router's prepublishOnly failed, with no tag or bump commit; the branch was then set to 4.0.0-rc.1 by hand and the series continues at rc.2. Since then the release runs the package tests after the bump, at the target version.) The bump commit and tag come back to this branch, so main stays 3.x and can still ship 3.x patches. 4.0.0: merge this branch into main, then run `release` on main (`major` is refused there, so merging before the first rc cannot ship 4.0.0 without an rc). `release.yml` still skips `private: true` packages. The extension's version is not bumped before 4.0 (R11: 2.0.0 with 4.0.0); **do not publish the vsix from this branch** — no workflow stops it.

### After the swap (R1)

`packages/state` is the 4.0 engine, and the state-next special cases are gone (v4-remaining §3 / §4). The CI gates have been rebuilt for the 4.0 output: `check-state-size.mjs` and `check-state-coupling.mjs` replace the four 3.x gates, and the core target is now an absolute limit.

## Testing

- **Framework:** Vitest with happy-dom environment, except `server` / `vscode-wcs` (Vitest default, Node) and `typescript` (`node`); `lint` has no Vitest, only a smoke test
- **Test location:** `__tests__/` directory in each package, pattern `__tests__/**/*.{test,spec}.{js,ts}` (`vscode-wcs`: `__tests__/**/*.test.ts`)
- **Setup file:** `__tests__/setup.ts` per package, except `server`, `state`, `testing`, `typescript`, `vscode-wcs`
- **Coverage thresholds** (statements / branches / functions / lines, in each package's `vitest.config.ts`): 100/100/100/100 in 20 packages, 100/97/100/100 in 24, `state` 99.5/98.5/100/99.5, `testing` and `typescript` 95/90/95/95, none in `server` and `vscode-wcs`. Treat 100/97/100/100 as the baseline for a new package
- Test descriptions are written in Japanese
- Real-browser coverage lives in `e2e/` (Playwright, over the local `packages/*/dist`)

## Linting

ESLint flat config format. Notable rules:
- `no-explicit-any` and `no-this-alias` are off
- Unused vars prefixed with `_` are allowed
- Test files have relaxed rules

## TypeScript Configuration

Root `tsconfig.json` sets ESNext target/module with bundler module resolution, strict mode, and DOM lib types. Each package extends this and sets its own `outDir`/`rootDir` (`state` sets `noEmit: true` and `rootDir: "."` instead).

## Architecture Notes

### Core interop protocols

These protocols are how `state`/`signals` talk to I/O node components, and how custom tags bind to one another. They are the heart of the project — read the per-package `README.md` and `docs/` before changing them.

- **`wc-bindable-protocol`** — A component declares its bindable surface as `static wcBindable = { protocol: "wc-bindable", version, properties, inputs?, commands? }` (canonical types: `/protocol/wc-bindable.ts`). `properties` are observable outputs: each names the `event` the element dispatches on change, an optional `getter` that reads the value from that event, and an optional `semantics` (`"state"` / `"event"` / `"handle"`). `inputs` (the settable surface, with an optional `attribute` hint) and `commands` (invocable methods) are declarative metadata. This lets `data-wcs` (and signals' `bindNode`) wire DOM elements together without per-element glue. I/O node components implement this so they interoperate with `state`.
- **`command-token` protocol** — `state → element` imperative command invocation: `$commandTokens` / `$command.<name>` / `command.<method>:`. Positional arguments are passed through verbatim (`Token.emit` → `Reflect.apply`); the runtime does not `await` them.
- **`event-token` protocol** — the dual of command-token: `element → state` event dispatch. `$eventTokens` / `eventToken.<prop>: <name>` / `$on`. Keys are `wcBindable` property names.
- **`transition-runner` protocol** — how a package that mutates the DOM (`state`'s drain, `router`'s route swap) hands that mutation to whoever arbitrates view transitions. Canonical source `/protocol/transition-runner.ts`, mirrored per package by `scripts/sync-protocol-types.mjs`. No arbiter installed = the mutation runs directly and synchronously, exactly as before the protocol existed. Invariant: a mutation handed to `run()` is applied exactly once, whatever is decided about animating it.
- **`binder` / `ssr-snapshot` protocols** — the same global-symbol pattern: `router` hands DOM it inserted to `state` for binding (`/protocol/binder.ts`, [docs/binder-protocol-design.md](docs/binder-protocol-design.md)), and `server` asks `state` to build the hydration snapshots as a final pass (`/protocol/ssr-snapshot.ts`, docs/ssr-router-design.md §5). Both are mirrored by `scripts/sync-protocol-types.mjs`.
- **DevTools Hook Protocol** — `globalThis.__WCSTACK_DEVTOOLS_HOOK__`, through which `@wcstack/devtools` observes the runtimes without importing them ([docs/devtools-hook-protocol.md](docs/devtools-hook-protocol.md)).

### Component package layout (I/O node pattern)

Each I/O node component splits into two layers:
- **Core** (`src/core/XxxCore.ts`) — framework-agnostic logic over the platform API. Holds state, exposes `commands`, emits events. Testable without the DOM custom element. Packages using the shared request lane / capability layer carry generated copies of `io-core/` next to it.
- **Shell** (`src/components/<Name>.ts`) — the actual custom element (`HTMLElement` subclass) that wraps Core, handles attributes/lifecycle, and declares `static wcBindable`. The class is usually `WcsXxx`; a few older packages (fetch, storage, timer, raf, debounce) name it `Xxx` and export it as `WcsXxx` (`export { Fetch as WcsFetch }`). The Shell class is exported so adopters can subclass it.

`src/exports.ts` is the Rollup entry; `src/auto.ts` is the single-tag bootstrap (it calls the package's `bootstrapXxx()`, which registers the tags via `registerComponents.ts`).

### Autoloader Flow
1. Parses the page's Import Map for `@components/` namespace entries
2. Scans the DOM using TreeWalker for undefined custom elements
3. Resolves tag names to module URLs via namespace matching
4. Dynamically imports and registers components
5. Observes DOM via MutationObserver for elements added after initial scan

### Router Architecture
- `src/components/Router.ts` orchestrates navigation, matching routes, and rendering; it also holds the `popstate` fallback
- `src/components/Route.ts` holds a route's parsed path and weight; `matchRoutes.ts` / `testPath.ts` match the URL, `showRoute.ts` / `hideRoute.ts` toggle visibility
- `src/components/Layout.ts` / `LayoutOutlet.ts` handle nested layout templates
- `src/Navigation.ts` only feature-detects the Navigation API (`getNavigation()`)
- Route priority: more segments first, then more static segments (`users` > `:id` > `*`), then definition order — catch-all `*` is lowest (README §3.3)
- Supports basename for sub-directory deployment

### State engine (4.0, `packages/state`)

The layout is in [The 4.0 engine](#the-40-engine-packagesstate).
- Binding syntax: `property[#modifier]: path[|filter[|filter(args)...]]` — v2 removed the `@state` selector (parse error with a migration hint): one state tree per root; graft subtrees with `<wcs-state mount="path">` volumes and read them as `path.…`

## Examples

- Root `examples/` holds cross-package demo apps only (e.g. `state-camera-record-upload`, `state-notification-chat`, `state-cross-tab-todo`, `ssr`) plus `websocket-chat/` — one chat scenario implemented in five stacks (vanilla / state / signals / React / Vue) on one shared WebSocket server. See `examples/README.md` for the full list and ports.
- `examples/shared/server.js` is the shared static-file + JSON API core; each demo's `server.js` is a thin file declaring only its own routes. `websocket-chat/shared/` keeps its own self-contained server (needs the `ws` dependency), and so does `ssr/` (renders with `@wcstack/server`).
- Single-package demos live in that package's own `examples/` (e.g. `fetch` has `pagination` / `users-crud` / `infinite-scroll`, `speech` has `speech-echo` / `speak-highlight`, `defined` has `defined-loader`, `midi` has `midi-fader`, `view-transition` has `list-transitions`, `state` has its basics).
- All state-based demos load packages via CDN one-liners (`https://esm.run/@wcstack/<pkg>/auto`); signals demos import from the single `@wcstack/signals/dom` CDN entry (mixing `.`/`.dom` entries on one CDN page duplicates the reactive core).

## Docs & Design Notes

`docs/` contains design documents, implementation plans, and spec proposals (e.g. tag-design notes, `signals-migration-plan.md`, `spec-proposal-*.md`, `timing-and-firing-contract.md`, `async-io-node-guidelines.md`). Consult the relevant doc before extending a component's behavior or its protocol. Per-package `README.md`/`README.ja.md` are the normative references for that package — update both (the unscoped `wcstack` package has an English README only). On this branch the 4.0 work is planned and recorded in `docs/state-engine-rewrite/` (start with `v4-remaining.ja.md`), and `docs/migration-v4.md` / `.ja.md` is the 3.x → 4.0 guide.

The AI app-building skill (`wcstack-app`) lives in the separate [wcstack/wcstack-skill](https://github.com/wcstack/wcstack-skill) repository. When changing `data-wcs` syntax, the wc-bindable / command-token / event-token protocols, or router attributes/behavior, update that skill's references to match (its plugin version tracks the wcstack release it was verified against).

## Module System

All packages use `"type": "module"` (ESM only); no package ships a CommonJS entry point. The only `.cjs` files are bundled Node tools: `@wcstack/lint`'s `dist/cli.cjs`, `@wcstack/typescript`'s `schema-core.cjs` / `tsc-core.cjs`, and the vscode-wcs extension's esbuild output.
