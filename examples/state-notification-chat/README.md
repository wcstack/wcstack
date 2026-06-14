# chat notifications demo

`@wcstack/state` + `@wcstack/notification` (`<wcs-notify>`) + `@wcstack/permission` (`<wcs-permission>`). Desktop notifications driven from state: show via command-token, click back via event-token — both directions in one tag.

## Getting Started

Open `index.html` in a browser (any static server, or `localhost`). No build step — everything loads from `esm.run`. Notifications need a secure context: `localhost` or `https://` works; `file://` may not prompt. Click **Allow notifications** first, then **Simulate new message**; clicking the OS notification updates "Last opened".

## Features

- **`notify` command-token (state → element)**: `this.$command.notify.emit("New message #1", { body, tag, data })`. The positional args pass straight through to `notify(title, options)` — the same argument-forwarding contract used by `<wcs-speak>`/`<wcs-fetch>`.
- **`clicked` event-token (element → state)**: the OS notification click flows back into `$on.opened(state, event)`, where `event.detail` is `{ tag, data, action }`. The demo reads `data.room` to show which message was opened.
- **`request` command-token**: `<wcs-notify>` is self-contained — it owns `Notification.requestPermission()`. Unlike `<wcs-permission>` (no `request`), the Notifications API *has* a request standard, so the command-token applies here.
- **`<wcs-permission name="notifications">` banner**: `hidden@granted` hides the prompt the moment the grant flips, with live `change` tracking.

## Key Points

- **One tag, both directions.** `<wcs-notify>` is the first @wcstack node where command-token (show) and event-token (click) live together. `<wcs-permission>` next to it stays a pure watcher (event-token only).
- **`notify` vs `notice`.** The demo uses the imperative `notify` command (fires every call). For "show when a bound value changes", bind the reactive `notice` input instead — it has a same-value guard. Auto-firing on every change risks notification spam, so reach for a `debounce` filter.
- **Backend & mobile.** `mode="auto"` (default) shows via the `Notification` constructor on desktop and falls back to the Service Worker on mobile, where `new Notification()` is illegal. For the SW path, import `wireNotificationClicks()` from `@wcstack/notification/sw` into your Service Worker so clicks relay back to the page.
