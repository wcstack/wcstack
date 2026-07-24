# @wcstack/contacts

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/contacts` is a headless Contact Picker component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `navigator.contacts.select(properties, options)` into declarative command + observable state, the same shape `@wcstack/share` establishes for the Web Share API.

With `@wcstack/state`, `<wcs-contacts>` can be bound directly through path contracts:

- **input surface**: none — `select(properties, options)`'s arguments are per-call
- **output state surface**: `value`, `loading`, `error`, `cancelled`

## Why this exists — Android Chrome only, unsupported is the common case

The Contact Picker API works **only on Android Chrome**. Desktop browsers (and iOS Safari) entirely lack `navigator.contacts`. Design any UI around this being a supplementary shortcut, not the primary input method — always keep a manual-entry fallback.

> **Two positional arguments, no protocol change needed.** `select(properties, options)` is the first batch-3 member to take two arguments instead of one. The command-token argument pass-through does not special-case argument count — it works unmodified (see `docs/contact-picker-tag-design.md` §2).

> **`multiple: false` (the default) still resolves to an array.** Even a single selection is a one-element array — bind `value.0` (or iterate) rather than expecting a bare object.

## Install

```bash
npm install @wcstack/contacts
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/contacts/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      picked: null,
      pickContact() {
        this.$command.select.emit(["name", "tel"], { multiple: false });
      },
    };
  </script>
</wcs-state>

<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>

<button data-wcs="onclick: pickContact">Pick a contact</button>
<p data-wcs="textContent: picked.0.name.0"></p>
```

## Observable Properties (outputs)

| Property    | Event                        | Description |
| ----------- | ----------------------------- | ------------ |
| `value`     | `wcs-contacts:complete`        | The array of picked contacts (always an array, even with `multiple: false`), or `null` before any successful selection. |
| `loading`   | `wcs-contacts:loading-changed` | `true` while the picker dialog is open. |
| `error`     | `wcs-contacts:error`           | A true platform failure (a `DOMException`/`Error` from `select()`), or the plain object `{ message: "Contact Picker API is not supported in this browser." }` on the unsupported path, or `null`. |
| `cancelled` | `wcs-contacts:cancelled-changed` | `true` when the user dismissed the picker (kept separate from `error`). |
| `errorInfo` | `wcs-contacts:error-info-changed` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null`. Additive — the `error` shape is unchanged; `code` is `capability-missing` when unsupported or `select-failed` on a genuine failure. |

**Concurrency.** The contact picker is a single system-modal surface, so
`<wcs-contacts>` runs its calls through the shared io-core lane with the `exhaust`
policy: while one `select()` is in flight, a second call is an idempotent **no-op**
(it returns `null` without opening a second picker), leaving the in-flight call's
result untouched.

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `select` | yes | `select(properties, options?)` — `properties` is an array of `"name"`/`"email"`/`"tel"`/`"address"`/`"icon"`; `options.multiple` defaults to `false`. Never-throw: a user-cancelled picker surfaces via `cancelled`, any other failure via `error`. No `abort` command — the Contact Picker API accepts no `AbortSignal`. |

## Attributes / Inputs

**None.**

## CSS styling with `:state()`

`<wcs-contacts>` reflects three boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `loading` | `wcs-contacts:loading-changed` fires with `true` (cleared on `false`) |
| `cancelled` | `wcs-contacts:cancelled-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-contacts:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-contacts:state(loading) ~ .spinner { display: block; }
wcs-contacts:state(loading) ~ .spinner { display: none; } /* default */

form:has(wcs-contacts:state(error)) .banner { display: block; }
form:has(wcs-contacts:state(cancelled)) .hint { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-contacts>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-contacts:not(:defined)` instead.

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
  <wcs-contacts debug-states></wcs-contacts>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **Android Chrome only.** Treat `unsupported` as the default, not an edge case.
- **`unsupported` has no dedicated flag.** Calling `select()` when `navigator.contacts.select` is not a function immediately sets `error` to the plain object `{ message: "Contact Picker API is not supported in this browser." }` and resolves with `null` — no `_gen` is consumed, since no asynchronous work is started. This shape differs from a real failure, where `error` holds a `DOMException`/`Error`; do not assume `error instanceof Error` or `error.name` on the unsupported path.
- **`getProperties()` is out of scope for v1** (an async pre-check for supported fields) — see `docs/contact-picker-tag-design.md` §4.
- Shares its architecture with `@wcstack/share`/`@wcstack/eyedropper`: single `_gen` generation guard, never-throw, no `AbortController`.

## Headless usage (`ContactsCore`)

```typescript
import { ContactsCore } from "@wcstack/contacts";

const core = new ContactsCore();
core.addEventListener("wcs-contacts:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // ContactInfo[]
});

await core.select(["name", "tel"], { multiple: true });
core.dispose();
```

## License

MIT
