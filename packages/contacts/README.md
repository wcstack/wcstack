# @wcstack/contacts

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
| `error`     | `wcs-contacts:error`           | A true platform failure, or `null`. |
| `cancelled` | `wcs-contacts:cancelled-changed` | `true` when the user dismissed the picker (kept separate from `error`). |

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `select` | yes | `select(properties, options?)` — `properties` is an array of `"name"`/`"email"`/`"tel"`/`"address"`/`"icon"`; `options.multiple` defaults to `false`. Never-throw: a user-cancelled picker surfaces via `cancelled`, any other failure via `error`. No `abort` command — the Contact Picker API accepts no `AbortSignal`. |

## Attributes / Inputs

**None.**

## Notes & limitations

- **Android Chrome only.** Treat `unsupported` as the default, not an edge case.
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
