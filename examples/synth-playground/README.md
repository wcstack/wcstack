# synth-playground — a modular synthesizer made of HTML tags

A **toy experiment**, not a published wcstack package: oscillators, filters,
envelopes, LFOs, a mixer and a delay as custom elements over the Web Audio
API, wired the wcstack way — declaratively, in markup, with zero build and
zero dependencies. Play it from the on-screen keys, your computer keyboard,
or a MIDI keyboard.

```bash
npx serve examples/synth-playground
# or serve the whole repo: cd e2e && npm run serve
```

Audio starts on your first click / key press (browser autoplay policy).
Checked in Chromium; `<wcs-midi>` needs Web MIDI (Chromium-only).

## Wiring model

Two rules cover every patch:

1. **Nesting is the signal chain.** A parent tag's audio output feeds each
   nested child, so signal flows *downward* through the markup. A leaf tag
   (no chain children, no `out=`) connects to the synth's master output.

   ```html
   <wcs-synth>
     <wcs-osc type="sawtooth" frequency="220">  <!-- source          -->
       <wcs-filter type="lowpass" frequency="800">  <!-- ...filtered -->
         <wcs-gain gain="0.5"></wcs-gain>       <!-- ...attenuated, then out -->
       </wcs-filter>
     </wcs-osc>
   </wcs-synth>
   ```

2. **Anything nesting can't express is routed by id.**
   - `out="bus"` — send audio to the element with that id (many-to-one:
     that's how several chains meet in a `<wcs-mixer>`).
   - `out="vcf.frequency"` — drive any AudioParam anywhere.
   - `param="frequency"` — modulator shorthand: drive the *parent's* param
     (an LFO nested inside a filter, vibrato nested inside an oscillator).

Polyphony: wrap a patch in `<wcs-voice poly="8">` and its subtree becomes a
template — one fresh audio graph per held note, with envelope release and
oldest-note stealing. Outside a voice the graph is live and monophonic
(last-note priority, legato + optional `glide`).

## Tags

| Tag | Web Audio | Attributes |
|-----|-----------|------------|
| `<wcs-synth>` | AudioContext (shared) + master gain + limiter | `volume` |
| `<wcs-voice>` | per-note graph instancing | `poly` |
| `<wcs-osc>` | OscillatorNode | `type` `frequency` `detune` `note` (follow notes) `transpose` (semitones) `glide` (s) |
| `<wcs-noise>` | looped white-noise buffer | — |
| `<wcs-filter>` | BiquadFilterNode | `type` `frequency` `q` `gain` `detune` |
| `<wcs-gain>` | GainNode | `gain` |
| `<wcs-mixer>` | GainNode (named bus) | `gain` |
| `<wcs-delay>` | DelayNode + feedback + dry/wet | `time` `feedback` `mix` |
| `<wcs-shaper>` | WaveShaperNode (soft clip) | `amount` |
| `<wcs-env>` | ADSR; in the chain = VCA, with `param=` = param envelope | `attack` `decay` `sustain` `release` `depth` `param` |
| `<wcs-lfo>` | OscillatorNode + depth gain (always a modulator) | `type` `rate` `depth` `param` |
| `<wcs-scope>` | AnalyserNode passthrough + canvas | `mode` (`wave`/`fft`) `master` (tap the master out) |
| `<wcs-keys>` | on-screen keyboard (pointer, glissando, multi-touch) + computer keyboard (<kbd>A</kbd>–<kbd>;</kbd>, <kbd>Z</kbd>/<kbd>X</kbd> octave) | `octaves` `octave` `keyboard="off"` `for` |
| `<wcs-midi>` | Web MIDI note input | `channel` `for` |

All numeric attributes are live: change them (devtools, sliders, anything
that writes attributes) and every running instance — including sounding
voices — retunes with a short smoothing ramp.

## Notes on the design

- Each tag is a descriptor + attribute reactivity; the synth root compiles
  the DOM into an audio graph (two passes: instantiate along the nesting,
  then resolve id wires). `<wcs-voice>` re-runs that compiler per note, which
  is what makes "markup as patch template" cheap.
- Audio leaving a voice (default out *and* `out=` sends) is funneled through
  a per-voice gain so note stealing can fade the whole voice.
- A gateless voice patch gets an implicit 5 ms/80 ms safety envelope so it
  can't sustain forever.
- One AudioContext is shared by all `<wcs-synth>` elements (browsers cap
  concurrent contexts); each synth keeps its own master gain + compressor
  (ear protection). Master analyser taps are re-kicked on resume — Chromium
  can silently drop edges into a sink-only AnalyserNode wired while the
  context is suspended.
- Structural changes (adding/removing tags, editing `out=`/`param=`) rebuild
  the whole graph and cut sounding voices; parameter changes never rebuild.

Fun follow-ups if the toy earns a second session: `wc-bindable` surfaces so
`<wcs-state>` can drive a patch (`data-wcs="frequency: cutoff"`), a
step-sequencer tag, pitch bend / mod wheel in `<wcs-midi>`, and an
`<wcs-adsr-pad>` XY controller.
