# state + eyedropper + clipboard + storage demo (color palette)

A color-palette picker combining `@wcstack/state`, `@wcstack/eyedropper`, `@wcstack/clipboard` and `@wcstack/storage`. Pick colors from **anywhere on your screen**, click a swatch to copy its hex, and the palette persists across reloads — and syncs across tabs.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so there is no backend and no build — any static server over `http://localhost` (or HTTPS) works.

```bash
npx serve examples/state-color-palette
```

The EyeDropper API is **Chromium-only** (Chrome / Edge); other browsers get a `<input type="color">` fallback so the rest of the demo still works.

## Features

- **Command → event round trip**: `command.open` starts the OS picker; the picked color comes back through the `value` event token as `{ sRGBHex }`. Esc cancels silently (`cancelled` output, not `error`).
- **Argument pass-through copy**: the swatch click handler resolves its row with the wildcard path `this["list.*.hex"]` and emits it — `$command.copy.emit(hex)` arguments are passed verbatim to `writeText(hex)`. `writeText` is fire-and-forget by design (no success event); failures surface on the `error` output.
- **One-line persistence**: `<wcs-storage key="wcs-color-palette" type="local" data-wcs="value#init=element: palette">` gives load-on-connect, save-on-assign and cross-tab sync (native `storage` event) with a single two-way binding. Open the page in two tabs and watch the palettes converge.
- **List diffing**: the palette grid is a `for:` template over a normalizing `list` getter, and every mutation replaces the array, which is what triggers both the re-render and the auto-save.
- **Load-before-bind settled by `#init=element`**: the storage node loads and announces the persisted value in its own `connectedCallback`, which can happen *before* the bindings attach. `value` is a two-way member, so its default authority is `state` and the initial apply would write the seed back and clobber the persisted palette on reload. `#init=element` flips the *initial* sync to element authority: no initial write, and the already-loaded value is pulled into `palette`. Later assignments still flow state→element, so auto-save keeps working.

## Wiring highlights

```html
<wcs-eyedropper
  data-wcs="loading: picking; command.open: $command.pick; eventToken.value: colorPicked"></wcs-eyedropper>

<wcs-clipboard
  data-wcs="error: clipboardError; command.writeText: $command.copy"></wcs-clipboard>

<wcs-storage key="wcs-color-palette" type="local"
  data-wcs="value#init=element: palette; error: storageError"></wcs-storage>
```

- Feature detection is deliberate on the page side: the eyedropper node has no `supported` flag — `typeof EyeDropper === "function"` *is* the flag.
- The clipboard's `copied` event token is **not** used here on purpose: it reports *monitored* copies (user Ctrl+C via `startMonitor()`), not `writeText()` completions.
