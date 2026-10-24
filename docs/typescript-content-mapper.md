# `<wcs-state>` under TypeScript 7: a content mapper

**日本語版**: [typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md)

- **Status**: implemented, experimental, not released (branch `feat/typescript-content-mapper`, planned for the first minor after TypeScript 7.1 is stable — §8). The design was written 2026-10-24 against TypeScript 7.1.0-beta (released 2026-10-20; an RC is expected about a month later) from a prototype outside the repository; the implementation was measured the same day on 7.1.0-beta and 7.1.0-dev.20261023.1. The decisions in §8 are the author's.
- **Audience**: whoever maintains TypeScript 7 support in `@wcstack/typescript` and `packages/vscode-wcs`, and the author deciding when to ship it.
- **Shipped so far**: 4.6.1 refuses TypeScript 7 by name (peer `typescript >=5.0 <7`, both commands exit 2 naming the version). 4.6.2 checks getter bodies (§5.3), which the mapper inherits unchanged.

## 1. Why: TypeScript 7 removed what `wcs-tsc` and `wcs-schema` stand on

TypeScript 7 is the native (Go) compiler. Its npm package publishes no JavaScript compiler API: the root export of `typescript` 7.0.2 and 7.1.0-beta is `./lib/version.cjs` (`{ version, versionMajorMinor }`), and `exports` has no `./lib/tsc`.

| Tool | How it works on 5 / 6 | On 7 |
|---|---|---|
| `wcs-tsc` | vue-tsc's mechanism: `@volar/typescript`'s `runTsc` patches the project's `typescript/lib/tsc.js` so tsc accepts `.html` and builds the program through the language plugin ([typescript.md](./typescript.md) §4) | no `lib/tsc.js` to patch |
| `wcs-schema` / `loadStateFile` | `import ts from "typescript"`, then `createProgram` and the checker | no `createProgram`, no checker |
| VS Code extension | bundles TypeScript 5.9 and Volar 2.4 | unaffected: it never loads the project's TypeScript |

`npm i -D typescript` installs 7 now, so a new project meets this on its first install. 4.6.1 says so instead of failing on what is missing.

TypeScript 7.1 brings two replacements: **content mappers** for the first row (this document) and a new **programmatic API** (`typescript/sync`, `typescript/async`) for the second (§7).

## 2. What a content mapper is

A content mapper ([microsoft/typescript-go#4712](https://github.com/microsoft/typescript-go/pull/4712), merged 2026-08-19, finished by [microsoft/TypeScript#63936](https://github.com/microsoft/TypeScript/pull/63936); the source now lives in microsoft/TypeScript's `tsc/internal/contentmapper`) lets TypeScript include a file type it does not understand. The mapper turns the file's text into TypeScript and maps spans between the two; TypeScript checks the TypeScript and reports in the original file. It is Volar's model made a TypeScript feature: Vue, Svelte, Astro, MDX, Ember and CSS Modules have prototypes.

- **Configuration**, in the project's `tsconfig.json`:
  ```jsonc
  {
    "include": ["src"],                       // takes the mapped extensions as well
    "contentMappers": [
      { "package": "@wcstack/typescript", "extensions": [".html"], "options": { } }
    ]
  }
  ```
  `package` is resolved as a Node module from the config's directory (an absolute or relative path is refused, TS18075). Its `package.json` declares the mapper under a top-level `typescript` field: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`. `exec` is any command; `compilerOptions` (the options the transform reads), `dynamicConfig` and `outputExtensions` are optional. `contentMappers` is inherited through `extends`; a config's own array replaces the inherited one, and one extension can have only one mapper (TS18067).
- **Protocol**: TypeScript spawns the mapper and speaks JSON-RPC over stdio (`Content-Length` framing). TypeScript sends every request: `initialize` (`positionEncodings` offered, an optional `locale`; the answer picks `utf-8` or `utf-16` and names the diagnostic source, which may not be `typescript`, `tsc` or a mapped extension), `openProject` (an opaque project handle, the entry's `options`, the effective compiler options; the answer may carry `optionDiagnostics`, and only a `dynamicConfig` mapper may return `configIdentity` / `watchedFiles`), `transform` (`fileName`, `content`) and `closeProject` (answered with `null`; a handle can be opened again afterwards). One process serves every project that uses the same package and version. Round 2 (#63936) removed `protocolVersion` and made every diagnostic `code` required.
- **`transform` returns** a canonical output and, optionally, `supplemental` outputs (`{ text, extension, mappings, diagnosticDirectives? }`). A supplemental output is a file in the same program that cannot be imported; this is how one file contributes several scripts. `.mts` / `.cts` / `.mjs` / `.cjs` outputs are always read as modules. A span mapping is `[virtualStart, virtualLength, originalStart, originalLength, kind, features?]` — virtual starts ascending, no overlap — where `kind` is `Verbatim` (identical text, checked character by character), `Atom` or `Alias`, and `features` is a bit mask of the language-service features that may use the span. Text outside every span is synthesized. A position may not split a code point.
- **Permission**: `tsc` refuses `contentMappers` without `--runExternalCode` (TS18068), since a mapper is an arbitrary executable. The language server runs mappers only when the client passes `runExternalCode: true` in the LSP `initializationOptions` (VS Code does so in trusted workspaces); `tsc --lsp` has no such command-line flag. In VS Code, `js/ts.contentMappers.enabled` turns the feature off.
- **Diagnostics** map back through spans. One in synthesized text is not dropped (unlike Volar): the CLI prints it with a snippet of the generated code. Declared-but-unused diagnostics in synthesized text are suppressed. Diagnostics cannot be filtered by code; `diagnosticDirectives` is the only suppression: tuples `[originalStart, originalLength, virtualStart, virtualEnd, policy]` (an end, not a length) over non-overlapping virtual ranges, policy `0` ignore or `1` expect.
- **Editor activation**: a VS Code extension calls `registerContentMappers(contributorId, [{ extensions, inferredProjectContribution? }])` on the TypeScript 7 extension (`TypeScriptTeam.native-preview`), so `.html` files reach TypeScript's server before a `tsconfig.json` names the mapper; the `inferredProjectContribution` brings a manifest for files outside any configured project. `registerLspMiddleware` can rewrite the server's responses.
- **Emit**: mapped files are not emitted to JavaScript. With `--declaration`, `App.svelte` emits `App.d.svelte.ts` (and `App.svelte.0.d.ts` … for supplemental outputs).
- **Incremental**: `--incremental`, `--build` and `--watch` work. A static mapper's identity is its package name and version, its `options` and the compiler options it lists, so a changed transform needs a version bump.

## 3. What was measured

The prototype was a mapper of about 100 lines that wrapped `dist/tsc-core.cjs` — the same `createWcsLanguagePlugin` that `wcs-tsc` and the extension use — and translated its Volar `VirtualCode` into the protocol. The implementation (§4) keeps that shape and fixes what the prototype and a review of the plan found.

| Question | Result |
|---|---|
| Can a mapper claim `.html`? | Yes. A page without `<wcs-state>` is an empty output: its markup is never read as TypeScript. (The upstream HTML sample claims `.dhtml`, to stay out of VS Code's HTML; see §6.) |
| Do Volar's mappings carry over? | Not as they were. TypeScript compares every `Verbatim` span with the original text and refuses a difference (TS18073). The plugin mapped a whole block in one span after blanking the `@wcstack/state` import, which Volar tolerates. The plugin now leaves blanked imports unmapped, so every mapping it makes is verbatim (§4.2). |
| Several `<wcs-state>` on one page | One supplemental output each. They are separate files, so two blocks declaring `const helper` do not collide — the tsc-mode combining (`buildCombinedScript`: one module, hoisted imports, block scopes) is not needed. |
| `.ts` or `.mts` outputs | `.mts`. A `.ts` output is a script when the block has neither import nor export, and its preamble's declarations then collide across pages (TS2451 / TS2393); under `module: nodenext` (what `tsc --init` writes in 7.1) without `"type": "module"`, a `.ts` output is CommonJS and every `import` / `export default` is TS1295. An inline `<script type="module">` is always an ES module, which `.mts` says. |
| CDN imports | The prototype's ambient `declare module "https://*"` supplemental breaks under `moduleDetection: force` (it becomes an augmentation, TS2664, and the imports stay TS2307). An ignore directive over each URL module specifier (TS2307 not reported; the binding is `any`) works under every setting. |
| The preamble | With `lib` lacking DOM, the preamble's `HTMLElement` was TS2304 in synthesized text, once per block. An ignore directive over the preamble's virtual range keeps Volar's behaviour (preamble diagnostics dropped). |
| Parity with `wcs-tsc` | Over the 33 pages of `examples/` (CI's `examples/tsconfig.wcs-tsc.json`), the mapper on 7.1.0-beta and on 7.1.0-dev.20261023.1 reports the same 25 diagnostics at the same positions as `wcs-tsc` on 5.9. Multi-byte text between blocks maps correctly. |
| The language server | `tsc --lsp --stdio` with `initializationOptions: { runExternalCode: true }` answers hover, definition (into the right block) and diagnostics in the `.html`, at HTML positions. Without the option it answers nothing for `.html`. |
| Speed | The 33 pages took about 1.0 s on 7.1 against 1.6 s for `wcs-tsc` on 5.9, start-up included. |

## 4. Design

### 4.1 Package

The mapper ships in `@wcstack/typescript`, the package that already owns `wcs-tsc` and `wcs-schema`:

- `package.json`: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`. No `compilerOptions` (the transform reads none) and no `dynamicConfig`, so the identity is static and `--build` decides without starting the process.
- `dist/content-mapper.cjs` is built like `tsc-core.cjs`: esbuild bundles it from `packages/vscode-wcs` (`src/contentMapperMain.ts` and `src/contentMapper/`, next to the plugin's canonical home) and `scripts/build-schema-core.mjs` copies it. It uses Node's built-ins only, so the package keeps zero runtime dependencies; under 7 it needs neither `typescript` at run time nor Volar. Option B (§6) can bundle the same file in the extension.
- The project writes `{ "package": "@wcstack/typescript", "extensions": [".html"] }`. Options, validated in `openProject` and reported through `optionDiagnostics` (`wcs1001` an unknown option, `wcs1002` a wrong value; the option then takes its default):
  - `stateTagName` (default `wcs-state`), as the extension's `wcstack.stateTagName`;
  - `urlImports`: `"any"` (default) or `"error"`, as `wcs-tsc --url-imports`.
- Messages are English; the `locale` TypeScript passes is not used (as `wcs-tsc`).

### 4.2 Transform

For each file, `transform` returns:

1. **Canonical**: an empty `.mts`, no mappings.
2. **One supplemental `.mts` output per `<wcs-state>` block**: the language-server-mode virtual code — the preamble once per block, the user code with the `@wcstack/state` import blanked, `export default {…}` wrapped in `defineState(…)`, and `: any` after each getter that reads `this` (§5.3). No synthesized `export {}`: `.mts` is a module already, and an appended statement would add errors after a block that does not parse.
3. **Diagnostic directives** on each supplemental output, policy ignore: the preamble's virtual range, and with `urlImports: "any"` the string literal of every `http(s)://` module specifier (`from "…"`, `import "…"`, `import("…")` — not `fetch("…")`).

Every mapping comes from the plugin's `VirtualCodeBuilder`, which separates inserted text from user code and leaves blanked imports (and, in the tsc mode, the hoisted imports' original places) as gaps. The mapper emits each one as a `Verbatim` span with the default `features` (all), after checking that both sides are equal; a mapping that is not would be split into its equal runs at code-point boundaries (a safety net — TypeScript would otherwise read the whole page as empty). The tests check that the net is never needed for any example page.

Positions: `utf-16` when TypeScript offers it (JavaScript string offsets, what the plugin computes); otherwise both sides are converted to `utf-8`.

### 4.3 Reusing the plugin

The plugin stays the single definition of the virtual code ([typescript.md](./typescript.md) §4: what the editor underlines is what CI reports). The mapper is a third consumer next to the Volar language server and `runTsc`:

- `createWcsLanguagePlugin` (language-server mode) gives the per-block virtual codes; the mapper only reframes them. The tsc mode and `buildCombinedScript` remain for `wcs-tsc` on 5 / 6.
- Leaving blanked imports unmapped also changes the Volar modes, harmlessly: no editor feature reached the blanked text, and a Volar edit (format, organize imports) mapped onto it could no longer rewrite the user's import. `wcs-tsc` on 5.9 reports the same 25 diagnostics over `examples/` before and after.

### 4.4 Failures

A block that does not parse is still mapped; TypeScript reports the syntax error at its HTML position. A crash or a protocol error makes TypeScript report it and read the file as empty; after five failures in a project it stops calling the mapper. The mapper therefore answers every request, an exception inside a request becoming a JSON-RPC error (-32603), and writes nothing but protocol messages to stdout (`console.log` goes to stderr). A request it cannot serve (an unknown or closed project handle, `transform` before `initialize`) is a JSON-RPC error; params of the wrong shape are -32602. When stdin closes it lets stdout drain and exits.

### 4.5 Options a project may set

What the mapper adds besides the preamble — `defineState(`, `)`, `: any` — must not report under any option a project may set. The e2e tests run a clean page under: `strict` with every stricter check (`noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`); `tsc --init`'s 7.1 settings (`module: nodenext`, `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedSideEffectImports`, `moduleDetection: force`); `nodenext` with `"type": "module"`; `lib` without DOM; and TypeScript 7's defaults (`strict`).

## 5. The CLI

### 5.1 Running it

```bash
npm i -D @wcstack/typescript typescript@^7.1
npx tsc --noEmit --runExternalCode        # with the mapper in tsconfig.json
```

`--runExternalCode` is required and is the user's to give. A project with `declaration: true` would emit declaration files for every page and its supplemental outputs: use `noEmit` for the pages (or a separate tsconfig). Type errors exit with code 2.

### 5.2 `wcs-tsc` on 7

`wcs-tsc` keeps one command for both worlds (`src/cli/wcsTscMapper.ts`). On 5 / 6 it does what it did. On 7.1 and later (prereleases included) it runs the project's `tsc` (`bin.tsc` of its `typescript/package.json`) with `--runExternalCode`:

- It first finds `@wcstack/typescript` under `node_modules` from the config's directory upwards — TypeScript resolves the mapper from there, and `tsc --showConfig` does not report a mapper it cannot resolve (the `.html` files just vanish) — and exits 2 with `npm i -D @wcstack/typescript` when there is none. A different version than the running `wcs-tsc` is a warning.
- It reads the effective `contentMappers` of the config's `extends` chain itself (TypeScript 7 has no API for it; JSONC, relative and package `extends`). When the chain names `@wcstack/typescript`, the config is used as it is, and an explicit `--url-imports` is reported as ignored. Otherwise it writes a temporary config next to the user's, `.wcs-tsc.<config file name>`, that `extends` it and sets `contentMappers` to the inherited entries plus `{ "package": "@wcstack/typescript", "extensions": [".html"] }` (with `options.urlImports` for `--url-imports=error`) — a config's own array replaces the inherited one. An inherited mapper that already takes `.html` is refused with exit 2. The fixed name keeps one `.tsbuildinfo` for an `incremental` project; two runs on one config at the same time share the file.
- It audits the effective config with `tsc --showConfig --runExternalCode` (the user's arguments, without `-w`): no `.html` in `files`, or `noImplicitThis` turned off (7's default is `strict`), is a warning; with `--wcs-defaults` the temporary config adds `noImplicitThis: true` and `**/*.html` to the resolved `include`. `allowJs`, `checkJs` and `target` are not audited on 7.1: the outputs are `.mts`, and 7's default target is current.
- `-b` / `--build` passes through with `--runExternalCode` (each project's tsconfig has to name the mapper), with a warning. File names with `-p` are refused by tsc itself (TS5042).
- The temporary config is removed on exit and on SIGINT / SIGTERM / SIGHUP (SIGBREAK on Windows). The exit code is tsc's.
- On 7.0, which has no mappers, it refuses by name and suggests `typescript@^7.1` (or `typescript@6`).

The user's tsconfig needs no change, and CI scripts keep `npx wcs-tsc`.

### 5.3 Getters (shipped in 4.6.2)

`defineState<T>(def: T & ThisType<…T…>)` infers `T` from the object literal. A getter with no return type annotation is typed from its body, and a body that reads `this` brings the inference back to `T`: TypeScript types that getter `any` and keeps the `this` in its body as `any` too. So `get first() { return this.items[0].nmae; }` was not reported, and under `strict` a callback in a getter (`this.items.filter((i) => …)`) was an implicit `any` (TS7006). Methods are not affected. The behavior is TypeScript's (5.9 and 7.1 alike) and is documented for `.ts` state files in [define-state.md](../packages/state/docs/define-state.md#getters-with-an-inferred-return-type).

An inline script is JavaScript, so its author cannot annotate. From 4.6.2 the plugin inserts `: any` after the parameter list of every top-level getter of the state object that reads `this` (`src/language/getterAnnotations.ts`, acorn). The inserted text is unmapped; the getter's type was `any` already, so nothing is lost, and the body is checked against the inferred `this`. The mapper inherits it: on 7.1 it reports the getter typo at the same HTML position as `wcs-tsc`.

## 6. The editor

The extension does not need TypeScript 7 and keeps working. The question is what happens beside it.

- **Overlap.** In a trusted workspace whose tsconfig names the mapper, TypeScript 7's server also serves the `.html` (§3): its diagnostics and hovers appear next to the extension's. Diagnostics cannot be disabled per span (§2), so the mapper cannot stay quiet in the editor and speak in the CLI from one tsconfig. Until Option A ships, the READMEs tell users of both extensions to set `js/ts.contentMappers.enabled: false`.
- **Option A — keep Volar, step aside (next).** The extension detects that TypeScript 7's extension is active and that the workspace's tsconfig names `@wcstack/typescript` for `.html`. It then stops providing TypeScript features for `<wcs-state>` scripts (the Volar TypeScript service plugins) and keeps everything `data-wcs` (validators, completion, navigation, lenses), which never used the TypeScript service. It needs checking by hand in VS Code with both extensions installed, so it is a change of its own.
- **Option B — delegate (later).** The extension calls `registerContentMappers("wcstack.wcstack-intellisense", [{ extensions: [".html"], inferredProjectContribution: { manifest } }])` with the bundled mapper (or the workspace's `@wcstack/typescript`), and drops the bundled TypeScript and Volar's TypeScript plugins. The extension shrinks to `data-wcs`. It needs TypeScript 7's extension installed and is right only once that is VS Code's default.
- **VS Code's HTML.** The built-in HTML language server already offers JavaScript features inside `<script>`. Under Option B, three providers may answer in one `<script>`: the HTML server, TypeScript 7 and the extension. The upstream sample avoided the question by naming its files `.dhtml`. Measure it before choosing B.

## 7. `wcs-schema` is a separate port

Content mappers do not touch `wcs-schema`: it reads a `.ts` / `.js` state file through the checker. TypeScript 7.1's `typescript/sync` API has the checker calls it uses (`getPropertiesOfType`, `getTypeOfSymbolAtLocation`, `isArrayType`, `isTupleType`, `getTypeArguments`, `getIndexInfosOfType`, `typeToString`, `getCallSignatures`). Its objects are `Disposable` and talk to the native compiler over IPC, and it calls itself unstable. Porting means a second implementation of `program.ts` / `typeToSchema.ts` over that API, chosen by the installed major version. Plan it after the API leaves preview. Until then `wcs-schema` and `loadStateFile` refuse 7 by name.

## 8. Decisions

Taken 2026-10-24 with the recommendations; the plan was reviewed independently before the implementation, and the review's findings are folded into §3–§5.

1. **When.** Built now on a branch, against 7.1.0-beta (and checked on a nightly). It is merged after 7.1 is stable — with the `typescript-7` devDependency moved to the stable release — and ships marked experimental for one minor: the first minor after 7.1 is stable. Not 4.7, which goes to the next seam app (one seam app per minor, [v4-direction-2026-10.md](./v4-direction-2026-10.md) §4, ja; decided 2026-10-24). The READMEs' marks say `4.8 (not released yet)`, the earliest it can be, and are set to the actual minor when the branch is merged — `scripts/unreleased-marks.mjs --check` refuses a mark of a released version.
2. **The peer range**: `typescript: ">=5.0 <7 || >=7.1"`. `wcs-tsc` checks the version it needs (5 / 6, or 7.1 and later); `wcs-schema` stays 5 / 6 until §7.
3. **The CLI shape**: both — `wcs-tsc` running `tsc --runExternalCode` itself (§5.2) for continuity, and the plain `tsc` invocation documented.
4. **The editor**: no change in this work; the overlap is documented. Option A next, as its own change; Option B when TypeScript 7's extension is VS Code's default (§6).
5. **The options**: `stateTagName` (default `wcs-state`) and `urlImports` (default `any`); diagnostic source `wcs`; outputs `.mts` (§3).

## 9. Tests

- **Unit** (vscode-wcs, `__tests__/contentMapper.test.ts`): the transform's outputs (no block, one, several, `stateTagName`, `urlImports`, the directives); every `Verbatim` span equals the original text in `utf-16` and `utf-8`, for a page with surrogate pairs and for every example page, with the safety net never used; the URL specifier scan; the options; the protocol (initialize → openProject → transform → closeProject, two handles in one process, reopening a closed handle, unknown handles, malformed JSON and requests, notifications, an exception inside a request); the framing (split and joined chunks, multi-byte bodies, extra headers). `__tests__/plugin.test.ts` checks that both plugin modes map only identical text.
- **CLI** (packages/typescript, `__tests__/wcsTscMapper.test.ts`, `tsconfigChain.test.ts`): every branch of §5.2 with tsc replaced.
- **End to end** (packages/typescript, `__tests__/contentMapper.e2e.test.ts`, gating, against the `typescript-7` devDependency): diagnostics at HTML positions, no collision between blocks or pages, `urlImports: "error"`, option diagnostics in the tsconfig, TS18068 without the flag, the option matrix of §4.5, the built `wcs-tsc` on 7.1, and the built `content-mapper.cjs` over stdio.
- **Parity and the language server** (CI's `wcs-validate` job, non-gating while 7.1 is not stable, `packages/typescript/scripts/content-mapper-parity.mjs`): `tsc --runExternalCode` on 7.1 over `examples/` produces exactly what `wcs-tsc` on 5.9 produces; `tsc --lsp --stdio` answers hover and diagnostics on a page with `runExternalCode` and nothing without it. `WCS_TS7_TSC` runs it against another build.
- **Editor**: Option A's detection, by hand, when it is built.

## 10. References

- [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [microsoft/typescript-go#4712 — Content mappers](https://github.com/microsoft/typescript-go/pull/4712) (the protocol, span maps, LSP activation, emit, incremental)
- [microsoft/TypeScript#63936 — Content mappers round 2](https://github.com/microsoft/TypeScript/pull/63936) (no `protocolVersion`, required diagnostic codes); the wire types are in `tsc/internal/contentmapper/hostimpl.go`, the span checks in `tsc/internal/spanmap/spanmap.go`
- [microsoft/TypeScript#63800 — API usage patterns for complex editor extensions](https://github.com/microsoft/TypeScript/issues/63800)
- [DanielRosenwasser/content-mapper-sample](https://github.com/DanielRosenwasser/content-mapper-sample) (an HTML mapper for `<script>` and event handler attributes)
- [typescript.md](./typescript.md) §4 — `wcs-tsc` and the language plugin
- [typescript-binding-check.md](./typescript-binding-check.md) — checking `data-wcs` bindings through the mapper (study and prototype)
