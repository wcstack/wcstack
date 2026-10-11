# AGENTS.md

Guidance for AI coding agents working in this repository. (Claude Code users: [CLAUDE.md](./CLAUDE.md) is the more detailed, tool-specific guide; this file is the vendor-neutral summary.)

**wcstack** (Web Components Stack) is a monorepo of focused TypeScript packages for building Web Components-based SPAs — standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, buildless, with zero runtime dependencies (except `@wcstack/server`, which depends on `@wcstack/state` and `happy-dom`). Project site: **https://wcstack.github.io**

## Building an app WITH wcstack?

If your task is to generate an application that *uses* wcstack (rather than modify wcstack itself):

- Use the **wcstack-app skill**: https://github.com/wcstack/wcstack-skill — complete `data-wcs` binding syntax, router/SPA skeletons, and a catalog of all `<wcs-*>` tags. Claude Code users can install it with `/plugin marketplace add wcstack/wcstack-skill`.
- Docs and live guides: https://wcstack.github.io
- **Validate generated HTML** with the static-contract CLI and iterate until exit code `0`:

  ```bash
  npx @wcstack/lint --errors-only index.html wcstack.manifest.json
  ```

  Diagnostics carry stable codes and `source:line:col` ranges; exit code is `1` if any error-severity finding exists, `2` on usage/read failure. See [packages/lint](./packages/lint/README.md).
- **Test the page headlessly** with vitest + happy-dom: mount the HTML, `await getBindingsReady(document)`, assert, write through `createStateAsync("writable")`, assert again. Recipes (including bare Node and `renderToString()` snapshots): [Testing Your Page](./packages/state/README.md#testing-your-page).

## Working ON this monorepo?

**`@wcstack/state` is the 4.0 engine**, rewritten on the `research/state-engine` branch and released as 4.0.0. CLAUDE.md → "The `@wcstack/state` 4.0 engine" has the details; the record of the work is in `docs/state-engine-rewrite/` (start with `v4-remaining.ja.md`).

### Layout & commands

- Each package under `packages/` is built and tested on its own — **there is no root `package.json`**. Run commands inside a package directory:
  ```bash
  npm run build          # most packages: rimraf dist .tsc-out → tsc → rollup (state: esbuild + terser via build.mjs)
  npm test               # vitest run
  npm run test:coverage  # enforces the package's coverage thresholds
  npm run lint           # eslint on src/
  npx vitest run __tests__/someFile.test.ts   # single test file
  ```
- Exceptions: `packages/lint` has no source (its build copies the vscode-wcs CLI bundle, `test` is a smoke test); `packages/vscode-wcs` builds with esbuild and has no `lint`; `typescript` and `testing` add steps to the build (CLAUDE.md → Build Pipeline); `packages/state` builds with `build.mjs` and type-checks with `npm run typecheck` (tsc never emits). Tests run under happy-dom, except `server`, `typescript` and `vscode-wcs` (Node).
- Coverage thresholds are set per package in `vitest.config.ts` (statements / branches / functions / lines): 100/100/100/100 or 100/97/100/100 for most, `state` 99.5/98.5/100/99.5, `testing` / `typescript` 95/90/95/95, none in `server` / `vscode-wcs`.
- All packages are ESM only (`"type": "module"`). Published packages share one version, bumped in lockstep by the release workflow; `vscode-wcs` is versioned separately.
- Tests live in `__tests__/` per package; test descriptions are written in Japanese. Code and commit messages are in English; source comments are mixed English / Japanese — follow the surrounding file. User-facing docs come in `README.md` / `README.ja.md` pairs — update both (the unscoped `wcstack` package has an English README only).

### Things that bite

- **Generated files** are synced from single sources by `scripts/sync-*.mjs`: from `/protocol`, each package's `src/protocol/*` copies (`wcBindable.ts`, `wcBindableReader.ts`, `upgradeProperties.ts`, `transitionRunner.ts`, `binder.ts`, `ssrSnapshot.ts`) and `__tests__/protocol.upgradeProperties.test.ts`; from `/io-core`, the `src/core/operationLane.ts` / `platformCapability.ts` copies; from `/config-templates`, each `@wcstack/*` package's `rollup.config.js` / `eslint.config.js` (except the hand-written ones registered in `DEVIATIONS` in `scripts/sync-package-configs.mjs`; `packages/wcstack` keeps a hand-maintained copy and `packages/vscode-wcs` is outside the sync). `packages/state`'s generated copies are `eslint.config.js`, `src/protocol/binder.ts` and `src/protocol/transitionRunner.ts` (its `rollup.config.js` slot is a `DEVIATIONS` entry: it builds with esbuild). Never edit the copies; edit the source and run the sync script (CI fails on drift). `packages/vscode-wcs/src/service/generated/builtinTags.generated.ts` and `packages/vscode-wcs/wcs.html-data.json` are generated too, from the committed dists, by `packages/vscode-wcs/scripts/emit-builtin-tags.mjs` (CI runs `--check`). The AI-agents banner directly below each `@wcstack/*` package README's H1 is likewise managed — its text lives in `scripts/sync-readme-agents-banner.mjs`; edit the rest of the README freely, but change that one line only via the script (`node scripts/sync-readme-agents-banner.mjs`).
- **CI validates all HTML**: the `wcs-validate` CI job runs the static-contract validator over every `*.html` / `*.manifest.json` in `examples/` and `packages/` (skipping `node_modules`, `dist`, `coverage`, `.tsc-out` and `test-fixture` directories) and fails on error-severity findings. The validator carries the 4.0 rules, so every page must pass them. Do not commit intentionally-broken fixtures — generate them in a temp dir at test runtime. The one exception is `packages/vscode-wcs/test-fixture/`, which holds pages broken on purpose for opening by hand in the extension.
- **The `@wcstack/state` gates have little headroom in places.** `scripts/check-state-size.mjs --check` covers the full entries, the split core with its chunks, each add-on beyond the core and `split/auto.js`. Each may grow 3 % gzip over `scripts/state-size-baseline.json`, plus an optional `slack` in bytes (kept across `--update`). That is only a few dozen bytes for the small add-ons: `list-keys` may go from 931 B to 959 B. Two limits are absolute: `dist/core.min.js` ≤ 20,480 B (20 KiB) gzip (19,846 B at 4.0.0: 634 B of room) and `dist/define.js` ≤ 1 KB. `scripts/check-state-coupling.mjs --check` fails when an add-on carries core code or another add-on's code beyond the core chunk, or when a core entry reaches an add-on. It also fails on any change to the core ↔ add-on imports or to the modules that run code when evaluated, both recorded in `scripts/state-coupling-baseline.json`. CLAUDE.md keeps the numbers. Re-record with `--update` on both scripts as part of the release, and treat a failure before then as a real signal, not as a stale baseline.
- **`vscode-wcs` reads `@wcstack/state` through `"@wcstack/state": "file:../state"`** (a symlink to the committed `packages/state/dist` — the 4.0 engine). A parser or manifest change in `packages/state/src` does not reach the extension, the `wcs-validate` CLI, `@wcstack/typescript`'s `schema-core.cjs` / `tsc-core.cjs`, or the vsix until someone runs `npm run build` in `packages/state`. Until then they silently run the parser of the last build: `wcs/binding-syntax` diagnostics go missing, and `wiringLens` features (hover, go-to-definition, find-references, inlay hints) plus `bindingSyntaxValidator` go quiet on the affected forms. **Before packaging the extension, build `packages/state` first** — and re-run the vscode-wcs tests then, because fresh diagnostics can change existing expectations. CI (`ci.yml`, `e2e.yml`) runs only on pull requests to `main`, so on a branch without one none of its gates run unless you run them locally. Releases run `release.yml` from main (nothing may be merged into main while one runs); the vsix is published by hand, separately; see CLAUDE.md.
- **Committed dists**: every published package's `dist` is committed but only rebuilt at release. `npm run build` in `packages/testing` rebuilds `state`, `router` and `server` in place and dirties their committed `dist`. The 3.x side of `packages/state`'s parity tests is frozen (`__tests__/fixtures/state-3.5.4`, `__tests__/golden/`).
- **Protocols are the heart of the project**: `wc-bindable-protocol`, `command-token`, and `event-token` (see `docs/` and per-package READMEs — the normative references), plus the internal `transition-runner` / `binder` / `ssr-snapshot` protocols (canonical sources in `/protocol/`), must not be changed casually. Component packages follow a Core (framework-agnostic logic, `src/core/`) / Shell (custom element, `src/components/`) split.
- When changing `data-wcs` syntax, protocols, or router behavior, the wcstack-app skill's references (separate repo above) must be updated to match.

## Key packages

| Package | Role |
|---|---|
| `wcstack` | npm entry point; `wcstack/auto` bundles state + router + fetch + storage + autoloader as one script |
| `@wcstack/state` | Reactive state + declarative `data-wcs` binding |
| `@wcstack/router` | Declarative SPA routing (Navigation API) |
| `@wcstack/signals` | Signals-based lightweight reactive core |
| `@wcstack/autoloader` | Import-Map-driven auto-registration of custom elements |
| `@wcstack/lint` | Static-contract validator CLI (`wcs-validate`) |
| `@wcstack/testing` | Headless test helpers (`mount()` / `settle()` / `fire()`) |
| 30+ I/O node packages | Declarative wrappers over Web platform APIs (`<wcs-fetch>`, `<wcs-ws>`, `<wcs-camera>`, …) |

Full catalog: root [README.md](./README.md) and https://wcstack.github.io
