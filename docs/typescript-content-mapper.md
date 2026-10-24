# `<wcs-state>` under TypeScript 7: a content mapper

**日本語版**: [typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md)

- **Status**: design, not implemented. Written 2026-10-24 against TypeScript 7.1.0-beta (released 2026-10-20; an RC is expected about a month later). Every figure below comes from a prototype run outside the repository on that beta. The decisions in §8 are the author's.
- **Audience**: whoever implements TypeScript 7 support in `@wcstack/typescript` and `packages/vscode-wcs`, and the author deciding whether and when to.
- **Shipped so far**: 4.6.1 refuses TypeScript 7 by name (peer `typescript >=5.0 <7`, both commands exit 2 naming the version). 4.6.2 checks getter bodies (§5.3), which the mapper inherits unchanged.

## 1. Why: TypeScript 7 removed what `wcs-tsc` and `wcs-schema` stand on

TypeScript 7 is the native (Go) compiler. Its npm package publishes no JavaScript compiler API: the root export of `typescript` 7.0.2 and 7.1.0-beta is `./lib/version.cjs` (`{ version, versionMajorMinor }`), and `exports` has no `./lib/tsc`.

| Tool | How it works on 5 / 6 | On 7 |
|---|---|---|
| `wcs-tsc` | vue-tsc's mechanism: `@volar/typescript`'s `runTsc` patches the project's `typescript/lib/tsc.js` so tsc accepts `.html` and builds the program through the language plugin ([typescript.md](./typescript.md) §4) | no `lib/tsc.js` to patch |
| `wcs-schema` / `loadStateFile` | `import ts from "typescript"`, then `createProgram` and the checker | no `createProgram`, no checker |
| VS Code extension | bundles TypeScript 5.9 and Volar 2.4 | unaffected: it never loads the project's TypeScript |

`npm i -D typescript` installs 7 now, so a new project meets this on its first install. 4.6.1 says so instead of failing on what is missing; nothing yet type-checks `<wcs-state>` under 7.

TypeScript 7.1 brings two replacements: **content mappers** for the first row (this document) and a new **programmatic API** (`typescript/sync`, `typescript/async`) for the second (§7).

## 2. What a content mapper is

A content mapper ([microsoft/typescript-go#4712](https://github.com/microsoft/typescript-go/pull/4712), merged 2026-08-19) lets TypeScript include a file type it does not understand. The mapper turns the file's text into TypeScript and maps spans between the two; TypeScript checks the TypeScript and reports in the original file. It is Volar's model made a TypeScript feature: Vue, Svelte, Astro, MDX, Ember and CSS Modules have prototypes.

- **Configuration**, in the project's `tsconfig.json`:
  ```jsonc
  {
    "include": ["src"],                       // takes the mapped extensions as well
    "contentMappers": [
      { "package": "@wcstack/typescript", "extensions": [".html"], "options": { } }
    ]
  }
  ```
  `package` is resolved as a Node module. Its `package.json` declares the mapper under a top-level `typescript` field: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`. `exec` is any command; `compilerOptions` (the options the transform reads) and `dynamicConfig` are optional.
- **Protocol**: TypeScript spawns the mapper and speaks JSON-RPC over stdio (`Content-Length` framing). TypeScript sends every request: `initialize` (pick `utf-8` or `utf-16` positions, name the diagnostic source), `openProject` (an opaque project handle, the entry's `options`, the effective compiler options), `transform` (`fileName`, `content`) and `closeProject`. One process serves every project that uses the same package and version.
- **`transform` returns** a canonical output and, optionally, `supplemental` outputs (`{ text, extension, mappings }`). A supplemental output is a file in the same program that cannot be imported; this is how one file contributes several scripts. A span mapping is `[virtualStart, virtualLength, originalStart, originalLength, kind, features?]`, where `kind` is `Verbatim` (identical text), `Atom` or `Alias`, and `features` is a bit mask of the language-service features that may use the span. Text outside every span is synthesized.
- **Permission**: `tsc` refuses `contentMappers` without `--runExternalCode` (TS18068), since a mapper is an arbitrary executable. The language server runs mappers only when the client passes `runExternalCode: true` in the LSP `initializationOptions` (VS Code does so in trusted workspaces); `tsc --lsp` has no such command-line flag. In VS Code, `js/ts.contentMappers.enabled` turns the feature off.
- **Diagnostics** map back through spans. One in synthesized text is not dropped (unlike Volar): the CLI prints it with a snippet of the generated code. Declared-but-unused diagnostics in synthesized text are suppressed. Diagnostics cannot be filtered by code; `diagnosticDirectives` (expect / ignore over a virtual range) is the only suppression.
- **Editor activation**: a VS Code extension calls `registerContentMappers(contributorId, [{ extensions, inferredProjectContribution? }])` on the TypeScript 7 extension (`TypeScriptTeam.native-preview`), so `.html` files reach TypeScript's server before a `tsconfig.json` names the mapper; the `inferredProjectContribution` brings a manifest for files outside any configured project. `registerLspMiddleware` can rewrite the server's responses.
- **Emit**: mapped files are not emitted to JavaScript. With `--declaration`, `App.svelte` emits `App.d.svelte.ts` (and `App.svelte.0.d.ts` … for supplemental outputs). Declaration maps are not supported.
- **Incremental**: `--incremental`, `--build` and `--watch` work. A static mapper's identity is its package name and version, its `options` and the compiler options it lists, so a changed transform needs a version bump.

## 3. What the prototype measured

The prototype was a mapper of about 100 lines that wraps `dist/tsc-core.cjs` — the same `createWcsLanguagePlugin` that `wcs-tsc` and the extension use — and translates its Volar `VirtualCode` into the protocol: the canonical output is `export {};`, and each `<wcs-state>` block is one supplemental output (the language-server-mode virtual code: preamble, `defineState` wrap, `@wcstack/state` import removed).

| Question | Result |
|---|---|
| Can a mapper claim `.html`? | Yes. A page without `<wcs-state>` is `export {};`: its markup is never read as TypeScript. (The upstream HTML sample claims `.dhtml`, to stay out of VS Code's HTML; see §6.) |
| Do Volar's mappings carry over? | Not as they are. TypeScript compares every `Verbatim` span with the original text and refuses a difference (TS18073). The plugin maps a whole block in one span after blanking the `@wcstack/state` import, which Volar tolerates. Splitting each span into its equal runs, with the differing runs left unmapped, passes. |
| Several `<wcs-state>` on one page | One supplemental output each. They are separate files, so two blocks declaring `const helper` do not collide — the tsc-mode combining (`buildCombinedScript`: one module, hoisted imports, block scopes) is not needed. |
| Parity with `wcs-tsc` | Over the 33 pages of `examples/` (CI's `examples/tsconfig.wcs-tsc.json`), the mapper on 7.1 and `wcs-tsc` on 5.9 report the same diagnostics at the same positions: 23 before 4.6.2, 25 with it. Multi-byte text between blocks maps correctly (`utf-16` positions). |
| `--url-imports=any` | A supplemental output with `declare module "https://*"; declare module "http://*";` (a global script) types CDN imports as `any`; without it they are TS2307. Every page may declare it. |
| The language server | `tsc --lsp --stdio` with `initializationOptions: { runExternalCode: true }` answers hover, definition (into the right block) and diagnostics in the `.html`, at HTML positions. Without the option it answers nothing for `.html`. |
| Speed | The 33 pages took about 1.0 s on 7.1 against 1.6 s for `wcs-tsc` on 5.9, start-up included. |

## 4. Design

### 4.1 Package

The mapper ships in `@wcstack/typescript`, the package that already owns `wcs-tsc` and `wcs-schema`:

- `package.json`: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`. No `compilerOptions` (the transform reads none) and no `dynamicConfig`, so the identity is static and `--build` decides without starting the process.
- `dist/content-mapper.cjs` is built like `tsc-core.cjs`: esbuild bundles it from `packages/vscode-wcs` (the plugin's canonical home) and `scripts/build-schema-core.mjs` copies it. It uses Node's built-ins only, so the package keeps zero runtime dependencies; under 7 it needs neither `typescript` at run time nor Volar.
- The project writes `{ "package": "@wcstack/typescript", "extensions": [".html"] }`. Options (validated in `openProject`, reported through `optionDiagnostics`):
  - `stateTagName` (default `wcs-state`), as the extension's `wcstack.stateTagName`;
  - `urlImports`: `"any"` (default) or `"error"`, as `wcs-tsc --url-imports`.

### 4.2 Transform

For each file, `transform` returns:

1. **Canonical**: `export {};` with extension `.ts` and no mappings.
2. **One supplemental output per `<wcs-state>` block**: the language-server-mode virtual code — the preamble once per block, the user code with the `@wcstack/state` import removed, `export default {…}` wrapped in `defineState(…)`, and `: any` after each getter that reads `this` (§5.3). Extension `.ts`.
3. **With `urlImports: "any"`**: one more supplemental output, the two shorthand ambient module declarations.

Mappings are built by the plugin's `VirtualCodeBuilder`, which already separates inserted text from user code. The mapper emits each user-code piece as one `Verbatim` span with the default `features` (all), after checking that the piece equals the original text. The preamble, `defineState(`, `)`, `: any` and the blanked import are synthesized. A blanked import must become a gap, not a span: its text no longer matches (§3).

Positions: take `utf-16` when TypeScript offers it (JavaScript string offsets, what the plugin computes); otherwise convert both sides to `utf-8`.

### 4.3 Reusing the plugin

The plugin stays the single definition of the virtual code ([typescript.md](./typescript.md) §4: what the editor underlines is what CI reports). The mapper is a third consumer next to the Volar language server and `runTsc`:

- `createWcsLanguagePlugin` (language-server mode) gives the per-block virtual codes; the mapper only reframes them. The tsc mode and `buildCombinedScript` remain for `wcs-tsc` on 5 / 6.
- A shared test asserts, for every example page, that every `Verbatim` span the mapper emits equals the original text — the check TypeScript makes at run time (TS18073).

### 4.4 Failures

A block that does not parse is still mapped; TypeScript reports the syntax error at its HTML position. A crash or a protocol error makes TypeScript report it and read the file as empty; after five failures in a project it stops calling the mapper. The mapper therefore never throws out of `transform`. A request it cannot serve (an unknown project handle) is a JSON-RPC error.

### 4.5 The preamble in synthesized text

Under Volar a diagnostic in the preamble was dropped. Under a content mapper it is printed with a snippet of the preamble. The preamble must therefore be clean under every option a project may set: `strict`, `noImplicitAny`, `noUnusedLocals` (unused declarations in synthesized text are suppressed, but other checks are not), `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, the `lib` / `target` combinations `wcs-tsc` accepts. Add a matrix test over those options.

## 5. The CLI

### 5.1 Running it

```bash
npm i -D @wcstack/typescript typescript@^7.1
npx tsc --noEmit --runExternalCode
```

`--runExternalCode` is required and is the user's to give. A project with `declaration: true` would emit `index.d.html.ts` and the supplemental `.d.ts` files for every page: recommend `noEmit` for the pages (or a separate tsconfig).

### 5.2 `wcs-tsc` on 7

`wcs-tsc` can keep one command for both worlds. On 5 / 6 it does what it does now; on 7.1 and later it runs the project's `tsc` with `--runExternalCode` and a temporary config that extends the user's and adds the `contentMappers` entry (the way `--wcs-defaults` adds options today), passing `--url-imports` as the mapper's option. On 7.0, which has no mappers, it keeps the 4.6.1 refusal. The user's tsconfig then needs no change, and CI scripts keep `npx wcs-tsc`.

### 5.3 Getters (shipped in 4.6.2)

`defineState<T>(def: T & ThisType<…T…>)` infers `T` from the object literal. A getter with no return type annotation is typed from its body, and a body that reads `this` brings the inference back to `T`: TypeScript types that getter `any` and keeps the `this` in its body as `any` too. So `get first() { return this.items[0].nmae; }` was not reported, and under `strict` a callback in a getter (`this.items.filter((i) => …)`) was an implicit `any` (TS7006). Methods are not affected. The behavior is TypeScript's (5.9 and 7.1 alike) and is documented for `.ts` state files in [define-state.md](../packages/state/docs/define-state.md#getters-with-an-inferred-return-type).

An inline script is JavaScript, so its author cannot annotate. From 4.6.2 the plugin inserts `: any` after the parameter list of every top-level getter of the state object that reads `this` (`src/language/getterAnnotations.ts`, acorn). The inserted text is unmapped; the getter's type was `any` already, so nothing is lost, and the body is checked against the inferred `this`. The mapper inherits it: on 7.1 it reports the getter typo at the same HTML position as `wcs-tsc`.

## 6. The editor

The extension does not need TypeScript 7 and keeps working. The question is what happens beside it.

- **Overlap.** In a trusted workspace whose tsconfig names the mapper, TypeScript 7's server also serves the `.html` (§3): its diagnostics and hovers appear next to the extension's. Diagnostics cannot be disabled per span (§2), so the mapper cannot stay quiet in the editor and speak in the CLI from one tsconfig.
- **Option A — keep Volar, step aside (recommended first).** The extension detects that TypeScript 7's extension is active and that the workspace's tsconfig names `@wcstack/typescript` for `.html`. It then stops providing TypeScript features for `<wcs-state>` scripts (the Volar TypeScript service plugins) and keeps everything `data-wcs` (validators, completion, navigation, lenses), which never used the TypeScript service. Until then, the README tells users of both to set `js/ts.contentMappers.enabled: false`.
- **Option B — delegate (later).** The extension calls `registerContentMappers("wcstack.wcstack-intellisense", [{ extensions: [".html"], inferredProjectContribution: { manifest } }])` with the bundled mapper (or the workspace's `@wcstack/typescript`), and drops the bundled TypeScript and Volar's TypeScript plugins. The extension shrinks to `data-wcs`. It needs TypeScript 7's extension installed and is right only once that is VS Code's default.
- **VS Code's HTML.** The built-in HTML language server already offers JavaScript features inside `<script>`. Under Option B, three providers may answer in one `<script>`: the HTML server, TypeScript 7 and the extension. The upstream sample avoided the question by naming its files `.dhtml`. Measure it before choosing B.

## 7. `wcs-schema` is a separate port

Content mappers do not touch `wcs-schema`: it reads a `.ts` / `.js` state file through the checker. TypeScript 7.1's `typescript/sync` API has the checker calls it uses (`getPropertiesOfType`, `getTypeOfSymbolAtLocation`, `isArrayType`, `isTupleType`, `getTypeArguments`, `getIndexInfosOfType`, `typeToString`, `getCallSignatures`). Its objects are `Disposable` and talk to the native compiler over IPC, and it calls itself unstable. Porting means a second implementation of `program.ts` / `typeToSchema.ts` over that API, chosen by the installed major version. Plan it after the API leaves preview.

## 8. Decisions for the author

1. **When.** Build the mapper while 7.1 is in beta (the protocol changed after the PR merged, [microsoft/TypeScript#63936](https://github.com/microsoft/TypeScript/pull/63936)) or after 7.1 is stable. Recommended: prototype in a branch now and ship after the stable release, marked experimental for one minor.
2. **The peer range** once the mapper ships: `typescript: ">=5.0 <7 || >=7.1"`, with each command checking the version it needs (`wcs-schema` stays 5 / 6 until §7).
3. **The CLI shape**: `wcs-tsc` running `tsc --runExternalCode` itself (§5.2), or a documented `tsc` invocation only. Recommended: both — `wcs-tsc` for continuity, `tsc` documented.
4. **The editor**: Option A with detection now; Option B when TypeScript 7's extension is VS Code's default (§6).
5. **The options** (`stateTagName`, `urlImports`) and their defaults.

## 9. Test plan

- **Unit** (vscode-wcs): the transform's outputs for the plugin's fixtures; every `Verbatim` span equals the original text; positions in `utf-8` and `utf-16`; the protocol (initialize → openProject → transform → closeProject, two project handles in one process, an unknown handle, malformed input).
- **Parity** (CI, non-gating first, like the `wcs-tsc` job): `tsc --runExternalCode` on `typescript@7.1` over `examples/` produces exactly what `wcs-tsc` on 5.9 produces.
- **Option matrix**: the preamble is clean under the options of §4.5.
- **Language server smoke**: `tsc --lsp --stdio` with `runExternalCode` answers hover, definition and diagnostics in a fixture page; without it, nothing.
- **Editor**: Option A's detection, by hand in VS Code with both extensions installed.

## 10. References

- [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [microsoft/typescript-go#4712 — Content mappers](https://github.com/microsoft/typescript-go/pull/4712) (the protocol, span maps, LSP activation, emit, incremental)
- [microsoft/TypeScript#63800 — API usage patterns for complex editor extensions](https://github.com/microsoft/TypeScript/issues/63800)
- [DanielRosenwasser/content-mapper-sample](https://github.com/DanielRosenwasser/content-mapper-sample) (an HTML mapper for `<script>` and event handler attributes)
- [typescript.md](./typescript.md) §4 — `wcs-tsc` and the language plugin today
