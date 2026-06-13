# @wcstack/speech

`@wcstack/speech` is a headless Web Speech component pair for the wcstack ecosystem.

These are not visual UI widgets. They are **async primitive nodes** that turn the browser's Web Speech APIs into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/geolocation` turns the device's location into reactive state.

The package ships two complementary tags, the two halves of the same protocol:

| Tag | API | Direction | Protocol role |
|---|---|---|---|
| **`<wcs-speak>`** | SpeechSynthesis (TTS) | state → speech | command-token (state drives speech) |
| **`<wcs-listen>`** | SpeechRecognition (STT) | speech → state | event-token (recognition flows to state) |

Their coexistence in one package is the point: `<wcs-speak>` is a perfect showcase of **command-driven output**, `<wcs-listen>` of **event-driven input**. Wire them together for a speak ⇄ listen loop.

Both follow the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`SpeakCore` / `ListenCore`) wraps the native API, normalizes data, manages lifecycle/permission, and never throws (failures surface through `error`).
- **Shell** (`<wcs-speak>` / `<wcs-listen>`) connects that state to DOM attributes, lifecycle, and declarative commands.
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`.

## Install

```bash
npm install @wcstack/speech
```

Or buildless via CDN (registers both tags):

```html
<script type="module" src="https://esm.run/@wcstack/speech/auto"></script>
```

---

## `<wcs-speak>` — text to speech

### Two ways to speak

`<wcs-speak>` exposes the same action through two surfaces that differ in **when they fire**:

```html
<!-- 1. Reactive: speaks whenever `status` changes (same value is NOT re-spoken). -->
<wcs-speak data-wcs="say: status"></wcs-speak>

<!-- 2. Imperative: speaks on demand, even the same text again, via the command token. -->
<wcs-speak data-wcs="command.speak: $command.announce"></wcs-speak>
```

```js
// state
export default {
  $commandTokens: ["announce"],
  status: "Ready.",
  onClick() {
    this.$command.announce.emit("Button clicked again.");  // imperative — re-speaks same text
  },
};
```

| Surface | Fires when | Same value re-speaks? | Use for |
|---|---|---|---|
| `say` (reactive input) | the bound value **changes** | no (guarded) | status / a11y announcements |
| `speak` (imperative command) | the command is **invoked** | yes | "speak this on click", "say it again" |

> **Tip:** wire `say` through a `\|debounce` filter when binding to a rapidly-changing source (e.g. an `<input>` value), or it will speak on every keystroke. Set the `manual` attribute to mute the `say` path entirely (also the hook for muting speech while listening — see the echo example).

### Word-boundary highlighting

`charIndex` / `spokenWord` update as each word is spoken — bind them to highlight the currently-spoken word (karaoke-style).

### Attributes / Inputs

| Attribute | Input | Type | Default | Meaning |
|---|---|---|---|---|
| — | `say` | string | — | reactive: writing a new value speaks it |
| `rate` | `rate` | number | `1` | speech rate (0.1–10) |
| `pitch` | `pitch` | number | `1` | pitch (0–2) |
| `volume` | `volume` | number | `1` | volume (0–1) |
| `voice` | `voice` | string | — | voice selected by `name` |
| `lang` | `lang` | string | — | BCP-47 language tag |
| `manual` | `manual` | boolean | `false` | mute the `say` path |

### Observable Properties (outputs)

| Property | Type | Meaning |
|---|---|---|
| `voices` | `SpeechVoiceInfo[]` | available voices (populated asynchronously) |
| `speaking` | boolean | an utterance is being spoken |
| `paused` | boolean | speech is paused |
| `pending` | boolean | utterances are queued |
| `charIndex` | number \| null | offset of the word being spoken |
| `spokenWord` | string \| null | the word being spoken |
| `error` | `WcsSpeakErrorDetail` \| null | last failure |
| `unsupported` | boolean | SpeechSynthesis is unavailable |

### Commands

| Command | Meaning |
|---|---|
| `speak(text)` | queue an utterance (uses current `rate`/`pitch`/… attributes) |
| `cancel()` | clear the queue and stop |
| `pause()` / `resume()` | suspend / resume |

### Optional DOM triggering

With `autoTrigger` on (default), clicking an element carrying `data-speaktarget="<id>"` speaks its `data-speaktext` (or its text content) through the `<wcs-speak id="<id>">`.

```html
<wcs-speak id="tts"></wcs-speak>
<button data-speaktarget="tts" data-speaktext="Hello!">Speak</button>
```

---

## `<wcs-listen>` — speech to text

```html
<!-- Auto-start on connect; bind the transcript to state -->
<wcs-listen lang="en-US" interim data-wcs="finalTranscript: transcript; interimTranscript: draft"></wcs-listen>

<!-- Manual, continuous, command-driven -->
<wcs-listen manual continuous max-restarts="5"
  data-wcs="command.start: $command.listen; finalTranscript: transcript; listening: isListening"></wcs-listen>
```

Like `<wcs-geo>`, it has two phases: a **one-shot** recognition (default) and a **continuous** session (`continuous` attribute). The browser still ends a session on silence; auto-restart bridges that, but is **opt-in via `max-restarts`** — `continuous` *alone* (with the default `max-restarts="0"`) does **not** restart on silence. Set `max-restarts="5"` to bridge up to 5 silences. This bound is deliberate: unbounded restart is an infinite-loop / quota-exhaustion risk.

> **Microphone auto-start.** Without `manual`, `<wcs-listen>` calls `start()` on connect — placing the tag in the DOM begins recognition (a permission prompt, then continuous capture). **Add `manual` to require an explicit `start()` / DOM-trigger / `trigger` write instead.** Mirrors `<wcs-geo>`'s `manual` convention, but mind that microphone capture is more privacy-sensitive.

### Attributes / Inputs

| Attribute | Input | Type | Default | Meaning |
|---|---|---|---|---|
| `lang` | `lang` | string | — | BCP-47 language tag |
| `continuous` | `continuous` | boolean | `false` | keep the session open & auto-restart on end |
| `interim` | `interim` | boolean | `false` | emit live interim transcripts |
| `max-restarts` | `maxRestarts` | number | `0` | cap on automatic restarts (continuous) |
| `manual` | `manual` | boolean | `false` | do not auto-start on connect |
| — | `trigger` | boolean | — | momentary: `false`→`true` starts a session |

### Observable Properties (outputs)

| Property | Type | Meaning |
|---|---|---|
| `interimTranscript` | string | live, not-yet-final text |
| `finalTranscript` | string | accumulated final text |
| `result` | `WcsListenResultDetail` \| null | latest result (transcript / confidence / alternatives / isFinal) |
| `listening` | boolean | a session is active |
| `permission` | `"prompt"\|"granted"\|"denied"\|"unsupported"` | microphone permission |
| `error` | `WcsListenErrorDetail` \| null | last failure |
| `unsupported` | boolean | SpeechRecognition is unavailable |

### Commands

| Command | Meaning |
|---|---|
| `start()` | begin a session (resets transcripts) |
| `stop()` | stop gracefully (no auto-restart) |
| `abort()` | stop immediately |

### Optional DOM triggering

Clicking an element with `data-listentarget="<id>"` toggles `start()` / `stop()` on the target `<wcs-listen>`.

---

## Notes & limitations

- **Secure context required.** Both APIs need HTTPS or `localhost`; `<wcs-listen>` additionally needs microphone permission.
- **Browser support.** SpeechSynthesis is broad; SpeechRecognition is Chrome-only (vendor-prefixed `webkitSpeechRecognition`) — `<wcs-listen>` reports `unsupported` elsewhere.
- **SpeechSynthesis is a global singleton.** `<wcs-speak>` does **not** `cancel()` on disconnect (that would stop other instances); call `cancel()` explicitly to stop audio. A disconnected element stops tracking but any in-flight utterance finishes.
- **Echo loop.** When wiring `<wcs-listen>` → state → `<wcs-speak>`, mute speaking while listening (e.g. bind `manual`) so the synthesized audio is not re-recognized. See the echo example.

## Headless usage (`SpeakCore` / `ListenCore`)

Both Cores are framework-agnostic and usable without the custom elements, via `bind()` from `@wc-bindable/core`:

```js
import { SpeakCore } from "@wcstack/speech";
const core = new SpeakCore();
core.speak("Hello, world.");
```

## License

MIT
