# state + router + audio + midi demo (a music room's practice keyboard)

The practice keyboard of a junior high school music room, in Japanese. An 8-voice synth (`<wcs-voice poly="8">`) played from a MIDI keyboard, the on-screen keyboard and the computer keyboard, with velocity, the sustain pedal, pitch bend and the mod wheel (vibrato), MIDI thru to a sound module, a level meter and a "stop every sound" button. Sounds come from the teacher (saved on the server with a key), from the student (kept on this computer) and from a link (every value in the URL's query). The practice page has a metronome, a 16-step sequencer and takes recorded against the metronome, played back and saved on the server.

It was written by a first-time author from the 4.16.0 documents and the AI authoring skill only, to find where `<wcs-midi>`, state and `<wcs-audio>` meet badly ([docs/seam-apps.md](../../docs/seam-apps.md#music-room-2026-11-07)). There was no MIDI keyboard: the author wrote a stand-in for the Web MIDI API (`tests/fixtures/fake-midi.js`) and a probe that taps every node the page connects to the speakers (`tests/fixtures/audio-probe.js`), so "it sounds" was measured, not assumed.

Packages: `@wcstack/state`, `router`, `audio`, `midi`, `fetch`, `storage`, `timer`, `raf`, `debounce`, `network`.

## Run it

The packages load from a CDN ([esm.run](https://esm.run), npm `latest`); the server uses Node's built-ins only:

```bash
node examples/music-room/server.js                # http://localhost:5610   (PORT=… to change)
WCS_LOCAL=1 node examples/music-room/server.js    # the repository's packages/*/dist instead of the CDN
```

The page is `public/index.html`; the sounds and takes live in memory. Sound starts at the first click or key press (the browser's rule); the banner says so until then.

| URL | |
|---|---|
| `/play?wave=square&cutoff=1800&…` | Play: the keyboards, the pedal, the vibrato depth, the sound's eleven controls (each change rewrites the query in place), a link to the sound, "save on this computer", and the teacher's save (key `ongaku`) |
| `/sounds`, `/sounds/2`, `/sounds/my-…` | The teacher's sounds and the student's own (rename, delete), and one sound's values |
| `/practice` | The metronome (BPM, beats per bar), the sequencer, recording, the saved takes |
| `/settings` | MIDI input and output, the computer keyboard on or off, the master volume, the metronome click |

Add `?delay=3000` to any page to slow every API request it makes.

API: `GET /api/sounds`, `/api/sounds/:id`, `POST /api/sounds` (`X-Teacher-Key`; 403, 422 per field), `GET /api/takes`, `/api/takes/:id`, `POST /api/takes` (422, 413 past 5000 events).

Test hooks (`POST`): `/__reset` (the seed sounds and takes again), `/api/_test/fail` `{ path, status, times }` (the next requests to `path` fail).

## Things to try

- Press `A` before clicking anything: that key press starts the sound and plays C4. `Z` / `X` change the octave.
- Plug in a MIDI keyboard and press "MIDI キーボードをつなぐ": the page plays from it, the pedal holds a chord, the wheels bend and add vibrato. Unplug it with keys held: they let go.
- Hold a chord and turn the controls, or change the waveform: the notes keep sounding (only structural attributes rebuild the patch, and the page binds none).
- Copy the sound's link into another tab, or reload: the same sound. Back and Forward move between sounds.
- On the practice page, start the sequencer and change the tempo while it runs: the bar keeps its place.
- Switch tabs or windows with a key held: nothing is left sounding.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| `<wcs-midi>` → state → `<wcs-audio>` | `eventToken.message: onMidi` takes each message as an occurrence (not a property: two equal notes in a row are two notes); the handler decides from `type` (`noteon` / `noteoff`, velocity-0 note-ons already normalized), never from the status byte, and calls `$command.synthOn.emit(note, velocity)` with the velocity as given (0–1) |
| Several sources, one note | A note is held by its sources (the MIDI port, the screen, the computer keyboard, the sequencer, a take) and the pedal; it is released when the last one lets go (`lib/music.js`, unit-tested) |
| The URL's query ⇄ the sound | The query is strings: they are parsed, clamped and completed into numbers before they reach an audio input, and a non-canonical query is rewritten with `replaceUrl`. A control's change settles through `<wcs-debounce>` before it is written back |
| Structural attributes | `poly`, `out`, `param` and `note` stay in the markup; only live values are bound |
| Where the I/O nodes live | `<wcs-audio>`, `<wcs-midi>`, `<wcs-storage>`, the timer and the fetches are at the page level, outside the router, for the page's whole life |
| Two instruments | The metronome click is a second `<wcs-audio>` root: one root plays one patch, and `noteOn` reaches every voice in it |
| The browser's sound rule | A banner bound to `running` until the first gesture; the first key press is the gesture and plays its note |
| Time | One 20 ms `<wcs-timer>` whose ticks read `performance.now()`; beats and steps come from the elapsed time, so a late tick plays the latest step instead of a burst, and a tempo change re-anchors the clock |
| A held key and the page | Leaving a page, a hidden tab, a lost window focus, an unplugged keyboard or a refused permission release what the player held |
| Stored data older than the app | A sound saved before a key existed (no `delayMix`) is completed with the default when it is read |

## What building it found

The author's friction log, the 17 mistakes made on purpose, and how each claim was reproduced and classified are in [docs/seam-apps.md](../../docs/seam-apps.md#music-room-2026-11-07). What 4.17.0 did about them, in short:

| Found | 4.17.0 |
|---|---|
| The "ear protection" limiter let the README's own 8-voice patch reach +5 dBFS at the default volume; `volume` had no upper bound | a ceiling at -6 dBFS, `volume` clamped to [0, 1] |
| `<wcs-audio>` created its `AudioContext` at connect, so Chromium and Firefox warned on every load | created at the first gesture |
| A `<wcs-midi>` without `auto` taken out by a route and put back kept its `devices` and did not reconnect — "1 台つながっています", MIDI dead until a reload | `devices: []` on disconnect; reconnects while the permission is granted |
| Where Web MIDI is absent, `<wcs-midi>` said `permission: "prompt"` until `request()` | `unsupported` at connect |
| A removed `<wcs-audio>` left `voices` and `running` in state | published on disconnect |
| A structural attribute bound to state cut every held note without a word | `[wcs/audio-voices-cut]` |
| A sound link or a stored sound without a key left the node on the previous sound's value | `[wcs/input-undefined]` |
| `out:` on `<wcs-env>` failed the page with a sentence that named no tag | `[wcs/tag-member-unknown]` names the tag |
| The lint ignored a getter's `@type`, rows from `Array.from` and `[...Array(n).keys()]`, and a namespace import's spread | all read |

Landing it here removed the workarounds 4.17.0 made unnecessary:

- **`request()` at connect where Web MIDI is absent**, so that the MIDI area could say "使えません" from the start — `<wcs-midi>` says `unsupported` itself.
- **The step and beat rows built over module constants** (`STEP_INDEXES.map(…)`) — `Array.from({ length: 16 }, …)` and `[...Array(n).keys()].map(…)`.
- **The field errors copied by a `$watch` into seeded keys** — getters again (`soundFieldErrors`, `takeFieldErrors`), typed with a JSDoc `@type`.
- **An identity `.map((o) => ({ id: o.id, label: o.label }))`** over the MIDI port lists — a JSDoc `@type` on the getters.
- **A JSDoc `@type` on `sound`** written for its spread of `M.DEFAULT_SOUND` — the lint follows a namespace import's member.

With each removed, the 4.16.0 lint gives 22 `wcs/binding-path-missing` warnings and one `wcs/path-dynamic-unknown` info, and the 4.16.0 `<wcs-midi>` fails the "no Web MIDI" test.

Landing it also found a 4.17.0 regression, fixed in 4.18: `<wcs-audio>` built its graph inside the first `pointerdown`, so the banner hid before the button went up, the page moved up under the pointer, and the page's first click landed elsewhere — the MIDI button was not pressed, a checkbox flipped back ([docs/seam-apps.md](../../docs/seam-apps.md#landing-music-room-in-examples-2026-11-08)).

## Lint

```bash
node packages/lint/dist/cli.cjs --strict examples/music-room/public/index.html
```

0 errors, 0 warnings and 0 infos.

## Known limits

- **The packages follow npm `latest`.** The one-liners are unpinned, as in the other examples; production pins versions with `integrity` ([docs/sri.md](../../docs/sri.md)).
- **No real MIDI keyboard was used.** Device timing, Chrome's real permission prompt and whether Chrome keeps an unplugged port in `inputs` are not tested; the stand-in keeps it with `state: "disconnected"`.
- **Two tabs with a real keyboard both sound**: Web MIDI delivers input to every page. The computer keyboard plays in the focused tab only.
- **Firefox** has `requestMIDIAccess` behind its site-permission add-on; headless, the request never settles, so the page waits on "the browser is asking". Sound, the metronome and links work. **WebKit** (Playwright's build on Windows) has no Web Audio: the page says it cannot make sound. Safari was not tried.
- **A hidden tab** is simulated in the tests (headless Chromium never hides one). A real hidden, silent tab gets about one timer tick a second; a late tick plays only the latest beat or step.
- **The data lives in memory**: a restart of the server forgets the teacher's new sounds and the takes.

## Tests

[`e2e/tests/music-room.spec.ts`](../../e2e/tests/music-room.spec.ts) (`WCS_LOCAL=1`, one server per worker on port 7500 + 10 × the worker index) turns the author's 31 checks into Chromium tests, with the MIDI stand-in and the audio probe: a note from the computer keyboard measured at the speakers, a MIDI chord under the pedal, a sound link after a reload, the sequencer's tempo, a take recorded, saved and played, the settings after a reload; what happens in real use (a key held when the window loses focus, the tab hides, the page changes or the keyboard is unplugged; ten notes on eight voices; a keyboard plugged in; the permission refused, allowed and revoked; no Web MIDI; controls turned while a chord sounds; two tabs; offline); and the rest of the site. Three more pin what 4.17.0 decided: no `AudioContext` before the first gesture, the -6 dBFS ceiling for an 8-voice chord at full volume, and a stored sound older than the app played without a warning. The console stays free of warnings and errors in the main flows.

The author's unit tests (29, Vitest on the published `@wcstack/testing`) are in `tests/unit/`:

```bash
cd examples/music-room && npm install && npm test
```
