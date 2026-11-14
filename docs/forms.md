# Forms

**日本語版**: [forms.ja.md](./forms.ja.md)

A page that is mostly a form — an application, an entry sheet, a wizard — meets things a list or a dashboard never does: text composed with an IME, fields that format what is typed, browsers that fill fields in, a reset button, rows of inputs that move, controls of your own. This guide collects what `@wcstack/state` does about them and what is left to the page. It was written from the `ekiden-entry` seam app, a team entry wizard in Japanese ([seam-apps.md](./seam-apps.md)); the versions say where a behavior starts.

## What happens, and what to do

| In the form | What happens | What to do |
|---|---|---|
| A field is composed with an IME while state writes it (a setter that normalizes, a draft from another tab) | Up to 4.22 the write ended the composition and the text was typed again (`やまだ` → `ヤヤマヤマダヤマダ`). Since 4.23 the write waits for the end of the composition (the `forms` add-on). | Nothing. Normalize in a setter; see [A field that changes what is typed](#a-field-that-changes-what-is-typed) for the caret. |
| Enter confirms a conversion | The `keydown` reaches the page's handler like any Enter: the form is sent, or the wizard moves on, in the middle of a word. | Ignore a key pressed while composing: [Enter](#enter-while-composing). |
| An output filter on a two-way field (`value: code\|upper`) | The field is rewritten on every keystroke: the caret jumps to the end, and state receives the formatted text. | Do not. Format in a setter, or show the formatted text elsewhere. The lint says so since 4.23 (`wcs/two-way-output-filter`). |
| A number is typed (`value: count`) | An element writes a string: `count + 1` is `"51"`. | `valueAsNumber: count`, or an input filter: `value\|number: count`. The lint says so since 4.23 (`wcs/number-written-as-string`). |
| A browser or a password manager fills a field | With `input` and `change`: as typed. With `change` alone, or with no event: up to 4.22 state never heard of it. Since 4.23 it is told on `change`, and before a `submit` handler runs. | Nothing. Send from a `submit` handler of the `<form>`, so a value with no event is read. |
| `<button type="reset">`, `form.reset()` | Up to 4.22 the fields went blank and state kept everything. Since 4.23 state takes the reset values. | Nothing — or clear state in a method, when the defaults are not the markup's. |
| A row of inputs moves (a sort, ↑ / ↓) | Moving the same row objects keeps what the row's elements hold. Writing the values across leaves it at the position. | Reorder the objects; see [Rows of inputs](#rows-of-inputs). |
| A row's radios share a `name` | The browser makes one group of all the rows: one radio on the whole page is checked. | A name per row. The lint says so since 4.23 (`wcs/radio-name-shared`). |
| A form control of your own | Declared one way, or not at all, it loses data without a word. | `value` in both `properties` and `inputs`: [Form controls of your own](#form-controls-of-your-own). |

## Text composed with an IME

Japanese, Chinese and Korean are typed in two stages: the keys make a reading (`やまだ`), and a conversion turns it into the text (`山田`). Between `compositionstart` and `compositionend` the field holds text that is not final, and an `input` event fires at every step with `isComposing` true.

**A two-way binding writes every step to state.** That is what you want for a live count or a search, and it means a getter or a `$watch` on the path runs on unfinished text. Code that must see only finished text checks the event: in an `oninput:` handler, `if (e.isComposing) return;`, and handle `oncompositionend:` for the final text (Chromium sends the last `input` before `compositionend`; do not rely on the order).

**State does not write a field while it is composed.** Since 4.23 the bindings that write the field's `value` are held from `compositionstart` and applied after `compositionend` with the value state has then. So a setter may normalize what is typed:

```js
export default {
  kanaRaw: "",
  get kana() { return this.kanaRaw; },
  // ひらがな → カタカナ; the field shows the result once the conversion is confirmed
  set kana(v) { this.kanaRaw = String(v).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); },
};
```

```html
<input data-wcs="value: kana">
```

A write from elsewhere during a composition — another tab's draft, a looked-up address — is held too. If the user types on, their text is what state ends with; if they confirm with nothing more typed, the held value is shown.

Real compositions can be driven in a test only in Chromium (CDP's `Input.imeSetComposition` and `Input.insertText`); Firefox and WebKit have no such door, and happy-dom has no IME at all — dispatch `compositionstart` / `compositionend` yourself there.

### Enter while composing

Enter confirms a conversion, and the page sees a `keydown`. Ignore it:

```js
onKey(e) {
  // 229: Safari sends the confirming Enter after compositionend, with isComposing already false
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  this.next();
}
```

This is for a `keydown` handler of your own (a wizard's "next" on Enter, a chat's send).

### A reading (フリガナ) field

The reading is what the keys made before the conversion. It is in `compositionupdate`'s `data` while it is still kana, and gone once the text is converted — the field's value is `山田`, which no code can turn back into `やまだ`.

```html
<input data-wcs="value: name; oncompositionupdate: reading; oncompositionend: readingEnd">
<input data-wcs="value: kana">
```

```js
export default {
  name: "", kana: "", _reading: "",
  reading(e) { if (/^[ぁ-ゖァ-ヺー]+$/.test(e.data)) this._reading = e.data; },
  readingEnd() {
    this.kana += this._reading.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    this._reading = "";
  },
};
```

Text pasted, or typed with the IME off, has no reading: leave the field for the user to fill.

## A field that changes what is typed

A phone number that gains hyphens, a postal code, full-width digits made half-width.

- **Normalize in a setter** (as above). What state holds is the clean value; the field shows the getter's.
- **The caret goes to the end** when a write changes the field's text — a browser rule for a `value` set from script. For a field edited at its end (a phone number typed once) that is fine. For one edited in the middle, write back when the field is committed instead: `value#onchange: phone` hears `change`, so the formatting happens on blur, with no caret to lose.
- **To format while typing and keep the caret**, take the field over: bind it one way and write it from a handler that also places the caret.

  ```html
  <input data-wcs="value#ro: phone; oninput: typePhone">
  ```

  ```js
  typePhone(e) {
    if (e.isComposing) return;
    const el = e.target;
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
    this.phoneDigits = el.value.replace(/\D/g, "");
    const text = this.phone;              // the getter's formatted text
    el.value = text;
    let i = 0;
    for (let seen = 0; i < text.length && seen < digitsBefore; i++) if (/\d/.test(text[i])) seen++;
    el.setSelectionRange(i, i);
  }
  ```

- **Not an output filter.** `value: price|locale` formats what state holds on every keystroke and writes it into the field; what comes back is the formatted text, which the filter then fails on. Show the formatted value in another element (`{{ price|locale }}`).
- **An input filter converts on the way in only.** `value|trim: name` gives state the trimmed text and leaves the field as typed — the user can still type a space in the middle of a name.

Undo (Ctrl+Z) covers the user's own edits: a write from script is not in the browser's history. A field rewritten while it is typed undoes coarsely or not at all, and a value a lookup filled in is not undone; formatting on `change` keeps undo working while the user types. Undo fires `input`, so state follows whatever it restores.

## Numbers

An element's `value` is a string. Bound to a number, the first edit makes the number a string, and `+` concatenates.

```html
<input type="number" data-wcs="valueAsNumber: count">   <!-- number, range, date and time types -->
<input data-wcs="value|number: count">                  <!-- any field: an input filter -->
<select data-wcs="value|int: size">…</select>
```

An emptied field: `valueAsNumber:` gives `NaN` (and state then writes `NaN` back, which the browser reports as unparsable); `value|number:` gives `0`. Where "nothing entered" must stay distinct from zero, keep the text (`value: countText`) and convert in a getter.

## Values the user did not type

- **Autofill.** Browsers fire `input` and `change` — state hears it as typing. Some password managers and extensions fire `change` alone, and some set the value with no event. Since 4.23 the `forms` add-on tells state on `change`, and, for each field of a form, before the form's `submit` handlers run. A value put in with no event is therefore known when it is sent, not before: a "next" button that is not a submit reads state as it was. Make the step's button the form's submit button.
- **Give the browser what it needs**: a `name` and an `autocomplete` token on each field (`autocomplete="family-name"`, `"tel"`, `"postal-code"`), inside a `<form>`.
- **A reset** puts each control back to the default of the markup — `value=""`, the `checked` and `selected` attributes — and since 4.23 state follows. A radio group none of whose radios is `checked` in the markup has no reset value to write: state keeps its value and the radio shows it again. If the form's defaults live in state, not in the markup, write a method (`clear() { this.entry = emptyEntry(); }`) and a plain button.
- **Reading the page instead of state** (`new FormData(form)`) sees only the controls in the page at that moment — not the steps that are not rendered. State is the entry; send that.

## Rows of inputs

A list whose rows hold fields (members, order lines) and can be sorted or moved.

- **Move the objects.** `this.runners = [b, a, ...rest]` with the same objects moves each row's elements: the focus, an open `<details>`, a chosen file and a composition travel with the row (in Chromium 133+ and Firefox 144+, which have `moveBefore()`; Safari re-inserts the row, and the focused field loses the focus — put it back with `element.focus()`).
- **Do not exchange the values.** Writing row 2's fields into row 1 and back leaves everything the elements hold — the focus, the open section, the file — at the position, now beside another person's name.
- **New objects are new rows.** A list rebuilt from JSON (a reload of the draft) re-creates every row unless `$listKeys` names the key that says which is which.
- **A row's radios need a name per row** — or the browser treats every row as one group. Bind it: `attr.name: .sexGroup` with `get "runners.*.sexGroup"() { return "sex-" + this[".id"]; }`. Without a `name` the `radio:` binding still keeps the radios in step, but the arrow keys do not move between them.
- **Keep a server's errors by the row's id, not its index.** `errors.runners[3]` points at another person after a sort; `errorsById[runner.id]` follows the row. The same for anything else kept beside the list.
- **An upload or a fetch inside a row.** A `<wcs-upload>` or `<wcs-fetch>` in a row that moves: since 4.23 its request goes on when the browser moves the row with `moveBefore()` (Chromium, Firefox). Where the row is taken out and put back (Safari), the element is disconnected and its request is aborted, as for any disconnect. While a row's request is in flight, either do not reorder, or keep the I/O elements in a list that does not move and point them at the row by id.

## Steps

- **Render a step, do not hide it.** A step kept in the page and hidden keeps its `required` fields in the form: the browser refuses the submit because of a field the user cannot see (Chromium logs `An invalid form control … is not focusable`), and nothing happens. Put each step in an `if:` branch or a route, and validate the whole entry in state before the last send.
- **Focus after the step is there.** A field of the next step is not in the page in the update that changes the step. A focus command emitted in the same breath is lost (`[wcs/command-token-unbound]`); emit it from `$renderedCallback`, or — with a route per step — when the router's `path` changes.
- **A server's 422 that names a field of another step**: keep the errors in state by field, go to the first step that has one, and focus its field once the step is rendered.

## Form controls of your own

A form-associated custom element (`static formAssociated = true`, `attachInternals()`) takes part in the form like a native control, with or without wcstack. To bind it:

```js
class MidoriStepper extends HTMLElement {
  static formAssociated = true;
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "midori-stepper:change" }],   // element → state
    inputs: [{ name: "value" }],                                        // state → element
  };
  #internals = this.attachInternals();
  #value = 0;
  get value() { return this.#value; }
  set value(v) { this.#set(Number(v) || 0); }               // from state or script: no event
  #set(v) { this.#value = v; this.#internals.setFormValue(String(v)); this.#render(); }
  #changed(v) {                                              // from the user: tell
    this.#set(v);
    this.dispatchEvent(new CustomEvent("midori-stepper:change", { detail: v, bubbles: true }));
  }
  formResetCallback() { this.#changed(0); }                  // a reset is a change state did not make
  formDisabledCallback(disabled) { this.toggleAttribute("aria-disabled", disabled); }
  formStateRestoreCallback(state) { this.#changed(Number(state) || 0); }
  #render() { /* draw the value */ }
}
```

- **`value` in both lists.** In `properties` only, state never writes the control, and the control's first value replaces the one state had — a saved draft is lost as the page loads. In `inputs` only, or with no declaration, what the user enters never reaches state. Since 4.23 the `diagnostics` add-on warns about each (`[wcs/form-control-one-way]`); the lint cannot see a class in another file.
- **Dispatch on the user's change, on a reset and on a restore** — every change state did not make. An event dispatched from the setter with the value state just wrote is recognized as its echo and ignored, so dispatching there too is harmless, but it is not needed.
- **A setter for every input.** State writes properties. A control that reads its value only from an attribute fails with `Cannot set property value … which has only a getter`.
- **`<fieldset disabled>` and `form.reset()`** reach the control through `formDisabledCallback` and `formResetCallback`; state does not call them.

## Sending

Send what state holds, from a `submit` handler:

```html
<form data-wcs="onsubmit: send">…</form>
<wcs-fetch url="/api/entries" method="POST" manual data-wcs="body: payload; trigger: sending; error: sendError"></wcs-fetch>
```

```js
send(e) {
  e.preventDefault();
  this.payload = { ...this.entry };      // a new object each time
  this.sending = true;                   // applied after body: bindings apply in the order written
}
```

- **`body` first, then `trigger`**, in the `data-wcs` and in the method. A command (`command.fetch: $command.post`) runs at once, before the bindings of the same update are applied: the request it starts carries the body the element had before.
- **`<wcs-fetch>` takes its `body` once**: after a request it has none. Writing the same string again is no change for state, so it is not written, and a retry goes out with no body. Write a new object (as above), which is always a change. Since 4.23 `<wcs-fetch>` warns when a `POST`, `PUT` or `PATCH` goes out with no body after one that had a body (`[wcs/fetch-body-gone]`).
