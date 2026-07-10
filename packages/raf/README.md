# @wcstack/raf

`@wcstack/raf` is a headless requestAnimationFrame component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the browser's rendering opportunities into reactive state — `@wcstack/timer`'s sibling with the time source swapped from a period (`setInterval`) to the frame (`requestAnimationFrame`).

With `@wcstack/state`, `<wcs-raf>` can be bound directly through path contracts:

- **input surface**: `once`, `repeat`, `manual`, `trigger`
- **output state surface**: `tick`, `elapsed`, `dt`, `running`, `suspended`
- **commands**: `start`, `stop`, `reset`, `pause`, `resume`

This means a game loop or animation driver can be expressed declaratively in HTML, without writing `requestAnimationFrame` re-registration, dt bookkeeping, or teardown glue in your UI layer.

## Why this exists — and when to prefer it over `wcs-timer`

`<wcs-timer interval="16">` can drive a game loop, but `setInterval` is not aligned to the display's refresh, and consumers must measure their own frame delta. `<wcs-raf>` ticks on the browser's actual rendering opportunity and ships the delta as a first-class output.

| | `<wcs-timer>` | `<wcs-raf>` |
|---|---|---|
| Time source | `setInterval` (a period you choose) | `requestAnimationFrame` (the display's frame) |
| `interval` input | yes | **no** — rAF has no period |
| `dt` output | no | **yes** (`0` across interruptions, see below) |
| Hidden tab | throttled (~1Hz) | **fully stopped** — surfaced via `suspended` |
| Use for | polling, countdowns, clocks | game loops, animation, per-frame measurement |

## Install

```bash
npm install @wcstack/raf
```

## Quick Start

### 1. A declarative game loop

When `<wcs-raf>` is connected to the DOM, it automatically starts a frame loop. Bind `tick` / `dt` to state paths — or receive the frame as an event token and run one physics step per frame:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/raf/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      x: 0,
      $eventTokens: ["frame"],
      $on: {
        frame: (state, e) => { state.x += 60 * (e.detail.dt / 1000); }, // 60px/s
      },
      get transform() { return `translateX(${this.x}px)`; },
    };
  </script>
</wcs-state>

<wcs-raf data-wcs="eventToken.tick: frame"></wcs-raf>
<div class="box" data-wcs="style.transform: transform"></div>
```

`e.detail` carries `{ count, elapsed, dt, timestamp }` — integrate against `dt` and the motion speed is frame-rate independent.

### 2. One frame (`requestAnimationFrame`-once equivalent)

`once` fires exactly one tick on the next rendering opportunity, then auto-stops — the declarative form of a single rAF call:

```html
<wcs-raf once data-wcs="tick: afterNextPaint"></wcs-raf>
```

### 3. Bounded frames

`repeat="N"` fires `N` frames and then stops (`running` becomes `false`).

## Attributes / Inputs

| Attribute | Type    | Default | Description |
| --------- | ------- | ------- | ------------ |
| `once`    | boolean | `false` | Fire a single frame, then stop. Sugar for `repeat="1"`. |
| `repeat`  | number  | `0`     | Stop after N frames (`0` = unlimited). Takes precedence over `once`. |
| `manual`  | boolean | `false` | Do not auto-start on connect; start via command / trigger. |

Deliberately absent vs `<wcs-timer>`: `interval` (rAF has no period) and `immediate` (the first frame already **is** the next rendering opportunity — no earlier meaningful moment exists).

## Observable Properties (outputs)

| Property    | Event                     | Description |
| ----------- | ------------------------- | ------------ |
| `tick`      | `wcs-raf:tick`            | Frame counter, increments on every fire (reset to 0 on `reset`). |
| `elapsed`   | `wcs-raf:tick`            | Accumulated **active** milliseconds (Σdt) since the last reset — hidden/paused periods contribute nothing. Frame-granular: between frames the getter returns the value as of the last tick. |
| `dt`        | `wcs-raf:tick`            | Delta to the previous frame in ms. **`0` on the first frame after `start()` / `resume()` / a visibility interruption** — a value spanning an interruption never reaches observers. No upper clamp: how to treat a slow frame is your domain decision (a physics loop typically applies its own `Math.min(dt, …)`). |
| `running`   | `wcs-raf:running-changed` | The started **intent**: `true` from `start` until `stop`/`pause`/bounded completion. Stays `true` in a hidden tab even though no frames arrive. |
| `suspended` | `wcs-raf:suspended-changed` | The delivery **actuality**: `true` while `running` in a hidden tab (rAF is fully stopped there — not throttled). The desired/actual split mirrors `@wcstack/wakelock`'s `active`/`held`. |

`tick` / `elapsed` / `dt` all derive from the single `wcs-raf:tick` event (`detail = { count, elapsed, dt, timestamp }`; `timestamp` is the frame's `DOMHighResTimeStamp`, `0` for the `reset()` notification). `tick` fires every frame with no equality guard; `running` / `suspended` are equality-guarded.

## Commands

| Command   | Description |
| --------- | ----------------------------------------------------------------------- |
| `start`   | Begin the frame loop (no-op if already running). |
| `stop`    | Stop; `tick` / `elapsed` are retained. |
| `reset`   | Stop and reset `tick` / `elapsed` / `dt` to `0`. |
| `pause`   | Suspend the loop, preserving values and the bounded-run remainder. |
| `resume`  | Continue from a `pause`; the first frame after it reports `dt = 0`. |

State-driven invocation uses the command-token protocol:

```html
<wcs-raf manual data-wcs="command.start: $command.beginLoop"></wcs-raf>
```

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element carrying `data-raftarget="<id>"` calls `start()` on the referenced `<wcs-raf>`. A matched click calls `event.preventDefault()` — do not put `data-raftarget` on an element whose default action you also want.

```html
<button data-raftarget="loop">Start</button>
<wcs-raf id="loop" manual data-wcs="eventToken.tick: frame"></wcs-raf>
```

## CSS styling with `:state()`

`<wcs-raf>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet):

| State | On when |
|-------|---------|
| `running` | `wcs-raf:running-changed` fires with `true` (cleared on `false`) |
| `suspended` | `wcs-raf:suspended-changed` fires with `true` (cleared on `false`) |

```css
wcs-raf:state(running) ~ .indicator { color: green; }
wcs-raf:state(suspended) ~ .indicator { color: orange; } /* tab hidden, loop starved */
```

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+, Firefox 126+. In older browsers the states are simply never set — `<wcs-raf>` itself keeps working (graceful degradation, never-throw). The `debug-states` attribute mirrors changes onto `data-wcs-state-*` attributes for DevTools inspection (debug aid only — style against `:state()`).

## Notes & limitations

- **Hidden tabs stop rAF completely** (unlike `setInterval`'s ~1Hz throttle). `running` keeps reporting the intent; `suspended` reports the reality; `elapsed` counts only active time; and the first frame after the tab becomes visible again reports `dt = 0`, so a dt-integrating consumer never sees a teleport.
- **No `error` surface.** rAF has no persistent failure mode; on a platform without it (SSR pre-pass, worker), `start()` is a silent no-op (never-throw).
- **SSR**: prefer `manual` in server-rendered markup — an auto-started loop keeps scheduling frames in DOM-emulating renderers.
- The platform API is resolved at call time (`globalThis.requestAnimationFrame`), and a scheduler can be injected into `RafCore` for testing.

## Headless usage (`RafCore`)

```typescript
import { RafCore } from "@wcstack/raf";

const core = new RafCore();
core.addEventListener("wcs-raf:tick", (e) => {
  console.log((e as CustomEvent).detail); // { count, elapsed, dt, timestamp }
});
core.observe();  // subscribes visibilitychange (drives `suspended`)
core.start();
// later:
core.dispose();
```

## Configuration

```javascript
import { bootstrapRaf } from "@wcstack/raf";

bootstrapRaf({
  autoTrigger: true,               // data-raftarget click triggering (default: true)
  triggerAttribute: "data-raftarget",
  tagNames: { raf: "wcs-raf" },
});
```

## License

MIT
