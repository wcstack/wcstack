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

Files ending in `.manifest.json` are validated as sidecar manifests; everything else is validated as HTML with `data-wcs` bindings.

External state referenced via `<wcs-state src="...">` (`.json` / `.js` / `.ts`) is resolved relative to the HTML file and included in path validation. URLs and absolute paths are never read, unreadable files are skipped, and unresolved paths stay warnings. Note that once external state *does* resolve, the full validation surface applies to those pages — error-severity findings (e.g. `for:` bound to a non-array) can fail a build that was previously silent because the paths could not be checked.

```
wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] [--strict] <file> [<file> ...]
```

| Option | Description |
|---|---|
| `--attr=<name>` | Bind attribute name (default `data-wcs`) |
| `--state-tag=<name>` | State custom-element tag name (default `wcs-state`) |
| `--lang=ja\|en` | Diagnostic message language. Defaults to the environment locale (`LC_ALL` / `LC_MESSAGES` / `LANG`, then the OS locale); codes and ranges are language-independent |
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

## Declaring a state contract (`stateSchema`)

Without a contract, a path the validator cannot resolve is only a **warning** (`wcs/binding-path-missing`): `count` may well exist at runtime even when the inline script cannot be read statically. Put an `application` sidecar next to (or above) the HTML and the same typo becomes an **error**:

```json
{
  "schemaVersion": 1,
  "kind": "application",
  "manifestExtensions": {
    "wcstack.application": {
      "version": 1,
      "states": {
        "default": {
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
  }
}
```

- **Discovery**: the nearest `wcstack.manifest.json` walking up from the HTML file is used automatically — nothing to pass on the command line. Passing `*.manifest.json` arguments that contain an `application` artifact replaces discovery for the whole run. The VS Code extension discovers the same file, so IDE and CLI agree.
- **Effect**: for a state that has a `stateSchema`, a bound path that the schema definitely lacks is `wcs/path-nonexistent` (**error**, exit `1`); `for:` on a non-array is `wcs/path-type-mismatch` (**error**). Paths the schema leaves open (a bare `{}`) stay silent, and methods / getters / `$listKeys` from the inline script still count as existing. States without a schema are unchanged.
- **Where the schema comes from**: write it by hand (only the JSON-Schema subset `type / properties / required / items / enum / const / anyOf / $defs / $ref` is accepted), or generate it from a TypeScript state file with `wcs-schema` (`@wcstack/typescript`). The manifest is a derived artifact — keep it in sync with `wcs-schema check` in CI.

## Use in generate–validate–fix loops

Stable diagnostic codes, `source:line:col` ranges, and the exit-code contract make this CLI a drop-in gate for CI and for AI code-generation flows: generate HTML → `npx @wcstack/lint --errors-only` → read the diagnostics, fix, and re-run until exit code `0`.

## Relationship to the VS Code extension

This package is a thin distribution wrapper: it ships the self-contained CLI bundle built from the [`wcstack-intellisense`](https://github.com/wcstack/wcstack/tree/main/packages/vscode-wcs) validator core (zero runtime dependencies). The sidecar manifest is tooling-only and never changes runtime behavior; the normative schema lives in [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md).

## License

MIT
