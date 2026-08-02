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

Pass your own `createContext` to render into an `OfflineAudioContext` — no user gesture, faster than realtime, deterministic output. That is how this package's own browser tests assert that a patch is audible.

## Tags

| Tag | Web Audio | Attributes |
|-----|-----------|------------|
| `<wcs-audio>` | `AudioContext` (shared) + master gain + limiter | `volume` `limiter` `resume-on-gesture` |
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

## Live values vs. rebuilds

| Change | Effect |
|---|---|
| a numeric attribute or property (`frequency`, `gain`, `attack`, …) | **live** — applied to every instance, sounding voices included |
| a structural attribute (`out`, `param`, `note`, `id`, `poly`) | **rebuild** |
| adding, removing or moving an audio tag | **rebuild** |
| any other DOM change | **nothing** |

That last row matters: a `<div>` added among your sliders must not silence the instrument. Rebuilds are coalesced onto a microtask, and re-submitting an unchanged patch is free.

**A rebuild cuts sounding voices.** The discontinuity is audible. Structure is meant to be declared, not animated.

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
- **The limiter starts working early.** Its threshold is -18 dBFS (≈ 0.126 amplitude), which is well below full scale — that is the point, it is ear protection. If you are measuring amplitudes, stay under it or turn it off with `limiter="off"`.
- **`<wcs-env>` changes role with context**: in the chain it is a VCA, with `param` it shapes that parameter.
- **A voice patch with no `<wcs-env>`** gets an implicit 5 ms attack so it cannot click, and is released on note-off so it cannot sustain forever.
- **Voices are reclaimed on the audio clock**, never on a timer — background tabs throttle timers to about once a minute while audio keeps rendering, which would otherwise leak a voice per note.
- **Units**: `glide` in seconds, `detune` in cents, `transpose` in semitones, `time` in seconds.
- **SSR**: there is no `AudioContext` on a server, so the state is `unsupported` and the tags render nothing.

## License

MIT
