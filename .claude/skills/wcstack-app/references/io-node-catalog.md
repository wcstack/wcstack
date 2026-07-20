# wcstack I/O Node Catalog + signals Quick Reference

Sources: each package's README (ja preferred) plus the `static wcBindable` declarations in src, `packages/signals/README.ja.md`, and `examples/signals-live-search`. fetch / storage / websocket / timer / intersection / clipboard / notification / geolocation have been cross-checked against their READMEs. For the rest, kebab-case attribute spellings include inferences from input names — verify against the package README before relying on them heavily.

## 0. Common Conventions (all I/O nodes)

- **One-line CDN**: `<script type="module" src="https://esm.run/@wcstack/<pkg>/auto"></script>` (alongside `@wcstack/state/auto`; load the I/O side first)
- **wc-bindable**: each tag declares via `static wcBindable` its **properties** (observable outputs; state subscribes) / **inputs** (write surface; attributes are kebab-case mirrors) / **commands** (invocable methods).
- **Wiring**: output binding `data-wcs="value: users"` / command-token `data-wcs="command.<method>: $command.<name>"` / event-token `data-wcs="eventToken.<property>: <name>"` / spread `data-wcs="...: slot"`.
- **Common idioms**:
  - `manual` attribute = do not auto-start on connect.
  - `trigger` is a **momentary input property**, not a command. Writing `false`→`true` fires it (`command.trigger` does not exist).
  - Event names are `<tag-name>:<kind>` (exceptions: screen-orientation uses `wcs-orientation:*`, `<wcs-throttle>` uses `wcs-throttle:*`).
  - Nearly every node has `error` / `errorInfo` outputs (the ones without: timer / raf / debounce / permission / network / intersection / resize / defined). Omitted from the table.

## 1. Catalog

| package | tag | key attributes / inputs | properties (outputs) | commands |
|---|---|---|---|---|
| **fetch** | `<wcs-fetch>` (helpers: `<wcs-fetch-header name value>` `<wcs-fetch-body type>` `<wcs-infinite-scroll>`) | `url` `method` `target` `manual` `body` `response-type`(auto/json/text/blob/arrayBuffer) `trigger` | `value` `loading` `error` `status` `objectURL` `trigger` | `fetch` `abort` |
| **storage** | `<wcs-storage>` | `key` `type`(local/session) `value` `manual` `trigger` | `value` `loading` `error` (with cross-tab sync) | `load` `save` `remove` (all synchronous) |
| **upload** | `<wcs-upload>` | `url` `method` `field-name` `multiple` `max-size` `accept` `manual` `files` `trigger` | `value` `loading` `progress` `error` `status` `files` `trigger` | `upload` `abort` |
| **websocket** | `<wcs-ws>` | `url` `protocols` `auto-reconnect` `reconnect-interval` `max-reconnects` `binary-type` `manual` `trigger` `send` (writing a value sends immediately; objects are auto-JSON-serialized) | `message` `connected` `loading` `readyState` `trigger` `send` | `connect` `sendMessage` `close` |
| **sse** | `<wcs-sse>` | `url` `with-credentials` `events` `raw` `manual` `trigger` | `message` `connected` `loading` `readyState` `trigger` | `connect` `close` (receive-only) |
| **broadcast** | `<wcs-broadcast>` | `name` `manual` | `message` (no self-echo; structured clone) | `open` `post` `close` |
| **worker** | `<wcs-worker>` | `src` `type` `name` `manual` `keep-alive` `restart-on-error` `max-restarts` `restart-interval` | `message` `running` | `start` `post` `terminate` |
| **timer** | `<wcs-timer>` | `interval`(default 1000) `once` `repeat` `immediate` `manual` `trigger` | `tick`(counter) `elapsed`(ms) `running` `trigger` | `start` `stop` `reset` `pause` `resume` |
| **raf** | `<wcs-raf>` | `once` `repeat` `manual` `trigger` | `tick` `elapsed` `dt` `running` `suspended` | `start` `stop` `reset` `pause` `resume` |
| **debounce** | `<wcs-debounce>` / `<wcs-throttle>` (throttle defaults leading on; `wcs-throttle:*`) | `source` (value-surface input) `wait` `leading` `trailing` `max-wait` | `value`(settled value) `fired` `pending` | `trigger` `cancel` `flush` |
| **clipboard** | `<wcs-clipboard>` | `monitor` | `text` `items` `loading` `readPermission` `writePermission` `monitoring` `copied` `cut` `pasted` | `writeText` `write` `readText` `read` `startMonitor` `stopMonitor` (write requires a user gesture) |
| **geolocation** | `<wcs-geo>` | `high-accuracy` `timeout` `maximum-age` `watch` `manual` `trigger` (attributes are read at connect time) | `position` `latitude` `longitude` `accuracy` `coords` `timestamp` `watching` `loading` `permission` | `getCurrentPosition` `watchPosition` `clearWatch` |
| **permission** | `<wcs-permission>` | `name` (one tag, one permission) `user-visible-only` `sysex` | `state`(granted/denied/prompt/unsupported) `granted` `denied` `prompt` `unsupported` | none (monitor-only) |
| **notification** | `<wcs-notify>` | `notice` (reactive display; same-value guard) `mode`(auto/constructor/sw) `body` `icon` `badge` `tag` `lang` `dir` `require-interaction` `silent` `renotify` `manual` | `permission` `granted` `denied` `prompt` `unsupported` `clicked` `closed` `shown` | `request` `notify(title, options)` `close` `closeAll` (for SW use, `wireNotificationClicks()` from `@wcstack/notification/sw`) |
| **intersection** | `<wcs-intersect>` | `target` (default = first child / selector / `self`) `root` `root-margin` `threshold` `once` `manual` `trigger` | `entry` `intersecting` `ratio` `visible` (latched on first intersection) `observing` | `observe` `reobserve` `unobserve` `disconnect` `reset` |
| **resize** | `<wcs-resize>` | `target` `box` `round` `once` `manual` `trigger` | `entry` `width` `height` `observing` | `observe` `unobserve` `disconnect` |
| **wakelock** | `<wcs-wakelock>` | `active` (desired input) `type` `manual` | `held` (actual output; reflects OS release) | `request` `release` |
| **camera** | `<wcs-camera>` | `audio` `facing-mode` `device-id` `width` `height` `autostart` `keep-alive` | `active` `permission` `audioPermission` `deviceId` `devices` `streamReady` (raw MediaStream) `ended` | `start` `stop` `switchCamera` |
| **camera** | `<wcs-recorder>` | `mime-type` `timeslice` `audio-bits-per-second` `video-bits-per-second` | `recording` `paused` `duration` `mimeType` `blob` `objectURL` `recorded` `dataavailable` | `attachStream` `start` `stop` `pause` `resume` |
| **speech** | `<wcs-speak>` (TTS) | `say` (reactive speech; same-value guard) `rate` `pitch` `volume` `voice` `lang` `manual` | `voices` `speaking` `paused` `pending` `charIndex` `spokenWord` `unsupported` | `speak` (imperative; fires even on same value) `cancel` `pause` `resume` |
| **speech** | `<wcs-listen>` (STT) | `lang` `continuous` `interim` `max-restarts` `manual` `trigger` | `interimTranscript` `finalTranscript` `result` `listening` `permission` `unsupported` `trigger` | `start` `stop` `abort` |
| **defined** | `<wcs-defined>` | `tags` `mode` `timeout` (timeout detects load failure) | `defined` `pending` `missing` `count` `total` `error` (invariant: total=count+pending+missing) | none (event-token only; monotonic; terminal) |
| **fullscreen** | `<wcs-fullscreen>` | `target` | `active` | `requestFullscreen` `exitFullscreen` |
| **picture-in-picture** | `<wcs-pip>` | `target` | `active` | `requestPictureInPicture` `exitPictureInPicture` |
| **pointer-lock** | `<wcs-pointer-lock>` | `target` | `active` | `requestPointerLock` `exitPointerLock` |
| **screen-orientation** | `<wcs-screen-orientation>` | (no inputs) | `type` `angle` `portrait` `landscape` | `lock` `unlock` |
| **idle** | `<wcs-idle>` | `threshold` | `userState` `screenState` `active` | `requestPermission` `start` `stop` |
| **network** | `<wcs-network>` | (no inputs) | `effectiveType` `downlink` `rtt` `saveData` `supported` | none (monitor-only) |
| **share** | `<wcs-share>` | (no inputs) | `value` `loading` `cancelled` | `share` |
| **contacts** | `<wcs-contacts>` | (no inputs) | `value` `loading` `cancelled` | `select` |
| **credential** | `<wcs-credential>` | (no inputs) | `value` `loading` `cancelled` | `get` `store` |
| **eyedropper** | `<wcs-eyedropper>` | (no inputs) | `value` `loading` `cancelled` | `open` `abort` |
| **tilt** | `<wcs-tilt>` | (no inputs) | `alpha` `beta` `gamma` `absolute` `permissionState` | `requestPermission` `start` `stop` |
| **accelerometer** | `<wcs-accelerometer>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **gyroscope** | `<wcs-gyroscope>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **magnetometer** | `<wcs-magnetometer>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **ambient-light-sensor** | `<wcs-ambient-light-sensor>` | `frequency` | `illuminance` | `start` `stop` |

## 2. Minimal state-integration examples for high-frequency nodes (from each README)

**fetch** — a computed URL drives the fetch (auto re-runs on url change; aborts any in-flight request):
```html
<wcs-fetch data-wcs="url: usersUrl; value: users; loading: listLoading; error: listError"></wcs-fetch>
<ul><template data-wcs="for: users"><li data-wcs="textContent: users.*.name"></li></template></ul>
```

**storage** — two-way persistence of primitive values. The bound state slot is **intentionally initialized to `undefined`** (`""`/`null` would overwrite the stored value on the initial write-back = load-before-bind idiom):
```html
<wcs-storage key="username" data-wcs="value: username"></wcs-storage>
<input data-wcs="value: username">
```
For object sub-property changes, bind a getter containing `$trackDependency` to `trigger` and persist with `manual` + save.

**websocket** — receive via `message`; to send, just write a value to `send`:
```html
<wcs-ws url="wss://example.com/ws"
  data-wcs="message: lastMessage; connected: isConnected; send: outgoing"></wcs-ws>
<!-- state side: sendChat() { this.outgoing = { type: "chat", content: this.chatInput }; } -->
```

**timer** — declarative `setInterval` equivalent:
```html
<wcs-timer interval="1000" data-wcs="tick: count; running: isRunning"></wcs-timer>
<!-- one-shot: <wcs-timer interval="3000" once data-wcs="tick: showBanner"> -->
```

**intersection** — lazy loading (`visible` is latched on first intersection; `once` disconnects):
```html
<wcs-intersect once data-wcs="visible: shown">
  <img data-wcs="src: src" alt="lazy">
</wcs-intersect>
<!-- infinite-scroll edge detection: <wcs-intersect target="self" data-wcs="intersecting: atEnd"> -->
```

**clipboard** — copy via command-token (write requires a user gesture):
```html
<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
<button data-wcs="onclick: onShare">Share</button>
<!-- state side: $commandTokens: ["copy"], onShare() { this.$command.copy.emit(this.message); } -->
```
Read with `command.readText: $command.paste; text: pasted`; monitor with the `monitor` attribute + `eventToken.pasted: ...`.

**notification** — command-token (display) and event-token (click) coexist on one tag:
```html
<wcs-notify data-wcs="
  command.request: $command.request;
  command.notify:  $command.notify;
  eventToken.clicked: opened"></wcs-notify>
<!-- state side: $commandTokens:["request","notify"], $eventTokens:["opened"],
     send() { this.$command.notify.emit("New message", { body:"...", tag:"chat", data:{room:7} }); },
     $on: { opened: (state, event) => { /* event.detail = {tag,data,action} */ } } -->
```
The reactive form binds the `notice` attribute (with same-value suppression; recommend debounce + `tag` to prevent spam).

**camera/recorder** — a raw MediaStream never enters state; wire elements directly to each other:
```html
<wcs-camera data-wcs="eventToken.streamReady: streamReady"></wcs-camera>
<wcs-recorder data-wcs="command.attachStream: $command.attachStream"></wcs-recorder>
<!-- $on: { streamReady: (state, ev) => state.$command.attachStream.emit(ev.detail) } -->
```

## 3. signals Quick Reference (`@wcstack/signals`)

### Positioning (when to use vs state)

- `@wcstack/state` connects UI and state through **HTML path strings** (`data-wcs`); no reactive primitives appear in code. `@wcstack/signals` conversely **exposes signal/computed/effect directly** (no DSL, no `data-wcs`). The two are not competitors — they **coexist**.
- Out of scope for signals v1: SSR/hydration, deep/proxy reactivity (path-based deep tracking is state's territory), stream backpressure.
- The API is a minimal in-house implementation modeled on the TC39 Signals proposal.

### CDN loading (one-entry-per-page rule)

```html
<script type="importmap">
{ "imports": { "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom" } }
</script>
<script type="module">
  import { signal, computed, effect, h, render, For, bindNode } from "@wcstack/signals/dom";
</script>
```

> **Known trap**: on the CDN each entry is a self-contained bundle with the core embedded, so importing both `@wcstack/signals` and `@wcstack/signals/dom` on one page causes **reactive core duplication** and reactivity breaks at the seam. On CDN pages import everything from the single `/dom` entry (`/dom` re-exports the entire core). No such constraint with local npm / bundlers.

### Basic API (core)

```js
const count = signal(0);                       // .get()=read+track / .peek()=no tracking / .set(v)
const doubled = computed(() => count.get() * 2); // lazy, memoized, equality short-circuit
effect(() => { console.log(doubled.get()); });   // runs immediately once, then coalesced into a microtask
count.set(1);        // effect re-runs on the next microtask
flushSync();         // synchronous flush (when reading DOM back in tests)
createRoot((dispose) => { /* effects/resources inside are disposed all at once by dispose */ });
onCleanup(fn);       // register cleanup on the current owner
```

### DOM layer (`h` / `render` / `SignalsElement`)

`h(tag, props, ...children)` builds real DOM once; only function/signal props and children update via individual effects (no VDOM). `onXxx` props are event listeners. For custom elements, extend `SignalsElement` and implement only `render()` (mounts on connect; disposes all effects on disconnect).

### Keyed lists — `For` / `Index`

```js
const todos = signal([{ id: 1, text: "a" }, { id: 2, text: "b" }]);
h("ul", null, For(todos, (t, index) => h("li", null, () => `${index()}: ${t.text}`), { key: (t) => t.id }));
// for primitive arrays use Index: each is (item: () => T, index: number)
h("ul", null, Index(nums, (n) => h("li", null, () => String(n() * 2))));
```

A plain reactive child (`() => items.map(render)`) regenerates everything on every change, so always use For/Index for lists. Key default is `===`; duplicate keys throw. `each` returns a single Node.

### Async — `resource` / `streamResource`

```js
const user = resource(
  async (userId, signal) => (await fetch(`/api/users/${userId}`, { signal })).json(),
  { args: () => id.get() },  // when a signal read inside args changes → abort the previous run and restart (switchMap)
); // user.value / user.loading / user.error are read-only signals

const log = streamResource((args, signal) => openLogStream(signal), {
  fold: (acc, chunk) => [...(acc ?? []), chunk], initial: [],
}); // log.value / log.status ("idle"|"active"|"done"|"error") / log.error. No backpressure; keep fold bounded
```

Strong contract: `source` must always honor the `AbortSignal` it is passed (this is what drives restart/dispose).

### wc-bindable bridge — `bindNode` (turn I/O nodes into signals)

```js
await customElements.whenDefined("wcs-fetch");
const bound = bindNode(fetchEl);              // descriptor is auto-derived from constructor.wcBindable
bound.signals.value.get();                    // output property → read-only signal (same-value guard)
bound.on("fired", { fold, initial });         // event-token stream (fires every time, even on same value)
bound.set("url", v);                          // imperative write to an input
bound.bindInput("url", someSignal);           // reactive reflection of signal → input (loops are guarded)
bound.command("fetch", ...args);              // invoke a command
bound.bindCommand("start", trigger, mapArgs); // invoke command on trigger change (does not fire on the initial value)
bound.dispose();                              // tear down everything (idempotent; inert afterwards)
```

Typing via `bindNode<FetchShape>(el)`. Real-world pattern: `effect(() => bound.set("url", ...))` for the query → `<wcs-fetch>` auto-fetches → read `bound.signals.value` in a `computed` and render with `For` (examples/signals-live-search).

### Stability

The core (signal/computed/effect/createRoot/onCleanup/flushSync) and resource/streamResource are **Stable**. `bindNode`/`nodeSource` and the DOM layer (h/For/Index/SignalsElement) are **Evolving** (may change in minor releases).
