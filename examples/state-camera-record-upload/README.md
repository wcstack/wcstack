# camera → record → upload demo

`@wcstack/state` + `@wcstack/permission` + `@wcstack/camera` (`<wcs-camera>` / `<wcs-recorder>`) + `@wcstack/upload`. A one-line pipeline — preview a camera, record a clip, play it back, and upload it — where **the live `MediaStream` never touches state**.

## Getting Started

Open `index.html` over a secure context (`localhost` or `https://`). `getUserMedia` will not prompt on `file://`. No build step — everything loads from `esm.run`.

## What it shows

- **`<wcs-camera>` owns its preview.** It acquires the stream and renders the `<video>` internally (`srcObject` is assigned in its shadow root), so the non-serializable handle never crosses the state boundary.
- **The direct channel.** On `stream-ready` the raw `MediaStream` is handed to `<wcs-recorder>` as a **command-token argument** — `$command.feedRecorder.emit(event.detail)` — passing through the token bus transiently. It is never assigned to a reactive state path; only derived values (`active`, `recording`, the recorded `Blob`, an object URL) live in state.
- **Recorded `Blob` → upload, unchanged.** The recorded clip is a settled `Blob` (a value), wrapped in a `File` and bound into the existing `<wcs-upload>` node — the IO-node pipeline merges back onto the normal value rail.

## Key Points

- **`keep-alive: recording`** — a one-line, declarative fix for the visibility/recording problem: while `recording` is true the camera is kept alive even if the tab is hidden; otherwise the stream is suspended on hidden and re-acquired on return.
- **Two roles, two elements.** `<wcs-permission name="camera">` *watches* the grant as pure state; `<wcs-camera>` is the one that *acquires* (prompts via `getUserMedia`).
- **Stream ownership stays with the camera.** The recorder *borrows* the stream and never stops its tracks — only the camera releases it (on stop / disconnect), clearing the hardware indicator.
