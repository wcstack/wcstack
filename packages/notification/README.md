# @wcstack/notification

`@wcstack/notification` is a headless desktop-notification component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the Notifications API into reactive state and a state-driven command — the same way `@wcstack/geolocation` turns the device's location into reactive state.

With `@wcstack/state`, `<wcs-notify>` can be bound directly through path contracts:

- **command surface**: `request`, `notify`, `close`, `closeAll`
- **input surface**: `notice` (reactive show), `mode`, `body`, `icon`, `badge`, `tag`, `lang`, `dir`, `require-interaction`, `silent`, `renotify`
- **output state surface**: `permission`, `granted`, `denied`, `prompt`, `unsupported`, `error`, `clicked`, `closed`, `shown`

`@wcstack/notification` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`NotificationCore`) handles permission, showing (constructor or Service Worker), and click relaying
- **Shell** (`<wcs-notify>`) connects that to DOM attributes, the reactive `notice` input, and lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties`, `inputs`, and `commands`

## Why this exists — both directions in one tag

Most wcstack IO nodes lean one way: `<wcs-permission>` only *watches* (it has no commands, because the Permissions API has no `request()`); `<wcs-speak>`/`<wcs-listen>` split a duo across two tags. The Notifications API is different — it is genuinely **bidirectional in a single API**:

- **show** is a command (state → element): `notify(title, options)`.
- **click / close / show** are events (element → state): the user interacting with the OS notification.

So `<wcs-notify>` is the first wcstack node where the **command-token** (show) and **event-token** (click) directions live together in one tag. And unlike `<wcs-permission>`, the Notifications API *does* have `Notification.requestPermission()`, so this node is **self-contained**: it both requests/monitors the permission and shows notifications.

> **Secure context required.** The Notifications API only works in a secure context (HTTPS, or `localhost`). Where it is absent, `<wcs-notify>` reports `permission = "unsupported"` instead of throwing. Requesting permission and showing also typically require a user gesture — firing `notify` from a timer may show nothing.

## Install

```bash
npm install @wcstack/notification
```

## Quick Start

### 1. Ask, then show — from state

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/notification/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["request", "notify"],
      $eventTokens: ["opened"],
      ask()  { this.$command.request.emit(); },
      send() { this.$command.notify.emit("New message", { body: "Tap to open", tag: "chat", data: { room: 7 } }); },
      $on: {
        opened: (state, event) => { console.log("clicked", event.detail); }, // { tag, data, action }
      },
    };
  </script>
</wcs-state>

<wcs-notify data-wcs="
  command.request: $command.request;
  command.notify:  $command.notify;
  eventToken.clicked: opened
"></wcs-notify>

<button data-wcs="onclick: ask">Allow notifications</button>
<button data-wcs="onclick: send">New message</button>
```

The positional args of `notify.emit(title, options)` pass straight through to `notify(title, options)` — the same argument-forwarding contract used by `<wcs-speak>`/`<wcs-fetch>`.

### 2. Reactive `notice` vs imperative `notify`

```html
<!-- reactive: shows whenever the bound value *changes* (same-value guard). -->
<wcs-notify data-wcs="notice: statusMessage | debounce(1000)"></wcs-notify>
```

`notice` is the declarative counterpart of `notify`: writing a *changed* value shows it; an identical write is suppressed. The imperative `notify` command fires every call (even the same text). Auto-firing a notification on every state change risks spam, so debounce the bound source and prefer a `tag` so the OS de-dups.

### 3. Permission as bindable state

```html
<wcs-notify data-wcs="permission: notifyPerm; granted: canNotify"></wcs-notify>

<!-- one boolean, straight from the node -->
<div data-wcs="hidden: canNotify">Allow notifications to get alerts.</div>
```

`permission` is `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`. The Notifications API's own `"default"` is normalized to `"prompt"`, so this node shares the exact four-value surface of `@wcstack/permission` / `@wcstack/geolocation`.

### 4. Reading the click

```html
<wcs-notify data-wcs="command.notify: $command.notify; eventToken.clicked: opened"></wcs-notify>
```

`clicked` / `closed` / `shown` carry `{ tag, data, action }`. `tag` identifies the notification (your `options.tag`, or a generated `wcs-<n>` when omitted); `data` is whatever you passed in `options.data`; `action` is the Service Worker action-button id (always `""` for the constructor backend).

See `examples/state-notification-chat` for the full demo.

## Service Worker / mobile

`new Notification()` works on desktop only. On Android Chrome it throws, and `ServiceWorkerRegistration.showNotification()` is required. `<wcs-notify>` picks the backend per `mode`:

| `mode`        | Behavior                                                                          |
| ------------- | --------------------------------------------------------------------------------- |
| `auto` (default) | Try the `Notification` constructor; on a `TypeError` (mobile), fall back to the SW. |
| `constructor` | Constructor only; a `TypeError` surfaces as an `error` (no fallback).             |
| `sw`          | Always `ServiceWorkerRegistration.showNotification()`.                            |

The SW's `notificationclick` fires inside **your** Service Worker, which this package cannot inject into. Import the one-line helper so clicks relay back to the page:

```js
// your sw.js
import { wireNotificationClicks } from "@wcstack/notification/sw";
wireNotificationClicks();
```

It relays each click over `BroadcastChannel("wcs-notify")` (primary) and `clients.postMessage` (fallback); `NotificationCore` on the page de-dups the two transports and emits `wcs-notify:click`.

## Attributes / Inputs

| Attribute             | Type    | Default | Description                                                                 |
| --------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `mode`                | string  | `auto`  | Show backend: `auto` / `sw` / `constructor`.                                |
| `body`                | string  | `""`    | Notification body text.                                                     |
| `icon`                | string  | `""`    | Icon URL.                                                                   |
| `badge`               | string  | `""`    | Badge URL (monochrome, mobile).                                             |
| `tag`                 | string  | `""`    | Notification tag (the OS replaces a notification with the same tag).        |
| `lang`                | string  | `""`    | Language tag.                                                               |
| `dir`                 | string  | `""`    | Text direction: `auto` / `ltr` / `rtl`.                                     |
| `require-interaction` | boolean | `false` | Keep the notification visible until the user dismisses it.                  |
| `silent`              | boolean | `false` | Suppress sound/vibration.                                                   |
| `renotify`            | boolean | `false` | Re-alert when replacing a same-tag notification.                            |
| `manual`              | boolean | `false` | Mute the reactive `notice` path (the `notify` command still works).         |

`notice` is a reactive input (no attribute): writing a changed value shows a notification. Per-call `notify(title, options)` options win per-key over these attribute defaults.

## Observable Properties (outputs)

| Property      | Event                          | Description                                                       |
| ------------- | ------------------------------ | ----------------------------------------------------------------- |
| `permission`  | `wcs-notify:permission-change` | `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`, live.    |
| `granted` / `denied` / `prompt` / `unsupported` | `wcs-notify:permission-change` | Convenience booleans derived from `permission`. |
| `error`       | `wcs-notify:error`             | `{ error, message }` on a failure (never-throw), else `null`.     |
| `clicked`     | `wcs-notify:click`             | `{ tag, data, action }` of the last click (event-token source).   |
| `closed`      | `wcs-notify:close`             | `{ tag, data, action }` of the last close.                        |
| `shown`       | `wcs-notify:show`              | `{ tag, data, action }` of the last shown notification.           |

## Commands

| Command      | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| `request()`  | `Notification.requestPermission()`; resolves to the normalized permission state.  |
| `notify(title, options?)` | Show a notification; returns its identifying tag.                    |
| `close(tag)` | Dismiss the notification(s) with `tag`.                                           |
| `closeAll()` | Dismiss every notification this element has shown.                                |

## Notes & limitations

- **Notifications outlive the page.** Disconnecting `<wcs-notify>` (or calling `dispose()` on the Core) detaches its subscriptions but does **not** close open notifications — a notification is meant to persist past the page. Use `close` / `closeAll` to dismiss.
- **Push API is out of scope.** This package wraps the Notifications API (local notifications). Server-initiated Push is a separate concern.
- **Silent failure handling (zero-log).** Consistent with wcstack's zero-dependency philosophy, `<wcs-notify>` never logs or throws. A missing API → `permission = "unsupported"`; a not-granted permission or a show failure → the `error` property. Bind `error` / `permission` to react.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, so the server renderer waits for the connect-time permission probe before snapshotting.

## Headless usage (`NotificationCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { NotificationCore } from "@wcstack/notification";

const notify = new NotificationCore();
await notify.observe();          // start watching permission + click relays
await notify.request();          // ask the user

notify.addEventListener("wcs-notify:click", (e) => {
  console.log((e as CustomEvent).detail); // { tag, data, action }
});

const tag = notify.notify("Hello", { body: "world", data: { room: 1 } });
// later:
notify.close(tag);
notify.dispose();                // detach subscriptions (open notifications stay)
```

## License

MIT
