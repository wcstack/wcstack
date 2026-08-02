# midi-fader — a MIDI controller drives the page

A minimal `@wcstack/midi` demo, deliberately **independent of any synth**: it
shows that Web MIDI is a general-purpose input node, not just something that
makes sound. Notes and control changes flow into `<wcs-state>` and render as
ordinary HTML.

```bash
npx serve packages/midi/examples/midi-fader
# or serve the whole repo: cd e2e && npm run serve
```

Chromium only (Web MIDI is not implemented in Firefox or Safari). Access is
requested from a real click, because `requestMIDIAccess()` may prompt.

## What to look at

- `<wcs-midi>` has **no rendering of its own**. It produces state; every pixel on
  the page is plain HTML bound to paths.
- `eventToken.message: onMidi` delivers one occurrence per message. The `$on`
  handler decides what each message kind means to *this* page.
- `command.request: $command.requestMidi` fires the access request from a button,
  so the permission prompt is tied to a user gesture.
- The status dot is styled with `wcs-midi:state(connected)` — output state
  reaches CSS without passing through the binding layer at all.
