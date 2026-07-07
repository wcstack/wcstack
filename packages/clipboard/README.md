# @wcstack/clipboard

`@wcstack/clipboard` is a headless clipboard component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns clipboard access into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/geolocation` turns the device's location into reactive state.

Unlike geolocation (a read-only sensor), the clipboard is **bidirectional**, which makes `<wcs-clipboard>` the showcase for both directions of the wc-bindable token protocol:

- **write** (`state → element`) via the command-token protocol — `command.writeText: $command.copy`
- **read** (`element → state`) via command results, plus a monitor mode that republishes the user's `copy` / `cut` / `paste` via the event-token protocol — `eventToken.pasted: clipboardPasted`

With `@wcstack/state`, `<wcs-clipboard>` can be bound directly through path contracts:

- **input surface**: `monitor`
- **command surface**: `writeText`, `write`, `readText`, `read`, `startMonitor`, `stopMonitor`
- **output state surface**: `text`, `items`, `loading`, `error`, `readPermission`, `writePermission`, `monitoring`, `copied`, `cut`, `pasted`

This means clipboard work can be expressed declaratively in HTML, without writing `navigator.clipboard.writeText()`, `readText()`, `read()`, event listeners, or teardown glue in your UI layer.

`@wcstack/clipboard` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`ClipboardCore`) handles read/write, rich `ClipboardItem` normalization, error handling, monitor subscriptions, and live permission tracking
- **Shell** (`<wcs-clipboard>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

The Clipboard API is, like `fetch`, an asynchronous source of values — but it is bidirectional (read *and* write) and gated by two separate permissions (`clipboard-read` / `clipboard-write`). Imperatively it requires gesture-bound calls, permission queries, event wiring, and cleanup on disconnect.

`@wcstack/clipboard` moves that logic into a reusable component and exposes the result as bindable state. A copy or a paste becomes a **state transition**, not imperative callback wiring.

> **Secure context + user gesture required.** The Clipboard API only works in a secure context (HTTPS, or `localhost`). Writes (`writeText` / `write`) require transient activation — call them from a click handler or a command-token wired to a user action. Reads (`readText` / `read`) require focus and read permission. When `navigator.clipboard` is absent (non-secure context or unsupported browser), commands surface a `NotSupportedError` through the `error` property rather than throwing. Firefox does not expose the clipboard permission names, so `readPermission` / `writePermission` fall back to `"unsupported"` there.

## Install

```bash
npm install @wcstack/clipboard
```

## Quick Start

### 1. Copy text (write)

Writes need a user gesture, so drive them from a DOM click (autoTrigger) or a command-token.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/clipboard/auto"></script>

<wcs-clipboard id="cb"></wcs-clipboard>

<!-- Optional DOM triggering: click copies the literal text -->
<input id="token" value="abc-123" readonly />
<button data-clipboardtarget="cb" data-clipboard-from="#token">Copy</button>
<button data-clipboardtarget="cb" data-clipboard-text="Hello!">Copy greeting</button>
```

`data-clipboard-text` copies a literal string; `data-clipboard-from` copies the `value` (or `textContent`) of the element matched by the selector.

### 2. Copy from state (command-token)

```html
<wcs-state>
  <script type="module">
    export default {
      message: "Shareable link",
      $commandTokens: ["copy"],
      onShare() { this.$command.copy.emit(this.message); }
    };
  </script>
</wcs-state>

<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
<button data-wcs="onclick: onShare">Share</button>
```

### 3. Read text (paste on demand, command-token)

The DOM autoTrigger only drives **writes** (`writeText`); there is no DOM-trigger
path for reads. Drive a read from a command-token, or call `readText()` /
`read()` imperatively on the element.

```html
<wcs-state>
  <script type="module">
    export default {
      pasted: "",
      busy: false,
      $commandTokens: ["paste"],
      onPaste() { this.$command.paste.emit(); }
    };
  </script>
</wcs-state>

<wcs-clipboard
  data-wcs="command.readText: $command.paste; text: pasted; loading: busy"></wcs-clipboard>
<button data-wcs="onclick: onPaste">Paste</button>
<p data-wcs="textContent: pasted"></p>
```

> Reading requires focus + read permission; the browser may prompt. Bind `error` to handle a denied read.

### 4. Monitor the user's clipboard activity (event-token)

Add the `monitor` attribute to republish document `copy` / `cut` / `paste` as reactive state.

```html
<wcs-state>
  <script type="module">
    export default {
      lastPaste: "",
      $eventTokens: ["clipboardPasted"],
      $on: {
        clipboardPasted: (state, event) => { state.lastPaste = event.detail; }
      }
    };
  </script>
</wcs-state>

<wcs-clipboard monitor
  data-wcs="pasted: lastPaste; eventToken.pasted: clipboardPasted"></wcs-clipboard>
```

## Attributes / Inputs

| Attribute | Type    | Default | Description                                                                 |
| --------- | ------- | ------- | --------------------------------------------------------------------------- |
| `monitor` | boolean | `false` | Subscribe to document `copy` / `cut` / `paste` on connect and republish them as `copied` / `cut` / `pasted`. |

### DOM trigger attributes (autoTrigger, copy-on-click)

| Attribute             | On             | Description                                                             |
| --------------------- | -------------- | ---------------------------------------------------------------------- |
| `data-clipboardtarget`| trigger button | Id of the `<wcs-clipboard>` to drive.                                  |
| `data-clipboard-text` | trigger button | Literal text to copy (takes precedence; empty string is valid).        |
| `data-clipboard-from` | trigger button | CSS selector; copies the matched element's `value` (or `textContent`). |

> DOM triggers are **write-only**: a click always drives `writeText`. There is no DOM-trigger path for reads (`readText` / `read`) — drive reads from a command-token or imperatively.

> A DOM-triggered `writeText` is fire-and-forget (its `Promise` is not awaited), but it never rejects: a failed copy surfaces through the `error` property like any other write. Bind `error` (e.g. `text: error.message@cb`) to observe autoTrigger failures.

> **autoTrigger is on by default.** The first `<wcs-clipboard>` to connect installs a single **document-level `click` listener** (a click on a `data-clipboardtarget` element runs `writeText`). If you don't use the DOM shortcut, opt out via the bootstrap entry:
>
> ```js
> import { bootstrapClipboard, getConfig } from "@wcstack/clipboard";
> bootstrapClipboard({ autoTrigger: false });        // no document click listener
> bootstrapClipboard({ triggerAttribute: "data-copy" }); // rename the trigger attribute (default: data-clipboardtarget)
> getConfig();                                        // read the effective (deep-frozen) config
> ```
>
> Call `bootstrapClipboard()` before the elements connect. (`setConfig` is internal; configure through `bootstrapClipboard`.)

## Observable Properties (outputs)

| Property         | Event                                    | Description                                                            |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `text`           | `wcs-clipboard:read`                     | Plain text from the last `readText()` / `read()` (or `null`).        |
| `items`          | `wcs-clipboard:read`                     | Normalized `ClipboardItem` snapshot from `read()` (`{ types, data }[]`), or `null`. |
| `loading`        | `wcs-clipboard:loading-changed`          | `true` during any async read/write.                                  |
| `error`          | `wcs-clipboard:error`                    | Normalized `{ name, message }` (e.g. `NotAllowedError`, `NotSupportedError`). |
| `readPermission` | `wcs-clipboard:read-permission-changed`  | `"prompt"` / `"granted"` / `"denied"` / `"unsupported"` for `clipboard-read`. |
| `writePermission`| `wcs-clipboard:write-permission-changed` | Same states for `clipboard-write`.                                   |
| `monitoring`     | `wcs-clipboard:monitoring-changed`       | `true` while monitoring document clipboard events.                  |
| `copied`         | `wcs-clipboard:copied`                   | Text of the latest monitored `copy` (from the selection).           |
| `cut`            | `wcs-clipboard:cut`                      | Text of the latest monitored `cut`.                                 |
| `pasted`         | `wcs-clipboard:pasted`                   | `text/plain` of the latest monitored `paste`.                       |

## Commands

| Command       | Description                                                                |
| ------------- | ------------------------------------------------------------------------- |
| `writeText`   | Write a string to the clipboard (async; never rejects — failures go to `error`). Needs a user gesture. |
| `write`       | Write `ClipboardItem[]` (images, HTML, multiple MIME types) (async).      |
| `readText`    | Read plain text; publishes `text` and `wcs-clipboard:read` (async).       |
| `read`        | Read rich `ClipboardItem`s, resolving each representation to a `Blob` (async). |
| `startMonitor`| Begin monitoring document `copy` / `cut` / `paste` (no-op if already monitoring). |
| `stopMonitor` | Stop monitoring; `monitoring` becomes `false`.                            |

State-driven invocation uses the command-token protocol:

```html
<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
```

## Notes & limitations

- **Attributes are read at connect time, not observed.** `<wcs-clipboard>` does not implement `observedAttributes` / `attributeChangedCallback`. The `monitor` attribute is read when the element connects — toggling it imperatively after connect does not start/stop monitoring by itself; call `startMonitor()` / `stopMonitor()`, or re-connect the element.
- **No connect-time read.** Unlike `<wcs-geo>`, the clipboard cannot auto-read on connect (reads need a user gesture and permission); the connect-time actions are an initial permission probe and optional monitoring. It still exposes `connectedCallbackPromise` (`hasConnectedCallbackPromise = true`) — a state binder / SSR awaits it so the initial permission snapshot has settled before binding.
- **Reconnect re-subscribes.** Removing and re-inserting the element runs `connectedCallback` again, so permission tracking is revived and a `monitor`-attribute element restarts monitoring (matching how it tears them down on disconnect). Monitoring persistence is **attribute-driven only**: if you started monitoring imperatively with `startMonitor()` on an element *without* the `monitor` attribute, a reconnect does not restore it (the attribute is the source of truth). Add the `monitor` attribute for persistent monitoring across reparents.
- **`copy` / `cut` text comes from the selection.** During a `copy` / `cut` event the clipboard payload is not yet readable (the browser returns an empty string for security reasons), so `copied` / `cut` report `document.getSelection().toString()` — the user's selected text. If the page installs a custom `copy` handler that overrides the payload via `clipboardData.setData(...)`, that override is **not** reflected in `copied` / `cut`. `pasted` reads `event.clipboardData.getData("text/plain")`.
- **Silent failure handling (zero-log).** Consistent with the rest of wcstack's zero-dependency, minimal philosophy, `<wcs-clipboard>` never logs or throws for runtime failures. A failed permission query (e.g. Firefox, which has no clipboard permission names) silently falls back to `"unsupported"`. Read/write failures (denied permission, no focus, missing Clipboard API) are surfaced only through the `error` property / `wcs-clipboard:error` event — the commands resolve and never reject. Bind `error` (and the `*Permission` properties) to observe and react.

## Headless usage (`ClipboardCore`)

The Core has no DOM dependency beyond the global `document` / `navigator` and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { ClipboardCore } from "@wcstack/clipboard";

const clip = new ClipboardCore();
clip.addEventListener("wcs-clipboard:read", (e) => {
  console.log((e as CustomEvent).detail); // { text, items }
});

await clip.writeText("hello");
await clip.readText();
// or, to monitor the user's clipboard activity:
clip.startMonitor();
// ...later
clip.stopMonitor();
```

## License

MIT
