# Checking `data-wcs` bindings with TypeScript

**日本語版**: [typescript-binding-check.ja.md](./typescript-binding-check.ja.md)

- **Status**: study, prototype and design (2026-10-24). Branch `research/typescript-binding-check`, on top of [typescript-content-mapper.md](./typescript-content-mapper.md). Not implemented. The decisions in §8 are the author's.
- **Audience**: whoever designs and maintains wcstack's static checks (`wcs-validate`, the VS Code extension, `wcs-tsc`, the content mapper), and the author deciding the direction.
- **Where the figures come from**: a prototype mapper kept outside the repository, run with TypeScript 7.1.0-beta's `tsc --runExternalCode` and `tsc --lsp` over the 58 example pages (`examples/` and every package's `examples/`). The comparison is `wcs-validate --lang=en` over the same pages.

## 1. The idea

A content mapper (TypeScript 7.1) receives a whole `.html` file and may return any TypeScript with a span map. Today's mapper hands TypeScript only the `<wcs-state>` scripts. **If the bindings (`data-wcs`, `{{ }}`, `<!--@@: -->`) are lowered to TypeScript expressions as well, TypeScript itself reports a wrong binding at its position inside the attribute** — the way vue-tsc checks templates.

```html
<p data-wcs="textContent: coutn"></p>
```

```ts
// synthesized by the mapper at the end of the state block's output (the text coutn is mapped to the attribute's)
{ const { coutn: __v } = __s; }
// → page.html(21,27): error TS2339: Property 'coutn' does not exist on type '__WcsBindView<__T0>'.
```

## 2. Two checkers today

| What | Who checks it | Where the types come from |
|---|---|---|
| `<wcs-state>` scripts | TypeScript (`wcs-tsc`, the extension, the content mapper) | TypeScript's inference |
| Binding paths, filters, syntax | `wcs-validate` (the validator the extension and the CLI share) | a **candidate set** read from the script (an estimate, which is why `wcs/binding-path-missing` is a warning), or the sidecar `stateSchema` that `wcs-schema` writes (an error when present) |

`wcs-schema` uses TypeScript's compiler API, so it does not run on TypeScript 7 ([typescript-content-mapper.md](./typescript-content-mapper.md) §7).

## 3. Hypotheses

- **H1** Path checks move from an estimated candidate set to the type TypeScript inferred.
- **H2** An inline state needs neither `wcs-schema` nor a sidecar.
- **H3** Checks only types can make become possible (`for:` over an array, `onclick:` naming a function, a filter's input type, an element property's type).
- **H4** The editor gives the same verdicts, with hover and go-to-definition.

## 4. Questions

| # | Question | Answer (§6) |
|---|---|---|
| Q1 | Can a wrong path be reported at the path inside the attribute? | Yes. A range that starts in synthesized text is moved to the end of the previous segment, so a key's quotes are mapped as Atoms |
| Q2 | Which expression is reported whatever `noImplicitAny` is, with a readable message? | Destructuring. An element access is reported only under `noImplicitAny` |
| Q3 | How does the state's type reach the binding checks? | Rewrite `export default X` to `const __wcsState = X; export default __wcsState;` and put the checks at the end of the module. Putting them in a call's callback silently turned the types into `any` |
| Q4 | Which syntax? | 1,178 of 1,301 bindings (90.5%) are checked. The rest: tokens (98), a deployment-relative `src` (24), an index (1) |
| Q5 | Agreement with `wcs-validate`? | On correct pages the TypeScript checks report 0, `wcs-validate` 76 (9 of them wrong where the type is known). Typos caught: TypeScript 97.3%, `wcs-validate` 99.2% (all as warnings, and it warns on correct pages too) |
| Q6 | False reports of type-only checks? | `for:`, `on*:` and filters: 0. Element property types: 23 when compared strictly (numbers into string properties); 0 when relaxed, but then nothing is caught |
| Q7 | Limits of the types? | Subtrees of unknown shape (`any`, `null`, `{}`, rows of an empty array) are left silent. 4.6.2's `any` getters can be recovered from copies of their bodies. JavaScript object literal types are open. Each carries a risk of checks going silent |
| Q8 | Speed? | 58 pages: 330 ms → 535 ms (median, start-up included) |
| Q9 | Division of labour? | §7.6 |
| Q10 | Editor? | The language server's diagnostics match the CLI. Hover works on every form, go-to-definition on top-level keys |

## 5. The prototype

The prototype is a mapper of about 500 lines that imports vscode-wcs's parts (`parseWcsStateElements`, `stripWcsImportRanges`, `getterAnnotationOffsets`, `findAllBindAttributes`, `parseBindTextWithPositions`, `findAllMustacheSyntax` / `findAllCommentBindings`, `getRowShorthandForPath` / `getResolvedForListPath`, the manifest's `builtinFilterMeta`), bundled with esbuild. Options switch the kinds of checks.

Three measurements:

1. **A fixture**: ten intended errors (missing paths, a number given to `for:` and to `onclick:`, a filter's input type, an unknown filter, a volume's path, a comment binding) and the forms that must stay silent (a path getter, `$1`, row shorthand, the rows of an empty array) on one page.
2. **Correct pages**: the 58 example pages run, so any binding diagnostic on them is a false report.
3. **Mutation**: copy the example pages, append `Zq` to the end of every checkable binding path (1,196 places), and count whether the TypeScript checks and `wcs-validate` each report at the mutated position.

## 6. Results

### 6.1 Positions and the expression (Q1, Q2)

- **Destructuring** `const { "users.*.nmae": __v } = __s;` reports TS2339 whatever `noImplicitAny` is. An element access `__s["users.*.nmae"]` reports TS2551 ("Did you mean") only under `noImplicitAny` and is silent otherwise. A function argument (`path<P extends keyof S>(p)`) reports TS2345 with a union for a message. → Use destructuring; it gives no "Did you mean".
- When a diagnostic's range starts in synthesized text (a key's quote), TypeScript moves its start to the end of the previous segment (`coutn` reported at column 32; `.nmae` just after the previous path). Keys are mapped this way:
  - a path written as an identifier (`count`): the key unquoted, Verbatim;
  - any other path (`users.*.name`): each quote an Atom for a zero-length edge of the path, the text between Verbatim;
  - row shorthand (`.name` → `users.*.name`) and volume paths, whose key differs from the written text: the whole key an Atom for the written path.
- With these three forms the fixture's ten errors land on the right line and column inside the attributes, and every caught mutation lands exactly at the mutated path.

### 6.2 Getting the state's type to the checks (Q3)

A supplemental output cannot be imported, so the checks must sit in the output of the block that defines the state.

1. **First form**: `export default __wcsBindings(defineState({…}), (__s) => { …checks… })`, with the callback's parameter typed from `T`. The binding checks worked. But inside the callback, every type built from `typeof __t` (to recover getter types) became `any`, and every check went silent — with no error.
2. **Form taken**: rewrite `export default X` to the synthesized `const __wcsState = X; export default __wcsState;` (the text `export default ` is left unmapped) and put the checks at the end of the module from `type __T0 = …typeof __wcsState…`. A variable's type comes from its initializer alone; no inference runs through the checks.
3. **Volumes** (`<wcs-state mount="cart">`): a path starting with `cart.` is checked, without `cart.`, in the volume's block.
4. **`src` states** (`<wcs-state src="./state.js">`): the output for that element does `import __wcsState from "./state.js"`. An object literal's type from a JavaScript file is **open** in TypeScript (reading a property it lacks is not an error), and every check stayed silent. A mapped type (`{ [K in keyof S]: S[K] }`) closes it.

### 6.3 Syntax covered (Q4)

| Form | Handling |
|---|---|
| Attribute bindings, `{{ }}`, `<!--@@: -->` | checked |
| `*` paths inside `for`, path getter keys (`"users.*.ageCategory"`) | the key as written |
| Row shorthand (`.name`, `.`) | expanded with the enclosing `for`; nested relative `for` (`for: .cards`) resolved with `getResolvedForListPath` (`wcs-validate` skipped these) |
| Volume paths | checked in the volume's block |
| `on*:` handlers | the method name as a key, checked to be a function |
| `$1` and other indexes, `$command.x`, literals, `**` | not checked (`wcs-validate` covers them) |
| `eventToken.*:`, `command.*:` | not checked (the right side is a token name) |
| `src` states | relative `.js` / `.mjs` / `.ts` / `.mts` only. A location like `/app.js` depends on the server's layout, so no type reaches it |
| `json` / `state` attribute states | not handled by the prototype (no example page has one) |

1,178 of the 1,301 bindings on the 58 pages (90.5%) were checked. The rest: 98 tokens, 24 under the `/app.js` `src`, 1 index.

### 6.4 False reports on correct pages, and typos caught (Q5)

**Correct pages** (58):

| | Binding diagnostics |
|---|---|
| TypeScript checks (`strict: false`, the examples' CI setting) | **0** |
| TypeScript checks (`strict: true`) | **0** (after `NonNullable` on getter types; the canary also fires on two `src` pages — §6.6) |
| `wcs-validate` | 76 warnings |

`wcs-validate`'s 76 were of two kinds:

- **Wrong although the type is known** (9): values that come from module constants (`products: products`), expressions (`Array.from(…)`) or getters. The candidate analysis cannot follow identifiers; TypeScript's inference does.
- **Subtrees of unknown shape** (67): rows of a list that starts as `[]`, paths below a value that starts as `null`. The TypeScript checks are silent there (§6.6).

**Mutation** (1,172 places on the 57 pages a type reaches):

| | Count |
|---|---|
| Caught by both | 1,131 |
| TypeScript only | 9 (row shorthand inside a nested relative `for`) |
| `wcs-validate` only | 32 (31 in subtrees of unknown shape, where `wcs-validate` warns on correct paths alike) |
| Caught by neither | 0 |
| **Rate** | TypeScript 97.3% (errors), `wcs-validate` 99.2% (all warnings) |

### 6.5 Type-only checks (Q6)

| Check | False reports on correct pages | Notes |
|---|---|---|
| `for:` over an array (or `null` / `undefined`) | 0 | |
| `on*:` naming a function | 0 | |
| Filters (`interface WcsFilters` synthesized from the manifest's `acceptTypes` / `argTypes` / `resultType`) | 0 | a wrong input type is reported at the path, an unknown filter at its name with "Did you mean 'upper'?" |
| Element property types (`HTMLElementTagNameMap[tag][prop]`) | **23** | all `number` into a `string` property (`textContent`, `value`, …), which the runtime converts: false |
| The same, with `number` / `boolean` allowed into string properties | 0 | but it catches nothing on the example pages |

### 6.6 Limits, and the risk of silent checks (Q7)

Four times in the prototype the checks **went silent all at once, with no error**: the checks' type had become `any`-like somewhere.

| Cause | Remedy |
|---|---|
| Inference through a callback (§6.2) | Put the checks at the end of the module |
| The "error type" of a getter body: a getter that reads an untyped path (`this["query.sort"]`) returns what prints as `any` but is TypeScript's internal error type, which swallowed every type computed from it (router-admin's 167 caught typos dropped to 0) | Type the copied body's `this` as the view with unknown subtrees open (the read becomes a plain `any`), and refine one view per getter, used only for paths under that getter |
| JavaScript object literals are open (§6.2) | Close with a mapped type |
| Under `strict: true`, a `src` `state.js` with type errors of its own spoils that state's type | Not fixed — the canary below reports it |

**The canary**: with the upstream `diagnosticDirectives` policy `expect`, each state's checks start by checking a key no state has (`"__wcsCanary"`). While the checks work, that error is there and expected. When the type has collapsed and the error is missing, TypeScript reports the mapper's message at the `<wcs-state>` start tag (`error wcs2001: The data-wcs checks of this <wcs-state> stopped working: …`). It fires when the view is forced to `any`, never on the example pages under `strict: false`, and on the two `src` pages above under `strict: true`.

Other limits:

- **Subtrees of unknown shape**: below a value typed `any`, `unknown`, `null`, `undefined` or an empty `{}`, and below the rows of an array whose element is `any` / `never`, every path is accepted (as `wcs-validate` stays silent below a bare `{}`). Data from outside — `<wcs-fetch>` results, the router's `routeParams`, rows arriving over a WebSocket — falls here, which is why 31 mutations were missed. An inline script is JavaScript but the virtual code is read as TypeScript, so **JSDoc type annotations have no effect** (`/** @type {Item[]} */` leaves `[]` as `never[]` / `any[]`).
- **Getter types**: 4.6.2 types a getter that reads `this` as `any` to break the inference cycle. The binding checks run after the state's type is settled, so a copy of the getter's body can be evaluated against that `this` and the state refined with its return type (`NonNullable`). Errors inside the copy are hidden by an ignore directive. This caught 6 more mutations. Under `strict: true` a path getter returning `Map.get(…)` (`T | undefined`) needed `NonNullable`.
- **`.length`**: `users.length` is a valid path, absent from the preamble's path type. `.length` is added for array and string paths.
- **Depth**: the preamble's path expansion stops at depth 4. The example pages did not reach it.
- **Importing a `src`**: the `src` file joins the program, and under `checkJs` it is checked itself. With the examples' settings (`strict: false`) nothing appears; under `strict: true` the example `state.js` files report many type errors of their own.

### 6.7 Speed (Q8)

58 pages, median of five runs (start-up included): without binding checks 330 ms, with every check 535 ms.

### 6.8 The editor (Q10)

Asked of `tsc --lsp --stdio` (with `runExternalCode`) on the fixture page:

- **Diagnostics**: the same ten as the CLI.
- **Hover**: a path written as an identifier (`count` → `(property) count: number`) works through the destructured key. A quoted key's string gets no hover. An element access added for the editor only, `void (__s as … & { readonly [key: string]: unknown })["users.*.name"]`, with its mapping's `features` limited to hover and definition, returns `(property) "users.*.name": string`. The index signature takes any key, so a missing path is not reported twice. Row shorthand hovers too (as the key inside its volume or list).
- **Go-to-definition**: a top-level key (`count` → the state's `count: 0`) works. A derived path such as `users.*.name` is a key the mapped type creates, with no declaration, so it does not.

## 7. Design

### 7.1 Where

In the content mapper's transform (`packages/vscode-wcs/src/contentMapper/transform.ts`): the binding checks are appended to the output of each state block (and of each relative `src`). Whether the language plugin's virtual code (Volar's language-server mode and `wcs-tsc`'s tsc mode) gets the same synthesis is a decision in §8.

### 7.2 The output

```ts
// [preamble][binding-check helper types and declarations]        ← ignore (as the preamble)
// …user code…
const __wcsState = defineState({ … }); export default __wcsState;   // `export default X` rewritten
// …rest of the user code…
// --- binding checks ---
type __T0 = { [K in keyof typeof __wcsState]: (typeof __wcsState)[K] };   // closed (§6.2)
const __s = null as unknown as __WcsBindView<__T0>;
{ const { "__wcsCanary": __c } = __s; }                              // expect (§6.6)
const __g0 = function (this: __WcsBindView<__T0>) { …copy of a getter body… };   // ignore
const __s0g = null as unknown as __WcsBindView<Omit<__T0, "cards"> & { readonly "cards": NonNullable<ReturnType<typeof __g0>> }>;
{ const { count: __v } = __s; }                                       // existence
{ const { "users": __v } = __s; __wcsList(__v); }                     // for:
{ const { inc: __v } = __s; __wcsHandler(__v); }                      // on*:
{ const { "price": __v } = __s; void __wcsF.toFixed(__v, 2); }        // filters
{ const { "cards.*.title": __v } = __s0g; }                           // under a getter
```

- `__WcsBindView<T>` = `_WcsThis<T>` + `.length` on array and string paths + every path below a subtree of unknown shape (`any`).
- One block statement per binding, reusing the name `__v`.
- A path written as an identifier is an unquoted key; any other is mapped in three segments (§6.1) with the hover element access beside it.

### 7.3 Checks in and out

| Check | In? |
|---|---|
| Path existence (attributes, `{{ }}`, `<!--@@: -->`, row shorthand, nested relative `for`, volumes, `src`) | yes |
| `for:` over an array | yes |
| `on*:` naming a function | yes |
| Filter inputs and arguments (synthesized from the manifest) | yes |
| Element property types | no (§6.5) |
| `$1`, `$command`, tokens, `**` | no (`wcs-validate` covers them) |

### 7.4 Subtrees of unknown shape

Silent, as in `wcs-validate` (§6.6). A way to write the shape of data from outside (Q-c below) is separate work.

### 7.5 Guarding against silent checks

- **Canary**: one per state and one per refined getter view (`wcs2001`).
- **Tests**: the mutation test becomes a permanent test. A TypeScript 7.1 e2e breaks the example pages' bindings one by one and checks that the catch rate does not drop and that correct pages stay at 0.

### 7.6 Division of labour with `wcs-validate`

`wcs-validate` runs without TypeScript and serves the extension, the CLI and `wcs-schema`'s sidecar checks. TypeScript binding checks are **an additional layer for projects on TypeScript 7.1's content mapper**: an error where the type is known, silence where it is not.

In a project that runs both, one typo is reported twice: a `wcs-validate` warning and a TypeScript error.

- The CLIs (`wcs-validate` and `tsc`) are separate tools, so the duplicate is acceptable.
- The overlap in the editor is decided together with the content mapper's options A / B for the extension ([typescript-content-mapper.md](./typescript-content-mapper.md) §6).

### 7.7 Messages

The type prints as `__WcsBindView<__T0>` (`Property 'coutn' does not exist on type '__WcsBindView<__T0>'`). Whether to give it a readable alias (`WcsState`) is in §8. Destructuring gives no "Did you mean".

## 8. Decisions for the author

1. **Whether and when**: ship with the content mapper (planned as experimental in the first minor after TypeScript 7.1 is stable) as an option `bindings` (on by default), or after the content mapper is stable. Recommended: with the content mapper — no false reports on correct pages and 97.3% of typos caught were measured, and the canary makes a stopped check visible.
2. **The language plugin too** (`wcs-tsc` on 5 / 6, Volar in the editor)? It would give 5 / 6's `wcs-tsc` and the extension the same verdicts and hover, but in the extension it overlaps `wcs-validate`'s warnings. Recommended: the content mapper first; the plugin together with the editor-overlap decision (option A).
3. **Element property types**: leave out, or add the relaxed form? Recommended: leave out (it either misreports or catches nothing).
4. **Import `src` states**? It widens the checks but brings the `src` file into the program. Recommended: import, document the side effect, and let the canary report a collapsed type.
5. **A readable type name** (§7.7) such as `WcsState`? Recommended: `WcsState` (it can collide with a name in user code; fall back to the current name if so).

Open questions (outside this document):

- **Q-a** Go-to-definition for derived paths (it needs a synthesized declaration site for each key).
- **Q-b** Whether `wcs-validate` should stop reporting `wcs/binding-path-missing` for states the TypeScript checks cover.
- **Q-c** How an inline JavaScript state can state the shape of data from outside (an empty array, `null`). JSDoc type annotations have no effect in virtual code read as TypeScript; the validator's `jsdocType.ts` could be used to synthesize TypeScript annotations from JSDoc.

## 9. References

- [typescript-content-mapper.md](./typescript-content-mapper.md) — the content mapper (protocol, span maps, directives)
- microsoft/TypeScript `tsc/internal/contentmapper/hostimpl.go` (the `expect` directive and `unusedExpectDirectiveDiagnostics`), `tsc/internal/spanmap/spanmap.go` (Verbatim / Atom, features)
- `packages/vscode-wcs/src/service/bindingValidator.ts` — today's binding check (`wcs/binding-path-missing`)
