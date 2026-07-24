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

```
wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] <file> [<file> ...]
```

| Option | Description |
|---|---|
| `--attr=<name>` | Bind attribute name (default `data-wcs`) |
| `--state-tag=<name>` | State custom-element tag name (default `wcs-state`) |
| `--lang=ja\|en` | Diagnostic message language. Defaults to the environment locale (`LC_ALL` / `LC_MESSAGES` / `LANG`, then the OS locale); codes and ranges are language-independent |
| `--errors-only` (alias `--quiet`) | Print only error-severity lines; warning/info counts and the exit code are unchanged |

## Output & exit codes

One line per diagnostic, in a stable order:

```
index.html:12:8 warning wcs/path-nonexistent Path "user.nam" does not exist ...
app.manifest.json:1:3 error wcs/manifest-broken Broken manifest JSON: ...

1 error(s), 1 warning(s), 0 info
```

| Exit code | Meaning |
|---|---|
| `0` | No error-severity diagnostics (warnings/info may exist) |
| `1` | At least one error-severity diagnostic |
| `2` | Usage error or unreadable file |

## Use in generate–validate–fix loops

Stable diagnostic codes, `source:line:col` ranges, and the exit-code contract make this CLI a drop-in gate for CI and for AI code-generation flows: generate HTML → `npx @wcstack/lint --errors-only` → read the diagnostics, fix, and re-run until exit code `0`.

## Relationship to the VS Code extension

This package is a thin distribution wrapper: it ships the self-contained CLI bundle built from the [`wcstack-intellisense`](https://github.com/wcstack/wcstack/tree/main/packages/vscode-wcs) validator core (zero runtime dependencies). The sidecar manifest is tooling-only and never changes runtime behavior; the normative schema lives in [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md).

## License

MIT
