# @wcstack/typescript

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if the types you already wrote for your state reached the HTML that binds to it?**

`@wcstack/state` pages bind DOM to state through path strings (`users.*.name`). A TypeScript state file already knows every one of those paths and its type — but HTML cannot consume a `.d.ts`, and the static validator (`wcs-validate`, the VS Code extension) reads the inline script with a regular-expression analyzer that does not understand annotations: `users: [] as { name: string }[]` leaves `users.*.name` unresolvable, so a real typo is only a warning and a correct binding gets a false one.

`@wcstack/typescript` closes that gap with one command. `wcs-schema` compiles the state file with the TypeScript compiler API and writes the sidecar `wcstack.manifest.json` `stateSchema` that the validator consumes — in CI and in every editor. The manifest is a **derived artifact**: the type stays the source of truth, and `wcs-schema check` fails CI when they drift.

```bash
npm install -D @wcstack/typescript typescript@6
npx wcs-schema emit src/state.ts          # writes ./wcstack.manifest.json
npx wcs-validate --strict index.html      # typos are now errors, false warnings are gone
```

Zero runtime dependencies. `typescript` is a peer dependency — the project's own compiler is used. It must be TypeScript 5 or 6: TypeScript 7 publishes no JavaScript compiler API (`typescript` exports only its version, and there is no `typescript/lib/tsc.js`) for either command to call.

## Commands

### `wcs-schema emit <state.ts|state.js> [options]`

Generates the manifest's single `stateSchema` (`schemaVersion` 2) from the file's `export default` (a `defineState(...)` call is unwrapped syntactically, so the package does not even need to resolve `@wcstack/state`). The result is run through the validator core's own manifest check before anything is written.

A top-level spread brings its type's keys in: `{ ...defaults(), get total() { … } }` lists what `defaults()` is typed to return. Since 4.4, a spread whose type does not list its keys — an index signature (`Record<string, unknown>`), `any`, `unknown` — makes the schema open (`{}`, with a warning): the compiler drops an index signature from a spread, and a schema of the literal's own keys would make every key of the spread `wcs/path-nonexistent`. Type the expression instead. When the keys come from a table, derive the type from the table, so they are still declared once:

```javascript
export const FIELDS = /** @type {const} */ ({ total: { type: "amount" }, married: { type: "flag" } });
/**
 * @typedef {{ amount: number, flag: boolean }} ValueOf
 * @typedef {{ -readonly [K in keyof typeof FIELDS]: ValueOf[(typeof FIELDS)[K]["type"]] }} Inputs
 * @returns {Inputs}
 */
export const defaults = () => /** @type {Inputs} */ (Object.fromEntries(
  /** @type {(keyof typeof FIELDS)[]} */ (Object.keys(FIELDS)).map((k) => [k, FIELDS[k].type === "flag" ? false : 0])));
```

Since 4.4, the command runs on a worker thread with a large stack: the TypeScript checker recurses once per getter that reads `this` in a literal with a spread, and a state of a hundred getters ran out of the main thread's. Called from the API (`generateStateSchema()`), such a state may throw `the TypeScript checker ran out of stack`; call it on a worker with a larger `resourceLimits.stackSizeMb`.

| Option | Description |
|---|---|
| `--mount=<path>` | Emit only the subtree at this mount path — the type file of a `<wcs-state mount="…">` volume merges as a subtree of the single tree. Omit for the root state file |
| `--out=<path>` | Output manifest, relative to the working directory (default `wcstack.manifest.json`). `--out=-` prints to stdout. Since 4.26, missing directories are created |
| `--merge` | Keep everything else in an existing manifest (`filters`, `listContexts`, other subtrees) and replace only the slot being written — the whole `stateSchema`, or the subtree at `--mount`. A hand-written schema in that slot is replaced, not merged |
| `--state-source=<path>` | Since 4.26: the file the page's root `<wcs-state src>` names, when it is not the state file itself — a build's output, such as `public/state.js` compiled from `src/state.ts`. It is recorded as `stateSource` in place of the state file (see below). Give `check` the same option. Not with `--mount` |
| `--tsconfig=<path>` | `tsconfig.json` to compile with (default: the nearest one above the state file, else built-in defaults) |
| `--max-depth=<n>` | Object nesting depth at which the schema stops with a bare `{}` (default `5`, the validator's own budget) |

Exit codes: `0` written · `2` usage error, unreadable file, syntax error, or a generated manifest that failed its self-check.

Since 4.26, a root emit (no `--mount`) also records the file the schema comes from: `stateSource` in the application namespace, the state file's path relative to the manifest's directory, with forward slashes (`"src/state/app.ts"`; relative to the working directory with `--out=-`). The validator applies the schema only to the pages whose root `<wcs-state src>` is that file (the `.js` of the same path counts as the same file). So one `wcstack.manifest.json` at the project root, where `wcs-validate` and the VS Code extension discover it, serves an app with several pages: a page with an inline state or another `src` is checked against its own script, not against this schema. When the page loads a build's output from another path (`tsc --outDir`), name that file with `--state-source`, or the schema reaches no page. A `--mount` emit leaves `stateSource` as it is. A manifest without one (written by 4.25 or earlier) still applies to every page under it; `wcs-schema emit <state file> --merge` records it.

### `wcs-schema check <state.ts|state.js> [options]`

Regenerates the schema and compares it with `--manifest=<path>` (default `wcstack.manifest.json`), key order ignored. Since 4.31, so is the order of an `enum`'s values and of an `anyOf`'s members: TypeScript lists a union in the order it first made its types, and an edit elsewhere in the state file reordered an `enum` with the same values.

Exit codes: `0` up to date · `1` drift (each change is listed as a JSON pointer: `+` only in the type, `-` only in the manifest, `~` different) · `2` usage error, missing manifest, or the state has no `stateSchema` yet.

Since 4.26, `check` also compares `stateSource` with the state file (or `--state-source`): a manifest that names another file is drift (`~ stateSource`, exit `1`), because the validator would apply the schema to that file's pages and not to this one's — a state file moved or renamed without regenerating. A manifest without `stateSource` is still up to date; `check` adds a note.

The recommended CI gate is

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

**A tree with volumes.** Since 4.28, `emit --mount=<path>` records the mount path in the manifest (`stateMounts` in the application namespace). The root's `check` then compares the tree without the recorded subtrees — each volume is checked with its own `--mount` — and a root `emit --merge` keeps them. So the gate for a root and two volumes is

```bash
npx wcs-schema check src/state/app.ts \
  && npx wcs-schema check src/state/map.ts --mount=map \
  && npx wcs-schema check src/state/cart.ts --mount=cart \
  && npx wcs-validate --strict index.html
```

Up to 4.27, `check` on the root listed every key of every volume as drift and exited `1`, and the `emit --merge` it suggested replaced the whole tree, volumes included. A manifest whose volumes were merged by an earlier version has no `stateMounts`: emit each volume once more.

### `wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]`

`tsc` over `.html`: every `<wcs-state>` inline `<script type="module">` is type-checked through the same language plugin the VS Code extension uses (typed `this`, automatic `defineState` wrap, `@wcstack/state` imports stripped whether bare or a CDN URL), and diagnostics point into the HTML:

```bash
npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0   # optional peers, only wcs-tsc needs them
npx wcs-tsc --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<…>'. Did you mean 'count'?
```

The script is checked as JavaScript, which is what the browser runs (Since 4.26; up to 4.25 it was read as TypeScript): JSDoc types count (`/** @type {Item[]} */ items: []`, `/** @param {number} n */`, `/** @typedef {import("./api").Item} Item */`), and TypeScript syntax — a type annotation, `as`, `import type` — is an error where it stands (`index.html(5,14): error TS8010: Type annotations can only be used in TypeScript files.`), as it would be a `SyntaxError` in the browser. The check is on whatever `checkJs` says. `$on` handlers get typed parameters and `this.$command` is narrowed to `$commandTokens`, as with `defineState` ([define-state.md](../state/docs/define-state.md)).

| Option | Description |
|---|---|
| `--url-imports=any` (default) | Every `http(s)://` module import types as `any` — buildless pages import from a CDN that tsc cannot resolve |
| `--url-imports=error` | Leave URL imports alone (TS2307 each) |
| `--wcs-defaults` | If the project tsconfig leaves the pages out or sets no ES2015+ `target` / `lib`, run with a temporary config that extends it and adds `include: "**/*.html"` (and `target`) — otherwise only a warning is printed |
| anything else | passed to tsc verbatim (`-p`, `--noEmit`, …) |

The tsconfig needs only to reach the pages and to target ES2015 or later. Since 4.26, `noImplicitThis`, `allowJs` and `checkJs` are not needed for the HTML (JavaScript types an object literal's `this` without `noImplicitThis`; the plugin turns the check on), and the audit no longer asks for them. When pages with an inline `<wcs-state>` lie under the tsconfig's directory and none of them is in the program — `include: ["src"]` and a page beside the tsconfig — the warning names them: `wcs-tsc: warning: …/tsconfig.json is missing include: "**/*.html" (no page with an inline <wcs-state> is in the program: counter.html is not) — HTML may not be checked; …` (the `warning:` prefix since 4.26, so a CI log filter on `error|warning` keeps it). The warning does not change the exit code; pass `--wcs-defaults` in CI to check the pages anyway. Turn on `strict` (at least `noImplicitAny`) for the full check: without it, JavaScript's object literals are open, so a misspelt property of an object inside an array (`this.items[0].nmae`) is not reported — `this.coutn` still is.

Exit codes are tsc's (`0` clean, non-zero with diagnostics); `2` when `typescript` / `@volar/typescript` cannot be resolved or an option is invalid. A page with several `<wcs-state>` blocks is combined into one virtual module (imports hoisted, each block in its own scope); a page without inline state is an empty module. The mechanism is vue-tsc's: `@volar/typescript`'s `runTsc` patches the project's own `typescript/lib/tsc.js`.

## Building with Vite

Since 4.26, `@wcstack/typescript/vite` is a Vite plugin for pages written with wcstack tags:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wcstack } from "@wcstack/typescript/vite";

export default defineConfig({
  plugins: [wcstack()],
});
```

- **`<wcs-state src="./src/state.ts">`.** `@wcstack/state` loads the file with `import(src)` at run time, so Vite never sees it: the dev server serves it on request, but `vite build` keeps the attribute as it is and emits no file, and production 404s its state. With the plugin, the build emits the file of every local `src` of a `<wcs-state>` (the root state and `mount` volumes) as a chunk of its own, keeping its `export default` and sharing modules with the page's bundle, and rewrites the attribute to that file's URL under `base`. A `src` is resolved as the page resolves it: against the page, or its `<base href>`. A `.json` state is emitted as an asset, a file of `public/` stays as it is, an external URL is left alone, and a `src` with no file behind it fails the build, naming it.
- **Inline scripts.** Vite moves every inline `<script type="module">` out of the page into its bundle, in dev and in the build. The one inside a `<wcs-state>` (the state) or a `<wcs-guard-handler>` (the guard) is read by its element, so the plugin keeps it in the page: it needs no `vite-ignore`.

In dev the plugin changes a `src` only where Vite changes a `<script src>`: an absolute path gets the `base`, and on a deep URL served by the SPA fallback a relative one becomes absolute (not on a page with a `<base>`). A page that renames the tags passes them: `wcstack({ tagNames: { state: "app-state", guardHandler: "app-guard" } })`. `vite` (6 or later) is an optional peer dependency: the plugin imports only its types.

## What the generated schema contains

Only the JSON-Schema subset the sidecar spec allows (`type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`):

| TypeScript | stateSchema |
|---|---|
| `string` / `number` / `boolean` / `null` | `{ "type": … }` (`integer`-less: numbers are `number`) |
| `"a" \| "b"`, `1 \| 2` | `{ "type": "string", "enum": ["a", "b"] }` — since 4.31, in a fixed order (by value), as are the members of an `anyOf` |
| `T[]`, `readonly T[]`, tuples | `{ "type": "array", "items": … }` |
| `T \| null` | `{ "anyOf": [T, { "type": "null" }] }` |
| `T \| undefined`, `x?: T` | `T`, and `x` is left out of `required` |
| `A \| B` (objects or mixed primitives) | `{ "anyOf": [A, B] }` |
| object literals, interfaces, classes from your code | `{ "type": "object", "properties": …, "required": … }` |
| `Date`, `Map`, `Set`, DOM types, anything from a library, `any`, `unknown`, `Record<string, T>`, an object type with an index signature (`{ [year: number]: T }`, `{ [key: string]: T }`) | a **bare `{}`** |
| `get x(): T` | `x: T` — getters are members |
| `get "users.*.ageCategory"(): string` | injected as `users.items.properties.ageCategory` — a path getter is a member at the path it computes; since 4.31, one declared for several paths (`get "users.*.full,staff.*.full"()`) at each of them (it was dropped) |
| methods, function-valued properties, `$`-prefixed keys (`$watch`, `$commandTokens`, …) | dropped |
| nesting deeper than `--max-depth` | a bare `{}` |

The bare `{}` matters: the validator treats it as *unknown* and stays silent below it, whereas a typed object that lacks a member is *nonexistent* and an **error**. A `Date` or a `Record<string, unknown>` therefore never produces false errors for the paths under it.

A list that starts empty with no type (`dependents: []`) gets `items: {}`: the schema says nothing about its rows, not even the row getters declared under it. Since 4.31, `emit` and `check` name each such list in a warning, and the lint checks the paths under it as it would without a schema (before, adding the schema made a misspelt `.deductio` under such a list pass without a word). Give the list a type that lists its fields: `/** @type {{ kind: string, income: number }[]} */ dependents: []`.

## Library API

```ts
import { generateStateSchema, buildManifest, compareStateSchema } from "@wcstack/typescript";

const { schema, warnings } = generateStateSchema("src/state.ts");   // { tsconfig?, maxDepth? }
// (mount path or null for the root, schema, existing manifest object?, stateSource?)
const manifest = buildManifest(null, schema, undefined, "src/state.ts");
const result = compareStateSchema(JSON.stringify(manifest), null, schema, "src/state.ts"); // { kind: "same" } | { kind: "differs", changes, stateSource? } | …
```

`loadStateFile` / `stateTypeToSchema` expose the two halves (compiler program, type → schema) for tools that want to compose them differently.

## Where this fits

- The validator side — discovery of the nearest `wcstack.manifest.json`, `wcs/path-nonexistent`, `wcs/path-type-mismatch` — is documented in [`@wcstack/lint`](../lint/README.md#declaring-a-state-contract-stateschema) and normatively in [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md).
- The full TypeScript story for wcstack apps (typing `this` with `defineState`, this package, tag name maps, `wcs-tsc`) is collected in [`docs/typescript.md`](https://github.com/wcstack/wcstack/blob/main/docs/typescript.md).

## License

MIT
