# tilt + accelerometer + timer + wakelock demo (ball maze)

The classic wooden labyrinth toy, as a wcstack composite: tilt your phone to
roll a ball past four holes to the flag. Five packages, and each one has a
real job — **including the game loop, which is a declarative tag**.

> The same game also exists with `@wcstack/signals` as the reactive core —
> same maze, same unmodified I/O nodes: see
> [`examples/signals-tilt-maze`](../signals-tilt-maze/) for the side-by-side
> comparison of what a core swap changes.

| Package | Role |
|---|---|
| `@wcstack/tilt` | `beta` / `gamma` become the gravity vector |
| `@wcstack/timer` | `<wcs-timer interval="16">` drives one physics step per tick |
| `@wcstack/accelerometer` | shake detection (\|accel\| far from 9.8 m/s²) → restart |
| `@wcstack/wakelock` | screen stays awake *while* `phase === "playing"` |
| `@wcstack/state` | physics, collision, phases, and every pixel of rendering |

## Getting Started

No backend and no build — any static server works:

```bash
npx serve examples/state-tilt-maze
```

- **Desktop**: drag on the board to tilt it (or emulate orientation in
  DevTools → Sensors). Physics coordinates are the CSS pixels of the 320×320
  board, so what you see is exactly what the collision code sees.
- **Phone**: sensors need a secure context — serve over HTTPS or use
  `adb reverse tcp:3000 tcp:3000` (Android). iOS grants tilt through the
  Start button's tap; shake needs the Generic Sensor API (Chromium/Android),
  elsewhere the Retry button covers it.

## Data Flow

```
<wcs-tilt> ──beta/gamma──▶ state.tiltBeta/tiltGamma ─┐
pointer drag ──▶ state.simBeta/simGamma ─────────────┤ get effBeta/effGamma
                                                     ▼
<wcs-timer interval="16"> ──eventToken.tick──▶ $on.frameTick ─▶ step()
                                                     │  integrate velocity,
                                                     │  collide, hole/goal check
                                                     ▼
                       state.ballX/ballY ──▶ style.transform (the ball moves)

<wcs-accelerometer> ──x/y/z──▶ shake check inside step() ──▶ restart()
state.isPlaying ──active──▶ <wcs-wakelock> ──held──▶ HUD chip
```

## Key Points

- **The game loop is declarative.** `<wcs-timer interval="16">` emits its
  `tick` as an event token (`eventToken.tick: frameTick`), and `$on.frameTick`
  runs one `step()`. No `requestAnimationFrame`, no `setInterval`, no teardown
  — remove the tag and the loop is gone. The HUD's "game loop" chip is styled
  via `wcs-timer:state(running)` (the CustomStateSet reflection added in
  1.17.0), with zero bindings.
- **Sensors are just input nodes.** The physics only ever reads
  `effBeta` / `effGamma` getters. The device sensor and the pointer-drag
  fallback write *different* state paths, and the getters pick a source —
  swapping the input changes nothing downstream. Desktop, denied permission,
  or a missing sensor all degrade to the same playable game.
- **Sensor enabling is a command token.** The Start button's `startGame()`
  emits one `$command.startSensors` token, and the elements subscribe their
  own methods to it in HTML (`command.requestPermission` + `command.start` on
  `<wcs-tilt>`, `command.start` on `<wcs-accelerometer>`) — state touches no
  DOM. The emit runs synchronously in the click's gesture context, which is
  what iOS's permission gate requires; firing `start()` without awaiting the
  permission is safe because that gate is on event *dispatch*, not listener
  registration — an ungranted subscription is simply silent (and every other
  platform resolves `"granted"` immediately).
- **Shake detection is a derived signal.** `<wcs-accelerometer>` just streams
  `x/y/z`; `step()` computes `|accel|` and treats a large deviation from
  gravity (9.81 m/s²) as a shake, with a 1.2s cooldown. On desktop the sensor
  errors (`NotReadableError`) by design — never-throw leaves it in the sticky
  `error` property and the game plays on.
- **Wakelock reads as one sentence.** `active: isPlaying` holds the screen
  awake exactly while playing; the `held` output feeds the HUD chip, honestly
  reporting when the OS actually holds the lock (headless browsers and
  desktops often don't — the game doesn't care).
- **Physics is tunneling-proof by construction.** `V_MAX` (260 px/s) times
  the clamped frame delta (40 ms) stays under the 12 px wall thickness, so
  the axis-separated collision test can never step through a wall.
- **Pointer-capture gotcha.** `dragStart` captures the pointer, and pointer
  capture retargets the derived `click` — so a capture started on the Start
  overlay would eat its button's click. Dragging is therefore gated on
  `phase === "playing"`, the only phase with no overlay covering the board.

## Verified

The demo ships after a real-browser (headless Chromium) run: rendering, drag
fallback, wall collision, synthetic-tilt control, hole fall, shake plumbing,
and an autonomous closed-loop solve that steers the ball through all four
lanes to the goal — proving the maze is clearable end-to-end.
