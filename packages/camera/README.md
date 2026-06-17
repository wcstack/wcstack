# @wcstack/camera

Declarative **camera capture** (`<wcs-camera>`) and **media recording** (`<wcs-recorder>`) for Web Components, built on `getUserMedia` + `MediaRecorder`. Framework-agnostic, zero runtime dependencies, exposed through the [wc-bindable protocol](../../docs).

> 日本語版は [README.ja.md](./README.ja.md)。

## The idea: a live handle that never touches state

Every other `@wcstack` IO node moves **serializable values** in and out of state. A `MediaStream` is different — it is a **live, non-serializable resource handle**: reference identity is all that matters, it never "settles", and leaking it is *physically observable* (the camera indicator stays on).

So this package keeps the live stream **out of state entirely**:

- `<wcs-camera>` owns a `<video>` preview in its shadow root and assigns `srcObject` **internally** — the handle never crosses the state boundary.
- For other consumers (a recorder, an external `<video>`), the stream is published via the `wcs-camera:stream-ready` **event-token**, and handed on as a **command-token argument** — it passes through the token bus transiently and is never written to a reactive path.
- Only **derived values** live in state: `active`, `permission`, the recorded `Blob`, an object URL, etc.

```html
<wcs-camera data-wcs="
  command.start: $command.camStart;
  eventToken.streamReady: gotStream;
  active: camActive; permission: camPerm"></wcs-camera>

<wcs-recorder data-wcs="
  command.attachStream: $command.feed;
  command.start: $command.recStart;
  command.stop: $command.recStop;
  recording: recording; objectURL: clipUrl;
  eventToken.recorded: onRecorded"></wcs-recorder>
```
```js
$commandTokens: ["camStart", "feed", "recStart", "recStop"],
$eventTokens: ["gotStream", "onRecorded"],
$on: {
  // The raw MediaStream is forwarded as a command argument — never stored.
  gotStream: (state, e) => state.$command.feed.emit(e.detail),
  // The recorded Blob is a value — it may live in state.
  onRecorded: (state, e) => { state.clipBlob = e.detail.blob; },
}
```

## `<wcs-camera>`

Acquires a camera stream and renders a preview. Acquisition is **explicit** — `start()` (or the `autostart` attribute) prompts; merely connecting does not.

**Attributes:** `facing-mode` (`user`/`environment`), `device-id`, `audio` (opt the microphone in), `width`, `height`, `autostart`, `keep-alive` (do not suspend on page-hidden — set while recording).

**Commands:** `start()`, `stop()`, `switchCamera()` (toggle front/back).

**Bindable values:** `active` (a stream is live), `permission` / `audioPermission` (`prompt`/`granted`/`denied`/`unsupported`), `deviceId`, `devices`, `error`.

**Events (event-token):** `streamReady` (`wcs-camera:stream-ready`, detail = the live `MediaStream`), `error`, `ended` (a track was revoked by the OS). The `streamReady` "property" exists for event-token wiring only — never bind it as a value.

### Lifecycle

- On `disconnectedCallback` every track is stopped (`track.stop()`), clearing the hardware indicator. Leaking a stream is the one failure mode unique to this node.
- Moving the element in the DOM (remove → re-append) runs `disconnectedCallback` (dispose, stop tracks) then `connectedCallback` (observe again). With `autostart` it re-acquires on reconnect (and may re-prompt). To keep a stream across a move, avoid `autostart` and re-`start()` yourself, or don't detach the element.
- A constraints change (`device-id`, `facing-mode`, `switchCamera()`) **re-acquires** (stop → new `getUserMedia`), guarded by a generation counter so a superseded acquire cannot leave an orphan stream live.
- While the page is hidden the stream is suspended and re-acquired on return — unless `keep-alive` is set. Bind `keep-alive: recording` to keep the camera alive while recording.

## `<wcs-recorder>`

Records a **borrowed** stream received via `attachStream` (the direct channel from a camera's `stream-ready`). It never owns or stops the stream — that is the camera's job.

**Attributes:** `mime-type`, `timeslice` (emit `dataavailable` chunks on this interval; omit for one `Blob` on stop), `audio-bits`, `video-bits`.

**Commands:** `attachStream(stream)`, `start()`, `stop()`, `pause()`, `resume()`.

**Bindable values:** `recording`, `paused`, `duration` (ms — see note below), `mimeType` (the **resolved** recording type, which may differ from the requested `mime-type` attribute or be filled in when none was requested), `blob`, `objectURL`, `error`.

**Events (event-token):** `recorded` (`wcs-recorder:recorded`, detail = `{ blob, objectURL, mimeType, duration }`), `dataavailable` (only in `timeslice` mode), `error`.

> **`duration` is finalized at stop/pause, not live.** There is no internal ticking timer: `duration` stays `0` from `start()` until the first `pause()` or `stop()`. For a live elapsed counter while recording, drive your own client-side timer off the `recording` flag.

> **`mimeType` has two sides — request vs. resolved.** The **input** is the `mime-type` *attribute* (what you ask the recorder to use). The **output** is the `mimeType` *bindable value* (what the browser actually picked, published via `wcs-recorder:mimetype-changed`). They share a base name by design but are distinct surfaces: bind the attribute to set the request (`mime-type` attribute / element setter), and bind the value property to read the resolved type. Don't expect reading `mimeType` to echo back what you wrote — it reflects the recording, not the request.

The assembled `Blob` is structured-clone friendly, so it *is* a value and may flow through state — for example `new File([blob], "clip.webm")` into [`@wcstack/upload`](../upload/). The object URL is managed: the previous one is revoked before a new clip **and on `disconnectedCallback` (dispose)**.

> **`objectURL` lifetime is bound to the recorder.** Because dispose revokes the last object URL — **and a new recording revokes the previous clip's URL before minting the next** — any `<video src>` / `<wcs-upload>` still pointing at an old URL breaks once the `<wcs-recorder>` is removed or the next clip completes. Always follow the latest `objectURL` / `recorded` value; never pin a stale one. If you hand the URL to a longer-lived consumer, either keep the recorder mounted for as long as the URL is in use, or build your own URL from the `Blob` (`URL.createObjectURL(blob)`) and own its revoke. The structured-clone-friendly **`blob`** has no such coupling — prefer flowing the `Blob` through state and minting URLs at the point of use.

## Headless cores

`CameraCore` and `RecorderCore` are exported for non-DOM use (`bind()` from `@wc-bindable/core`). The Shells are thin wrappers.

## Notes & gotchas

- **Secure context (https) required.** `getUserMedia` is unavailable on `file://` / plain `http://`.
- **The camera indicator = a leak detector.** If it stays on after you are done, a track was not stopped.
- **User gesture.** Some browsers require `getUserMedia` to be triggered by a user action; firing it from a timer may silently fail (surfaced via `error`, never thrown).
- **Errors are classified, never thrown:** `NotAllowedError` (denied), `NotFoundError` (no device), `NotReadableError` (in use by another app), `OverconstrainedError`.
- **Stream ownership stays with the camera.** A recorder borrows it; switching cameras while recording is not supported (stop recording first).
- **mimeType support varies** (webm/mp4). Unsupported `mime-type` values are ignored and the browser default is used.

## Install

```html
<script type="module" src="https://esm.run/@wcstack/camera/auto"></script>
```

Or programmatically:

```js
import { bootstrapCamera } from "@wcstack/camera";
bootstrapCamera();
```

MIT © mogera551
