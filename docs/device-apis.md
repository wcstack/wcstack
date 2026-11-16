# Screen and sensor APIs

**日本語版**: [device-apis.ja.md](./device-apis.ja.md)

A page that uses what the device has — the whole screen, a small video window, the pointer, which way the phone points and how it moves, the share sheet, the contact picker, saved passwords, the eye dropper — meets three things a form or a list never does. Every one of these is missing on some device. Every one that acts wants a tap. And none of them throws: a refusal is a value. This guide collects what the wcstack elements do about that and what is left to the page. It was written from the `stamp-rally` seam app ([seam-apps.md](./seam-apps.md)). There was no phone on the machine: what is said here about a phone was checked with stand-ins that behave as the platforms are documented to, and the sections say where that leaves something open.

The elements: `<wcs-fullscreen>`, `<wcs-pip>`, `<wcs-pointer-lock>`, `<wcs-screen-orientation>`, `<wcs-tilt>`, `<wcs-accelerometer>`, `<wcs-gyroscope>`, `<wcs-magnetometer>`, `<wcs-ambient-light-sensor>`, `<wcs-share>`, `<wcs-contacts>`, `<wcs-credential>`, `<wcs-eyedropper>`, with `<wcs-permission>` beside them.

## What happens, and what to do

| On the page | What happens | What to do |
|---|---|---|
| A command emitted outside the tap: from a `$watch`, when a response arrives, after an `await` in the tap's handler | The browser refuses it: `errorInfo.code` is `not-allowed`. In Chromium a tap's activation lasts about five seconds, so the page works on a fast network and fails on a slow one. | Emit in the tap's handler, before anything is awaited: [A tap](#a-tap). |
| A command fails | Nothing is thrown and nothing is printed: the failure is in the element's `error` / `errorInfo`. Since 4.25 the `diagnostics` add-on warns when nothing reads it (`[wcs/io-error-unobserved]`). | Bind `errorInfo` and show it: [Failures](#failures). |
| The feature is not there — fullscreen on an iPhone, Picture-in-Picture in Firefox, the share sheet on most desktops, the eye dropper and saved passwords outside Chromium, the contact picker outside Android | Up to 4.24 the button was offered and the tap failed. Since 4.25 each of these elements has a `supported` output. | Offer the button only when `supported`: [Is it there?](#is-it-there). |
| The page is in an `<iframe>` that does not allow the feature, or is served with a `Permissions-Policy` that forbids it | `supported` is `false`. `<wcs-permission>` says `unsupported`, and since 4.25 `unsupportedReason` says `policy-blocked`. | Tell the user to open the page itself in a new tab: the browser's site settings cannot change it. |
| The orientation and motion sensors on an iPhone | Safari shows its question only when asked from a tap, and there are two questions. Asked from anywhere else it refuses without showing anything; since 4.25 that leaves `permissionState` as it was (it said `"denied"`). | One button, both questions, in the tap: [The iPhone](#the-iphone). |
| North | `<wcs-tilt>`'s `alpha` is relative on both phone platforms. Since 4.25: the `heading` output. | Bind `heading`; `null` means the device has not said. |
| Acceleration and rotation on an iPhone | Safari has no Generic Sensor classes. Since 4.25 `<wcs-accelerometer>` and `<wcs-gyroscope>` read `devicemotion` there. | Nothing more than the question. |
| The user leaves fullscreen with Escape or a swipe, or closes the small window with its × | The element's `active` goes to `false`. A flag of the page's own does not. | Bind `active`. Do not keep a flag the buttons flip. |
| The element leaves the document while active — a route's content, an `if:` | The browser ends the fullscreen and the pointer lock when the target goes. Since 4.25 `active` goes to `false` (it stayed `true`). | What must go on across pages lives outside the router: [Across a navigation](#across-a-navigation). |
| The screen held in landscape | `lock()` holds only while the document is fullscreen. | Lock from a `$watch` on the path bound to `active`, unlock when it goes back: the [fullscreen README](../packages/fullscreen/README.md#locking-the-screen-orientation-while-fullscreen). |
| The user closes the share sheet, the eye dropper or the contact picker without choosing | `cancelled`, not `error` (the contact picker: since 4.25). | Show nothing. |
| `onclick: $command.share` — a token wired straight to a button, for a command that takes data | The event becomes the command's first argument: the browser's `TypeError` for `share`, `select` and `lock`, and `null` without a word for `<wcs-credential>`'s `get`. The lint says so since 4.25 (`wcs/command-event-argument`). | Emit from a state method, with the data. |
| Sensor readings | They arrive at the sensor's rate, and each one bound into state is a write. | Keep them out of state until something shown changes: [Sensors that keep running](#sensors-that-keep-running). |
| Signing out | The browser signs the user back in on the next visit. | The `preventSilentAccess` command (4.25): the [credential README](../packages/credential/README.md). |

## A tap

Fullscreen, Picture-in-Picture, the pointer lock, the share sheet, the pickers and the iPhone's sensor question are given only to a page that is handling a tap, a click or a key press. The browser decides it, and it is strict in different ways: Chromium keeps the activation for about five seconds, Firefox wants the request inside a short-running handler, and Safari's sensor question wants the tap itself.

An `on…:` handler runs inside the event, and so does everything a state method emits before its first `await`:

```js
export default {
  $commandTokens: ["share"],
  cardFile: null,   // made when the card is shown, not in the tap

  // The share is asked for in the tap.
  shareCard() {
    this.$command.share.emit({ files: [this.cardFile], text: "まち歩きスタンプラリー" });
  },

  // Do not: the tap is over by the time the picture exists.
  async shareCardLate() {
    const file = await this.makePicture();
    this.$command.share.emit({ files: [file], text: "まち歩きスタンプラリー" });
  },
};
```

The second form works on a developer's machine — the picture is made in milliseconds — and fails for the user whose phone or network is slow. Whatever a command needs (a picture, an answer from the server) is prepared before the tap, and the button is disabled until it is ready.

A command for an element the same update renders has nothing to act on yet: a `<wcs-fullscreen>` whose `target` appears in an `if:` the handler has just opened answers `Fullscreen target could not be resolved.` Emit after the render ([fullscreen README](../packages/fullscreen/README.md#notes--limitations)).

## Is it there?

Since 4.25 `supported` says whether **this page can use the feature**: the API is there, and the page is not forbidden to use it. It is an output read when the binding attaches, so the first paint is right:

```html
<wcs-fullscreen target="#stage" data-wcs="supported: fsSupported; active: fsActive; errorInfo: fsError;
                                          command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<div id="stage">
  <button data-wcs="hidden: fsSupported|not; onclick: $command.goFullscreen">全画面で見る</button>
</div>
```

It does not say that the user will allow it, that an orientation lock will hold, or that a sensor is in the device: a desktop browser has the events and never a reading. A page that must know waits a moment after `start` and treats "no reading" as "not here".

For a line that tells the user *why* — the five answers of a device check — combine it with the question's answer and with `<wcs-permission>`:

```html
<wcs-tilt data-wcs="supported: tiltSupported; permissionState: tiltPermission; errorInfo: tiltError;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-permission name="accelerometer" data-wcs="state: sensorPermission; unsupportedReason: sensorWhy"></wcs-permission>

<p>向きのセンサー: <span data-wcs="textContent: compassLine"></span>
  <button data-wcs="hidden: needsAsking|not; onclick: allow">許可する</button></p>
```

```js
get compassLine() {
  if (this.sensorWhy === "policy-blocked") return "このページでは使えません"; // the page it is embedded in forbids it
  if (!this.tiltSupported) return "この端末では使えません";
  if (this.tiltPermission === "denied" || this.sensorPermission === "denied") return "許可されていません";
  if (this.tiltPermission !== "granted") return "許可が必要です";
  return "使えます";
},
get needsAsking() { return this.compassLine === "許可が必要です"; },
```

`unsupportedReason` is `policy-blocked`, `insecure-context`, `no-permissions-api` or `unknown-name`. The last two mean the browser cannot say, not that the feature is absent: Firefox and Safari reject the sensor names. Only Chromium exposes the page's policy; in Firefox and WebKit a forbidding frame shows through `supported` where the browser has a flag for it (`document.fullscreenEnabled`).

## The iPhone

Safari on iOS gives no orientation or motion reading until the user has allowed it, asks only from a tap, and asks separately for orientation (`<wcs-tilt>`) and for motion (`<wcs-accelerometer>`, `<wcs-gyroscope>`). One token can ask every question and one can start every sensor, so one tap does it:

```html
<wcs-tilt data-wcs="permissionState: tiltPermission; heading: heading; errorInfo: tiltError;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-accelerometer data-wcs="errorInfo: motionError; eventToken.x: moved;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-accelerometer>
<button data-wcs="onclick: allow">許可する</button>
```

```js
$commandTokens: ["ask", "start"],
$eventTokens: ["moved"],
// Both in the tap. Nothing is awaited before the emits.
allow() {
  this.$command.ask.emit();
  this.$command.start.emit();
},
```

- A question asked outside a tap is refused without being shown: `errorInfo.code` is `not-allowed` with `recoverable: true`, and `permissionState` stays as it was. `"denied"` is the user's own answer; after it Safari does not ask again, and the user changes it in Safari's settings.
- After a reload `permissionState` is `"unknown"` again: Safari tells a page the answer only when asked. A page that wants to remember keeps its own note. Whether Safari answers an already decided question without a tap was not verified on a phone.
- Elsewhere — Android, a desktop — the same button works: there is no question, and `requestPermission` answers `"granted"` at once.
- On the `devicemotion` path the sign of the axes can differ between platforms and was not verified on devices: use the size of the reading (a shake, a step), or check on the phones you target.

## Across a navigation

A route's content is taken out of the document when the user leaves it ([router README](../packages/router/README.md#where-route-content-lives)), and so is an `if:` branch that closes. The browser ends a fullscreen and a pointer lock when their target goes, and the element — since 4.25 — reports `active: false` as it leaves.

A video that must go on in the small window while the user reads another page lives outside the router, with its `<wcs-pip>`, and is hidden rather than removed where it is not shown:

```html
<wcs-router>…</wcs-router>

<!-- outside the routes: the same nodes on every page -->
<section data-wcs="class.offscreen: onSpotPage|not">
  <wcs-pip data-wcs="supported: pipSupported; active: pipActive; errorInfo: pipError;
                     command.requestPictureInPicture: $command.openPip; command.exitPictureInPicture: $command.closePip">
    <video data-wcs="attr.src: videoUrl" playsinline></video>
  </wcs-pip>
</section>
```

Chromium keeps a video playing in the small window even after it has left the document, so the mistake does not show there; other browsers may close or pause it.

## Sensors that keep running

- **They start when asked, and stop when they leave.** No sensor element starts on connect, a disconnect stops it, and nothing starts it again when its route comes back: emit `start` when the page that needs it is shown (a `$watch` on the router's `routeName`), and `stop` when it is not.
- **A hidden tab.** No wcstack element reports page visibility; the recipe is in [long-lived-pages.md](./long-lived-pages.md). Stop the sensors from it, and say so when the user comes back if the page was counting something.
- **What a reading costs.** Bound into state (`x: ax; y: ay; z: az`), each reading is a write, and whatever is drawn from it is drawn again. In the seam app, a list drawn from every reading cost about twice the script time and a layout per reading (35 a second), against a layout only when something shown changed. Take the readings in an event-token handler instead, keep what the page computes from them outside state, and write a path only when what is shown changes — the heading when it has moved two degrees, the step count when a step is counted:

```js
$on: {
  moved(state, event) {
    const { x, y, z } = event.detail;          // the whole reading
    if (steps.feed(Math.hypot(x, y, z))) state.stepCount = steps.count;
  },
},
```

- **`frequency`** asks the sensor for a rate (and thins the `devicemotion` readings where that path is used). A value that is not a positive number is reported since 4.25 (`[wcs/frequency-invalid]`); a rate above what the browser allows is capped without a word.

## Failures

Bind `errorInfo` on every element whose command the user triggers, and show something for it:

```html
<wcs-share data-wcs="command.share: $command.share; cancelled: shareCancelled; errorInfo: shareError"></wcs-share>
<p role="alert" data-wcs="hidden: shareError|not">共有できませんでした。</p>
```

`errorInfo.code` is the same few words on every element: `capability-missing` (the API is not there — offer the fallback), `not-allowed` (refused: no tap, a policy, a permission), `invalid-argument` (a `target` that names nothing), and the element's own code for the rest. `cancelled` is separate: the user closing a sheet or a picker is not a failure.

Since 4.25, with the `diagnostics` add-on (it is in `/auto`), an element that reports a failure while its `data-wcs` reads none of `error`, `errorInfo`, `status` and `connected` — and has no event token — is named in the console once per tag and code ([state README](../packages/state/README.md)).

## Testing without the device

- **Sensors in Chromium**: the DevTools protocol feeds readings (`Emulation.setSensorOverrideEnabled`, `Emulation.setSensorOverrideReadings`), with the permissions granted to the context; `Magnetometer` and `AmbientLightSensor` exist only with `--enable-features=GenericSensorExtraClasses`.
- **The iPhone's question, the share sheet, the pickers, saved passwords**: a script installed before the page's (`page.addInitScript`) that behaves as the platform does — asked only with `navigator.userActivation.isActive`, a refusal remembered, a picker closed without a choice. The repository's own are in `e2e/tests/io-screen-sensors-stubs.ts`. A stand-in proves what the page does with an answer, not what a phone answers.
- **A call that is not a tap** has to come from the page's own timer, on a page the test has not touched: Playwright's clicks, `page.evaluate()` and the polling behind `expect(locator)` all count as user activation.
- **Headless browsers**: Chromium's `screen.orientation.lock()` resolves and changes nothing, in a plain tab too; Escape does not leave fullscreen in headless Chromium (it does in Firefox and WebKit); a tab behind another is not hidden; Playwright's WebKit on Windows has no `DeviceOrientationEvent` and plays no video.
