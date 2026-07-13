# @wcstack/devtools

**In-page DevTools overlay for wcstack.** One `<script>` tag adds a `<wcs-devtools>`
overlay that lets you inspect state trees, see which DOM nodes each state path is
wired to, and watch a live timeline of writes, update batches, and
command/event-token emissions.

- **Zero dependencies, zero build.** Connects to the page's wcstack runtimes only
  through the [DevTools Hook Protocol](../../docs/devtools-hook-protocol.md)
  (`globalThis.__WCSTACK_DEVTOOLS_HOOK__`) — it does not import `@wcstack/state`,
  and works even when multiple copies of a runtime are on the page.
- **Standards-first.** The overlay is itself a custom element rendered in a closed
  world (Shadow DOM); it never touches the page's DOM, CSS, classes, or styles.
  Highlights are drawn as fixed-position overlay boxes.
- **Inert in production paths.** With no devtools attached, the runtime cost of the
  instrumentation in `@wcstack/state` is a single null check per site; the overlay
  is only present when you add the script tag. SSR renders nothing.

## Quick start

```html
<!-- load BEFORE @wcstack/state so the wiring ledger is captured live -->
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

Open the panel with the floating **WCS** badge or **Alt+Shift+D**.

The auto entry defines `<wcs-devtools>` and appends one to `<body>` if the page
does not already contain one. To control placement/attributes, write the tag
yourself:

```html
<wcs-devtools open dock="right" hotkey="Ctrl+Shift+X" buffer="1000"
              hidden-states="analytics"></wcs-devtools>
```

## Panes

| Pane | What it shows |
|---|---|
| **State** | Every `<wcs-state>` (per runtime source): top-level keys, expandable arrays/objects, computed getters. Click a value to edit it inline — the write goes through the normal reactive pipeline (set trap → update batch → DOM), so the page reacts exactly as if application code had written it. Click a **path** to highlight the DOM nodes bound to it. |
| **Wiring** | The live binding ledger: `property ← path@state` rows per binding, with type badges (`text` / `prop` / `for` / …). Use **⌖ pick** to click a page element and see only its bindings. Rows highlight their bound nodes on click. |
| **Timeline** | A ring buffer (default 500) of `write` (with old value when available), `batch` (deduplicated update addresses per drain), `command` / `event` token emissions (with argument summaries and subscriber counts — **zero-subscriber emissions get a warning badge**, catching wired-before-`whenDefined` races), and state element registration. ⏸ pauses, 🗑 clears. |

## Attributes

| Attribute | Default | Meaning |
|---|---|---|
| `open` | closed | Panel visibility (toggled by badge/hotkey) |
| `dock` | `bottom` | `bottom` or `right` |
| `hotkey` | `Alt+Shift+D` | Toggle shortcut; `none` disables |
| `buffer` | `500` | Timeline ring-buffer capacity (read at connect) |
| `hidden-states` | — | Comma-separated state names to hide (names starting with `wcs-devtools` are always hidden) |

## Late attach

If devtools loads (or is injected) **after** bindings were built, past
`binding-added` events are unrecoverable — the Wiring pane falls back to a
**declared** view (re-scanning `data-wcs` attributes and `wcs-*` comments) and
offers a reload link; everything else (state tree, editing, timeline from that
point on) works fully. See protocol §6.

## Notes & limitations

- The panel repaints on `requestAnimationFrame`; in a hidden/background tab
  (where the overlay is invisible anyway) rendering pauses until the next frame.
- While open, the docked panel covers part of the page — dock it to the other
  side or close it to interact with covered controls.
- `@wcstack/signals` support is planned (the protocol reserves `kind: "signals"`);
  v1 covers `@wcstack/state`.

## Programmatic use

The pieces are exported for building your own tooling on the same protocol:

```js
import { DevtoolsCore, getOrCreateHookRegistry, formatValue, scanDeclaredBindings }
  from "@wcstack/devtools";

const core = new DevtoolsCore({ timelineCapacity: 200 });
core.connect();
core.onChange((kind) => { /* "sources" | "roster" | "wiring" | "timeline" */ });
core.getRoster();      // observed <wcs-state> elements
core.getTimeline();    // ring buffer snapshot
```

## License

MIT
