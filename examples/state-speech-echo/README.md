# speech echo demo (listen ⇄ speak)

`@wcstack/state` + `@wcstack/speech`. Both halves of the package in one loop: `<wcs-listen>` recognizes your voice into state (event-token side), `<wcs-speak>` reads it back on demand (command-token side).

## Getting Started

Open `index.html` in **Chrome** (SpeechRecognition is Chrome-only, vendor-prefixed) over `https://` or `localhost`, and allow the microphone when prompted.

## Features

- **Toggle mic** via the `data-listentarget` DOM autoTrigger (`start()` / `stop()` toggle).
- **Live transcript**: `interimTranscript` (greyed, in-progress) and `finalTranscript` (committed) bound to state.
- **Echo it back**: `$command.echo.emit(transcript)` speaks the recognized text.
- **Echo-loop guard**: `echoIt()` refuses to emit the echo while `listening` is true, so the synthesized audio is not picked up and re-recognized. The guard lives in state (not on `<wcs-speak>`) because `speak()` is imperative and does **not** honor `manual` — only the reactive `say` path does. To gate the reactive path instead, bind `<wcs-speak data-wcs="say: transcript; manual: listening">`.

## Key Points

- The recognition → state flow is the **event-token** direction (element → state); the echo is the **command-token** direction (state → element). The two tags demonstrate the protocol's duality at package scope.
- `permission` is bound so the UI can surface a denied microphone.
- `continuous` is off here (one phrase per session); add `continuous max-restarts="5"` to keep a session open across silences.
