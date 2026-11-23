# `<ken-postal>` 1.4.2

県 共通部品 — a postal-code field with an address lookup. A plain custom element; it has no dependencies.

```html
<script type="module" src="/vendor/ken-postal.js"></script>

<ken-postal value="123-4567"></ken-postal>
```

The file defines the element when it is loaded. Do not edit it — report problems to the prefecture's web team.

## Attributes and properties

| Attribute | Property | |
|---|---|---|
| `value` | `value` | The postal code, kept as `123-4567` (full-width digits and missing hyphens are fixed as the user types). Setting it from a script or through the attribute fires no event. |
| — | `address` (read-only) | The address of the last successful lookup; `""` before one. |
| `endpoint` | — | Where to look codes up; `GET <endpoint>/<seven digits>` must answer `{ "address": "…" }`, or `404`. Default `/api/postal`. |
| `disabled` | `disabled` | Disables the field and the button. |

## Method

- `lookup()` — looks the current code up (the 住所を検索 button and Enter call it). Returns a promise of the address, or
  `null` when there is none.

## Events

All of them bubble and cross shadow roots (`composed`).

| Event | `detail` | When |
|---|---|---|
| `ken-input` | `{ value }` | The user changed the code. |
| `ken-resolved` | `{ value, address }` | A lookup found an address. |
| `ken-error` | `{ value, reason: "format" \| "unknown" \| "server" \| "network", status? }` | A lookup failed. |

## Styling

The element's shadow root is closed. Use the custom properties `--ken-border`, `--ken-bg`, `--ken-fg`, `--ken-error`,
`--ken-button-bg`, and the parts `input`, `button`, `status`.
