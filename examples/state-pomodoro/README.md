# state + timer + wakelock + notification demo (pomodoro)

A pomodoro timer combining `@wcstack/state`, `@wcstack/timer`, `@wcstack/wakelock` and `@wcstack/notification`. The screen is kept awake **only while a focus session is running**, and the session-end desktop notification doubles as the "start the next session" button.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so there is no backend and no build — any static server over `http://localhost` (or HTTPS) works. A secure context is required for wake lock and notifications.

```bash
npx serve examples/state-pomodoro
```

## Features

- **Declarative game clock**: `<wcs-timer interval="1000" manual>` is a plain 1-second metronome. Its `tick` event (detail `{ count, elapsed }`) flows into state through an event token; the whole pomodoro state machine is ~20 lines of state code.
- **Wake lock tied to intent**: `<wcs-wakelock data-wcs="active: keepAwake; held: wakelockHeld">` — `active` (desired, input) and `held` (actual, output) are deliberately separate one-way surfaces. Pausing releases the lock, resuming re-acquires it, and an OS-side release is always visible because the UI reads `held`, not the request.
- **Notification as a control**: the session-end notification carries `data.next`, and its click flows back into state via `eventToken.clicked` — clicking it starts the next session, even when the tab is in the background.
- **Built-in permission monitoring**: `<wcs-notify>` watches the Permissions API itself (`granted` / `prompt` / `denied` / `unsupported` outputs), so no separate `<wcs-permission>` element is needed.
- **Demo durations**: pick the *6 sec / 3 sec (demo)* options to watch a full focus → break → focus cycle in seconds.

## Wiring highlights

```html
<wcs-timer interval="1000" manual
  data-wcs="running: running; eventToken.tick: timerTick;
            command.start: $command.start; command.stop: $command.stop; ..."></wcs-timer>

<wcs-wakelock data-wcs="active: keepAwake; held: wakelockHeld"></wcs-wakelock>

<wcs-notify
  data-wcs="granted: notifGranted; ...;
            command.request: $command.askNotify; command.notify: $command.notify;
            eventToken.clicked: notifyClicked"></wcs-notify>
```

- Session-end detection lives in the `timerTick` handler: when `elapsed >= durationMs` it stops/rewinds the timer, flips the mode and emits `$command.notify.emit(title, options)` — the emit arguments are passed straight through to `notify(title, options)` (command-token argument pass-through).
- The next session never auto-starts: the notification click (or the start button) is the explicit gesture.
