# TypeScript with wcstack

- **Status**: the single entry point for everything TypeScript-related when *building an app with* wcstack (not for working on the packages themselves). Written 2026-08-30 alongside [app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md); sections marked *planned* land with the phases of that plan.
- **Audience**: projects that `npm install` wcstack packages and run `tsc`. A CDN-only page (Import Map, `https://esm.run/...`) gets §2 — everything the validator does works from HTML and a manifest — but §3 and §4 need the package types in a TypeScript program.

wcstack's contract between UI and state is a **path string**, and TypeScript does not see strings. So "type safety" for a wcstack app is four separate things, each with its own tool:

| You want | Tool | Reaches |
|---|---|---|
| a typed `this` inside state methods and getters | `defineState` (§1) | any project that type-checks the state file |
| `data-wcs` paths in HTML checked against the state's real types, in CI and every editor | `wcs-schema` → `wcs-validate` (§2) | every project, CDN pages included |
| `document.querySelector("wcs-fetch")` typed as `WcsFetch` | `HTMLElementTagNameMap` augmentation (§3, *planned*) | npm + tsc projects |
| the inline `<script type="module">` inside `<wcs-state>` type-checked by `tsc` in CI | `wcs-tsc` (§4, *planned*) | npm + tsc projects |

## 1. Typing the state: `defineState`

`@wcstack/state` exports `defineState`, an identity function whose only job is to give `this` the right type inside methods and getters, including dot-path access:

```ts
import { defineState } from "@wcstack/state";

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],
  increment() { this.count++; },              // number
  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";   // string
  },
});
```

`WcsPaths<T>` and `WcsPathValue<T, P>` are exported for tools. Reference: [packages/state/docs/define-state.md](../packages/state/docs/define-state.md).

This is the whole extent of what `tsc` alone can check: the state file. It knows nothing about the HTML.

## 2. Reaching the HTML: `wcs-schema` and the sidecar `stateSchema`

The static validator (`wcs-validate` from `@wcstack/lint`, and the VS Code extension) checks every `data-wcs` path against the state — but it reads the state with a regex analyzer, not the type checker. `users: [] as { name: string }[]` leaves `users.*.name` unresolvable, so a typo is a **warning** (`wcs/binding-path-missing`, exit 0) and the correct path gets a false one.

The validator also has a typed input it never had a producer for: the `application` sidecar manifest's `stateSchema` (a JSON-Schema subset, [wcstack-manifest-schema.md](./wcstack-manifest-schema.md) §4). `@wcstack/typescript` is that producer:

```bash
npm install -D @wcstack/typescript typescript
npx wcs-schema emit src/state.ts        # ./wcstack.manifest.json — states.default.stateSchema from the TS type
npx wcs-validate --strict index.html    # discovers the manifest next to / above the HTML automatically
```

With a `stateSchema` declared, the validator's behavior for that state changes (spec §6):

- a path the schema definitely lacks → `wcs/path-nonexistent`, **error**;
- `for:` on a non-array → `wcs/path-type-mismatch`, **error**;
- paths under a bare `{}` (a `Date`, a `Map`, `Record<string, T>`, anything the generator cannot describe) → silent;
- methods, getters and `$listKeys` from the inline script still count as existing, and where both the script and the schema know a path, the schema's type wins.

The VS Code extension discovers the same file, so the IDE and CI agree.

The manifest is a **derived artifact** — the type is the source of truth. Keep them in sync in CI:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

`check` exits `1` with the drifted JSON pointers listed. Details of the conversion (unions, literals, path getters, depth cut-off) are in [packages/typescript/README.md](../packages/typescript/README.md).

Pitfalls:

- `--strict` also fails on warnings from `<wcs-state src>` files the validator cannot read — make every `src=` resolvable relative to its HTML first.
- `--merge` replaces the named state's `stateSchema` wholesale; a hand-written schema for the same state does not survive (the sidecar spec forbids implicit merging). Hand-written schemas belong to states you do not generate.
- Two application manifests declaring the same state name are a `wcs/manifest-state-collision` error with no winner; when passing manifests explicitly on the command line, pass one per state name.

## 3. Typed element lookups: `HTMLElementTagNameMap`

Every component package augments `HTMLElementTagNameMap` with its **default** tag names, so a lookup by tag is typed as the element class:

```ts
import "@wcstack/fetch";                       // the augmentation ships in the package's index.d.ts
import type { WcsFetch } from "@wcstack/fetch";

const el = document.querySelector("wcs-fetch");   // WcsFetch | null
el!.url = "/api/users";                           // typed property
document.querySelectorAll("wcs-route");           // NodeListOf<Route>
```

- **It applies only when the package's types are in your program.** `import "@wcstack/fetch"` (a side-effect import — the runtime cost is nil when you already load the package), or a `"types": ["@wcstack/fetch"]` entry in `tsconfig.json`. A page that only loads `https://esm.run/@wcstack/fetch/auto` and never imports the package gets `HTMLElement`, as before.
- **Default tag names only.** A project that renames tags through `IWritableTagNames` (`bootstrapFetch({ tagNames: { fetch: "my-fetch" } })`) is outside the map; declare its own augmentation if it wants typed lookups.
- Covered: every `wcs-*` element of every package, including helper and node tags (`wcs-fetch-header`, `wcs-voice`, `wcs-osc`, …), `wcs-state` / `wcs-ssr`, and the router tags. `wcs-guard-handler` is a config name without an element class and is not mapped.
- Drift is tested: vscode-wcs' `tagNameMap.test.ts` (always run by CI's `wcs-validate` job) checks that the built-in tag catalog and the declarations agree in both directions, and `state` / `router` / `devtools` compare their declaration with their own `config.tagNames`.

## 4. Type-checking inline state scripts: `wcs-tsc`

`wcs-tsc` (also in `@wcstack/typescript`) runs `tsc` over `.html` files. Every `<wcs-state>` inline `<script type="module">` goes through the same Volar language plugin the VS Code extension uses — the typed-`this` preamble, the automatic `defineState` wrap of a bare `export default {}`, the removal of `@wcstack/state` imports (bare **or** CDN URL) — so what the editor underlines is what CI reports:

```bash
npm i -D @wcstack/typescript typescript @volar/typescript@~2.4.0 @volar/language-core@~2.4.0
npx wcs-tsc --noEmit                 # or: npx wcs-tsc -p tsconfig.json --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<{ count: number; … }>'. Did you mean 'count'?
```

It is vue-tsc's mechanism: `@volar/typescript`'s `runTsc` patches the project's own `typescript/lib/tsc.js` to accept `.html` and to build the program through the plugin; every other tsc argument passes through untouched, and the exit code is tsc's.

- **Project setup.** The `tsconfig.json` must reach the HTML: an `include` that covers `**/*.html` (or no `include`, whose default does), plus `noImplicitThis` (typed `this`), `allowJs` and `checkJs`. `wcs-tsc` audits the config and warns when something is missing; `--wcs-defaults` runs with a temporary config that extends yours and adds them (deleted afterwards).
- **CDN imports.** A buildless page imports from `https://esm.run/...`, which tsc cannot resolve. By default (`--url-imports=any`) every `http(s)://` module types as `any`; `--url-imports=error` leaves them to fail with TS2307. `@wcstack/state` URL imports are stripped and typed by the preamble either way.
- **Several `<wcs-state>` on one page.** tsc handles one service script per file, so the blocks are combined into one virtual module: imports hoisted to the top, each block in its own scope (`{ const __wcs_state_N = defineState({ … }); }`), diagnostics mapped back to the HTML. A page without inline state is an empty module — its markup is never parsed as TypeScript.
- Peers: `typescript` (required), `@volar/typescript` + `@volar/language-core` (optional — only this command needs them, resolved from the project first). The package keeps zero runtime dependencies.
- CI in this repository runs `wcs-tsc` over every example page as an experimental, non-gating job for one release; it becomes a gate once a cycle shows no false positives ([app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md) §7-6).
