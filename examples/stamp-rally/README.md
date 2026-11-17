# stamp-rally — the screen and sensor APIs

みどり市 まち歩きスタンプラリー: a town-walk stamp rally, in Japanese, opened on the walker's own phone — more than half of them iPhones — and on a PC from home. A **seam app** ([docs/seam-apps.md](../../docs/seam-apps.md)): a first-time author built it from the public documents on 4.24.2, to find what goes wrong with the screen and sensor elements. One page with `@wcstack/state` and `@wcstack/router`:

- **はじめに and 端末のチェック** (`/`): one line per feature, with five answers kept apart — usable, needs asking, refused, forbidden by the page it is embedded in, not on this device — and 許可する for the iPhone's question.
- **Signing in without typing** (`/login`): the pair is offered to the browser once the server has accepted it, a guarded page waits for a silent sign-in, and ログアウト keeps the browser from signing the user back in.
- **A team** (`/team`): a colour picked from the screen (the eye dropper), members from the contact picker, the server's `422` at the field.
- **The compass** (`/walk`): an arrow to the next place from north and the position, a warning from the magnetic field, steps and a shake to stamp from the motion sensor, a theme from the light sensor, the screen kept on, the sensors only on the pages that need them and stopped while the tab is hidden.
- **A place** (`/spots/:id`): an old picture to look around in by turning the phone or dragging, fullscreen held in landscape, the mouse captured on a PC; a guide video in a small window that goes on across pages; the share sheet, or the link copied.
- **The stamp card** (`/card`): shared as a picture made before the tap (or downloaded), and the finisher's certificate full screen, upright, with the screen kept on.
- **The city's portal** (`/portal/allowed`, `/portal/forbidden`): the rally in an `<iframe>` from another origin (localhost ↔ 127.0.0.1), with every feature allowed and with none. `/?policy=none` serves the page itself with a `Permissions-Policy` that forbids them.

```bash
node examples/stamp-rally/server.js              # http://localhost:3000/
WCS_LOCAL=1 node examples/stamp-rally/server.js  # this repository's packages/*/dist instead of esm.run
```

Sign in as 1001 to 1010 with あいことば `midori-<number>`. Node built-ins only; the data is in memory. Copy `examples/shared/` alongside when you copy this directory out. On a phone the sensors, the share sheet and saved passwords need a secure page: serve it over `https:` (`localhost` is secure only on the machine itself).

## What it found

The findings and what became of each are in [docs/seam-apps.md](../../docs/seam-apps.md) ("stamp-rally"), and what a page that uses the device needs is in [docs/device-apis.md](../../docs/device-apis.md). In short: a command that fails said nothing to a page that bound no `error`; `active` stayed `true` after `<wcs-fullscreen>`, `<wcs-pointer-lock>` or `<wcs-pip>` left the document; `<wcs-tilt>` said `"denied"` for a question Safari never showed; no element read `devicemotion` (an iPhone's acceleration and rotation) or north; nothing said whether a feature is there before a tap failed; `<wcs-credential>` could not sign out; `<wcs-contacts>`' `cancelled` could not happen. 4.25.0 fixes or reports them.

## What the page does itself

The app is as its author wrote it, without the workarounds 4.25.0 made unnecessary: the page's own `<sr-motion>` (`<wcs-accelerometer>` and `<wcs-gyroscope>` read `devicemotion` where the browser has no sensor class, and the accelerometer asks the iPhone's motion question) and `<sr-heading>` (`<wcs-tilt>`'s `heading`), a getter that read `"denied"` with an `error` as "not asked yet", `preventSilentAccess()` called by hand and a `PasswordCredential` built by the page (the commands of `<wcs-credential>`), an `if:` around `<wcs-permission name="ambient-light-sensor">`, a memo kept on `globalThis`, and the page's own reading of `document.permissionsPolicy` (each element's `supported`, and `<wcs-permission>`'s `unsupportedReason`). What is still the page's own:

- **Whether the browser has the API**, for the lines of the device check whose element cannot say why it is unsupported — fullscreen, the orientation lock, Picture-in-Picture, the share sheet, the contact picker (`public/js/caps.js`). An element's `supported` is `false` both where the browser lacks the feature and where the page it is in forbids it; with the API there, it is the second. Firefox and WebKit let a page read no policy, so this is the only way to say it there. Also the page's: a frame of another origin (no saved password is offered to one), and whether the browser asks the iPhone's question.
- **A sensor known by its readings.** No element can tell a device without the sensor from one with no reading yet: the device check runs the sensors for 2.5 seconds (`<wcs-timer>`) and says この端末では使えません for one that sent nothing. The timer's documented reset tick (count 0) is skipped.
- **The iPhone's answer across a reload.** `<wcs-tilt>` and `<wcs-accelerometer>` start each page load at `"unknown"`: the page keeps the last answer in `<wcs-storage>` and asks again at load, assuming Safari answers a question already decided without a tap (not verified on a phone).
- **Page visibility.** One `visibilitychange` listener writes it into state ([long-lived-pages.md](../../docs/long-lived-pages.md)): the sensors stop while the tab is hidden, and the step count says so afterwards.
- **North on the screen.** `<wcs-tilt>`'s `heading` is the device's top edge; the page adds `<wcs-screen-orientation>`'s angle. The readings go to event-token handlers, and state is written only when what is shown changes.
- **The mouse look** reads `movementX` in its own `mousemove` handler, the guide video is started with `video.play()`, and the stamp card is downloaded through a temporary `<a download>` where there is no share sheet: no element does these.
- **The silent sign-in in the route guards** (`public/js/auth.js`) calls `<wcs-credential id="cred-silent">`'s `get()` itself and signs in with a plain `fetch()`: a guard runs before the state exists and has to await the answer.
- **The logout's `<wcs-fetch>` reads its answer as text** (`response-type="text"`). The server answers `204` with a JSON `Content-Type` and no body, and `<wcs-fetch>`'s automatic reading parses it as JSON and reports a network failure for a request that succeeded. Found while landing the app ([docs/seam-apps.md](../../docs/seam-apps.md)).
- **The wake lock's refusal is said** on the compass page (この端末では画面が自動で消えることがあります): a headless browser refuses it, and 4.25's `[wcs/io-error-unobserved]` named the `<wcs-wakelock>` the page read nothing from.

## Tests

- `npm install && npm test` here: 22 unit tests of the page's own logic (`public/js/logic.js`, `public/js/caps.js`) and of a mounted state, headless, with `@wcstack/testing`.
- `e2e/tests/stamp-rally.spec.ts`: the author's browser tests, against this repository's dist.

There is no phone on the machine. The tests use stand-ins, each with what it proves written down (`e2e/tests/stamp-rally-standins.ts`):

- **Sensor readings** come through Chromium's DevTools protocol. They prove what the page does with readings — the arrow, steps, a shake, the light, the magnetic warning, the sensors started and stopped — not a phone's noise, rates or axes.
- **The iPhone's question**: a script that behaves as Safari is documented to — asked only from a tap, one answer for both questions, remembered, no reading before it is allowed — run in Chromium with its sensor classes taken away, so the elements read `devicemotion` as on an iPhone. It does not prove Safari's dialog, its sensors, its settings switch, or whether it answers a decided question without a tap.
- **The share sheet, the contact picker, saved passwords and the eye dropper**: scripts that follow their specifications, including the user closing them without choosing. They do not prove the browsers' own windows or a real password manager.

What stays open without a phone: the sign of `accelerationIncludingGravity` on each platform (the page uses the size of a reading), an orientation lock on a phone, and the pickers' own windows.
