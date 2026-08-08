# @wcstack/midi

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/midi` is a headless Web MIDI component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns MIDI hardware into reactive state — the same way `@wcstack/geolocation` turns the device's location into reactive state.

With `@wcstack/state`, `<wcs-midi>` can be bound directly through path contracts:

- **input surface**: `input`, `output`, `channel`, `sysex`, `auto`
- **output state surface**: `message`, `type`, `channel`, `note`, `velocity`, `control`, `value`, `devices`, `connected`, `permission`, `error`
- **commands**: `request`, `close`, `send`

This means a MIDI controller can drive your application state declaratively in HTML, without writing `navigator.requestMIDIAccess()` or `onmidimessage` glue in your UI layer.

`@wcstack/midi` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`MidiCore`) handles access, port selection, message decoding and sending
- **Shell** (`<wcs-midi>`) connects that state to DOM attributes and lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` plus the three commands

## Why one tag for both directions

MIDI input and output look like two features, but a page holds exactly **one** `MIDIAccess` object, and both directions are derived from it. Splitting them into `<wcs-midi-in>` and `<wcs-midi-out>` would only force the two elements to coordinate over the same shared handle — so `<wcs-midi>` covers both, as `<wcs-ws>` does for WebSocket send/receive. (`@wcstack/speech` splits into two tags precisely because `SpeechSynthesis` and `SpeechRecognition` are two *different* APIs.)

> **Chromium only.** Web MIDI ships in Chromium-based browsers. Firefox has it behind a pref and Safari does not implement it. Where the API is absent — including any non-secure context — `<wcs-midi>` reports `permission = "unsupported"` instead of throwing.

## Install

```bash
npm install @wcstack/midi
```

## Quick Start

### 1. Play notes from a MIDI keyboard

```html
<!-- I/O node before state: module scripts execute in document order, so
     <wcs-midi> is defined before state binds to it. A command-token emit into
     a not-yet-defined element is never replayed. -->
<script type="module" src="https://esm.run/@wcstack/midi/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      held: [],
      $eventTokens: ["onMidi"],
      $on: {
        onMidi: (state, event) => {
          const { type, note } = event.detail;
          if (type === "noteon") state.held = [...state.held, note];
          else if (type === "noteoff") state.held = state.held.filter((n) => n !== note);
        },
      },
    };
  </script>
</wcs-state>

<wcs-midi auto data-wcs="eventToken.message: onMidi"></wcs-midi>

<p data-wcs="text: held"></p>
```

### 2. Nothing starts until you ask

`requestMIDIAccess()` can raise a permission prompt, so **connecting the element does nothing on its own**. Either add the `auto` attribute (above), or fire the command from a user gesture:

```html
<wcs-midi data-wcs="command.request: $command.connectMidi; connected: midiReady"></wcs-midi>

<button data-wcs="onclick: $command.connectMidi; hidden: midiReady">Connect MIDI</button>
```

### 3. Drive a value from a fader

```html
<wcs-midi auto channel="1" data-wcs="control: cc; value: ccValue"></wcs-midi>

<!-- CC 7 is the conventional volume fader. -->
<meter min="0" max="127" data-wcs="value: ccValue"></meter>
```

### 4. Send to a MIDI device

```html
<wcs-midi auto output="Synth" data-wcs="command.send: $command.midiSend"></wcs-midi>
```

```js
// Positional arguments pass through verbatim (command-token).
state.$command.midiSend.emit([0x90, 60, 100]);
```

## Message surface

One event (`wcs-midi:message`) carries the whole message; the individual fields are derived getters on that same event, so you bind only what you need.

| Property | Type | Notes |
|---|---|---|
| `message` | object | `{ data, port, portName, timestamp, ...decoded }` |
| `type` | string | `noteon` / `noteoff` / `polyaftertouch` / `controlchange` / `programchange` / `aftertouch` / `pitchbend` / `sysex` / `other` |
| `channel` | number \| null | 1-16; `null` for system messages |
| `note` | number \| null | 0-127 |
| `velocity` | number \| null | **normalized to 0-1** |
| `control` | number \| null | controller number, raw 0-127 |
| `value` | number \| null | raw 0-127, or **-1..1 for pitch bend** |

Two normalizations are applied so every consumer does not have to repeat them:

- **A note-on with velocity 0 is reported as `noteoff`.** Many controllers never emit a real 0x8n note-off; treating those as note-ons leaves stuck notes. The raw status byte is still in `message.data[0]`.
- **Velocity is 0-1**, so it multiplies straight into a gain. Controller values stay raw, since their meaning is per-controller.

`message` is an **occurrence**, not a state: two identical note-ons are two distinct presses, so it is never same-value guarded. `data` is a fresh `Uint8Array` on every message — the platform buffer is never handed out, so retaining a message (an RxJS replay, a React snapshot) is safe.

## Ports

| Attribute | Omitted | Given |
|---|---|---|
| `input` | subscribe to **every** input port | port id, or a case-insensitive name prefix |
| `output` | `send()` goes to the **first** output port | port id, or a case-insensitive name prefix |
| `channel` | deliver every channel | deliver only that channel (1-16); system messages always pass |

Subscribing to everything by default matches the expectation for MIDI: a controller you plug in should just work, not require the page to name it first.

Changing `input` / `output` / `channel` on a live element **re-hooks the existing access** — it never re-requests, so there is no second permission prompt.

`devices` publishes every port as `{ id, name, manufacturer, direction, state }`, refreshed on every plug and unplug. Device names are not unique (plug in two of the same model and both report the same name), so prefer ids when a page must target a specific unit.

## Permission

`permission` is the familiar four-value surface: `prompt` / `granted` / `denied` / `unsupported`.

Where the browser answers `navigator.permissions.query({ name: "midi" })`, a grant revoked in site settings flows into the state without a re-request. Where it does not, the state is inferred from the outcome of `request()`.

`sysex` requests the system-exclusive grant, which is a **separate and more restricted permission** — leave it off unless you actually need SysEx.

## CSS styling with `:state()`

The Shell reflects its output state into `ElementInternals.states`:

```css
wcs-midi:state(connected) { --midi-dot: limegreen; }
wcs-midi:state(denied)    { --midi-dot: crimson; }
wcs-midi:state(unsupported) { --midi-dot: dimgray; }
wcs-midi:state(error)     { --midi-dot: orange; }
```

Add `debug-states` to also mirror them as `data-wcs-state-*` attributes while debugging. In environments without `ElementInternals`, reflection is silently disabled and everything else keeps working.

## Headless usage (Core)

`MidiCore` is a public, framework-agnostic surface — no DOM required:

```js
import { MidiCore } from "@wcstack/midi";

const core = new MidiCore({ channel: 1 });
core.addEventListener("wcs-midi:message", (e) => console.log(e.detail.type, e.detail.note));
await core.request();
core.send([0x90, 60, 100]);
// You own the lifecycle: without dispose(), the live onmidimessage handlers
// keep this instance reachable for as long as the ports are alive.
core.dispose();
```

`parseMessage(data)` is exported separately for decoding bytes you obtained some other way.

## Errors

Nothing throws. Failures surface as state:

| Situation | `permission` | `error` | `errorInfo.code` |
|---|---|---|---|
| `navigator.requestMIDIAccess` absent | `unsupported` | `"unsupported"` | `capability-missing` |
| User denied / policy blocked | `denied` | rejection message | `not-allowed` |
| Other access failure | `denied` | rejection message | `access-error` |
| `send()` failed | unchanged | throw message | `send-failed` |

## Notes

- **Chromium only**, and a secure context is required.
- **Velocity 0 note-ons are note-offs** — see above.
- **`sysex` is a separate permission** and is often refused.
- **Device names are not unique**; prefer ids.
- **`statechange` can fire more than once per physical device** (the input and output sides arrive separately). `devices` is content-compared, so it is not republished when nothing actually changed.

## License

MIT
