# @wcstack/timer

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/timer` is a headless timer component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the passage of time into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state.

With `@wcstack/state`, `<wcs-timer>` can be bound directly through path contracts:

- **input surface**: `interval`, `once`, `repeat`, `immediate`, `manual`, `trigger`
- **output state surface**: `tick`, `elapsed`, `running`
- **commands**: `start`, `stop`, `reset`, `pause`, `resume`

> `trigger` is a momentary command-*property* (an input), not a command: a `false`→`true` write starts the timer. To start from state via the command-token protocol use `command.start:` (see [Commands](#commands)) — there is no `command.trigger`.

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

A live `interval` change is applied immediately only while the timer is **running**. Changing `interval` while **paused** has no effect on the current period; the new value takes effect on the next `start`.

State-driven invocation uses the command-token protocol:

```html
<wcs-timer manual data-wcs="command.start: $command.beginPolling"></wcs-timer>
```

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element carrying `data-timertarget="<id>"` calls `start()` on the referenced `<wcs-timer>`:

```html
<button data-timertarget="poll">Start polling</button>
<wcs-timer id="poll" interval="5000" manual data-wcs="tick: pollNow"></wcs-timer>
```

Event delegation is used, so it also works for dynamically added elements, and `closest()` handles nested targets (e.g. an icon inside the button). A matched click calls `event.preventDefault()` before starting the timer, so the element's default action is suppressed — do not put `data-timertarget` on an element whose default action you also want (a real `<a href>` link, a form-submit button), as it will be cancelled.

## CSS styling with `:state()`

`<wcs-timer>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `running` | `wcs-timer:running-changed` fires with `true` (cleared on `false`) |

`<wcs-timer>` has no `error` event, so no `error` state is reflected.

```css
wcs-timer:state(running) ~ .indicator { color: green; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-timer>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-timer:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["running"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto a `data-wcs-state-running` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-timer interval="1000" debug-states></wcs-timer>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Configuration

`bootstrapTimer()` registers `<wcs-timer>` and optionally overrides defaults. Pass a partial config:

```javascript
import { bootstrapTimer } from "@wcstack/timer";

bootstrapTimer({
  autoTrigger: true,             // enable data-timertarget click triggering (default: true)
  triggerAttribute: "data-timertarget", // attribute scanned for click triggering
  tagNames: {
    timer: "wcs-timer",          // custom element tag name
  },
});
```

`getConfig()` returns a deep-frozen snapshot of the current configuration:

```javascript
import { getConfig } from "@wcstack/timer";

const { autoTrigger, triggerAttribute, tagNames } = getConfig();
```

| Option             | Type                 | Default            | Description                                         |
| ------------------ | -------------------- | ------------------ | --------------------------------------------------- |
| `autoTrigger`      | boolean              | `true`             | Enable `data-timertarget` click triggering.         |
| `triggerAttribute` | string               | `data-timertarget` | Attribute scanned for DOM click triggering.         |
| `tagNames.timer`   | string               | `wcs-timer`        | Custom element tag name to register.                |

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
