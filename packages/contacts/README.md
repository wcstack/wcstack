# @wcstack/contacts

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/contacts` is a headless Contact Picker component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `navigator.contacts.select(properties, options)` into declarative command + observable state, the same shape `@wcstack/share` establishes for the Web Share API.

With `@wcstack/state`, `<wcs-contacts>` can be bound directly through path contracts:

- **input surface**: none — `select(properties, options)`'s arguments are per-call
- **output state surface**: `value`, `loading`, `error`, `cancelled`, and — since 4.25 — `supported`

## Why this exists — Android Chrome only, unsupported is the common case

The Contact Picker API works **only on Android Chrome**. Desktop browsers (and iOS Safari) entirely lack `navigator.contacts`. Design any UI around this being a supplementary shortcut, not the primary input method — always keep a manual-entry fallback.

> **Two positional arguments, no protocol change needed.** `select(properties, options)` is the first batch-3 member to take two arguments instead of one. The command-token argument pass-through does not special-case argument count — it works unmodified (see `docs/contact-picker-tag-design.md` §2).

> **`multiple: false` (the default) still resolves to an array.** Even a single selection is a one-element array, and every member of a contact is an array too — see [The result](#the-result) before binding it.

## Install

```bash
npm install @wcstack/contacts
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/contacts/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["select"],
      picked: null,     // the element's output: null, then the contacts of the last pick
      canPick: false,
      pickError: null,
      // every member of a contact is an array, so read the name through a getter
      get pickedName() {
        return this.picked?.[0]?.name?.[0] ?? "";
      },
      pickContact() {
        this.$command.select.emit(["name", "tel"], { multiple: false });
      },
    };
  </script>
</wcs-state>

<wcs-contacts
  data-wcs="command.select: $command.select; value: picked; supported: canPick; error: pickError"
></wcs-contacts>

<button data-wcs="hidden: canPick|not; onclick: pickContact">Pick a contact</button>
<p data-wcs="textContent: pickedName"></p>
<p data-wcs="hidden: pickError|falsy">The contact picker could not be opened.</p>
```

Three things in this example are load-bearing:

- **`$commandTokens: ["select"]`** declares the token `pickContact()` emits and the element subscribes to. Without it the page fails with `[wcs/token-undeclared]`.
- **`pickedName` is a getter.** `picked` is `null` until the first pick, a contact's `name` is an array, and that array can be empty. A getter with `?.` and a fallback says what to show in each case, in one place; prefer it to a path such as `picked.0.name.0` written into the markup.
- **`supported`** (since 4.25) hides the button where the picker cannot be used — which is most browsers. Keep a plain input next to it.

## The result

`value` is an array of contacts, one object per contact the user chose. Each contact has the members named in `properties` and nothing else, and **every member is an array** — a contact can have several numbers, or none:

```js
// select(["name", "tel", "email"], { multiple: true })
[
  { name: ["山田 花子"], tel: ["090-1234-5678", "03-1234-5678"], email: [] },
  { name: ["Taro Sato"], tel: [], email: ["taro@example.com"] },
]
```

So `contact.name` is `["山田 花子"]`, never `"山田 花子"`: take `name[0]`, and expect it to be missing (`name: []`).

**`value` is an output — do not bind it to a list you keep.** When the binding attaches, the element's value replaces what the path had: `null` before the first pick, and from then on only the contacts of the *last* pick. A `guests` list bound to `value` would become `null` on load and be replaced on every pick. Bind `value` to a path of its own and make your own members from it:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["select"],
      picked: null,
      guests: [],       // yours: { name, tel } — strings, not arrays
      $watch: {
        picked(contacts) {
          if (!contacts) return;
          this.guests = [
            ...this.guests,
            ...contacts.map((c) => ({ name: c.name?.[0] ?? "", tel: c.tel?.[0] ?? "" })),
          ];
        },
      },
      addGuests() {
        this.$command.select.emit(["name", "tel"], { multiple: true });
      },
    };
  </script>
</wcs-state>

<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>

<button data-wcs="onclick: addGuests">Add from contacts</button>
<ul>
  <template data-wcs="for: guests">
    <li><span data-wcs="textContent: .name"></span> <span data-wcs="textContent: .tel"></span></li>
  </template>
</ul>
```

## Observable Properties (outputs)

| Property    | Event                        | Description |
| ----------- | ----------------------------- | ------------ |
| `value`     | `wcs-contacts:complete`        | The array of picked contacts (always an array, even with `multiple: false`; never empty), or `null` before any successful selection. See [The result](#the-result). Since 4.25, a picker closed without a choice leaves it as it was. |
| `loading`   | `wcs-contacts:loading-changed` | `true` while the picker dialog is open. |
| `error`     | `wcs-contacts:error`           | A true platform failure (a `DOMException`/`Error` from `select()`), or the plain object `{ message: "Contact Picker API is not supported in this browser." }` on the unsupported path, or `null`. |
| `cancelled` | `wcs-contacts:cancelled-changed` | `true` when the user closed the picker without choosing anyone (kept separate from `error`). Reset to `false` when the next `select()` starts. See below. |
| `errorInfo` | `wcs-contacts:error-info-changed` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null`. Additive — the `error` shape is unchanged; `code` is `capability-missing` when unsupported or `select-failed` on a genuine failure. |
| `supported` | `wcs-contacts:supported-changed` | Since 4.25. `true` when this page can use the Contact Picker. See below. |

**`cancelled` — a closed picker.** The Contact Picker specification gives a closed picker no error: `select()` **resolves with an empty list**. Since 4.25, `<wcs-contacts>` reads that empty list as the cancellation: `cancelled` becomes `true`, `value` keeps what it had, no `wcs-contacts:complete` is dispatched, and `select()` resolves `null`. Up to 4.24 the element waited for an `AbortError` rejection that the specification does not have, so `cancelled` never became `true` and closing the picker wrote `value: []` over the last pick. (An `AbortError` rejection, should a browser send one, still sets `cancelled`.)

**`supported`** (since 4.25) is `true` when `navigator.contacts.select` is a function **and** the page is top-level (`window.top === window`): the specification refuses the picker to a document inside an `<iframe>`. It is read from the browser each time it is asked for, so a binding gets the right value when it attaches; the element also dispatches `wcs-contacts:supported-changed` (the boolean as `detail`) when it is connected, if the value differs from the last one it dispatched (it starts at `false`). It does **not** say the user will choose anyone, and it does not say which `properties` this device offers (`address` and `icon` are not everywhere).

**Concurrency.** The contact picker is a single system-modal surface, so
`<wcs-contacts>` runs its calls through the shared io-core lane with the `exhaust`
policy: while one `select()` is in flight, a second call is an idempotent **no-op**
(it returns `null` without opening a second picker), leaving the in-flight call's
result untouched.

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `select` | yes | `select(properties, options?)` — `properties` is an array of `"name"`/`"email"`/`"tel"`/`"address"`/`"icon"`; `options.multiple` defaults to `false`. Never-throw: a user-cancelled picker surfaces via `cancelled`, any other failure via `error`. No `abort` command — the Contact Picker API accepts no `AbortSignal`. |

**What a failure means.** `select()` rejects in three ways, and each lands in `error` (the browser's `DOMException` / `TypeError`) with `errorInfo.code: "select-failed"`:

| `error.name` | Cause |
| ------------ | ----- |
| `InvalidStateError` | The page is not top-level — it runs inside an `<iframe>` (there `supported` is `false`) — or a picker is already showing (another `<wcs-contacts>`), or the browser could not open it. |
| `SecurityError` | No user gesture: `select()` was not called from a tap or click (a timer, a page load, a promise that resolved later). |
| `TypeError` | `properties` is empty or names a property this browser does not offer — or is not an array of names at all. |

> **Wire `select` through a state method, not straight to a button.** `<button data-wcs="onclick: $command.select">` emits the token with the DOM event as its first argument, so the element is called as `select(event)` — and the browser rejects an `Event` as the list of properties with a `TypeError`. The command takes data: emit it from a method, as `pickContact()` does in the Quick Start (`this.$command.select.emit(["name", "tel"])`).

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

- **Android Chrome only.** Treat `unsupported` as the default, not an edge case: bind `supported` (since 4.25) and offer the picker only where it is `true`.
- **Unsupported browsers.** Calling `select()` when `navigator.contacts.select` is not a function immediately sets `error` to the plain object `{ message: "Contact Picker API is not supported in this browser." }` (`errorInfo.code: "capability-missing"`) and resolves with `null` — the call never enters the operation lane, since no asynchronous work is started. This shape differs from a real failure, where `error` holds a `DOMException`/`Error`; do not assume `error instanceof Error` or `error.name` on the unsupported path. Inside an `<iframe>` on a browser that has the API, `supported` is `false` but `select()` still asks the browser, which answers `InvalidStateError` (`select-failed`).
- **`getProperties()` is out of scope for v1** (an async pre-check for supported fields) — see `docs/contact-picker-tag-design.md` §4.
- Shares its architecture with `@wcstack/share`/`@wcstack/eyedropper`: each call runs through the shared io-core operation lane (`exhaust` here — one picker at a time; `dispose()` invalidates a call in flight, so a late completion writes nothing), never-throw, no `AbortController`.

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

Since 4.25, `core.supported` can be read at any time, `core.observe()` dispatches `wcs-contacts:supported-changed` when the value differs from the last one dispatched, and a `select()` the user closes resolves `null` with `core.cancelled` set.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## License

MIT
