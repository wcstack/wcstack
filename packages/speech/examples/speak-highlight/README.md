# speak + word highlight demo

`@wcstack/state` + `@wcstack/speech` (`<wcs-speak>`). Text-to-speech as a state transition, with a karaoke-style word highlight driven by the `charIndex` / `spokenWord` outputs.

## Getting Started

Open `index.html` in a browser (any static server, or just the file). No build step — everything loads from `esm.run`.

## Features

- **Speak / Stop** via command-tokens (`$command.say.emit(text)` / `$command.stopSpeak.emit()`).
- **Word highlight**: `<wcs-speak>` reports `charIndex` and `spokenWord` as it speaks; three derived getters (`before` / `current` / `after`) slice the text around the spoken word, and a `.hl` span highlights it.
- **No imperative speech code** in the UI — the page never calls `speechSynthesis.speak()`.

## Key Points

- `command.speak: $command.say` forwards the emitted text straight to `<wcs-speak>.speak(text)` — the command-token argument-forwarding contract.
- The highlight is pure derived state: `before/current/after` recompute whenever `pos` (`charIndex`) changes.
- `unsupported` is bound so the UI degrades gracefully where SpeechSynthesis is missing.
