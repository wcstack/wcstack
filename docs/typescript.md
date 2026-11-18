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

`@wcstack/state/define` exports `defineState`, an identity function whose only job is to give `this` the right type inside methods and getters, including dot-path access. Import it from `/define`, which has no runtime: in 4.0, importing it from `@wcstack/state` keeps the whole engine (about 21 KB gzip) in a bundle.

```ts
import { defineState } from "@wcstack/state/define";

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

Annotate a getter's return type (`get total(): number { … }`) when its body reads `this`: without one, TypeScript types the reads its result depends on `any`. Since 4.26 (not released yet) the lint reads the annotation too: up to 4.25 it did not see a getter or a method with a return type at all, and its script rules skipped them. Also since 4.26, a `$on` handler's parameters are typed — `state` (the state: its data, getters, paths and API; its methods `any`), `event` (`CustomEvent`), the list indexes (`number`), and `this` is `void` (a handler that reads `this` throws) — and `this.$command` has exactly the names in `$commandTokens`: a misspelt token is a type error, and `noUncheckedIndexedAccess` no longer makes each use "possibly undefined". A call that passes only `<T>` keeps the earlier typing.

Recursive paths (`**`, declared with `$recursion`) are typed `any` through a pattern index signature — a depth family cannot be enumerated as a union — while ordinary dot paths keep their resolved types. The VS Code extension's preamble declares the same signature, so the editor and `tsc` report the same thing.

This is the whole extent of what `tsc` alone can check: the state file. It knows nothing about the HTML.

## 2. Reaching the HTML: `wcs-schema` and the sidecar `stateSchema`

The static validator (`wcs-validate` from `@wcstack/lint`, and the VS Code extension) checks every `data-wcs` path against the state — but it reads the state with a regex analyzer, not the type checker (since 4.26 (not released yet) it reads return-type annotations, and reads a body with TypeScript syntax through Node's own type stripping, Node 22.13 or later). `users: [] as { name: string }[]` leaves `users.*.name` unresolvable, so a typo is a **warning** (`wcs/binding-path-missing`, exit 0) and the correct path gets a false one.

The validator also has a typed input it never had a producer for: the `application` sidecar manifest's `stateSchema` (a JSON-Schema subset, [wcstack-manifest-schema.md](./wcstack-manifest-schema.md) §4). `@wcstack/typescript` is that producer:

```bash
npm install -D @wcstack/typescript typescript@6
npx wcs-schema emit src/state.ts        # ./wcstack.manifest.json — its stateSchema (manifestExtensions["wcstack.application"]) from the state's type; a .js file's JSDoc types work too
npx wcs-validate --strict index.html    # discovers the manifest next to / above the HTML automatically
```

With a `stateSchema` declared, the validator's behavior for that state changes (spec §6):

- a path the schema definitely lacks → `wcs/path-nonexistent`, **error**;
- `for:` on a non-array → `wcs/path-type-mismatch`, **error**;
- paths under a bare `{}` (a `Date`, a `Map`, `Record<string, T>`, anything the generator cannot describe) → silent;
- methods, getters and `$listKeys` from the inline script still count as existing, and where both the script and the schema know a path, the schema's type wins;
- since 4.26 (not released yet), a schema whose top-level keys differ from the state script's is `wcs/drift-state-key` (warning): the schema is stale, or it is another page's. Up to 4.25 a name renamed in the `.ts` and left in the HTML passed the lint against the old schema — only `wcs-schema check` noticed.

The VS Code extension discovers the same file, so the IDE and CI agree.

**One manifest for several pages.** Since 4.26 (not released yet), `wcs-schema emit` records the state file as `stateSource` (relative to the manifest), and the validator applies the schema only to the pages whose root `<wcs-state src>` is that file (its `.js` counts as the same). Keep one `wcstack.manifest.json` at the project root, where `wcs-validate` and the extension discover it: a page with an inline state of its own is checked against its own script, not against this schema. `wcs-schema check` reports a manifest that names another file as drift. A manifest written by 4.25 or earlier has no `stateSource` and applies to every page under it until it is regenerated. When the page loads a build's output from another path (`tsc --outDir`), emit with `--state-source=<that .js>`.

**Building a page whose state is a `.ts` file.** The engine imports `<wcs-state src>` at run time, so the file must be served as JavaScript. Since 4.26 (not released yet), with Vite, add the plugin of `@wcstack/typescript`:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wcstack } from "@wcstack/typescript/vite";
export default defineConfig({ plugins: [wcstack()] });
```

The dev server serves `src="./src/state.ts"` as it is; the plugin makes `vite build` emit every local `<wcs-state src>` file (the root state and `mount` volumes) as a chunk of its own, keeping its `export default`, and rewrite the attribute to the built URL under `base`. Without it the build keeps the attribute, emits no file, and production 404s the state. It also keeps the inline `<script type="module">` of `<wcs-state>` and `<wcs-guard-handler>` in the page, which Vite would otherwise move into its bundle (and drop, when nothing imports its `export default`). Details: [Building with Vite](../packages/typescript/README.md#building-with-vite). Without a bundler, compile the state with `tsc` and point `src` at the `.js`.

The manifest is a **derived artifact** — the type is the source of truth. Keep them in sync in CI:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

`check` exits `1` with the drifted JSON pointers listed. Details of the conversion (unions, literals, path getters, depth cut-off) are in [packages/typescript/README.md](../packages/typescript/README.md).

Pitfalls:

- `--strict` also fails on warnings from `<wcs-state src>` files the validator cannot read — make every `src=` resolvable relative to its HTML first.
- `--merge` replaces the slot being written wholesale — the whole `stateSchema`, or the subtree at `--mount=<path>` (a volume's type merges as a subtree of the single tree); a hand-written schema for that slot does not survive (the sidecar spec forbids implicit merging). Hand-written schemas belong to slots you do not generate.
- Two application manifests both declaring a `stateSchema` are a `wcs/manifest-state-collision` error with no winner (v2: one state tree per page, one schema slot); keep the generated schema in exactly one manifest.

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

`wcs-tsc` (also in `@wcstack/typescript`) runs `tsc` over `.html` files. Every `<wcs-state>` inline `<script type="module">` goes through the same Volar language plugin the VS Code extension uses — the typed-`this` preamble, the automatic `defineState` wrap of a bare `export default {}`, the removal of `@wcstack/state` imports (bare — `/define` and the other entries too — or a CDN URL) — so what the editor underlines is what CI reports:

```bash
npm i -D @wcstack/typescript typescript@6 @volar/typescript@~2.4.0 @volar/language-core@~2.4.0
npx wcs-tsc --noEmit                 # or: npx wcs-tsc -p tsconfig.json --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<{ count: number; … }>'. Did you mean 'count'?
```

It is vue-tsc's mechanism: `@volar/typescript`'s `runTsc` patches the project's own `typescript/lib/tsc.js` to accept `.html` and to build the program through the plugin; every other tsc argument passes through untouched, and the exit code is tsc's.

- **JavaScript, as the browser runs it.** Since 4.26 (not released yet) the script is checked as JavaScript, turned on by the plugin's `// @ts-check` whatever `checkJs` says. JSDoc types count (`/** @type {Item[]} */ items: []`, `/** @param {number} n */`, `/** @typedef {import("./api").Item} Item */`). TypeScript syntax (a type annotation, `as`, `!`, `import type`) is reported where it stands (TS8010, TS8016, TS8006), as the browser would throw a `SyntaxError`; a syntax error stops tsc from reporting type errors until it is fixed. Up to 4.25 the script was read as TypeScript: JSDoc was ignored and TypeScript syntax passed. A JSDoc comment must start its own line: TypeScript does not attach one that follows `{` or `,` on the same line.
- **Project setup.** The `tsconfig.json` must reach the pages (an `include` that covers them, or no `include`) and target ES2015 or later (`target` or `lib`). Since 4.26 `noImplicitThis`, `allowJs` and `checkJs` are not needed (up to 4.25 they were). `wcs-tsc` audits the config and prints one `wcs-tsc: warning: …` line on stderr when something is missing — including when pages with an inline `<wcs-state>` lie under the tsconfig's directory and none of them is in the program, which it names. The exit code stays tsc's. `--wcs-defaults` runs with a temporary config that extends yours and adds `include: "**/*.html"` (and `target`), deleted afterwards. Use `strict` (at least `noImplicitAny`) for the full check: without it a JavaScript object literal is open, and a misspelt field of an object inside an array (`this.items[0].nmae`) is not reported; `this.coutn` still is.
- **`$on` and `$command`.** As with `defineState` (4.26): a `$on` handler's parameters are typed — `state` (the state; its methods `any`), `event` (`CustomEvent`, `detail` is `any`), the indexes (`number`), `this` is `void` — and `this.$command` is narrowed to the names in `$commandTokens`.
- **CDN imports.** A buildless page imports from `https://esm.run/...`, which tsc cannot resolve. By default (`--url-imports=any`) every `http(s)://` module types as `any`; `--url-imports=error` leaves them to fail with TS2307. `@wcstack/state` URL imports are stripped and typed by the preamble either way.
- **Several `<wcs-state>` on one page.** tsc handles one service script per file, so the blocks are combined into one virtual JavaScript module: imports hoisted to the top, each block in its own scope (`{ const __wcs_state_N = defineState({ … }); }`), diagnostics mapped back to the HTML. A page without inline state is an empty module — its markup is never parsed as TypeScript.
- **Getters.** A getter whose body reads `this` is given the return type `any` in the checked code (from 4.6.2; a `/** @returns {any} */` JSDoc since 4.26), and a getter with its own JSDoc `@returns` / `@type` keeps it, so its body is checked against the state's `this` like a method's. Without it, TypeScript's inference of the getter's type loops back to the state and leaves `this` in that body `any` — `get first() { return this.items[0].nmae; }` was not reported ([define-state.md](../packages/state/docs/define-state.md#getters-with-an-inferred-return-type)).
- **TypeScript 7** has no JavaScript compiler API for `wcs-tsc` to run. Its way to read `.html` is a content mapper (TypeScript 7.1), designed in [typescript-content-mapper.md](./typescript-content-mapper.md); until one ships, keep `typescript@6` for `wcs-tsc`.
- Peers: `typescript` (required, 5 or 6 — TypeScript 7 publishes no `typescript/lib/tsc.js` and no compiler API at `typescript`), `@volar/typescript` + `@volar/language-core` (optional — only this command needs them, resolved from the project first). The package keeps zero runtime dependencies.
- CI in this repository runs `wcs-tsc` over every example page as an experimental, non-gating job for one release; it becomes a gate once a cycle shows no false positives ([app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md) §7-6).
