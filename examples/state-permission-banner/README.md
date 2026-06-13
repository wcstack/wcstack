# permission banner demo

`@wcstack/state` + `@wcstack/permission` (`<wcs-permission>`) + `@wcstack/geolocation` (`<wcs-geo>`). A permission-aware banner driven purely from watched state — the page never touches `navigator.permissions`.

## Getting Started

Open `index.html` in a browser (any static server, or just the file). No build step — everything loads from `esm.run`. Geolocation needs a secure context: `localhost` or `https://` works; `file://` may not prompt in some browsers.

## Features

- **`<wcs-permission name="geolocation">` watches** the grant and reports `state` / `granted` / `prompt` / `denied` / `unsupported` as state. It is read-only: no commands, no prompt.
- **`<wcs-geo>` acquires** the fix on click via command-token (`$command.locate.emit()` → `getCurrentPosition()`), binding `latitude` / `longitude` / `loading` back.
- **Banner with `hidden@granted`**: the banner is one boolean away from the watched state — shown while not granted, gone the moment the grant flips. Live `change` tracking means flipping the permission in browser settings updates the UI without a reload.

## Key Points

- **Two responsibilities, two elements.** Asking for a grant is the feature node's job (`<wcs-geo>`); the permission node only observes. This is why `<wcs-permission>` has no `request` command — the Permissions API has no `request()`.
- **command-token does not apply to the watcher.** `<wcs-permission>` is a pure element → state producer (event-token only). The button drives `<wcs-geo>`, not the permission element.
- `denied` disables the button and switches the banner copy to a "blocked in settings" message — all derived state, no imperative branching in the UI layer.
