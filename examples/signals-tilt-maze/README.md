# signals tilt ball maze

The same labyrinth game as [`examples/state-tilt-maze`](../state-tilt-maze/) —
same maze, same physics, same four unmodified I/O nodes (`<wcs-tilt>`,
`<wcs-accelerometer>`, `<wcs-raf>`, `<wcs-wakelock>`) — with one thing
swapped: the reactive core is **`@wcstack/signals`** instead of
`@wcstack/state`.

That is the point of the demo. The I/O layer speaks wc-bindable and doesn't
know (or care) which reactive core is listening: `bindNode` folds each node's
property events into signals, `bound.set` writes its inputs, and
`bound.command` invokes its commands. **Swap the core, keep the nodes.**

## Getting Started

No backend and no build — any static server works:

```bash
npx serve examples/signals-tilt-maze
```

Desktop: drag the board (or DevTools → Sensors). Phone: HTTPS or
`adb reverse`; iOS grants tilt via the Start button's tap. Same platform notes
as the [state version](../state-tilt-maze/README.md#getting-started).

## What changes when the core is signals

| | state version | signals version |
|---|---|---|
| Wiring to I/O nodes | `data-wcs` attributes (declarative DSL) | `bindNode(el)` in JS (`signals` / `set` / `command`) |
| Game tick | event-token → `$on.frameTick` | `effect(() => { loop.signals.tick.get(); step(); })` |
| Hot-loop values (`vx`, `shakeCooldown`, …) | state properties (go through the proxy) | **plain JS variables** — never touch the reactive graph |
| Render-relevant values | every bound path | exactly three signals: `phase`, `pos`, `timeMs` |
| Rendering | HTML templates + structural `if:`/`for:` | `h()` — real DOM built once, per-binding effects |
| Per-frame DOM work | binding pipeline update per bound path | **one** `style` effect re-runs (`transform: translate(...)`) |
| Sensor enable commands | command-token: one `$command.startSensors` emit fans out to `command.*` subscriptions in HTML | `tilt.command("requestPermission")` via the bridge |
| `:state()` styling (`game loop` chip) | identical | identical — it's CSS, the core is irrelevant |

Two disciplines worth copying:

- **`peek()` inside the step.** The physics reads every signal (tilt, accel,
  phase, pos) with `peek()`, so the driving effect depends on exactly one
  signal — the timer tick. Tilt events firing at sensor rate never re-run the
  step out of cadence.
- **Signals only for what the DOM shows.** Velocities, drag state and
  timestamps are plain `let`s. The reactive graph sees three values, and the
  frame cost is one targeted `style` write — no diffing, no proxy traps in the
  hot path. This is the "real-time rendering leans signals" trade made
  concrete.

## Verified

Same real-browser (headless Chromium) run as the state version: rendering,
drag fallback, wall collision, synthetic-tilt control, hole fall — plus the
autonomous closed-loop solve steering the ball through all four lanes to the
goal (cleared in ~21 s of game time, matching the state version's physics).
