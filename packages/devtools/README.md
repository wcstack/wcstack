# @wcstack/devtools

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**In-page DevTools overlay for wcstack.** One `<script>` tag adds a `<wcs-devtools>`
overlay that lets you inspect state trees, see which DOM nodes each state path is
wired to, and watch a live timeline of writes, update batches, and
command/event-token emissions.

- **Zero dependencies, zero build.** Connects to the page's wcstack runtimes only
  through the [DevTools Hook Protocol](../../docs/devtools-hook-protocol.md)
  (`globalThis.__WCSTACK_DEVTOOLS_HOOK__`) — it does not import `@wcstack/state`,
  and works even when multiple copies of a runtime are on the page.
- **Standards-first.** The overlay is itself a custom element that renders in its
  own shadow root and never touches the page's DOM, CSS, classes, or styles.
  Highlights are drawn as fixed-position overlay boxes. The shadow root is
  **open**, so a test can read the overlay through
  `document.querySelector("wcs-devtools").shadowRoot` (see
  [Reading the overlay from a test](#reading-the-overlay-from-a-test)).
- **Inert in production paths.** With no devtools attached, the runtime cost of the
  instrumentation in `@wcstack/state` is a single null check per site; the overlay
  is only present when you add the script tag. SSR renders nothing.

## Quick start

```html
<!-- load BEFORE @wcstack/state so the wiring ledger is live from the start (see Late attach) -->
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

Open the panel with the floating **WCS** badge or **Alt+Shift+D**. Since 4.21,
the badge carries a red count when something failed on the page (see [Failures](#failures)).

The auto entry defines `<wcs-devtools>` and appends one to `<body>` if the page
does not already contain one. To control placement/attributes, write the tag
yourself:

```html
<wcs-devtools open dock="right" hotkey="Ctrl+Shift+X" buffer="1000"></wcs-devtools>
```

## Panes

| Pane | What it shows |
|---|---|
| **State** | Every root state tree (one per root node, labelled by its root — v2 has no name dimension): top-level keys, expandable arrays/objects, computed getters. Click a value to edit it inline — the write goes through the normal reactive pipeline (set trap → update batch → DOM), so the page reacts exactly as if application code had written it. Click a **path** to highlight the DOM nodes bound to it. Below the tree, **Overlays** lists the mount records and **Keyed selection** the `$eq` / `$eqPath` / `$eqIndex` subscriptions per path — rows, keys, list watchers and the last value — with a `tracked` badge when the path is a getter, so every getter reading it re-evaluates (`@wcstack/state` 3.0+). While the panel is open, the pane is read again after every update batch (at most once per frame, and also while the timeline is paused); it holds still while an inline edit has focus or a pointer is pressed in it, then catches up. |
| **Wiring** | The live binding ledger: `property ← path` rows per binding, with type badges (`text` / `prop` / `for` / …). Use **⌖ pick** to click a page element and see only its bindings. Rows highlight their bound nodes on click. Since 4.21, a row whose path the runtime reported as not resolving (`state:path-unresolved`, matched by the path as reported — `rows.*.amountLabl` — and the runtime that reported it) carries an **`unresolved`** badge; its tooltip names the segment that is not declared. The runtime's check stays silent where it cannot tell (a sub-property of a getter's value other than the rows of a list, a `null` parent; up to `@wcstack/state` 4.20 also a row of a list a getter returns and a list that is still empty — 4.21 checks those), so a row without the badge is not proof that its path resolves — `npx @wcstack/lint` reads those. The **coverage** toggle compares what the state declares with what has happened since the panel started observing: each `$watch` key (`fired` ×n / `never`), each command and event token (`emitted` ×n / `never` / `emitted-unheard` — every emit had zero subscribers) and each declared binding (`attached` / `never-attached`). With `@wcstack/state` 3.x, a wildcard row watch whose list has no `for` binding and no `$listKeys` declaration shows `prerequisite-missing` instead of `never` (3.x list writes do not reach such a watch); 4.0 row watches need neither, so a 4.0 page never shows it. |
| **Timeline** | A ring buffer (default 500) of `write` (with old value when available), `batch` (deduplicated update addresses per drain), `command` / `event` token emissions (with argument summaries and subscriber counts — **zero-subscriber emissions get a warning badge**, catching wired-before-`whenDefined` races), state element registration, and the [failures](#failures) the runtime isolated or cut off (warning badges). ⏸ pauses, 🗑 clears. Since 4.21, the **failures** button in the header shows only the failures. |

## Failures

Since 4.21. A failure is something the runtime only logs to the
console and then carries on from, so the page keeps running as if nothing happened:

| Timeline kind | What happened |
|---|---|
| `binding-apply-error` | A binding threw while applying (a `for:` list whose getter threw, for one); the rest of the batch was applied |
| `watch-error` | A `$watch` (or `$scan`) threw — the detail starts with the phase |
| `path-unresolved` | A bound or watched path does not resolve on the state; its updates are dropped |
| `watch-chain-limit` / `render-chain-limit` | A chain of writes hit the depth limit and was cut off |
| `propagation-hop-limit` | A two-way propagation chain hit the hop limit |
| `contract-drift` | A sidecar manifest disagrees with the live `wcBindable` declaration |

- **Badge.** While there are failures, the closed badge shows their number in a red
  corner (`99+` from 100). With none it looks as it always did.
- **Header.** The panel's header shows `⚠ 2 failures` (`0 failures`, dimmed, when
  there are none). Press it to show only the failures in the Timeline; press again
  to show everything.
- Failures are kept in a buffer of their own (the `buffer` size), so a busy page's
  `write` / `batch` rows do not push them out of view. ⏸ does not stop them being
  counted; 🗑 clears them and resets the count.
- A `command` / `event` emission with zero subscribers keeps its warning badge but is
  not counted: an event nobody listens to is often intended.

## Reading the overlay from a test

The overlay renders in an open shadow root, so a test reads it like any other
element — no screenshots or mouse coordinates needed. Playwright's CSS locators go
through open shadow roots by themselves
(`page.locator('wcs-devtools button[data-role="failures"]')`). The header buttons carry
`data-role`: `failures`, `pick`, `pause`, `clear`, `dock`, `close`.

```js
const devtools = document.querySelector("wcs-devtools");
devtools.toggle(true);                                     // open the panel
devtools.shadowRoot.querySelector(".pane-timeline .pane-body").textContent;
devtools.shadowRoot.querySelector('button[data-role="failures"]').textContent; // "⚠ 2 failures"

// the element's DevtoolsCore (null while disconnected) answers without the DOM
devtools.core.getTimeline();   // every row: { kind, label, detail, … }
devtools.core.failureCount;    // since 4.21
devtools.core.getFailures();   // since 4.21: the failure rows only
```

## Attributes

| Attribute | Default | Meaning |
|---|---|---|
| `open` | closed | Panel visibility (toggled by badge/hotkey) |
| `dock` | `bottom` | `bottom` or `right` |
| `hotkey` | `Alt+Shift+D` | Toggle shortcut; `none` disables |
| `buffer` | `500` | Timeline ring-buffer capacity (read at connect) |

## Late attach

What devtools sees when it loads (or is injected) **after** the bindings were
built depends on the runtime it talks to through the hook protocol:

- **`@wcstack/state` 4.0** can list its bindings: when devtools attaches, the
  runtime sends every current binding as `state:binding-added`, so the Wiring
  pane shows the live ledger, as if devtools had loaded first.
- **`@wcstack/state` 3.x** keeps no ledger it can list, so the
  `binding-added` events from before the attach are lost. The Wiring pane falls
  back to a **declared** view (the `data-wcs` attributes and `wcs-*` comments,
  scanned again) and offers a reload link.

With either runtime, everything else works fully: the state tree, editing, and
the timeline from that point on (earlier events are not replayed). See
protocol §6.

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
core.onChange((kind) => { /* "sources" | "roster" | "wiring" | "timeline" | "coverage" | "values" */ });
core.getRoster();      // observed <wcs-state> elements
core.getCoverageReport(); // declared × observed (the coverage view)
core.getTimeline();    // ring buffer snapshot
```

Since 4.21: `core.failureCount` and `core.getFailures()` (see
[Failures](#failures)), `isFailureKind(kind)` (the kinds counted as failures), and
`core.getUnresolvedReport(wiringEntry)` (the `state:path-unresolved` report that
matches a wiring row, or `null`).

## License

MIT
