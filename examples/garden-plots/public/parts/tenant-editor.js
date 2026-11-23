// みどり市 共通部品 <tenant-editor> — edits a person (a tenant, an applicant) in place: 氏名, 電話, 郵便番号 (the
// prefecture's <ken-postal>), 住所 (filled by the lookup and still editable). A developers' part: a class with
// `bind-component`.
//
//   <tenant-editor data-wcs="state: plot.tenant"></tenant-editor>
//
// Given (mounted):  the person (`state: …`) — { name, phone, postal, address, saved?, errors? }
//                   saved:  the last saved copy of the four fields (the "unsaved changes" mark compares with it;
//                           no `saved` = a new person)
//                   errors: messages from the server for fields ({ name?, phone?, postal? }), shown at the fields
// Gives back:       name, phone, postal, address (written in place, as typed); errors.<field> is cleared when that
//                   field is edited
// Exported getters: valid, dirty, messages
import "../vendor/ken-postal.js"; // the vendor's part defines itself when loaded; the editor is its only user
import { isDirty, validateTenant } from "./lib/tenant-rules.js";

const TEMPLATE = `
<style>
  :host { display: block; }
  form { display: grid; grid-template-columns: max-content 1fr; gap: 0.55em 0.9em; align-items: start; }
  label { padding-top: 0.35em; font-weight: 600; white-space: nowrap; }
  .req { margin-left: 0.4em; font-size: 0.75em; font-weight: 600; color: var(--midori-error, #b3261e); }
  input { box-sizing: border-box; width: 100%; font: inherit; padding: 0.35em 0.55em; border-radius: 4px;
    border: 1px solid var(--midori-line-strong, #8a929c); background: var(--midori-surface, #fff); color: var(--midori-fg, #1b1f24); }
  input[aria-invalid="true"] { border-color: var(--midori-error, #b3261e); }
  input:focus-visible { outline: 3px solid var(--midori-focus, #1a73e8); outline-offset: 0; }
  ken-postal { --ken-bg: var(--midori-surface, #fff); --ken-fg: var(--midori-fg, #1b1f24); --ken-border: var(--midori-line-strong, #8a929c);
    --ken-button-bg: var(--midori-surface-2, #f1f3f5); --ken-error: var(--midori-error, #b3261e); }
  ken-postal:not(:defined) { display: inline-block; min-height: 2em; min-width: 12em; }
  .msg { grid-column: 2; margin: -0.3em 0 0; font-size: 0.85em; color: var(--midori-error, #b3261e); }
  .msg:empty { display: none; }
  .dirty { grid-column: 1 / -1; margin: 0; font-size: 0.85em; color: var(--midori-renewal-fg, #6b4a00); }
  .dirty[hidden] { display: none; }
</style>
<wcs-state bind-component="state"></wcs-state>
<form novalidate data-wcs="onsubmit#prevent: noop">
  <label for="name">氏名<span class="req">必須</span></label>
  <input id="name" name="name" autocomplete="name" aria-describedby="name-msg"
    data-wcs="value: name; attr.aria-invalid: nameInvalid; oninput: editedName; onblur: touchName">
  <p class="msg" id="name-msg" data-wcs="textContent: messages.name"></p>

  <label for="phone">電話</label>
  <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" aria-describedby="phone-msg"
    data-wcs="value: phone; attr.aria-invalid: phoneInvalid; oninput: editedPhone">
  <p class="msg" id="phone-msg" data-wcs="textContent: messages.phone"></p>

  <label for="postal-field">郵便番号</label>
  <ken-postal id="postal-field" data-wcs="value: postal; onken-input: editedPostal; onken-resolved: resolved"></ken-postal>
  <p class="msg" id="postal-msg" data-wcs="textContent: messages.postal"></p>

  <label for="address">住所</label>
  <input id="address" name="address" autocomplete="street-address" data-wcs="value: address; oninput: editedAddress">

  <p class="dirty" role="status" data-wcs="hidden: dirty|not">● 保存していない変更があります</p>
</form>
`;

export default class TenantEditor extends HTMLElement {
  state = {
    touched: false, // private: per editor element — show "氏名は必須です" only once the field was left
    get clientErrors() {
      return validateTenant({ name: this.name, phone: this.phone, postal: this.postal });
    },
    get messages() {
      const c = this.clientErrors;
      return {
        name: this["errors.name"] || (this.touched || this.name ? c.name : "") || "",
        phone: this["errors.phone"] || c.phone || "",
        postal: this["errors.postal"] || c.postal || "",
      };
    },
    get valid() { return Object.keys(this.clientErrors).length === 0; },
    get dirty() {
      return isDirty({ name: this.name, phone: this.phone, postal: this.postal, address: this.address }, this.saved);
    },
    get nameInvalid() { return this["messages.name"] ? "true" : null; },
    get phoneInvalid() { return this["messages.phone"] ? "true" : null; },
    noop() {},
    touchName() { this.touched = true; },
    clearError(field) {
      if (this.errors?.[field]) this.errors = { ...this.errors, [field]: null };
    },
    editedName() { this.clearError("name"); },
    editedPhone() { this.clearError("phone"); },
    editedAddress() { this.clearError("address"); },
    // <ken-postal> is not a wc-bindable element: its value comes back through its own event.
    editedPostal(event) {
      this.postal = event.detail.value;
      this.clearError("postal");
    },
    resolved(event) { this.address = event.detail.address; },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = TEMPLATE;
  }
}
