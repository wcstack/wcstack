# @wcstack/audio

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/audio` turns the Web Audio API into HTML: a modular audio graph you write as markup.

It is not a visual UI widget, and it is not a synthesizer. It is a set of **async primitive nodes** over Web Audio, wired the wcstack way — declaratively, in markup, with zero build and zero dependencies.

```html
<wcs-audio>
  <wcs-osc type="sawtooth" frequency="220">   <!-- source            -->
    <wcs-biquad type="lowpass" frequency="800">  <!-- ...filtered    -->
      <wcs-gain gain="0.5"></wcs-gain>        <!-- ...attenuated, then out -->
    </wcs-biquad>
  </wcs-osc>
</wcs-audio>
```

**Structure is declared, values are reactive.** The shape of the graph lives in your markup; the numbers flowing through it come from `@wcstack/state`:

```html
<wcs-biquad id="vcf" data-wcs="frequency: cutoff; q: resonance"></wcs-biquad>
```

## Two rules cover every patch

1. **Nesting is the signal chain.** A parent tag's audio output feeds each nested child, so signal flows *downward* through the markup. A leaf tag (no chain children, no `out`) connects to the master output.

2. **Anything nesting cannot express is routed by id.**
   - `out="bus"` — send audio to the element with that id. Many-to-one: that is how several chains meet in one gain.
   - `out="vcf.frequency"` — drive any `AudioParam` anywhere.
   - `param="frequency"` — modulator shorthand: drive the *parent's* parameter (an LFO nested inside a filter, vibrato inside an oscillator).

Polyphony is one attribute. Wrap a patch in `<wcs-voice poly="8">` and its subtree becomes a template — one fresh graph per held note, with release tails and oldest-note stealing. Outside a voice the graph is live and monophonic (last-note priority, legato, optional `glide`).

## Where the live handles are

Every `AudioNode` is owned and disposed by the Core and **never crosses the protocol boundary** — the same way `@wcstack/worker`, `@wcstack/websocket` and `@wcstack/broadcast` treat their handles. What the element publishes is values: context state, voice count, warnings, error.

The reason is recorded in [ADR-14](../../docs/architecture-hardening/14-handle-graph-wiring.md). The short version: a graph's topology is not a value. It does not diff, it does not serialize, and it does not belong in a reactive store. So the patch is a **descriptor** — read once when the graph is built — and the DOM is one way of authoring it. `AudioGraphCore` accepts the same descriptor as a plain object, which is why it is a real headless surface and not a shell of the element.

## Install

```bash
npm install @wcstack/audio
```

## Quick Start

### 1. A patch that makes a sound

```html
<script type="module" src="https://esm.run/@wcstack/audio/auto"></script>

<wcs-audio volume="0.5">
  <wcs-osc type="sine" frequency="440">
    <wcs-gain gain="0.2"></wcs-gain>
  </wcs-osc>
</wcs-audio>
```

Audio starts on your first click or key press — browsers do not let a page make noise before then. `<wcs-audio>` resumes the context on the first gesture; set `resume-on-gesture="off"` to drive it yourself with `command.resume`.

Since 4.17 the page's `AudioContext` is not even created before that gesture: a context created earlier cannot start, and Chromium and Firefox print a warning for it as the page loads ("The AudioContext was not allowed to start…", "An AudioContext was prevented from starting automatically…"). Until then `state` reads `suspended` (`running` false, `suspended` true), as it did before a gesture. The first `resume()` or `noteOn()` creates it too, so a `resume-on-gesture="off"` page still starts on its own `command.resume`, and a note sent before any gesture (from a MIDI keyboard, say) is not dropped. A page that has already had a gesture when `<wcs-audio>` connects (a route entered by a click) creates it at once. A `createContext` you supply (an `OfflineAudioContext`) is called at connect, as before.

Since 4.18 a gesture creates it once that gesture is over — after the click, not inside its `pointerdown`. Building takes a while (a few hundred milliseconds in Chromium), and the outputs it publishes re-rendered the page before the button went up: a hint bound to `running` that hid there moved the page under the pointer, and the page's first click landed on another element. `noteOn()` and `resume()` still create it at once.

### 2. An 8-voice synth driven by state

```html
<script type="module" src="https://esm.run/@wcstack/audio/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      cutoff: 1400, resonance: 4, lfoDepth: 0, activeVoices: 0,
      $commandTokens: ["play", "stop"],
    };
  </script>

  <wcs-audio volume="0.7"
    data-wcs="command.noteOn: $command.play; command.noteOff: $command.stop; voices: activeVoices">

    <wcs-voice poly="8">
      <wcs-osc type="sawtooth" note detune="-7" out="vcf"></wcs-osc>
      <wcs-osc type="sawtooth" note detune="7" out="vcf"></wcs-osc>
      <wcs-osc type="square" note transpose="-12" out="vcf"></wcs-osc>

      <wcs-biquad id="vcf" type="lowpass" data-wcs="frequency: cutoff; q: resonance">
        <wcs-lfo type="sine" rate="4" param="frequency" data-wcs="depth: lfoDepth"></wcs-lfo>
        <wcs-env attack="0.01" decay="0.25" sustain="0.55" release="0.35" out="bus"></wcs-env>
      </wcs-biquad>
    </wcs-voice>

    <wcs-gain id="bus" gain="0.8">
      <wcs-delay time="0.28" feedback="0.35" mix="0.2"></wcs-delay>
    </wcs-gain>
  </wcs-audio>

  <input type="range" min="80" max="8000" data-wcs="value: cutoff">
  <p data-wcs="textContent: activeVoices"></p>
</wcs-state>
```

```js
state.$command.play.emit(60, 0.9);   // note number, velocity
state.$command.stop.emit(60);
```

### 3. Headless — a patch without any DOM

```js
import { AudioGraphCore } from "@wcstack/audio";

const core = new AudioGraphCore();
core.setPatch({
  nodes: [{
    kind: "osc", key: "o1", params: { frequency: 440 },
    children: [{ kind: "gain", key: "g1", params: { gain: 0.2 } }],
  }],
});
await core.resume();
core.setParam("o1", "frequency", 880);   // live, no rebuild
core.dispose();
```

Pass your own `createContext` to render into an `OfflineAudioContext` — no user gesture, faster than realtime, deterministic output. That is how this package's own browser tests assert that a patch is audible. The headless Core does not wait for a gesture: it creates its context at the first `setPatch()`, so with the default (realtime) context, call `setPatch()` and `resume()` from a user gesture.

## Tags

| Tag | Web Audio | Attributes |
|-----|-----------|------------|
| `<wcs-audio>` | `AudioContext` (shared) + master gain + limiter | `volume` (0–1) `limiter` `resume-on-gesture` |
| `<wcs-voice>` | per-note graph instancing | `poly` |
| `<wcs-osc>` | `OscillatorNode` | `type` `frequency` `detune` `note` `transpose` (semitones) `glide` (s) |
| `<wcs-noise>` | looped white-noise buffer | — |
| `<wcs-biquad>` | `BiquadFilterNode` | `type` `frequency` `q` `gain` `detune` |
| `<wcs-gain>` | `GainNode` — also the named bus other chains `out` into | `gain` |
| `<wcs-delay>` | `DelayNode` + feedback + dry/wet | `time` `feedback` `mix` |
| `<wcs-shaper>` | `WaveShaperNode` (soft clip) | `amount` |
| `<wcs-env>` | ADSR; in the chain a VCA, with `param` an envelope on that parameter | `attack` `decay` `sustain` `release` `depth` `param` |
| `<wcs-lfo>` | `OscillatorNode` + depth gain (always a modulator) | `type` `rate` `depth` `param` |
| `<wcs-analyser>` | `AnalyserNode` — data only, no drawing | `fft` `smoothing` `master` |

Every tag also takes the routing attributes `id`, `out`, `param`, and `note` where they apply.

**`null` and `undefined`.** Every input is backed by its attribute: a property write is reflected to the attribute, and the attribute carries it to the graph (live, never a rebuild). Each input takes `null` as "clear": the attribute is removed and the input falls back to its default (`volume` 0.8, `limiter` and `resumeOnGesture` on, each node parameter or setting its own default — `frequency` 440 and `type` `sine` on `<wcs-osc>`, for example). `undefined` means "no value supplied": the attribute goes back to what it was before the first write — the value written in the markup, or none. Either way the sound follows. Neither is ever written as the string `"null"` / `"undefined"`, and neither turns the limiter off. (`@wcstack/state` never writes `undefined`; React 19 does when a prop that had a value is removed, and so can a direct assignment.)

## Live values vs. rebuilds

| Change | Effect |
|---|---|
| an `AudioParam` attribute or property (`frequency`, `detune`, `gain`, `q`, `time`, `feedback`, `rate`, `depth` on `<wcs-lfo>`) | **live** — ramped over ~20 ms, applied to every instance, sounding voices included |
| a setting that is not an `AudioParam` (`type`, `mix`, `amount`, the envelope's `attack` `decay` `sustain` `release` `depth`, `glide`, `transpose`, `fft`, `smoothing`) | **live** — applied to every instance, sounding voices included: `type`, `mix` and `amount` at once, the envelope times, `glide` and `transpose` from the next note or envelope stage |
| a structural attribute (`out`, `param`, `note`, `master`, `id`, `poly`) | **rebuild** |
| adding, removing or moving an audio tag | **rebuild** |
| any other DOM change | **nothing** |

That last row matters: a `<div>` added among your sliders must not silence the instrument. Rebuilds are coalesced onto a microtask, and re-submitting an unchanged patch is free.

**A rebuild cuts sounding voices.** The discontinuity is audible. Structure is meant to be declared, not animated: bind the live values, and write the structure in the markup.

Since 4.17, a rebuild that cuts sounding voices is reported once per `<wcs-audio>`: `console.warn` with `[wcs/audio-voices-cut]`, naming what changed (the tag and the attribute, or the tag added or removed) and how many voices were cut. The usual cause is a structural attribute bound to state — `<wcs-voice data-wcs="poly: polyphony">` driven by a select, `data-wcs="attr.out: route"` — or an audio tag under `if:` / `for:`. To change the structure on purpose, call `allNotesOff` first. Nothing is reported when nothing sounds.

## When a value becomes audible

Writes are accepted synchronously and the getters reflect them at once. **When a write becomes audible is not specified** — it depends on the context's render quantum and output latency, neither of which is expressible in the main thread's sync / microtask / task vocabulary. Parameter changes are smoothed over ~20 ms so they do not click, and the effective value is never read back: `frequency` returns what you last wrote.

## CSS styling with `:state()`

```css
wcs-audio:state(running)     { --led: limegreen; }
wcs-audio:state(suspended)   { --led: goldenrod; }
wcs-audio:state(unsupported) { --led: dimgray; }
wcs-audio:state(error)       { --led: crimson; }
```

Add `debug-states` to also mirror them as `data-wcs-state-*` attributes while debugging.

## Drawing a scope

`<wcs-analyser>` produces data and nothing else — wcstack I/O nodes carry no rendering. Combine it with `@wcstack/raf` and your own canvas:

```html
<wcs-raf data-wcs="eventToken.tick: onTick"></wcs-raf>
<wcs-analyser id="scope" master data-wcs="command.sample: $command.grab; eventToken.frame: onFrame"></wcs-analyser>
```

Each `sample()` returns a **freshly allocated** array, so retaining a frame is safe.

## Notes

- **The context is shared.** Browsers cap concurrent `AudioContext`s, so every `<wcs-audio>` on a page uses one, reached through a `Symbol.for` registry so even two copies of the bundle converge on it. Each root keeps its own master gain and limiter.
- **`noteOn` reaches everything in its root.** Every `<wcs-voice>` in a `<wcs-audio>` plays each note — two voices in one root are layered, not two instruments — and so do the live graph's `note` oscillators and envelopes. Two instruments (a melody and a bass, a piano and a pad) are two `<wcs-audio>` roots, each with its own `noteOn` / `noteOff`, `volume` and `voices`. That is cheap: they share the page's one context, so a second root adds a master gain and a limiter, not a second `AudioContext`.
- **The limiter is ear protection, on by default.** Since 4.17 it compresses from -18 dBFS (≈ 0.126 amplitude) at 4:1, and a hard ceiling after the compressor keeps every sample at or under -6 dBFS (amplitude 0.501), whatever the patch or `volume`: the 8-voice patch above, a full chord at velocity 1 at the default volume, stays under it — through 4.16's limiter, a compressor with only its threshold set, it reached about +5 dBFS. Under -18 dBFS a signal passes at its own level (the compressor's automatic makeup gain is taken back out). `limiter="off"` removes both stages: use it when you measure amplitudes.
- **`volume` is 0 to 1.** Since 4.17 a value outside is clamped, not refused: `volume="80"` plays — and reads — as 1, `-1` as 0. The attribute keeps what was written. Make a quiet patch louder with the gains inside it; the limiter keeps the result under its ceiling.
- **Leaving the document stops the sound, and says so.** When `<wcs-audio>` is taken out (an `if:` branch removed, a route left), its voices stop and, since 4.17, it publishes what that changed: `voices` goes to 0 and `state` to `suspended` (`running` false), so a page bound to them shows the instrument stopped. When it comes back, `state` reads the context's again.
- **`<wcs-env>` changes role with context**: in the chain it is a VCA, with `param` it shapes that parameter.
- **A voice patch with no `<wcs-env>`** gets an implicit 5 ms attack so it cannot click, and is released on note-off so it cannot sustain forever.
- **Voices are reclaimed on the audio clock**, never on a timer — background tabs throttle timers to about once a minute while audio keeps rendering, which would otherwise leak a voice per note.
- **Units**: `glide` in seconds, `detune` in cents, `transpose` in semitones, `time` in seconds.
- **SSR**: there is no `AudioContext` on a server, so the state is `unsupported` and the tags render nothing.

## Accessibility

**WCAG 1.4.2 Audio Control (Level A)**: audio that plays automatically for more than 3 seconds needs a mechanism to pause, stop, or mute it, independent of system volume — a screen-reader user has to hear their reader *over* your audio. In practice the browser's autoplay policy already pushes you the right way (a context starts suspended until a gesture); keep it that way: start sound from an explicit user action, and wire a visible stop control to the `suspend` command (or `allNotesOff` to silence voices while keeping the graph alive). `resume` brings it back.

## License

MIT
