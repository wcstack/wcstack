# @wcstack/share

`@wcstack/share` is a headless Web Share component for the wcstack ecosystem.

It is not a visual UI widget.
It is a **command-only async primitive node** that turns `navigator.share(data)` — click, native share sheet, resolve/reject — into a single declarative command, the same way `@wcstack/notification` turns `Notification` into reactive state plus a `notify` command.

With `@wcstack/state`, `<wcs-share>` can be bound directly through path contracts:

- **command surface**: `share(data)` — a single async command, invoked as `command.share: $command.doShare`
- **output state surface**: `value`, `loading`, `error`, `cancelled`

This means a "Share this article" button can be expressed declaratively in HTML — success, failure, and the user simply dismissing the native share sheet are three distinct, bindable outcomes — without writing `navigator.share()` / `try`/`catch` glue in your UI layer.

`@wcstack/share` follows the wcstack Core/Shell architecture:

- **Core** (`ShareCore`) wraps `navigator.share(data)` behind a single `_gen` generation guard, same-value-guarded setters, and a never-throw `try`/`catch`
- **Shell** (`<wcs-share>`) connects that command to DOM lifecycle and exposes `canShare(data)` as a plain synchronous method
- **Binding Contract** (`static wcBindable`) declares observable `properties` and a single `share` command (deliberately **no `inputs`, no `abort` command**)

## Why this exists — a command-only node, and cancellation is not an error

Every other wcstack IO node either monitors a continuous state (`network`, `permission`) or configures something ahead of time and observes it change (`fetch`'s `url`, `geolocation`'s `enableHighAccuracy`). `navigator.share()` is different: it is a one-shot "call → native share sheet → resolve/reject" action with no continuous state to configure or watch, and (unlike `fetch`) **no way to abort an in-flight call** — there is no `AbortSignal` option, and the platform allows only one modal share sheet at a time, so the "a new call supersedes the previous one" plumbing `fetch` needs has no counterpart here.

The other defining decision is **separating `cancelled` from `error`**. When a user simply closes the native share sheet, `navigator.share()` rejects with an `AbortError` — exactly like closing a `<dialog>`. Folding that into `error` would make a binding like `hidden@error` (hide on real failure) also fire on routine, harmless user cancellation, which is a UX bug waiting to happen. `<wcs-share>` keeps `cancelled` as its own boolean/event, so `error` reflects **only genuine platform failures** (`NotAllowedError`, `TypeError`, etc.).

> See [`docs/web-share-tag-design.md`](https://github.com/wcstack/wcstack/blob/main/docs/web-share-tag-design.md) for the full design rationale.

## Install

```bash
npm install @wcstack/share
```

## Quick Start

### 1. Share an article, with cancellation handled separately from failure

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/share/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      onShareClick() {
        this.$command.doShare.emit({
          title: document.title,
          url: location.href,
        });
      },
    };
  </script>
</wcs-state>

<wcs-share
  data-wcs="command.share: $command.doShare; loading: loading; error: error; cancelled: cancelled"
></wcs-share>

<button data-wcs="event.click: onShareClick; disabled: loading">Share</button>
<p data-wcs="hidden: !error">Sharing failed: <span data-wcs="textContent: error.message"></span></p>
```

Because `share()` must run from within a real user gesture (a click handler), the button's click handler calls `$command.doShare.emit(...)` directly — `<wcs-share>` has no `autoTrigger` shortcut of its own (see [Notes & limitations](#notes--limitations)).

### 2. `canShare(data)` — checking feasibility ahead of time

```html
<script type="module">
  const shareEl = document.querySelector("wcs-share");
  if (shareEl.canShare({ url: location.href })) {
    // show the Share button
  }
</script>
```

## Observable Properties (outputs)

| Property    | Event                          | Description |
| ----------- | ------------------------------- | ------------ |
| `value`     | `wcs-share:complete`            | An echo of the `data` object passed to the `share()` call that just completed successfully, signalling "this share succeeded" (`navigator.share()` itself resolves `Promise<void>` with no payload). `null` before any successful share. |
| `loading`   | `wcs-share:loading-changed`     | `true` while a `share()` call is in flight. |
| `error`     | `wcs-share:error`               | A genuine platform failure (anything **other than** the user cancelling the share sheet). `null` when there has been no failure yet, or after the next `share()` call resets it. |
| `cancelled` | `wcs-share:cancelled-changed`   | `true` when the user dismissed the native share sheet (`AbortError`). Kept independent of `error` so `hidden@error`-style bindings do not react to routine cancellation. |

`cancelled` and `error` are both reset (`false` / `null`) at the **start** of the next `share()` call, so a stale outcome from a previous call never lingers into the next one's result.

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `share` | yes   | Invokes `navigator.share(data)` with a single options object (`{ title?, text?, url?, files? }`) passed as one positional argument. |

There is **no `abort` command** — the Web Share API offers no mechanism to cancel an in-flight `share()` call from the caller's side.

## `canShare(data)` — a plain synchronous method, not part of `wcBindable`

`navigator.canShare(data)` is a synchronous, side-effect-free predicate. It does not fit the wc-bindable `properties` shape (an observable with no arguments) or the `commands` shape (fire-and-observe-via-event); it is exposed directly as a plain instance method:

```typescript
const canShare: boolean = shareEl.canShare({ url: "https://example.com" });
```

It returns `false` (rather than throwing) when `navigator.canShare` is absent.

## Attributes / Inputs

**None.** `share(data)`'s `data` varies on every call — it is a command argument, not a value to park on the element ahead of time as an attribute.

## Notes & limitations

- **No `autoTrigger`.** `navigator.share()` must be invoked from within a real user gesture. A node-provided auto-trigger would not itself carry that gesture context, so — like `@wcstack/fullscreen` — this node has none. Wire the click handler directly to `$command.doShare.emit(...)`.
- **No `abort` command.** There is no platform mechanism to cancel an in-flight `navigator.share()` call.
- **`cancelled` is independent of `error`.** `AbortError` (the user closed the share sheet) sets `cancelled`, never `error`. Every other rejection sets `error`, never `cancelled`.
- **`unsupported` has no dedicated flag.** Calling `share()` when `navigator.share` is not a function immediately sets `error` to `{ message: "Web Share API is not supported in this browser." }` and resolves with `null` — no `_gen` is consumed, since no asynchronous work is started. Check `canShare`, or `typeof navigator.share`, ahead of time if you want to hide the UI proactively.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`; since there is no asynchronous probe, this promise always settles immediately (`ready` is `Promise.resolve()`).
- **Same-value guard.** `value`/`loading`/`error`/`cancelled` setters only dispatch when the value actually changes.

## Headless usage (`ShareCore`)

The Core has no DOM dependency and can be used directly:

```typescript
import { ShareCore } from "@wcstack/share";

const share = new ShareCore();
share.addEventListener("wcs-share:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // the echoed data
});
share.addEventListener("wcs-share:cancelled-changed", (e) => {
  console.log("cancelled:", (e as CustomEvent).detail);
});

await share.share({ title: "Article", url: location.href });

// later, when done:
share.dispose(); // invalidate any in-flight share() so a stale resolve is dropped
```

## License

MIT
