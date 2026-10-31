# @wcstack/lint

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

Static-contract validator CLI for [wcstack](https://github.com/wcstack/wcstack): checks HTML `data-wcs` bindings and `wcstack.manifest.json` sidecars headlessly, with the **same validator core** as the WcStack IntelliSense VS Code extension — the IDE and this CLI report identical diagnostic codes and ranges.

[日本語版 README はこちら](./README.ja.md)

## Usage

No install required:

```bash
npx @wcstack/lint --errors-only index.html wcstack.manifest.json
```

Or install and use the `wcs-validate` command:

```bash
npm i -D @wcstack/lint
npx wcs-validate --errors-only src/**/*.html
```

Files ending in `.manifest.json` are validated as sidecar manifests; everything else is validated as HTML with `data-wcs` bindings, except a framework's components and script files (`.js`, `.ts`, `.jsx`, `.tsx`, `.vue`, `.svelte`), which are not read (since 4.6; before, they were read as HTML and reported clean).

External state referenced via `<wcs-state src="...">` (`.json` / `.js` / `.ts`) is resolved relative to the HTML file and included in path validation. URLs are never read, and a path from `/` only under `--root` (below), unreadable files are skipped, and unresolved paths stay warnings. Note that once external state *does* resolve, the full validation surface applies to those pages — error-severity findings (e.g. `for:` bound to a non-array) can fail a build that was previously silent because the paths could not be checked. Since 4.4 that includes the script rules (`wcs/nested-assign`, `wcs/array-mutation`, `wcs/on-handler-this`, `wcs/updated-callback-unbound` and the rest) on a `.js` / `.ts` state: a finding in the file is reported in the file (`state.js:12:5 error wcs/nested-assign …`), once however many pages load it, and the IDE shows it on the page's `src` value. Up to 4.3 only the paths of an external state were checked. Since 4.10, a key written as a name — a shorthand (`export default { lang, t }`, the dictionary volume `<wcs-state mount="i18n" src="./i18n/state.js">` of `examples/router-i18n`) or `items: ITEMS` — has the shape of what the name is bound to: a `const` of the module, or an import from a relative path, which is read relative to the file that imports it (and the module it re-exports from). Up to 4.9 a shorthand key was not read at all, so every `i18n.t.*` binding was a false `wcs/binding-path-missing`. A name whose value is computed (the dictionary merged from the locale catalogs at run time), or that it cannot follow (a bare specifier, a URL, a file that is not there), leaves the paths under that key unchecked, and says so once at the key when the page binds under it (`wcs/path-dynamic-unknown`, info); a JSDoc `@type {typeof import("./en.js").default}` on the key or on the declaration has them checked against that file's literal.

```
wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--root=<dir>] [--errors-only] [--strict] <file> [<file> ...]
```

| Option | Description |
|---|---|
| `--attr=<name>` | Bind attribute name (default `data-wcs`) |
| `--state-tag=<name>` | State custom-element tag name (default `wcs-state`) |
| `--lang=ja\|en` | Diagnostic message language. Defaults to the environment locale (`LC_ALL` / `LC_MESSAGES` / `LANG`, then the OS locale); codes and ranges are language-independent |
| `--root=<dir>` (also `--root <dir>`) | Since 4.10: the site's root directory, where a path from `/` is read — a `<wcs-state src="/app.js">` under `<base href="/ja/">` (the form of `docs/csp.md` and `examples/router-i18n`) and an import from `/…` in a state file are read as `<dir>/app.js`; a path that leaves the directory (`/../x.js`) is not. Without it a path from `/` is not read (`wcs/state-src-unread`, info). A finding in such a file is reported under the directory (`public/app.js:12:5 …`) |
| `--errors-only` (alias `--quiet`) | Print only error-severity lines; warning/info counts and the exit code are unchanged |
| `--strict` | Exit `1` on warning-severity diagnostics too. Severities are unchanged (the IDE shows the same thing); only the exit-code threshold moves from error to warning. The summary line ends with `(strict)`. Use it to fail CI on a path typo (`wcs/binding-path-missing` is a warning) — but resolve every `<wcs-state src>` first (an unresolvable external state leaves warnings that would now fail the build). Combines with `--errors-only`: output stays error-only, the exit code still reflects warnings |

## Output & exit codes

One line per diagnostic, in a stable order:

```
index.html:12:8 warning wcs/path-nonexistent Path "user.nam" does not exist ...
app.manifest.json:1:3 error wcs/manifest-broken Broken manifest JSON: ...

1 error(s), 1 warning(s), 0 info
```

| Exit code | Meaning |
|---|---|
| `0` | No error-severity diagnostics (warnings/info may exist); with `--strict`, no error or warning |
| `1` | At least one error-severity diagnostic; with `--strict`, at least one error or warning |
| `2` | Usage error or unreadable file |

After the counts, two notes name the files the counts say nothing about (since 4.6; printed with `--errors-only` too, and they do not change the exit code):

```
0 error(s), 0 warning(s), 0 info
not read: src/App.tsx — wcs-validate reads HTML pages (data-wcs, <wcs-*> tags), not a framework's components or script files
nothing to check: index.html — no data-wcs binding, <wcs-*> tag or wcstack script in them
```

A framework app (React, Vue) that uses the `<wcs-*>` elements has neither: its page holds the root element and its components are not read. Exit code `0` does not mean such an app was checked; [the framework integration guide](../../docs/framework-adapter-integration.md) lists what to look for instead.

## Declaring a state contract (`stateSchema`)

Without a contract, a path the validator cannot resolve is only a **warning** (`wcs/binding-path-missing`): `count` may well exist at runtime even when the inline script cannot be read statically. Note that a list starting as `[]` does not need a contract just to name its row fields — the analyzer reads them from the row literals in the assignments that add or replace rows (`this.items = this.items.concat({ id, kind: "general" })`, `.toSpliced(i, n, { … })`, `.with(i, { … })`, `[...this.items, { … }]`); only a row passed as a variable (`concat(row)`) is invisible to it. Since 4.9 it also reads an assignment that rebuilds the rows with `map` — `this.rows = [...this.items].map((c) => ({ id: c.id, label: c.name }))`, `.filter(…).map((c) => { return { … }; })` — the way it reads a getter that does, and the keys of an object literal assigned to a key seeded `{}` (`this.fieldErrors = { date: "…" }` gives `fieldErrors.date`; a spread inside the literal is not followed). Since 4.11 (not released yet) a seed that spreads a constant of the module — `draft: { ...EMPTY_DRAFT }` with `const EMPTY_DRAFT = { title: "", body: "" }`, or one imported from a file it reads — has that literal's keys (nested ones too; a later key of the same name wins, as when the object is built), and so does a list seed's first row (`[{ ...ROW, id: 0 }]`). Up to 4.10 every binding under such a key was a false `wcs/binding-path-missing`, and a typo (`draft.titel`) the same warning. A spread it cannot read — a call, a `let`, an import it cannot read — leaves the keys under that key unchecked, said once at the key when the page binds under it (`wcs/path-dynamic-unknown`, info). A list that arrives from outside — `null` until `<wcs-fetch>` or `<wcs-storage>` fills it — has no such literal: declare its shape with a JSDoc `@type` before the property (`/** @type {{ id: number, name: string }[] | null} */ catalog: null`), or name the row type with a `@typedef` in the same script and write `@type {Product[] | null}`. Put an `application` sidecar next to (or above) the HTML and the same typo becomes an **error**:

```json
{
  "schemaVersion": 2,
  "kind": "application",
  "manifestExtensions": {
    "wcstack.application": {
      "version": 2,
      "stateSchema": {
        "type": "object",
        "properties": {
          "count": { "type": "number" },
          "users": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" } } } }
        }
      }
    }
  }
}
```

- **Discovery**: the nearest `wcstack.manifest.json` walking up from the HTML file is used automatically — nothing to pass on the command line. Passing `*.manifest.json` arguments that contain an `application` artifact replaces discovery for the whole run. The VS Code extension discovers the same file, so IDE and CLI agree.
- **Effect**: when a `stateSchema` is declared, a bound path that the schema definitely lacks is `wcs/path-nonexistent` (**error**, exit `1`); `for:` on a non-array is `wcs/path-type-mismatch` (**error**). Paths the schema leaves open (a bare `{}`) stay silent, and methods / getters / `$listKeys` from the inline script still count as existing. Without a `stateSchema`, behavior is unchanged.
- **When a contract is needed**: a state the validator cannot read in full needs one for its paths to be checked at all. A top-level spread is the common case — `export default { ...defaults(), get total() { … } }` brings in keys no static reader sees, so the validator checks no path of that state, and since 4.4 it says so once, at the spread (`wcs/path-dynamic-unknown`, info). With a `stateSchema` the bindings — and, since 4.4, the paths the getters read (`wcs/read-path-missing`) — are checked against it. A `<wcs-state src>` it cannot read — a path from `/`, a URL, a file that is not there — leaves that state unchecked as well; since 4.7 it says so once, at the attribute (`wcs/state-src-unread`, info), where up to 4.6 it said nothing. It reads a `src` relative to the page: keep the files laid out as on the server, and since 4.10 pass `--root=<dir>` for a path from `/`.
- **Where the schema comes from**: write it by hand (only the JSON-Schema subset `type / properties / required / items / enum / const / anyOf / $defs / $ref` is accepted), or generate it from a TypeScript state file — or a JavaScript one with JSDoc types — with `wcs-schema` (`@wcstack/typescript`). The manifest is a derived artifact — keep it in sync with `wcs-schema check` in CI.

## The page's wcstack scripts and the lint's version

Since 4.11 (not released yet), two warnings look at the wcstack scripts a page loads. Both are warnings: `--strict` fails on them, `--errors-only` does not.

- **`wcs/tag-package-missing`** — a `wcs-*` tag of a wcstack package (`<wcs-upload>`, or its helper `<wcs-upload-header>`; `<wcs-state>`, `<wcs-router>` …) on a page that loads wcstack itself but no script of that package. The element is never defined, its bindings wait and nothing happens, and the console says nothing. Reported once per package, at its first tag, with the `/auto` to load. A script counts when a `<script src>`, an import map entry, or an import or a string in an inline script names `@wcstack/<pkg>` (any version, any CDN, a local path) or the `wcstack` bundle (state, router, fetch, storage, autoloader); a local script (`./app.js`) is read, with the relative modules it imports, for what it names. Not reported on a page that names no wcstack script itself (a fragment, a bundler's page), for a tag an `@components/` import map entry covers while the autoloader is there, or when a local script cannot be read.
- **`wcs/lint-version-behind`** — a URL on the page pins a newer minor than this lint: `@wcstack/state@4.11.0` checked with `@wcstack/lint@4.10.1`. The lint carries the rules of its own version (it is released with `@wcstack/state`, in lockstep), so it does not check what the newer minor added, and it can report the newer minor's correct syntax as an error (4.2.0's lint gives `wcs/filter-arity` for 4.10's `datetime(ja-JP,short,Asia/Tokyo)`). Said once per page, at the newest pin: upgrade `@wcstack/lint` to that version — keep the lint in `package.json` at the version the page pins. A URL without a version, a major-only pin (`@4`) and a lint newer than the page are not reported.

## Use in generate–validate–fix loops

Stable diagnostic codes, `source:line:col` ranges, and the exit-code contract make this CLI a drop-in gate for CI and for AI code-generation flows: generate HTML → `npx @wcstack/lint --errors-only` → read the diagnostics, fix, and re-run until exit code `0`. The gate covers `data-wcs` pages: when the output ends with `not read:` or `nothing to check:`, those files were not checked.

## Relationship to the VS Code extension

This package is a thin distribution wrapper: it ships the self-contained CLI bundle built from the [`wcstack-intellisense`](https://github.com/wcstack/wcstack/tree/main/packages/vscode-wcs) validator core (zero runtime dependencies). The sidecar manifest is tooling-only and never changes runtime behavior; the normative schema lives in [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md).

## License

MIT
