# synth-playground — a modular synthesizer made of HTML tags

An 8-voice polyphonic synth and a mono bass, built from
[`@wcstack/audio`](../../packages/audio/) and [`@wcstack/midi`](../../packages/midi/)
with zero build and zero dependencies. Play it from the on-screen keys, your
computer keyboard, or a MIDI keyboard.

```bash
npx serve examples/synth-playground
# or serve the whole repo: cd e2e && npm run serve
```

Audio starts on your first click / key press (browser autoplay policy).
`<wcs-midi>` needs Web MIDI (Chromium-only); everything else works anywhere.

> This started as a throwaway experiment with its own 1,000-line `wcs-synth.js`.
> That file is gone — the tags it prototyped are now a published package, and the
> decision that made the promotion possible is recorded in
> [ADR-14](../../docs/architecture-hardening/14-handle-graph-wiring.md).

## What to look at

**The page is the patch.** View source and you can read the whole instrument:
nesting is the signal chain, `out="bus"` sends audio across the graph, and
`param="frequency"` hangs an LFO on the filter it modulates.

**Structure is declared, values are reactive.** Every slider is an ordinary
`<input>` bound to `<wcs-state>` with `data-wcs`; the state drives the audio
nodes as plain property writes. Nothing on this page calls a Web Audio API.

**Ordinary DOM lives inside the patch.** The `.controls` grid sits inside
`<wcs-audio>`, right after `<wcs-analyser>`. Adding markup there does *not*
rebuild the graph — a structural change would cut every sounding voice, so the
root filters its mutation observer down to audio elements.

**Drawing is the page's job.** `demo-ui.js` holds `<demo-keys>` and
`<demo-scope>` — deliberately *not* part of the package. wcstack I/O nodes carry
no rendering, so `<wcs-analyser>` produces data and the demo paints it.

**MIDI is independent.** `<wcs-midi>` turns messages into state; the `$on`
handler decides that a note-on should play this synth. Nothing couples the two
packages together.

## The patch

```
poly synth (8 voices)
  3 × wcs-osc ──out="vcf"──▶ wcs-biquad (lowpass)
                               ├── wcs-lfo   param="frequency"   (cutoff wobble)
                               └── wcs-env   out="bus"           (VCA)
  wcs-gain#bus ──▶ wcs-delay ──▶ master
  wcs-analyser[master] ──▶ demo-scope

mono bass
  2 × wcs-osc (glide) ──out="bflt"──▶ wcs-biquad ──▶ wcs-env ──▶ master
```
