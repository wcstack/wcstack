// <midori-stepper> — みどり市 design system: − / the number / ＋ with min and max. Value: a number.
// A form-associated custom element with no dependency on any framework.

const toHalf = (s) => String(s ?? "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d-]/g, "");

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: inline-flex; align-items: stretch; }
  :host([hidden]) { display: none; }
  button, input { font: inherit; border: 1px solid #8a8f98; background: #fff; color: inherit; }
  button { min-width: 2.4em; cursor: pointer; }
  button:first-child { border-radius: 4px 0 0 4px; }
  button:last-child { border-radius: 0 4px 4px 0; }
  input { width: 3.2em; text-align: center; border-left: 0; border-right: 0; padding: .3em 0; }
  :host([aria-invalid="true"]) input { border-color: #c62828; }
  button:disabled, input:disabled { background: #eee; color: #666; cursor: default; }
  :focus-visible { outline: 3px solid #1565c0; outline-offset: 1px; position: relative; }
</style>
<button type="button" part="minus" tabindex="-1" aria-label="減らす">−</button>
<input part="number" role="spinbutton" inputmode="numeric" autocomplete="off">
<button type="button" part="plus" tabindex="-1" aria-label="増やす">＋</button>`;

export class MidoriStepper extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["value", "min", "max", "disabled", "required", "aria-label"];
  // Declared for wc-bindable binding libraries (e.g. wcstack). A plain object — no dependency.
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "midori-stepper:value-changed" }],
    inputs: [{ name: "value", attribute: "value" }, { name: "min" }, { name: "max" }, { name: "disabled", attribute: "disabled" }],
  };

  #internals = this.attachInternals();
  #minus; #input; #plus;
  #value = 0;
  #valueSet = false;
  #formDisabled = false;
  #composing = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open", delegatesFocus: true });
    root.append(template.content.cloneNode(true));
    [this.#minus, this.#input, this.#plus] = ["minus", "number", "plus"].map((p) => root.querySelector(`[part=${p}]`));
    this.#minus.addEventListener("click", () => this.#step(-1));
    this.#plus.addEventListener("click", () => this.#step(1));
    this.#input.addEventListener("compositionstart", () => { this.#composing = true; });
    this.#input.addEventListener("compositionend", () => { this.#composing = false; this.#fromInput(); });
    this.#input.addEventListener("input", (e) => { if (!e.isComposing && !this.#composing) this.#fromInput(); });
    this.#input.addEventListener("blur", () => this.#render());
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); this.#step(1); }
      if (e.key === "ArrowDown") { e.preventDefault(); this.#step(-1); }
    });
  }

  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "value")) { const v = this.value; delete this.value; this.value = v; }
    if (!this.#valueSet) this.#value = this.#clamp(Number(this.getAttribute("value") ?? this.min));
    this.#syncLabel();
    this.#render();
  }

  attributeChangedCallback(name, _o, val) {
    if (name === "value" && !this.#valueSet) { this.#value = this.#clamp(Number(val ?? this.min)); this.#render(); }
    if (name === "min" || name === "max" || name === "required") this.#render();
    if (name === "disabled") this.#applyDisabled();
    if (name === "aria-label") this.#syncLabel();
  }

  get min() { const v = this.getAttribute("min"); return v === null ? 0 : Number(v); }
  set min(v) { this.setAttribute("min", String(v)); }
  get max() { const v = this.getAttribute("max"); return v === null ? Infinity : Number(v); }
  set max(v) { this.setAttribute("max", String(v)); }
  get value() { return this.#value; }
  set value(v) {
    this.#valueSet = true;
    const n = v === null || v === "" || v === undefined ? this.min : Number(v);
    this.#value = Number.isFinite(n) ? n : this.min;
    this.#render();
  }
  get valueAsNumber() { return this.#value; }
  get defaultValue() { return Number(this.getAttribute("value") ?? this.min); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { this.toggleAttribute("disabled", Boolean(v)); }
  get required() { return this.hasAttribute("required"); }
  set required(v) { this.toggleAttribute("required", Boolean(v)); }
  get name() { return this.getAttribute("name") ?? ""; }
  get form() { return this.#internals.form; }
  get labels() { return this.#internals.labels; }
  get validity() { return this.#internals.validity; }
  get validationMessage() { return this.#internals.validationMessage; }
  get willValidate() { return this.#internals.willValidate; }
  get type() { return "midori-stepper"; }
  checkValidity() { return this.#internals.checkValidity(); }
  reportValidity() { return this.#internals.reportValidity(); }

  #clamp(n) { return Math.min(this.max, Math.max(this.min, Number.isFinite(n) ? Math.round(n) : this.min)); }

  #step(d) {
    if (this.disabled || this.#formDisabled) return;
    this.#set(this.#clamp(this.#value + d));
    this.#input.focus();
  }
  #fromInput() {
    const half = toHalf(this.#input.value);
    if (half !== this.#input.value) this.#input.value = half;
    if (half === "" || half === "-") { this.#validate(true); return; }
    this.#set(Number(half), false);
  }
  #set(n, render = true) {
    const changed = n !== this.#value;
    this.#value = n;
    this.#valueSet = true;
    if (render) this.#render(); else this.#validate(false);
    if (changed) {
      this.dispatchEvent(new CustomEvent("midori-stepper:value-changed", { detail: this.#value, bubbles: true }));
      this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  #render() {
    if (this.#input.value !== String(this.#value)) this.#input.value = String(this.#value);
    this.#input.setAttribute("aria-valuenow", String(this.#value));
    this.#input.setAttribute("aria-valuemin", String(this.min));
    if (Number.isFinite(this.max)) this.#input.setAttribute("aria-valuemax", String(this.max));
    this.#validate(false);
    this.#applyDisabled();
  }
  #validate(empty) {
    const flags = {}; let msg = "";
    if (empty) { flags.badInput = true; msg = "数を入力してください。"; }
    else if (this.#value < this.min) { flags.rangeUnderflow = true; msg = `${this.min}以上にしてください。`; }
    else if (this.#value > this.max) { flags.rangeOverflow = true; msg = `${this.max}以下にしてください。`; }
    this.#internals.setValidity(flags, msg, this.#input);
    this.#internals.setFormValue(empty ? "" : String(this.#value));
  }
  #applyDisabled() {
    const off = this.disabled || this.#formDisabled;
    this.#input.disabled = off;
    this.#minus.disabled = off || this.#value <= this.min;
    this.#plus.disabled = off || this.#value >= this.max;
  }
  #syncLabel() { const l = this.getAttribute("aria-label"); if (l) this.#input.setAttribute("aria-label", l); }

  formDisabledCallback(disabled) { this.#formDisabled = disabled; this.#applyDisabled(); }
  formResetCallback() {
    this.#valueSet = false;
    this.#set(this.#clamp(this.defaultValue));   // reports the change, as the user would have made it
  }
  formStateRestoreCallback(state) {
    const n = Number(state);
    if (Number.isFinite(n)) this.#set(this.#clamp(n));
  }
}

if (!customElements.get("midori-stepper")) customElements.define("midori-stepper", MidoriStepper);
