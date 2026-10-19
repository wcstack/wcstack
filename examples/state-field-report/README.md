# state + router + the device I/O nodes demo (a field report from a phone)

An inspector at a site files a report from a phone: a title and a note (typed or dictated), the position (or an address when location is refused), and a few short video clips. The site has a bad network, so a report waits in an outbox and goes when the connection comes back; when everything is sent while the tab is hidden, a notification says so and opens the report. Permissions are the hard part: the inspector may refuse one, allow it later, have it taken away while the camera is on — or open the app where a device cannot be used at all.

Packages: `@wcstack/state`, `router`, `permission`, `camera` (`<wcs-camera>`, `<wcs-recorder>`), `geolocation`, `speech` (`<wcs-listen>`, `<wcs-speak>`), `wakelock`, `timer`, `fetch`, `upload`, `storage`, `network`, `notification`.

## Run it

The packages load from a CDN ([esm.run](https://esm.run), npm `latest`), so Node.js alone is enough:

```bash
node examples/state-field-report/server.js              # http://localhost:3000   (PORT=… to change)
WCS_LOCAL=1 node examples/state-field-report/server.js  # the repository's packages/*/dist instead of the CDN
node examples/state-field-report/server.js --prod       # the production form (below)
```

`--prod` is `SRI=1` + `CSP=1` + `PP=1`, each also usable alone:

- `SRI=1` — each `esm.run` one-liner becomes the version-pinned jsDelivr file with `integrity=`, the digest read from the GitHub Release's `sri.json` of that version (`WCS_VERSION`, default the version in `packages/state/package.json`, else npm `latest`). No digest, no page. (Ignored with `WCS_LOCAL=1`.)
- `CSP=1` — a Content-Security-Policy without `'unsafe-inline'` anywhere: the state is a file (`<wcs-state src="./state.js">`), the styles are a file, nothing inline. `media-src blob:` for the clip previews.
- `PP=1` — `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)`.

A camera, a microphone and a secure context are needed (`localhost` is one). The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. Reports and clips live in memory; a restart brings back the three seeded reports.

| URL | |
|---|---|
| `/` | The sent reports |
| `/new` | The draft: title, note (dictation, read-back), location, camera and clips, Send |
| `/reports/:id` | One report with its clips (`:id(int)`; an unknown id says so) |
| `/permissions` | The four permissions, live, with what to do for each state |
| `http://127.0.0.1:3000/embed` | Another origin framing the app **without** `allow=`; `?allow=1` with `allow="camera; microphone; geolocation"` |

API: `GET /api/reports`, `GET /api/reports/:id`, `POST /api/reports` (JSON; 422 `{ errors: { title: "required" } }` for an empty title, 500 with `?fail=1`), `POST /api/reports/:id/media` (multipart, the file in `file`; 413 over `MAX_UPLOAD`, default 2 MB; 415 unless `video/*`, `audio/*` or `image/*`; 500 with `?fail=1`; `?slow=1` reads the body slowly), `GET /media/:id`. `DELAY=<ms>` or `?delay=<ms>` slows the API. Test hooks: `POST /api/test/reset`, `/api/test/max-upload?bytes=`, `/api/test/fail-next?kind=create|upload`, `/api/test/drop-uploads`.

## Things to try

- Refuse the camera (site settings → Camera → Block), press Start camera, then allow it: the banner changes without a reload and Start works again.
- Start the camera, go to Permissions, come back: the camera was off in between, and Start works.
- Record, then leave `/new` while recording: the clip so far is in the draft when you come back. Take the camera permission away while recording: the same, and the page says why.
- Refuse location: the page asks for the address; allow it later and press Get position.
- DevTools → Network → Offline, then Send: the report waits in the outbox; back online, it goes.
- `curl -X POST localhost:3000/api/test/fail-next` (500), an empty title (422 → "Edit in the draft"), `MAX_UPLOAD=1000` (413 → the clip's row says why; Retry), Cancel an upload and Retry it.
- Reload with a draft: the text and the position come back; the clips cannot (a `Blob` is not JSON), and the page says so.
- Open `http://127.0.0.1:3000/embed`: the camera and location are "not available on this page" — not "blocked", because no site setting can help there.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| A permission's two views | `<wcs-permission>` watches each permission (live); the element that asks — `<wcs-camera>`, `<wcs-geo>`, `<wcs-listen>`, `<wcs-notify>` — reports its own `permission` and `errorInfo`. "Blocked" comes from the permission (`denied`), not from the last error, which describes the last attempt. `"unsupported"` is a page that cannot use the feature: no API, not a secure context, or a Permissions-Policy (the server's header, or an `<iframe>` without `allow`). |
| The live stream × state | The `MediaStream` goes element to element: `eventToken.streamReady` → `$on` → `$command.feedRecorder.emit(stream)` → `<wcs-recorder>.attachStream`. It is re-attached on every re-acquire. Only values enter state: `active`, `recording`, the clip's `Blob`. |
| Clips × object URLs | Each clip's URL is minted from its `Blob` by the app and revoked on Discard / Send: the recorder revokes its own `objectURL` on the next clip and on disconnect. |
| A route's nodes × the I/O nodes | The camera, recorder, wake lock, timer, location and dictation live in the `/new` route body, so leaving `/new` turns the camera off. The router puts the same nodes back on return; a disconnect publishes `active: false` / `recording: false`, and a take in progress arrives as a clip. |
| Recording × a hidden tab | `keepAlive: rec.recording` keeps the camera on while recording; `<wcs-wakelock data-wcs="active: rec.recording">` keeps the screen awake; `<wcs-timer>` shows the elapsed time (`duration` is final only at stop). |
| One microphone, two consumers, a speaker | Dictation and recording with sound share the microphone; Dictate is disabled while the note is read aloud, and Read aloud while dictating, so the listener never hears the speaker. |
| Create × upload | One `<wcs-fetch>` creates the report; then one `<wcs-upload manual>` per clip in a page-level `for:` row (so navigation does not abort it), created only once the id exists, with `trigger` the row's last binding, after `url` and `files`. A failure is read from `error`, never `status` or `progress`. An upload uses its `files` up, so a retry hands the file over again. |
| Offline × an outbox | `<wcs-network>`'s `offline` drives the outbox: queued while offline, sent when it is back; a dropped upload goes again by itself. |
| A draft that is half value, half handle | Text and position: `<wcs-storage type="session">` through an accessor pair (`value#init=element`) — per tab, so two tabs do not overwrite each other. Clips are counted, not stored; after a reload the page says how many were lost. |
| Leaving with an unsent draft | `leaveConfirm` asks when leaving `/new` with a draft or while recording (and the browser asks on a reload). Pending uploads, which survive a route change but not a reload, ask through the app's own `beforeunload` listener. |
| Hidden tab × notifications | When everything is sent while the tab is hidden, `<wcs-notify>` shows "Report sent" if notifications are granted (asked from the Permissions page, never automatically); the message is always mirrored in the page. Clicking the notification opens the report. |

## What building it found

A first-time author built it from the public documents and the published 4.4.0 ([docs/seam-apps.md](../../docs/seam-apps.md), "state-field-report"): 18 frictions, 12 of 15 deliberate mistakes that nothing reported, one life event that failed. What 4.5.0 did about them, in short:

| Found | 4.5.0 |
|---|---|
| Back on `/new` after leaving it, the page said "Camera live." with no camera, and Start stayed disabled until a reload (`<wcs-camera>` reset `active` on disconnect without its event) | fixed, in 13 packages: a disconnect publishes every output it changes |
| Leaving the route while recording threw the take away | the take arrives as `recorded` |
| Without `mime-type`, a clip had no type (`""`), and the server refused it (415) | the clip is typed |
| Under `style-src 'self'` the camera preview overflowed (a shadow `<style>`) | a constructed stylesheet |
| In an `<iframe>` without `allow`, under `camera=()`, or on a non-secure origin, the watchers said `granted` and the acquirers `not-allowed` — like a refusal | `"unsupported"`, `errorInfo` `capability-missing` with the reason |
| An upload retry, a `trigger` before `url` / `files`, a `notify()` without the permission did nothing, silently | `[wcs/command-not-ready]` |
| A clip kept in `<wcs-storage>`, speaking while listening, recording without `keep-alive` in a hidden tab — silent | `[wcs/storage-unserializable]`, `[wcs/speech-echo]`, `[wcs/camera-keep-alive-missing]` |
| A getter mapping a constant list gave false lint warnings; `streamReady:` bound as a value was quiet | rows read from the callback; `wcs/handle-bound-as-value` |

Landing it here removed the workarounds 4.5.0 made unnecessary:

- **The reset on leaving `/new`** — a `$watch` on `routeName` wrote `cam.active`, `rec.recording` and `streamAttached` back to `false`, because the elements did not say they had stopped. A disconnect publishes them now.
- **Reading `document.permissionsPolicy` and `isSecureContext` itself** to tell "turned off for this page" from "refused" — the watchers and the acquirers report `"unsupported"` with `errorInfo` `capability-missing` and the reason, and the page shows its "not available on this page" branch from that.
- **Forcing `mime-type="video/webm"` and a fallback type for the uploaded `File`** — the recorder types the clip; the `File` takes `blob.type`, as the camera README's recipe does.
- **`wcs-camera::part(video)` rules** that redid the preview's layout under the CSP — its styles are no longer blocked.

Kept, because they are the documented way: handing the file over again before a retry, `trigger` after `url` / `files`, `type="session"` for a per-tab draft, `mimeType#init=element` to read the resolved type, and the app's own `beforeunload` for pending uploads.

## Known limits

- **Aborting one row's upload needs DOM code**: a command token reaches every row's `<wcs-upload>`, so Cancel calls the row's own element from the click (`event.target.closest(".upload-row").querySelector("wcs-upload").abort()`).
- **No element reports page visibility**: "notify when the tab is hidden" uses a plain `visibilitychange` listener installed in `$connectedCallback`.
- **No still photo**: `<wcs-camera>` has no way to take one, so a report carries clips only.
- **Why a device is unavailable is known only after an attempt**: `permission: "unsupported"` arrives at once, but the reason (a Permissions-Policy, not a secure context, no API) comes in `error` from a refused `start()` / `getCurrentPosition()`. The page disables Start and Get position on `unsupported`, so it shows a general sentence instead.
- **Clips do not survive a reload**: a `Blob` cannot be kept in `<wcs-storage>`; the page counts them and says how many were lost. A reload during an upload loses the outbox (the server keeps the report without those clips).

## Tests

`e2e/tests/state-field-report.spec.ts` (Playwright project `chromium-media`: full Chromium with a fake camera and microphone; `WCS_LOCAL=1` with `CSP=1` and `PP=1`, one server per worker on port 5100 + the worker index) checks leaving `/new` and coming back, leaving while recording, the permission taken away while recording, refuse then allow, location refused then allowed, the offline outbox, 422 / 500 / 413 / 415 and the retries, a double click on Send, a reload with a draft, deep links, the app in an `<iframe>` with and without `allow`, and a quiet console in each.
