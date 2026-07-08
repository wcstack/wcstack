# @wcstack/credential

`@wcstack/credential` is a headless Credential Management component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `navigator.credentials.get()`/`.store()` into declarative commands + observable state, reusing the batch-3 "thin command" archetype `@wcstack/share` establishes.

With `@wcstack/state`, `<wcs-credential>` can be bound directly through path contracts:

- **input surface**: none — `get(options)`/`store(credential)`'s arguments are per-call
- **output state surface**: `value`, `loading`, `error`, `cancelled`

## Why this exists — password/federated only, WebAuthn is explicitly out of scope

`navigator.credentials` unifies three credential kinds (`password`, `federated`, `publicKey`/WebAuthn) behind one `get()`/`store()` surface. **v1 of this package excludes `publicKey` entirely.** WebAuthn is a much larger surface — attestation, authenticator selection, platform vs cross-platform, RP configuration — that deserves its own dedicated node. If a caller passes a `publicKey` option, it is **not** forwarded to the platform API; it surfaces as a scope-violation `error` instead, so this package never accidentally becomes a WebAuthn backdoor.

> **No user gesture required.** Unlike `@wcstack/share`/`@wcstack/fullscreen`, `navigator.credentials.get()` does not require a user gesture — this node can be invoked automatically on page load for a "silent sign-in" flow (`get({ mediation: "silent" })`).

> **`get()`/`store()` share a single `_gen` generation guard** — an accepted v1 simplification. These two operations are used sequentially in real auth flows (store after a successful login, get before attempting one), not naturally concurrently on the same element. If both ARE invoked concurrently on the same `<wcs-credential>`, the later call's completion silently overwrites the earlier one's. If this bites in practice, use **two separate `<wcs-credential>` instances** (one for `get`, one for `store`) rather than reworking the Core — see `docs/multi-promise-io-node-design.md`.

## Install

```bash
npm install @wcstack/credential
```

## Quick Start

### 1. Silent sign-in on page load

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/credential/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      user: null,
      async trySilentSignIn() {
        const el = document.querySelector("wcs-credential");
        const credential = await el.get({ password: true, mediation: "silent" });
        if (credential) this.user = credential;
      },
    };
  </script>
</wcs-state>

<wcs-credential data-wcs="value: user"></wcs-credential>
```

### 2. Store credentials after a successful login

```html
<wcs-credential data-wcs="command.store: $command.saveCredential"></wcs-credential>
```

## Observable Properties (outputs)

| Property    | Event                          | Description |
| ----------- | -------------------------------- | ------------ |
| `value`     | `wcs-credential:complete`        | The retrieved/stored credential, or `null` before any successful call. |
| `loading`   | `wcs-credential:loading-changed` | `true` while a `get()`/`store()` call is in flight. |
| `error`     | `wcs-credential:error`           | A true platform failure (normalized `{ name, message }`), or `null`. |
| `cancelled` | `wcs-credential:cancelled-changed` | `true` when the user dismissed the browser's account-chooser UI (the Credential Management API rejects with `NotAllowedError`). Kept out of `error`. |

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `get`   | yes   | `get(options)` — `options.publicKey` is rejected as a scope violation (see above) rather than forwarded. Never-throw: `NotAllowedError` (user dismissed the account chooser) → `cancelled`, everything else → `error`. |
| `store` | yes   | `store(credential)` — `value` echoes the input credential (`navigator.credentials.store()` itself resolves `Promise<void>`). |

## Attributes / Inputs

**None.**

## CSS styling with `:state()`

`<wcs-credential>` reflects three boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `loading` | `wcs-credential:loading-changed` fires with `true` (cleared on `false`) |
| `cancelled` | `wcs-credential:cancelled-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-credential:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-credential:state(loading) ~ .spinner   { display: block; }
wcs-credential:state(cancelled) ~ .hint    { display: block; }
form:has(wcs-credential:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-credential>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-credential:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["loading"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-loading` / `data-wcs-state-cancelled` /
  `data-wcs-state-error` attributes on the element, so the Elements panel
  highlights them as they toggle:

  ```html
  <wcs-credential debug-states></wcs-credential>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **WebAuthn (`publicKey`) is out of scope for v1** — a future `<wcs-webauthn>` node would cover it.
- **`get()`/`store()` share one `_gen`** — see "Why this exists" above for the concurrency caveat and workaround.
- Shares its architecture with `@wcstack/share`/`@wcstack/eyedropper`/`@wcstack/contacts`: never-throw, no `AbortController`.

## Headless usage (`CredentialCore`)

```typescript
import { CredentialCore } from "@wcstack/credential";

const core = new CredentialCore();
core.addEventListener("wcs-credential:complete", (e) => {
  console.log((e as CustomEvent).detail.value);
});

const credential = await core.get({ password: true });
core.dispose();
```

## License

MIT
