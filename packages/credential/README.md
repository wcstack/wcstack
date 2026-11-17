# @wcstack/credential

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/credential` is a headless Credential Management component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `navigator.credentials.get()`/`.store()` into declarative commands + observable state, reusing the batch-3 "thin command" archetype `@wcstack/share` establishes.

With `@wcstack/state`, `<wcs-credential>` can be bound directly through path contracts:

- **input surface**: none — `get(options)`/`store(credential)`'s arguments are per-call
- **command surface**: `get`, `store`, and — since 4.25 (not released yet) — `preventSilentAccess` (sign-out)
- **output state surface**: `value`, `loading`, `error`, `cancelled`, and — since 4.25 (not released yet) — `supported`

## Why this exists — password/federated only, WebAuthn is explicitly out of scope

`navigator.credentials` unifies three credential kinds (`password`, `federated`, `publicKey`/WebAuthn) behind one `get()`/`store()` surface. **v1 of this package excludes `publicKey` entirely.** WebAuthn is a much larger surface — attestation, authenticator selection, platform vs cross-platform, RP configuration — that deserves its own dedicated node. If a caller passes a `publicKey` option, it is **not** forwarded to the platform API; it surfaces as a scope-violation `error` instead, so this package never accidentally becomes a WebAuthn backdoor.

> **No user gesture required.** Unlike `@wcstack/share`/`@wcstack/fullscreen`, `navigator.credentials.get()` does not require a user gesture — this node can be invoked automatically on page load for a "silent sign-in" flow (`get({ password: true, mediation: "silent" })`).

> **`get()`/`store()` share one operation lane (`latest`)** — an accepted v1 simplification. These two operations are used sequentially in real auth flows (store after a successful login, get before attempting one), not naturally concurrently on the same element. If both ARE invoked concurrently on the same `<wcs-credential>`, the later call supersedes the earlier one: the earlier call's completion is dropped without writing anything, and its promise resolves `null`. If this bites in practice, use **two separate `<wcs-credential>` instances** (one for `get`, one for `store`) rather than reworking the Core — see `docs/multi-promise-io-node-design.md`.

## Install

```bash
npm install @wcstack/credential
```

## Browser support

Since 4.25 (not released yet) the element says where it works, through the `supported` output.

| Browser | Password credentials | `supported` |
| ------- | -------------------- | ----------- |
| Chrome, Edge and the other Chromium browsers (desktop and Android) | yes | `true` |
| Firefox, Safari and the other WebKit browsers (macOS and iOS) | no — `navigator.credentials` is there for WebAuthn, the `PasswordCredential` class is not | `false` |

So this element is an enhancement for Chromium, and the sign-in form has to work without it. Keep the form in a shape a password manager fills, in every browser: a real `<form>`, `autocomplete="username"` on the name or e-mail field and `autocomplete="current-password"` on the password field (`"new-password"` where an account is created). Where `supported` is `false`, `get()` for a password and `store()` end at once as `capability-missing` — the browser is not asked. `preventSilentAccess()` is still passed on where the browser has the method (Firefox and Safari do), and does nothing, without an error, where it has not.

## Quick Start

### Sign in, stay signed in, sign out

```html
<script type="module" src="https://esm.run/@wcstack/credential/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["getCredential", "storeCredential", "forgetSignIn"],
      $eventTokens: ["credentialArrived"],
      userId: "",             // who is signed in — never the password
      email: "",
      password: "",
      signInFailed: false,
      canSave: false,         // <wcs-credential>'s `supported`
      get signedIn() {
        return this.userId !== "";
      },

      $watch: {
        // Password credentials work here: on load, ask for a saved one — no UI.
        canSave(supported) {
          if (supported && !this.signedIn) {
            this.$command.getCredential.emit({ password: true, mediation: "silent" });
          }
        },
      },

      $on: {
        // get() answered. The credential goes to the server from here and is never
        // written into state. (store() echoes one too: by then the user is signed in.)
        credentialArrived(state, event) {
          const credential = event.detail.value;
          if (credential && !state.signedIn) {
            state.signInWith(credential.id, credential.password, false);
          }
        },
      },

      onSubmit() {
        this.signInWith(this.email, this.password, true);
      },

      async signInWith(id, password, offerToSave) {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, password }),
        });
        this.signInFailed = !response.ok;
        if (!response.ok) return;
        this.userId = id;
        this.password = "";
        // Only now — the server accepted the pair — offer to save it, where that works.
        if (offerToSave && this.canSave) this.$command.storeCredential.emit({ id, password });
      },

      async signOut() {
        await fetch("/api/session", { method: "DELETE" });
        this.userId = "";
        // Without this, the next visit's silent get() signs the user straight back in.
        this.$command.forgetSignIn.emit();
      },
    };
  </script>
</wcs-state>

<wcs-credential
  data-wcs="
    command.get: $command.getCredential;
    command.store: $command.storeCredential;
    command.preventSilentAccess: $command.forgetSignIn;
    eventToken.value: credentialArrived;
    supported: canSave
  "
></wcs-credential>

<template data-wcs="if: signedIn|not">
  <form data-wcs="onsubmit#prevent: onSubmit">
    <input type="email" autocomplete="username" required data-wcs="value: email">
    <input type="password" autocomplete="current-password" required data-wcs="value: password">
    <button>Sign in</button>
    <p data-wcs="hidden: signInFailed|not">Wrong e-mail address or password.</p>
  </form>
</template>
<template data-wcs="if: signedIn">
  <p>Signed in as <span data-wcs="textContent: userId"></span>.</p>
  <button data-wcs="onclick: signOut">Sign out</button>
</template>
```

What each part is for:

- **Silent sign-in on load.** `supported` arrives as `true` in a browser that has password credentials, the `$watch` runs once, and `get({ password: true, mediation: "silent" })` resolves with the saved credential or `null` — without showing anything. In Firefox and Safari `supported` stays `false`, nothing is asked, and the form is simply there. The command is emitted from that `$watch`, not from `$connectedCallback`: `supported` arrives once the element is defined and bound, and a command emitted before its `command.` binding is attached would be lost (`[wcs/command-token-unbound]`).
- **Store after the server said yes.** `store()` is called once `POST /api/session` succeeded, never before: the browser offers to save whatever it is given, and a mistyped password saved once comes back on every visit. Since 4.25 (not released yet) `store()` takes the plain `{ id, password }`; up to 4.24 it takes a `PasswordCredential` you build yourself.
- **Sign out calls `preventSilentAccess()`** (since 4.25 (not released yet)). Without it the browser hands the credential over again on the next load, and the user who just signed out is signed back in.
- **The password does not enter the state tree.** The credential is taken from the event (`eventToken.value`) and passed on. See [`value` carries the password](#value-carries-the-password).

### `value` carries the password

`value` is the `Credential` object the browser handed over (or the one `store()` stored). For a password credential that object has the password in the clear, as `value.password`. Binding it — `value: credential` — puts it in the state tree, where everything that reads the tree can see it: DevTools, a `<wcs-storage>` bound to a parent path, an SSR snapshot, a log of the state. Bind `value` only where that is intended. To use a credential in passing, take it from the event, as above, or keep only what the page needs:

```js
$on: {
  credentialArrived(state, event) {
    state.savedId = event.detail.value?.id ?? "";   // the id, not the credential
  },
},
```

## Observable Properties (outputs)

| Property    | Event                          | Description |
| ----------- | -------------------------------- | ------------ |
| `value`     | `wcs-credential:complete`        | The retrieved/stored credential, or `null` before any successful call (and when `get()` found none). A password credential carries the password — see [`value` carries the password](#value-carries-the-password). |
| `loading`   | `wcs-credential:loading-changed` | `true` while a `get()`/`store()` call is in flight. |
| `error`     | `wcs-credential:error`           | A true platform failure (normalized `{ name, message }`), or `null`. |
| `cancelled` | `wcs-credential:cancelled-changed` | `true` when the user dismissed the browser's account-chooser UI (the Credential Management API rejects with `NotAllowedError`). Kept out of `error`. |
| `errorInfo` | `wcs-credential:error-info-changed` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null`. Additive — the `error` shape is unchanged; `code` is `capability-missing` (unsupported), `out-of-scope` (a `publicKey`/WebAuthn attempt), or `credential-failed` (a genuine failure). A `NotAllowedError` cancellation is `cancelled`, not `errorInfo`. |
| `supported` | `wcs-credential:supported-changed` | Since 4.25 (not released yet). `true` when this page can use password credentials. See below. |

**`supported`** (since 4.25 (not released yet)) is `true` when `navigator.credentials` exists **and** `PasswordCredential` is a class — see [Browser support](#browser-support). It is read from the browser each time it is asked for, so a binding gets the right value when it attaches; the element also dispatches `wcs-credential:supported-changed` (the boolean as `detail`) when it is connected, if the value differs from the last one it dispatched (it starts at `false`). It does **not** say a credential is saved for this site, nor that the user will choose one: `get()` answers that.

**Unsupported is `capability-missing`, not a failure.** Since 4.25 (not released yet), where there is no `PasswordCredential` a `get()` whose options ask for `password` or `federated`, and every `store()`, end without calling the browser: `error` is `{ name: "NotSupportedError", message: "Password credentials are not supported in this browser." }` and `errorInfo` is `{ code: "capability-missing", phase: "start", recoverable: false, capabilityId: "web.password-credential", … }`. Up to 4.24 the call went to the browser and came back as `credential-failed` with `recoverable: true` — a failure a page would retry, in a browser that can never do it. Where `navigator.credentials` itself is missing, `error` is `{ message: "Credential Management API is not supported in this browser." }` (`capabilityId: "web.credentials"`), as before.

**Concurrency.** `get()` and `store()` share one io-core lane with the `latest`
policy: a later call **supersedes** the earlier one (these are used sequentially in
real auth flows — store after login, get before one — not concurrently). If both
are invoked concurrently, the later call's result wins.

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `get`   | yes   | `get(options)` — `options.publicKey` is rejected as a scope violation (see above) rather than forwarded. Never-throw: `NotAllowedError` (user dismissed the account chooser) → `cancelled`, everything else → `error`. Resolves the credential, or `null` when there is none. Since 4.25 (not released yet), `get(null)` and `get()` ask for nothing instead of throwing. |
| `store` | yes   | `store(credential)` — a `Credential` instance, or since 4.25 (not released yet) a plain `{ id, password, name?, iconURL? }`, from which the element builds `new PasswordCredential(...)` with the members given. `value` echoes the credential stored (`navigator.credentials.store()` itself resolves `Promise<void>`). |
| `preventSilentAccess` | yes | Since 4.25 (not released yet). Sign-out: calls `navigator.credentials.preventSilentAccess()`, after which a `get({ mediation: "silent" })` no longer hands a credential over until the user signs in again. No arguments. Clears `error` on success; a rejection lands in `error` / `errorInfo` (`credential-failed`). Where the browser has no such method it resolves having done nothing — signing out works everywhere. It touches neither `value` nor `loading`, and does not go through the lane: it neither supersedes a `get()` / `store()` in flight nor is superseded by one. |

**`store()` and plain data** (since 4.25 (not released yet)). A state method has an id and a password as strings, not a `PasswordCredential` — a class only Chromium has. So `store({ id, password })` builds it: when the argument is not a `Credential` instance and its `id` and `password` are strings, the element stores `new PasswordCredential({ id, password })`, adding `name` and `iconURL` when they are given. Anything else is passed to the browser as it came. A constructor that throws (an empty `id`) ends in `error` like any other failure.

> **Wire `get` and `store` through a state method, not straight to a button.** `<button data-wcs="onclick: $command.getCredential">` emits the token with the DOM event as its first argument, so the element is called as `get(event)` — options that ask for nothing, which resolves `null` — or `store(event)`, which the browser rejects with a `TypeError`. These commands take data: emit it from a method (`this.$command.getCredential.emit({ password: true })`). `preventSilentAccess` takes no argument, so `onclick: $command.forgetSignIn` is fine.

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

- **Chromium only** — see [Browser support](#browser-support). Bind `supported` and keep a form a password manager can fill.
- **WebAuthn (`publicKey`) is out of scope for v1** — a future `<wcs-webauthn>` node would cover it.
- **`get()`/`store()` share one operation lane** — see "Why this exists" above for the concurrency caveat and workaround.
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

Since 4.25 (not released yet): `core.supported` can be read at any time, `core.observe()` dispatches `wcs-credential:supported-changed` when the value differs from the last one dispatched, `core.store({ id, password })` builds the `PasswordCredential`, and `await core.preventSilentAccess()` is the sign-out.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## License

MIT
