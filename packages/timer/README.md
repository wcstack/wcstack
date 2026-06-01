# @wcstack/timer

`@wcstack/timer` is a headless timer component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the passage of time into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state.

With `@wcstack/state`, `<wcs-timer>` can be bound directly through path contracts:

- **input / command surface**: `interval`, `once`, `repeat`, `immediate`, `trigger`
- **output state surface**: `tick`, `elapsed`, `running`

This means recurring work can be expressed declaratively in HTML, without writing `setInterval()`, `clearInterval()`, or teardown glue in your UI layer.

`@wcstack/timer` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`TimerCore`) handles scheduling, tick counting, elapsed time, and pause/resume
- **Shell** (`<wcs-timer>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

A timer is, like `fetch`, an asynchronous source of values over time. Imperatively it requires lifecycle management: starting, clearing, counting, and cleanup on disconnect.

`@wcstack/timer` moves that logic into a reusable component and exposes the result as bindable state. Time becomes a **state transition**, not imperative event wiring.

With `@wcstack/state`, the flow becomes:

1. `<wcs-timer>` is connected to the DOM and starts ticking
2. each tick increments `tick` and updates `elapsed`
3. UI binds to those paths with `data-wcs`
4. a state getter can react to `tick` changes and chain into other commands (e.g. trigger a `<wcs-fetch>` poll)

## Install

```bash
npm install @wcstack/timer
```

## Quick Start

### 1. Reactive ticking from state

When `<wcs-timer>` is connected to the DOM, it automatically starts an interval timer. Bind `tick` / `elapsed` / `running` to state paths.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/timer/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      count: 0,
      isRunning: false,
      get statusLabel() {
        return this.isRunning ? "Running" : "Stopped";
      }
    };
  </script>
</wcs-state>

<wcs-timer
  interval="1000"
  data-wcs="tick: count; running: isRunning">
</wcs-timer>

<p data-wcs="textContent: count"></p>
<p data-wcs="textContent: statusLabel"></p>
```

### 2. One-shot timeout (`setTimeout` equivalent)

`once` fires exactly one tick after `interval` ms, then auto-stops. (`once` is sugar for `repeat="1"`.)

```html
<wcs-timer interval="3000" once data-wcs="tick: showBanner"></wcs-timer>
```

### 3. Bounded repetition

`repeat="N"` fires `N` ticks and then stops (`running` becomes `false`).

```html
<wcs-timer interval="1000" repeat="5" data-wcs="tick: countdownStep"></wcs-timer>
```

### 4. Fire immediately

`immediate` fires the first tick at start instead of waiting one full interval.

```html
<wcs-timer interval="5000" immediate data-wcs="tick: pollNow"></wcs-timer>
```

## Attributes / Inputs

| Attribute   | Type    | Default | Description                                                        |
| ----------- | ------- | ------- | ------------------------------------------------------------------ |
| `interval`  | number  | `1000`  | Tick period in milliseconds. Must be a finite value `> 0`; invalid values (`0`, negative, non-numeric) fall back to `1000`. |
| `once`      | boolean | `false` | Fire a single tick, then stop. Sugar for `repeat="1"`.             |
| `repeat`    | number  | `0`     | Stop after N ticks (`0` = unlimited). Takes precedence over `once`. |
| `immediate` | boolean | `false` | Fire one tick at start instead of waiting the first interval.      |
| `manual`    | boolean | `false` | Do not auto-start on connect; start via command / trigger.        |

## Observable Properties (outputs)

| Property  | Event                       | Description                                            |
| --------- | --------------------------- | ------------------------------------------------------ |
| `tick`    | `wcs-timer:tick`            | Tick counter, increments on every fire (reset to 0 on `reset`). |
| `elapsed` | `wcs-timer:tick`            | Running time in ms since the last reset.               |
| `running` | `wcs-timer:running-changed` | `true` while ticking, `false` when stopped/paused.     |

## Commands

| Command   | Description                                                              |
| --------- | ----------------------------------------------------------------------- |
| `start`   | Begin ticking (no-op if already running).                               |
| `stop`    | Stop ticking; `tick` / `elapsed` are retained.                          |
| `reset`   | Stop and reset `tick` / `elapsed` to `0`.                               |
| `pause`   | Suspend ticking, preserving the partial period and elapsed time.        |
| `resume`  | Continue from a `pause`, honoring the remaining time of the period.     |

State-driven invocation uses the command-token protocol:

```html
<wcs-timer manual data-wcs="command.start: $command.beginPolling"></wcs-timer>
```

## Headless usage (`TimerCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { TimerCore } from "@wcstack/timer";

const timer = new TimerCore();
timer.addEventListener("wcs-timer:tick", (e) => {
  console.log((e as CustomEvent).detail); // { count, elapsed }
});
timer.start({ interval: 1000, repeat: 10 });
```

## License

MIT
