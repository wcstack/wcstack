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

## 3. Typed element lookups: `HTMLElementTagNameMap` — *planned (Phase 3)*

Each component package will augment `HTMLElementTagNameMap` with its default tag names, so `document.querySelector("wcs-fetch")` is a `WcsFetch`. The augmentation lives in the package's own `.d.ts`; it takes effect only once the package's types are in your program — `import "@wcstack/fetch"` (a side-effect import) or a `types` entry in `tsconfig.json`. A page that only loads `https://esm.run/@wcstack/fetch/auto` gains nothing here.

## 4. Type-checking inline state scripts: `wcs-tsc` — *planned (Phase 5)*

`wcs-tsc` (also in `@wcstack/typescript`) will run `tsc` over `.html` files, mapping each `<wcs-state>` inline `<script type="module">` through the same virtual-code plugin the VS Code extension uses, so `this.coutn++` fails CI with a `file.html:line:col TS2339`. It requires `"include": ["**/*.html"]` in `tsconfig.json`, and `@volar/typescript` as an optional peer.
