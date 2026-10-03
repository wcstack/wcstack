# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

ユーザーへの応答は常に日本語で行うこと。

- Code, identifiers, and commit messages are in English.
- Source comments are mixed English / Japanese — follow the language of the surrounding file.
- Test descriptions are written in Japanese.

## Project Overview

**wcstack** (Web Components Stack) is a monorepo of focused TypeScript packages for building Web Components-based SPAs. The design philosophy is standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, buildless, with zero runtime dependencies (the exception is `@wcstack/server`, which depends on `@wcstack/state` and `happy-dom`). Each package is a self-contained custom element (or core utility) that can be dropped onto a page via CDN/Import Map and composed like LEGO bricks.

**This is the `research/state-engine` branch — the `@wcstack/state` 4.0 rewrite.** `packages/state-next` is the new engine; `packages/state` is still the 3.x code. Everything specific to this branch is in [research/state-engine (4.0 engine)](#researchstate-engine-40-engine). Elsewhere in this file, `@wcstack/state` means the 3.x `packages/state`.

## Repository Layout

- `packages/` — one directory per package (see Monorepo Structure).
- `protocol/` — canonical sources of the cross-package protocols (`wc-bindable`, `wc-bindable-reader`, `upgrade-properties` + its test, `transition-runner`, `binder`, `ssr-snapshot`). `scripts/sync-protocol-types.mjs` copies them into `packages/<pkg>/src/protocol/` (the test into `__tests__/`).
- `io-core/` — canonical IO-core helpers (`operation-lane`, `platform-capability`). `scripts/sync-io-core.mjs` copies them into `packages/<pkg>/src/core/`.
- `config-templates/` — canonical `rollup.config.js` / `eslint.config.js`. `scripts/sync-package-configs.mjs` writes the `@wcstack/*` copies; packages in its `DEVIATIONS` keep a hand-written file (or none, like `lint`), and `packages/wcstack` (a hand-kept copy) and `packages/vscode-wcs` are outside the sync.
- `scripts/` — the sync scripts, `sync-readme-agents-banner.mjs` (the AI-agents line under each package README's H1), the `@wcstack/state` size / split / coupling gates, `conformance-*.mjs`, `generate-sri.mjs`, and `audit-state-*` measurement tooling.
- `e2e/` — Playwright real-browser tests over the local `packages/*/dist` (own `package.json`; `.github/workflows/e2e.yml`).
- `examples/`, `docs/` — see below. `CHANGELOG.md` follows Keep a Changelog; `packages/vscode-wcs` keeps its own.

Generated copies carry a do-not-edit banner: edit the canonical source and re-run the sync script. CI's `protocol-types-sync` job runs each sync script with `--check` and fails on drift.

## Monorepo Structure

Each package lives under `packages/` and is built and tested on its own. There is no root-level `package.json` or workspace orchestration (the root `package-lock.json` is an empty stub) — run commands inside a package directory. All published packages (`@wcstack/*` and `wcstack`) share one version and are released in lockstep: `release.yml` bumps every package to the same version whether or not it changed. `packages/vscode-wcs` is versioned separately.

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
- **`packages/state-next`** (`@wcstack/state-next`, `private: true`, version `0.0.0`; this branch only) — The rewritten 4.0 engine of `@wcstack/state`. Never published under this name: at the 4.0 release it replaces the contents of `packages/state` (decision R1 in [docs/state-engine-rewrite/v4-remaining.ja.md](docs/state-engine-rewrite/v4-remaining.ja.md)); until then `packages/state` is the 3.x code. See [The 4.0 engine](#the-40-engine-packagesstate-next).

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
- `packages/state-next`: see [The 4.0 engine](#the-40-engine-packagesstate-next).

To run a single test file:
```bash
npx vitest run __tests__/someFile.test.ts
```

## Build Pipeline

Each package follows the same build flow: `rimraf dist .tsc-out` → `tsc` → `rollup -c`, with these exceptions:
- `state` appends `node scripts/emit-manifest.mjs` (writes `dist/wcs-manifest.json`).
- `typescript` appends `scripts/build-schema-core.mjs`; `testing` prepends `scripts/build-deps.mjs` (see Other packages).
- `lint` is `scripts/build.mjs` and `vscode-wcs` is `node esbuild.config.js` — neither runs tsc / Rollup.
- `state-next` is `node build.mjs` (esbuild + terser; tsc never emits and Rollup only bundles the `.d.ts`) — see [The 4.0 engine](#the-40-engine-packagesstate-next).

Rollup produces two outputs from `src/exports.ts`:
- `dist/index.esm.js` — ESM bundle, and what `exports["."]` resolves to (minified in `@wcstack/state` — requirement N1; `WCS_STATE_UNMINIFIED=1 npm run build` gives readable names for profiling)
- `dist/index.d.ts` — Bundled type declarations (via rollup-plugin-dts)

`@wcstack/state` also emits `dist/split/**` (the `/core` and `/features/*` entries), `dist/define.js`, `dist/parser.esm.js` and `dist/manifest.esm.js`.

Most packages add a third entry from `src/auto.ts` — `dist/auto.min.js`, exposed as `exports["./auto"]`. It lets a page activate the component with a single `<script>` tag (no manual registration), and is **bundled self-contained with no static imports**, so one `integrity` attribute covers the whole runtime. `src/auto.ts` must import only from `./exports`; a relative import of a sibling dist file would silently destroy that property. See [docs/sri.md](docs/sri.md).

There is deliberately no `dist/index.esm.min.js`: it appeared in no `exports` map, and its only consumer was the old auto stub. A minified named-export bundle is still built only where there is no self-contained auto bundle: `@wcstack/signals` (no `src/auto.ts` by design) and `@wcstack/server`. Neither appears in an `exports` map.

Two size gates guard `@wcstack/state`: `scripts/check-state-size.mjs` (the shipped bundles and the core closure, against `scripts/state-size-baseline.json`) and `scripts/check-state-split.mjs` (per-feature gzip against `scripts/state-split-baseline.json`, plus the rules that a feature entry carries neither core code nor another feature's code, and that no split output carries the 3.5 `wcs/v4-migration` warnings, which ship in the full entries only). Both allow 3 % over baseline; an entry of `scripts/state-split-baseline.json` may also carry a `slack` in bytes on top of the 3 % (kept across `--update`) — `features/ssr.js` has 1 KB, `features/scopes.js` has 512 B (#367). Both baselines were last re-recorded for the 3.5.3 release: the split core is 59,334 B against a 61,114 B limit, `auto.min.js` 87,973 B (limit 90,612 B), `index.esm.js` 90,899 B (limit 93,626 B), `features/scopes.js` 15,197 B and `features/ssr.js` 4,964 B plus their slack. Re-record both baselines with `--update` as part of each release; between releases, treat a failure as a real signal rather than a stale baseline. CI's `state` job also runs `scripts/audit-state-tech-coupling.mjs --check` (the core / feature value-import graph against `scripts/state-coupling-baseline.json`) and `scripts/audit-state-tech-helper-import.mjs --check --max-gzip 1024` (a `defineState`-only import stays ≤ 1 KB gzip). On this branch all four gates measure the 3.x `packages/state` only; `packages/state-next` has none, and they must be rebuilt for it at the 4.0 swap (see [At the 4.0 swap](#at-the-40-swap-r1)).

Every published package's `dist` is committed (`packages/vscode-wcs`'s is not, nor is the unpublished `packages/state-next`'s), but only rebuilt at release, so between releases it lags `src`. `packages/vscode-wcs` reads `@wcstack/state` through a `file:` symlink: on main that is `file:../state`, the *committed* `packages/state/dist`; **on this branch it is `"@wcstack/state": "file:../state-next"`, i.e. whatever `packages/state-next/dist` was last built** (see [vscode-wcs and the tooling](#vscode-wcs-and-the-tooling-read-the-40-engine)). Either way, a parser or manifest change does not reach the extension, the `wcs-validate` CLI, `@wcstack/typescript`'s `schema-core.cjs` / `tsc-core.cjs`, or the vsix until `npm run build` is run in the engine package (`packages/state-next` here) — meanwhile the extension runs the parser of the last engine build (missing `wcs/binding-syntax` diagnostics; `wiringLens` hover / definition / references / inlay hints and `bindingSyntaxValidator` silent on the affected forms). **Build the engine package before packaging the extension (`npm run package`), and re-run the vscode-wcs tests afterwards**, since newly-appearing diagnostics can change existing expectations. CI's `wcs-validate` job builds the engine from source first.

Two more traps around committed dists: `npm run build` in `packages/testing` rebuilds `state`, `router` and `server` in place and dirties their committed dist (restore with `git checkout -- packages/<pkg>/dist` when that was not the intent); and `packages/vscode-wcs/src/service/generated/builtinTags.generated.ts` + `packages/vscode-wcs/wcs.html-data.json` are generated from the committed dists by `packages/vscode-wcs/scripts/emit-builtin-tags.mjs` (release.yml regenerates them; CI runs `--check`) — never edit them by hand.

## research/state-engine (4.0 engine)

This branch rewrites `@wcstack/state` for 4.0. The plan and the record of the work are in `docs/state-engine-rewrite/` (start with [v4-remaining.ja.md](docs/state-engine-rewrite/v4-remaining.ja.md)); [docs/migration-v4.md](docs/migration-v4.md) / `.ja.md` is the 3.x → 4.0 guide.

### The 4.0 engine (`packages/state-next`)

- **Build**: `npm run build` runs `build.mjs`. esbuild bundles each entry with the internal property names listed in `mangle.mjs` shortened (`mangleProps`), then `minify.mjs` runs terser over the runtime bundles and every split file; rollup-plugin-dts emits only the `.d.ts`. tsc never emits (`tsconfig.json`: `noEmit: true`, `rootDir: "."`, no `outDir`). There is no `WCS_STATE_UNMINIFIED`: the runtime bundles are always minified. `dist/` is not committed.
- **Outputs**: the same `exports` layout as 3.x — `dist/index.esm.js`, `dist/auto.min.js`, `dist/split/{core,features/*,chunks/*}.js`, `dist/define.js`, `dist/manifest.esm.js` + `dist/wcs-manifest.json`, `dist/parser.esm.js` and the `.d.ts` files (`__tests__/public-surface.test.ts` compares the surface with `packages/state`'s) — plus two files no `exports` entry names: `dist/split/auto.js` (the split build from one `<script type="module">`, loading add-ons from `./features/` beside it) and `dist/core.min.js` (the core alone). The split files are one esbuild build, so core and add-ons share the shortened names and must come from the same build; the tooling entries (`define`, `manifest`, `parser`) are not name-shortened.
- **Core size target: ≤ 20,000 B gzip of `dist/core.min.js`** (19,434 B on 2026-10-03). **Nothing enforces it** — `build.mjs` only prints the sizes, and no test or CI step has a threshold — so read the build output after a core change.
- **`mangle.mjs`**: read its header before adding a name. A name the DOM, a protocol, a config key, a public method, DevTools, an author's object, or a string lookup reaches must not be listed. `__tests__/bundle.test.ts` / `split.test.ts` run the conformance scenarios on the mangled, tersed builds.
- `src/auto.ts` imports `./element`, `./hooks` and `./features/all`, not `./exports`; esbuild bundles it from source, so `dist/auto.min.js` is still self-contained.
- **Commands**: `build`, `test`, `test:coverage` (99.5 / 98.5 / 100 / 99.5, as 3.x), `lint`, `typecheck` (`tsc --noEmit`), `golden` (re-records `__tests__/golden/current-3.3.0.json` from `packages/state/dist`). No `clean`, no `test:watch`, no `__tests__/setup.ts`. Benchmarks: `npx vitest run --config bench/vitest.perf.config.ts`, `bench/run-all.sh`.
- **Cross-package tests**: the parity tests read the committed `packages/state/dist`, `packages/router/dist` and `packages/server/dist`, so rebuilding those changes what state-next is compared against. `packages/router/__tests__/routeRange.stateNext.test.ts` imports `../../state-next/src`, so a state-next change can break the router suite.
- **Layout**: `engine.ts` (the reactive core; path patterns in `pattern.ts`, lists and rows in `list.ts`, the dirty strategy in `strategy/`), `element.ts` (`<wcs-state>`), `dom/` (binding plans, views, binder, mounts, wc-bindable), `parser/` (the `data-wcs` grammar, a port of 3.x `bindTextParser/`), `filters/`, `token.ts`, `hooks.ts` (the slots the add-ons fill), and one directory per add-on (`temporal/`, `scopes/`, `recursion/`, `ssr/`, `devtools/`, `diagnostics/`) with its entry under `features/`.
- **Differences from 3.x that touch the protocols**:
  - binder — 4.0 renders top-level `for:` / `if:` of inserted content only when the caller passes `bind(subtree, { range: true })` ([docs/binder-protocol-design.md](docs/binder-protocol-design.md), migration-v4 §3.9); 3.x ignores the second argument.
  - command-token — state-next calls `target[method](...args)` (`dom/wc.ts`) instead of `Token.emit` → `Reflect.apply`, and does not call a detached element; arguments are still passed verbatim and not awaited.
  - `@state` — still a parse error (`parser/parseStatePart.ts`, message 32), but the migration-hint prose lives only in the diagnostics add-on (`diagnostics/messages.ts`): a `/core` page without `features/diagnostics` prints only the message number and the offending text.
- **CI**: a PR touching `packages/state-next/` gets its own `ci` matrix job (lint → build → typecheck → test:coverage), and `wcs-validate` builds it on every PR.

### vscode-wcs and the tooling read the 4.0 engine

- `packages/vscode-wcs` depends on `"@wcstack/state": "file:../state-next"` — a symlink named `@wcstack/state`, so the imports stay `@wcstack/state/parser` / `/manifest`. `@wcstack/lint`, `@wcstack/typescript` and the vsix bundle it, so they carry the 4.0 rules, and every page in the repository must pass them.
- `packages/vscode-wcs/scripts/ensure-state-dist.mjs` runs as Vitest's globalSetup and first thing in `esbuild.config.js`, so it runs on vscode-wcs `npm test` / `npm run build`, and through them in the lint / typescript builds. It fails if `node_modules/@wcstack/state` does not link the folder `package.json` names (a checkout installed before the switch still links `../state` — run `npm ci` again). If `dist/parser.esm.js`, `parser.d.ts`, `manifest.esm.js` or `manifest.d.ts` is missing, it builds state-next once (running `npm ci` there first when it has no `node_modules`). An existing dist is used as is, even when older than `src`, so the tooling runs the parser of the last state-next build until you run `npm run build` in `packages/state-next`.
- **CI**: the `wcs-validate` job builds state-next from source before vscode-wcs, lint and typescript; the `lint` / `typescript` matrix jobs get it from `ensure-state-dist.mjs`. But `ci.yml` and `e2e.yml` run only on pull requests to `main` (`on: pull_request: branches: [main]`), and this branch has none, so **none of these gates run on it — run them locally**.
- **No release from this branch** until state-next has replaced `packages/state`. `@wcstack/lint` and `@wcstack/typescript` are rebuilt from vscode-wcs on every release, so a release now would ship the 4.0 rules under a 3.x version and break 3.x users' CI; even a major bump would publish the 3.x `packages/state` as 4.0.0. `release.yml`'s first step therefore refuses to run, whatever the bump type, while vscode-wcs depends on `file:../state-next`. It also skips `private: true` packages, so state-next is never built, tested, bumped, committed or published there (`generate-sri.mjs` and `sync-readme-agents-banner.mjs` skip them too). The extension's version is not bumped before 4.0; **do not publish the vsix from this branch** — no workflow stops it.

### At the 4.0 swap (R1)

When state-next replaces the contents of `packages/state` (v4-remaining §3 / §4):
- Point vscode-wcs back at `file:../state`.
- Drop the state-next special cases: `release.yml`'s guard step (its `private: true` skip is generic and stays), the state-next build step of the `wcs-validate` job, `SKIP` in `packages/vscode-wcs/scripts/emit-builtin-tags.mjs`, `TRANSITIONAL_DUPLICATES` in `packages/vscode-wcs/__tests__/tagNameMap.test.ts`, the `state-next` targets in `scripts/sync-protocol-types.mjs`, its `DEVIATIONS` entry in `scripts/sync-package-configs.mjs` (the esbuild build becomes `state`'s deviation), and `packages/router/__tests__/routeRange.stateNext.test.ts`.
- Rebuild the four `@wcstack/state` gates; `--update` is not enough. `check-state-size.mjs` / `check-state-split.mjs` read `packages/state/dist`, and the split check reads `dist/split/**.js.map` and maps 3.x source directories to features — state-next emits no source maps. `audit-state-tech-coupling.mjs` compiles with tsc emit (state-next is `noEmit`), and `audit-state-tech-helper-import.mjs` imports the package's `rollup.config.js` (state-next has none).

## Testing

- **Framework:** Vitest with happy-dom environment, except `server` / `vscode-wcs` (Vitest default, Node) and `typescript` (`node`); `lint` has no Vitest, only a smoke test
- **Test location:** `__tests__/` directory in each package, pattern `__tests__/**/*.{test,spec}.{js,ts}` (`vscode-wcs`: `__tests__/**/*.test.ts`)
- **Setup file:** `__tests__/setup.ts` per package, except `server`, `testing`, `typescript`, `vscode-wcs` (and `state-next`)
- **Coverage thresholds** (statements / branches / functions / lines, in each package's `vitest.config.ts`): 100/100/100/100 in 20 packages, 100/97/100/100 in 24, `state` (and `state-next`) 99.5/98.5/100/99.5, `testing` and `typescript` 95/90/95/95, none in `server` and `vscode-wcs`. Treat 100/97/100/100 as the baseline for a new package
- Test descriptions are written in Japanese
- Real-browser coverage lives in `e2e/` (Playwright, over the local `packages/*/dist`)

## Linting

ESLint flat config format. Notable rules:
- `no-explicit-any` and `no-this-alias` are off
- Unused vars prefixed with `_` are allowed
- Test files have relaxed rules

## TypeScript Configuration

Root `tsconfig.json` sets ESNext target/module with bundler module resolution, strict mode, and DOM lib types. Each package extends this and sets its own `outDir`/`rootDir` (`state-next` sets `noEmit: true` and `rootDir: "."` instead).

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

### State Reactive System (3.x, `packages/state`)

The 4.0 engine's layout is different — see [The 4.0 engine](#the-40-engine-packagesstate-next). A directory map of the main folders is in [packages/state/CLAUDE.md](packages/state/CLAUDE.md). In short:
- `bootstrapState.ts` installs every feature (`ALL_FEATURES`) and the 3.5 `wcs/v4-migration` notices, then runs `core/bootstrapCore.ts` (config, tag registration, binder). The split entries (`@wcstack/state/core` + `/features/*`, from `entries/` and `features/`) install only what a page imports
- `defineState.ts` is the type-only identity helper, shipped alone as `@wcstack/state/define` (`entries/define.ts`); `stateLoader/` reads state from inline JSON, an inline `<script>`, or external JSON / script files
- `proxy/` implements a reactive proxy that tracks property access and mutations
- `bindings/` owns the binding lifecycle (node collection, `initializeBindings`, `BindingSession`, the binder); `binding/` resolves a binding to its state address; `apply/` holds the per-kind appliers (text, property, class, style, attribute, checkbox / radio, `for` / `if`, command, web component)
- `structural/` manages `<template>` conditional and list rendering
- `list/` provides array diffing for efficient DOM updates
- Filters: the built-ins are `formats/builtinFilters.ts` (installed by the `formats` feature into `core/filterRegistry.ts`); `filters/` holds their metadata and aliases
- `updater/` batches writes and applies them to the DOM; `ssr/` builds and hydrates SSR snapshots
- `command/`, `event/`, `token/`, `protocol/` implement the command-token / event-token / wc-bindable interop
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
