# AGENTS.md

Guidance for AI coding agents working in this repository. (Claude Code users: [CLAUDE.md](./CLAUDE.md) is the more detailed, tool-specific guide; this file is the vendor-neutral summary.)

**wcstack** (Web Components Stack) is a monorepo of focused, zero-dependency TypeScript packages for building Web Components-based SPAs — standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, buildless. Project site: **https://wcstack.github.io**

## Building an app WITH wcstack?

If your task is to generate an application that *uses* wcstack (rather than modify wcstack itself):

- Use the **wcstack-app skill**: https://github.com/wcstack/wcstack-skill — complete `data-wcs` binding syntax, router/SPA skeletons, and a catalog of all `<wcs-*>` tags. Claude Code users can install it with `/plugin marketplace add wcstack/wcstack-skill`.
- Docs and live guides: https://wcstack.github.io
- **Validate generated HTML** with the static-contract CLI and iterate until exit code `0`:

  ```bash
  npx @wcstack/lint --errors-only index.html wcstack.manifest.json
  ```

  Diagnostics carry stable codes and `source:line:col` ranges; exit code is `1` if any error-severity finding exists, `2` on usage/read failure. See [packages/lint](./packages/lint/README.md).

## Working ON this monorepo?

### Layout & commands

- Each package under `packages/` is independent — **there is no root `package.json`**. Run commands inside a package directory:
  ```bash
  npm run build          # rimraf dist .tsc-out → tsc → rollup
  npm test               # vitest run (happy-dom environment)
  npm run test:coverage  # enforces ~100/97/100/100 thresholds
  npm run lint           # eslint on src/
  npx vitest run __tests__/someFile.test.ts   # single test file
  ```
- All packages are ESM only (`"type": "module"`). Published packages share one version, bumped in lockstep by the release workflow.
- Tests live in `__tests__/` per package; test descriptions are written in Japanese. Code, comments, and commit messages are in English. User-facing docs come in `README.md` / `README.ja.md` pairs — update both.

### Things that bite

- **Generated files**: `rollup.config.js`, `eslint.config.js`, `src/protocol/wcBindable.ts`, and IO-core copies are synced from single sources by `scripts/sync-*.mjs`. Never edit the copies; edit the template/source and run the sync script (CI fails on drift). The AI-agents banner directly below each published package README's H1 is likewise managed — its text lives in `scripts/sync-readme-agents-banner.mjs`; edit the rest of the README freely, but change that one line only via the script (`node scripts/sync-readme-agents-banner.mjs`).
- **CI validates all HTML**: the `wcs-validate` CI job runs the static-contract validator over every `*.html` / `*.manifest.json` in `examples/` and `packages/` and fails on error-severity findings. Do not commit intentionally-broken fixtures — generate them in a temp dir at test runtime.
- **Protocols are the heart of the project**: `wc-bindable-protocol`, `command-token`, and `event-token` (see `docs/` and per-package READMEs — the normative references) must not be changed casually. Component packages follow a Core (framework-agnostic logic) / Shell (custom element) split.
- When changing `data-wcs` syntax, protocols, or router behavior, the wcstack-app skill's references (separate repo above) must be updated to match.

## Key packages

| Package | Role |
|---|---|
| `@wcstack/state` | Reactive state + declarative `data-wcs` binding |
| `@wcstack/router` | Declarative SPA routing (Navigation API) |
| `@wcstack/signals` | Signals-based lightweight reactive core |
| `@wcstack/autoloader` | Import-Map-driven auto-registration of custom elements |
| `@wcstack/lint` | Static-contract validator CLI (`wcs-validate`) |
| 30+ I/O node packages | Declarative wrappers over Web platform APIs (`<wcs-fetch>`, `<wcs-ws>`, `<wcs-camera>`, …) |

Full catalog: root [README.md](./README.md) and https://wcstack.github.io
