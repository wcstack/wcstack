# Migrating from wcstack 1.x to 2.x

**日本語版**: [migration-v2.ja.md](./migration-v2.ja.md)

wcstack 2.0.0 (2026-09-04) has one theme: **a state is one tree per root node, and it is extended by mounting, not by naming.** Everything that referred to a state *by name* — the `name` attribute, the `@name` path selector, and the name-shaped surfaces of SSR, devtools, the manifest, `@wcstack/testing`, and `wcs-schema` — is gone, replaced by a *mount path*. Nothing else about the binding syntax changed.

If your pages never used `<wcs-state name="…">` or `@` in a path, the runtime part of this guide is a no-op for you; read [Behavior changes that are not syntax](#4-behavior-changes-that-are-not-syntax) and [Tooling](#5-tooling) anyway, and the [late 1.x changes](#7-also-changed-in-late-1x) if you are coming from before 1.32.0.

The design record behind the change is [state-mount-design.md](./state-mount-design.md) (ja); the release-by-release list is the root [CHANGELOG](../CHANGELOG.md).

## 1. The mental model

v1 let a page hold several independent state trees, told apart by name:

```html
<wcs-state name="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>          <!-- name="default" -->

<span data-wcs="textContent: total@cart"></span>
<span data-wcs="textContent: user.name"></span>  <!-- @default implied -->
```

v2 has one tree. A second `<wcs-state>` is a **volume**: its data is grafted onto the tree at the *mount path*, and bindings read it by prefix:

```html
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>

<span data-wcs="textContent: cart.total"></span>
<span data-wcs="textContent: user.name"></span>
```

Inside the volume nothing changes: `cart.js` still says `this.total`, and its getters, `$watch`, `$listKeys`, `$updatedCallback`, and lifecycle callbacks are all relative to the mount path. Load order between the root and its volumes does not matter.

Components follow the same idea. A `bind-component` is *mounted* onto a path of the host tree — per property (`state.message: user.name`, unchanged from v1) or whole (`state: user`, new) — and its bindings are translated into absolute paths on the host tree when it registers. Light DOM components now use the identical form; they no longer need a name.

## 2. Mechanical steps

Run the validator first — it lists every site as an **error** with the replacement spelled out:

```bash
npx @wcstack/lint index.html            # or: the WcStack IntelliSense extension in VS Code
```

Then:

1. **`<wcs-state name="x"` → `<wcs-state mount="x"`.** `name="default"` is simply deleted. The runtime fails fast on `name=` with this guidance.
2. **`path@x` → `x.path`, `path@default` → `path`.** In `data-wcs`, `{{ }}`, `<!--@@:-->`, spread (`...: obj@x` → `...: x.obj`) and shorthand (`.name@x` → `.name`). `@` in a path is a parse error in v2.
3. **Plain Light DOM `bind-component`** (a component with no shadow root and no wiring from the host) cannot exist in v2: either add `this.attachShadow({ mode: "open" })`, or wire it from the host (`<my-c data-wcs="state: path">`). The runtime raises with this guidance.
4. **`@wcstack/testing`:** `state("x")` → `state()`, then prefix the paths you read or write with `x.`. Passing an argument throws with a migration hint.
5. **`wcs-schema`:** re-run `wcs-schema emit`. The manifest moves to `schemaVersion` 2 (one `stateSchema` for the whole tree). A volume's type file is emitted into its subtree with `--mount=<path>`; the old `--state=` is a usage error.

Four declarations do not survive a rename into a volume: **`$streams` raises**, and **`$commandTokens` / `$eventTokens` / `$on` warn** — move them to the root state. Everything else a volume declares works mount-relative.

## 3. Breaking changes, complete table

| v1 | v2 | How you find out |
|---|---|---|
| `<wcs-state name="x">` | `<wcs-state mount="x">` | runtime fail-fast with guidance; lint `wcs/named-state-deprecated` (error) |
| `path@x` / `path@default` — in `data-wcs`, `{{ }}`, `<!--@@:-->`, spread, shorthand | `x.path` / `path` | parse error with guidance; lint error |
| Plain (unwired) Light DOM `bind-component` | add a shadow root, or wire from the host (`state: path`) | runtime raise with guidance |
| Mapped component's own-key default value (`state = { message: "" }` overridden by the mapping) | rule **R1**: a component's own data keys are private and are never covered by a mapping — delete the default | `wcs/mount-own-key-shadow` warning |
| Several `<wcs-state bind-component>` wired to one component (different props) | one mount scope per component: merge the wiring into one, or split the component | runtime raise with guidance |
| `setInitialState()` re-set on a tree that already has grafted volumes or mounts | write the paths you want to change individually | runtime raise (a whole-tree re-set would silently break grafts, accessors, and the binding ledger) |
| Wildcard-terminal accessor on a mounted component (`get "tags.*"()` translated onto a list of the host tree) | a getter on the host tree, or a component-private array | runtime raise with guidance |
| `$updatedCallback` receiving other states' paths (`path@name` synthesis) | the name dimension is gone; a volume's `$updatedCallback` receives updates under its own prefix as **relative** paths | the delivered shape changes — see §4 |
| SSR `<wcs-ssr name>` / `Ssr.findByName` | name-less `<wcs-ssr>` / `Ssr.find(root)`. Snapshots written by a 1.x server (with names) are still readable | — |
| `@wcstack/server` `extractStateData()` (deprecated in 1.x) | `Ssr.extractStateData()` from `@wcstack/state` | import error |
| devtools hook protocol v1 (`keys` / `read` / `write` taking a state name, `stateName` payloads) | protocol **v2**: `keys(rootNode)` etc., new `overlays(rootNode)` | `version: 2` (first-wins) — an old devtools build shows nothing |
| Manifest `states[name].stateSchema` (`schemaVersion` 1) | one `stateSchema` (`schemaVersion` 2); volumes are subtrees at their mount path | manifest readers raise a migration-hint error |
| `@wcstack/testing` `state(name)` | `state()` | argument throws with a hint |
| `wcs-schema --state=<name>` | `--mount=<path>` | usage error with a hint |
| `IStateElement.name` / `State.name` (2.1.0) | removed — it was always `"default"` | TypeScript error |

## 4. Behavior changes that are not syntax

- **`$updatedCallback` on a volume** receives the paths under its mount as relative paths (`total`, not `cart.total`), and only those. Root-level callbacks receive absolute paths. Neither receives the private mount-marker paths (`#m<id>`) — since 2.1.0 they are filtered; mount visualization is a devtools concern (`overlays()`).
- **Rule R1 (own keys are private).** When a component is mounted per property, a key that the component itself declares in its `state` is never overridden by the mapping. In v1 a mapping could silently shadow it. The runtime warns with `wcs/mount-own-key-shadow`; the fix is to delete the redundant default.
- **`mount=` is static.** Mount paths may not contain `*`, `$`, `#`, or `@` (`wcs/mount-path-invalid`, error). Changing `mount` after the element initialized is ignored — with a console warning since 2.1.0 — so remove the element and add a new one.
- **One mount scope per component.** Two `<wcs-state bind-component>` elements wiring different props of the same component raise; the ledger is one per component.
- **Whole-tree re-set** via `setInitialState()` on a tree with grafts raises. Write individual paths instead.
- **Performance** is unchanged for pages without components or volumes (measured gate). Lists whose rows are components got faster (create 1k −24%, update −45%, −1.5 KB heap per row).

## 5. Tooling

| Tool | What changes |
|---|---|
| `@wcstack/lint` / VS Code extension | `wcs/named-state-deprecated` is an **error** (it was a warning in 1.33). `wcs/mount-path-invalid` is new. The extension's `@` state-name completions are gone |
| `wcs-schema` (`@wcstack/typescript`) | `--mount=<path>` replaces `--state=`; output is `schemaVersion` 2 with a single `stateSchema`; `--merge` replaces only the slot being written (whole schema, or the subtree at `--mount`) |
| `wcs-validate` with a manifest | `schemaVersion` 1 manifests are rejected with a migration hint — regenerate |
| `@wcstack/testing` | `state()` takes no argument; volumes are read by prefix. `mount()` mounts DOM, `mount=` mounts state |
| `@wcstack/devtools` | Hook protocol v2; requires a 2.x `@wcstack/state`. `overlays(rootNode)` powers the new mount overlay rows; a runtime without it hides the section |
| `@wcstack/server` | `extractStateData()` removed (use `Ssr.extractStateData()`); `<wcs-ssr>` has no `name`; `Ssr.find(root)` replaces `findByName` |
| `wcstack/auto`, CDN pins | All packages are released in lockstep; pin every `@wcstack/*` tag to the same version. SRI digests per release are on the GitHub Release page and in [sri.md](./sri.md) |

## 6. Checklist

```text
[ ] npx @wcstack/lint <every html>        → zero errors
[ ] name="…"  → mount="…"  (name="default" deleted)
[ ] path@x → x.path ; path@default → path   (data-wcs, {{ }}, <!--@@:-->, spread, shorthand)
[ ] Light DOM bind-component: shadow root or host wiring
[ ] $streams / $commandTokens / $eventTokens / $on live on the root state, not in a volume
[ ] tests: state("x") → state() + "x." prefix
[ ] wcs-schema emit re-run (schemaVersion 2; --mount for volumes)
[ ] server: extractStateData → Ssr.extractStateData ; Ssr.findByName → Ssr.find
[ ] devtools: 2.x build alongside 2.x state
[ ] all @wcstack/* pins on one version
```

## 7. Also changed in late 1.x

If you are upgrading from earlier than 1.32.0, these landed in minor releases and may affect you independently of the v2 rename:

- **1.32.0 — `config.locale` defaults to `<html lang>`** (was `'en'`). Pages with a non-English `lang` see `|date` / `|time` / `|datetime` / `|locale` output change. Set `config.locale` explicitly to keep the old output.
- **1.32.0 — `$getAll(path)` with `indexes` omitted** defaults to the enclosing loop context instead of every match; `[]` still means all. Outside a loop, with shared wildcards, it throws.
- **1.32.0 — `<wcs-route>`'s `static wcBindable`** (`params` / `typedParams` / `active`) was removed; bind to the router's `params` / `typedParams` / `searchParams` / `routeName` instead. The `wcs-route:*` events still fire.
- **1.32.0 — same-match navigation**: a query-only navigation to the same route no longer re-runs guards, restamps content, or requests a view transition.
- **1.31.0 — validator severities**: `wcs/nested-assign`, `wcs/array-mutation`, `wcs/array-index-assign` became errors.
- **1.33.0 — `stateSchema` consumption**: with a manifest declaring the state, an unknown path is an error (`wcs/path-nonexistent`), and the manifest is discovered as the nearest `wcstack.manifest.json` above the HTML file.
