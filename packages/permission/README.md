# @wcstack/permission

`@wcstack/permission` is a headless permission-state component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns a browser permission grant into reactive state — the same way `@wcstack/geolocation` turns the device's location into reactive state.

With `@wcstack/state`, `<wcs-permission>` can be bound directly through path contracts:

- **input surface**: `name`, `user-visible-only`, `sysex`
- **output state surface**: `state`, `granted`, `denied`, `prompt`, `unsupported`

This means permission-aware UI — banners, gates, capability hints — can be expressed declaratively in HTML, without writing `navigator.permissions.query()` or `change`-listener glue in your UI layer.

`@wcstack/permission` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`PermissionCore`) handles the query, the four-value state, and live `change` tracking
- **Shell** (`<wcs-permission>`) connects that state to DOM attributes and lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` (and, deliberately, **no commands**)

## Why this exists — a read-only, command-less node

Every other wcstack IO node (`<wcs-geo>`, `<wcs-ws>`, `<wcs-clipboard>`, …) both *does* something and reports state. The Permissions API is different: it is **read-only**. It has `query()` but no standard `request()`. You cannot ask for a grant through it — asking happens as a side effect of calling the feature itself (`getCurrentPosition()`, `Notification.requestPermission()`, …).

So `<wcs-permission>` is a pure **element → state** producer: it *watches*, it never *asks*. It is the first wcstack node with **no commands at all** — command-token does not apply, only event-token. Acquiring a grant is the job of the feature node (`<wcs-geo>` etc.); this node just reflects the current grant as bindable state, live.

A permission change becomes a **state transition**, not a `change`-listener subscription.

> **Secure context required.** The Permissions API only works in a secure context (HTTPS, or `localhost`). Where it is absent — or the browser rejects the requested permission name (support varies widely: Firefox has no `clipboard-read`, Safari omits several names) — `<wcs-permission>` reports `state = "unsupported"` instead of throwing.

## Install

```bash
npm install @wcstack/permission
```

## Quick Start

### 1. Watch a grant and gate the UI

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default { granted: false };
  </script>
</wcs-state>

<wcs-permission name="geolocation" data-wcs="granted: granted"></wcs-permission>

<!-- One boolean, straight from the watcher: shown until granted. -->
<div data-wcs="hidden: granted">Please allow location to continue.</div>
```

### 2. The four-value state

```html
<wcs-permission name="camera"
  data-wcs="state: camState"></wcs-permission>
```

`state` is `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`, and updates live when the user changes the grant in browser settings.

### 3. Descriptors that take extra members

Some permissions need more than a name. Use the matching boolean attribute:

```html
<!-- push: query({ name: "push", userVisibleOnly: true }) -->
<wcs-permission name="push" user-visible-only data-wcs="state: pushPerm"></wcs-permission>

<!-- midi: query({ name: "midi", sysex: true }) -->
<wcs-permission name="midi" sysex data-wcs="state: midiPerm"></wcs-permission>
```

### 4. Watcher + acquirer, side by side

`<wcs-permission>` watches; `<wcs-geo>` asks. The button drives the feature node, not the permission node.

```html
<wcs-permission name="geolocation" data-wcs="granted: granted; denied: denied"></wcs-permission>
<wcs-geo manual data-wcs="command.getCurrentPosition: $command.locate; latitude: lat"></wcs-geo>

<button data-wcs="onclick: locate; disabled: denied">Locate me</button>
```

See `examples/state-permission-banner` for the full demo.

## Attributes / Inputs

| Attribute           | Type    | Default | Description                                                                 |
| ------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `name`              | string  | `""`    | The permission name to query (e.g. `geolocation`, `notifications`, `camera`). Required — an empty `name` short-circuits to `state = "unsupported"` without querying. |
| `user-visible-only` | boolean | `false` | Adds `userVisibleOnly: true` to the descriptor (for the `push` permission). |
| `sysex`             | boolean | `false` | Adds `sysex: true` to the descriptor (for the `midi` permission).           |

## Observable Properties (outputs)

| Property      | Event                  | Description                                                              |
| ------------- | ---------------------- | ----------------------------------------------------------------------- |
| `state`       | `wcs-permission:change`| `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`, tracked live.   |
| `granted`     | `wcs-permission:change`| `true` when `state === "granted"`. Convenience for `hidden@granted` etc. |
| `denied`      | `wcs-permission:change`| `true` when `state === "denied"`.                                       |
| `prompt`      | `wcs-permission:change`| `true` when `state === "prompt"`.                                       |
| `unsupported` | `wcs-permission:change`| `true` when the permission cannot be queried in this environment.       |

All five derive from the single `wcs-permission:change` event (the booleans change in lockstep with `state`).

## Commands

**None.** The Permissions API is read-only — there is no `request()` to call. Acquiring a grant is the feature node's responsibility (e.g. `<wcs-geo>`'s `getCurrentPosition`). `<wcs-permission>` is a pure monitor.

## Notes & limitations

- **Attributes are read at connect time, not observed.** `<wcs-permission>` does not implement `observedAttributes` / `attributeChangedCallback`. The descriptor (`name` + extras) is fixed when the element connects; changing `name` imperatively after connect does not re-query. To watch a different permission, use a separate element (or re-connect).
- **Reconnect re-queries.** Removing and re-inserting the element runs `connectedCallback` again, re-issuing the query and re-subscribing to `change` (matching how it tears the subscription down on disconnect). A query still in flight when the element disconnects is invalidated: if it resolves afterwards it neither updates `state` nor attaches a `change` listener, so a rapid disconnect→reconnect cannot leak a stale subscription.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, so the server renderer waits for the connect-time query to settle before snapshotting.
- **Silent failure handling (zero-log).** Consistent with the rest of wcstack's zero-dependency philosophy, `<wcs-permission>` never logs or throws. A missing Permissions API, a browser that rejects the requested permission name, or a missing/empty `name` attribute all silently resolve to `state = "unsupported"`. Bind `unsupported` (or `state`) to react.

## Headless usage (`PermissionCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { PermissionCore } from "@wcstack/permission";

const perm = new PermissionCore({ name: "geolocation" });
perm.addEventListener("wcs-permission:change", (e) => {
  console.log((e as CustomEvent).detail); // "prompt" | "granted" | "denied" | "unsupported"
});

await perm.ready;        // first query has settled
console.log(perm.granted);

// later, when done:
perm.dispose();          // detach the live `change` listener
```

## License

MIT
