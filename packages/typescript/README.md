# @wcstack/typescript

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if the types you already wrote for your state reached the HTML that binds to it?**

`@wcstack/state` pages bind DOM to state through path strings (`users.*.name`). A TypeScript state file already knows every one of those paths and its type — but HTML cannot consume a `.d.ts`, and the static validator (`wcs-validate`, the VS Code extension) reads the inline script with a regular-expression analyzer that does not understand annotations: `users: [] as { name: string }[]` leaves `users.*.name` unresolvable, so a real typo is only a warning and a correct binding gets a false one.

`@wcstack/typescript` closes that gap with one command. `wcs-schema` compiles the state file with the TypeScript compiler API and writes the sidecar `wcstack.manifest.json` `stateSchema` that the validator consumes — in CI and in every editor. The manifest is a **derived artifact**: the type stays the source of truth, and `wcs-schema check` fails CI when they drift.

```bash
npm install -D @wcstack/typescript typescript
npx wcs-schema emit src/state.ts          # writes ./wcstack.manifest.json
npx wcs-validate --strict index.html      # typos are now errors, false warnings are gone
```

Zero runtime dependencies. `typescript` is a peer dependency — the project's own compiler is used.

## Commands

### `wcs-schema emit <state.ts|state.js> [options]`

Generates `states[<name>].stateSchema` from the file's `export default` (a `defineState(...)` call is unwrapped syntactically, so the package does not even need to resolve `@wcstack/state`). The result is run through the validator core's own manifest check before anything is written.

| Option | Description |
|---|---|
| `--state=<name>` | State name (default `default`) |
| `--out=<path>` | Output manifest, relative to the working directory (default `wcstack.manifest.json`). `--out=-` prints to stdout |
| `--merge` | Keep everything else in an existing manifest (other states, `filters`, `listContexts`) and replace only this state's `stateSchema`. A hand-written schema for the same state is replaced, not merged |
| `--tsconfig=<path>` | `tsconfig.json` to compile with (default: the nearest one above the state file, else built-in defaults) |
| `--max-depth=<n>` | Object nesting depth at which the schema stops with a bare `{}` (default `5`, the validator's own budget) |

Exit codes: `0` written · `2` usage error, unreadable file, syntax error, or a generated manifest that failed its self-check.

### `wcs-schema check <state.ts|state.js> [options]`

Regenerates the schema and compares it with `--manifest=<path>` (default `wcstack.manifest.json`), key order ignored.

Exit codes: `0` up to date · `1` drift (each change is listed as a JSON pointer: `+` only in the type, `-` only in the manifest, `~` different) · `2` usage error, missing manifest, or the state has no `stateSchema` yet.

The recommended CI gate is

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

### `wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]`

`tsc` over `.html`: every `<wcs-state>` inline `<script type="module">` is type-checked through the same language plugin the VS Code extension uses (typed `this`, automatic `defineState` wrap, `@wcstack/state` imports stripped whether bare or a CDN URL), and diagnostics point into the HTML:

```bash
npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0   # optional peers, only wcs-tsc needs them
npx wcs-tsc --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<…>'. Did you mean 'count'?
```

| Option | Description |
|---|---|
| `--url-imports=any` (default) | Every `http(s)://` module import types as `any` — buildless pages import from a CDN that tsc cannot resolve |
| `--url-imports=error` | Leave URL imports alone (TS2307 each) |
| `--wcs-defaults` | If the project tsconfig lacks `include` covering `**/*.html`, `noImplicitThis`, `allowJs` or `checkJs`, run with a temporary config that extends it and adds them (otherwise only a warning is printed and HTML may go unchecked) |
| anything else | passed to tsc verbatim (`-p`, `--noEmit`, …) |

Exit codes are tsc's (`0` clean, non-zero with diagnostics); `2` when `typescript` / `@volar/typescript` cannot be resolved or an option is invalid. A page with several `<wcs-state>` blocks is combined into one virtual module (imports hoisted, each block in its own scope); a page without inline state is an empty module. The mechanism is vue-tsc's: `@volar/typescript`'s `runTsc` patches the project's own `typescript/lib/tsc.js`.

## What the generated schema contains

Only the JSON-Schema subset the sidecar spec allows (`type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`):

| TypeScript | stateSchema |
|---|---|
| `string` / `number` / `boolean` / `null` | `{ "type": … }` (`integer`-less: numbers are `number`) |
| `"a" \| "b"`, `1 \| 2` | `{ "type": "string", "enum": ["a", "b"] }` |
| `T[]`, `readonly T[]`, tuples | `{ "type": "array", "items": … }` |
| `T \| null` | `{ "anyOf": [T, { "type": "null" }] }` |
| `T \| undefined`, `x?: T` | `T`, and `x` is left out of `required` |
| `A \| B` (objects or mixed primitives) | `{ "anyOf": [A, B] }` |
| object literals, interfaces, classes from your code | `{ "type": "object", "properties": …, "required": … }` |
| `Date`, `Map`, `Set`, DOM types, anything from a library, `any`, `unknown`, `Record<string, T>` | a **bare `{}`** |
| `get x(): T` | `x: T` — getters are members |
| `get "users.*.ageCategory"(): string` | injected as `users.items.properties.ageCategory` — a path getter is a member at the path it computes |
| methods, function-valued properties, `$`-prefixed keys (`$watch`, `$commandTokens`, …) | dropped |
| nesting deeper than `--max-depth` | a bare `{}` |

The bare `{}` matters: the validator treats it as *unknown* and stays silent below it, whereas a typed object that lacks a member is *nonexistent* and an **error**. A `Date` or a `Record<string, unknown>` therefore never produces false errors for the paths under it.

## Library API

```ts
import { generateStateSchema, buildManifest, compareStateSchema } from "@wcstack/typescript";

const { schema, warnings } = generateStateSchema("src/state.ts");   // { tsconfig?, maxDepth? }
const manifest = buildManifest("default", schema /*, existingManifestObject */);
const result = compareStateSchema(JSON.stringify(manifest), "default", schema); // { kind: "same" } | { kind: "differs", changes } | …
```

`loadStateFile` / `stateTypeToSchema` expose the two halves (compiler program, type → schema) for tools that want to compose them differently.

## Where this fits

- The validator side — discovery of the nearest `wcstack.manifest.json`, `wcs/path-nonexistent`, `wcs/path-type-mismatch` — is documented in [`@wcstack/lint`](../lint/README.md#declaring-a-state-contract-stateschema) and normatively in [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md).
- The full TypeScript story for wcstack apps (typing `this` with `defineState`, this package, tag name maps, `wcs-tsc`) is collected in [`docs/typescript.md`](https://github.com/wcstack/wcstack/blob/main/docs/typescript.md).

## License

MIT
