// <midori-date> — みどり市 design system: a date as 年 / 月 / 日 with a 西暦 ⇄ 和暦 (昭和 / 平成 / 令和) switch.
// A form-associated custom element with no dependency on any framework. Value: ISO date ("2010-04-02") or "".

const ERAS = [
  { key: "reiwa", label: "令和", start: [2019, 5, 1] },
  { key: "heisei", label: "平成", start: [1989, 1, 8], end: [2019, 4, 30] },
  { key: "showa", label: "昭和", start: [1926, 12, 25], end: [1989, 1, 7] },
];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const toHalf = (s) => String(s ?? "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");

function eraOf(y, m, d) {
  for (const e of ERAS) if (cmp([y, m, d], e.start) >= 0 && (!e.end || cmp([y, m, d], e.end) <= 0)) return e;
  return null;
}
function today() { const t = new Date(); return [t.getFullYear(), t.getMonth() + 1, t.getDate()]; }
function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? [y, mo, d] : null;
}
const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: inline-flex; align-items: center; gap: .25em; flex-wrap: wrap; }
  :host([hidden]) { display: none; }
  select, input { font: inherit; padding: .3em .35em; border: 1px solid #8a8f98; border-radius: 4px; background: #fff; color: inherit; }
  input { width: 4.2em; text-align: right; }
  :host(:state(user-invalid)) select, :host(:state(user-invalid)) input,
  :host([aria-invalid="true"]) select, :host([aria-invalid="true"]) input { border-color: #c62828; }
  :host([disabled]) select, :host([disabled]) input, select:disabled, input:disabled { background: #eee; color: #666; }
  :focus-visible { outline: 3px solid #1565c0; outline-offset: 1px; }
</style>
<select part="era" aria-label="暦"><option value="ad">西暦</option><option value="reiwa">令和</option><option value="heisei">平成</option><option value="showa">昭和</option></select>
<input part="year" inputmode="numeric" autocomplete="off" aria-label="年"><span aria-hidden="true">年</span>
<select part="month" aria-label="月"><option value=""></option></select><span aria-hidden="true">月</span>
<select part="day" aria-label="日"><option value=""></option></select><span aria-hidden="true">日</span>`;

export class MidoriDate extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["value", "disabled", "required", "max", "aria-label", "aria-labelledby"];
  // Declared so that a binding library speaking the wc-bindable protocol (e.g. wcstack) can bind `value` two-way.
  // A plain static object — no dependency on that library.
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "midori-date:value-changed" }],
    inputs: [{ name: "value", attribute: "value" }, { name: "disabled", attribute: "disabled" }, { name: "required", attribute: "required" }],
  };

  #internals = this.attachInternals();
  #root;
  #era; #year; #month; #day;
  #value = "";
  #composing = false;
  #userTouched = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open", delegatesFocus: true });
    this.#root.append(template.content.cloneNode(true));
    [this.#era, this.#year, this.#month, this.#day] = ["era", "year", "month", "day"].map((p) => this.#root.querySelector(`[part=${p}]`));
    for (let i = 1; i <= 12; i++) this.#month.add(new Option(String(i), String(i)));
    for (let i = 1; i <= 31; i++) this.#day.add(new Option(String(i), String(i)));
    this.#era.addEventListener("change", () => this.#onEraChange());
    this.#year.addEventListener("compositionstart", () => { this.#composing = true; });
    this.#year.addEventListener("compositionend", () => { this.#composing = false; this.#onPartInput(); });
    this.#year.addEventListener("input", (e) => { if (!e.isComposing && !this.#composing) this.#onPartInput(); });
    this.#month.addEventListener("change", () => this.#onPartInput());
    this.#day.addEventListener("change", () => this.#onPartInput());
    for (const el of [this.#era, this.#year, this.#month, this.#day]) el.addEventListener("blur", () => { this.#userTouched = true; this.#syncState(); });
  }

  connectedCallback() {
    // A value written before the element was defined (an own property) goes through the setter.
    if (Object.prototype.hasOwnProperty.call(this, "value")) { const v = this.value; delete this.value; this.value = v; }
    if (!this.#valueSet && this.hasAttribute("value")) this.#setValue(this.getAttribute("value"), false);
    this.#syncLabel();
    this.#update(false);
  }
  #valueSet = false;

  attributeChangedCallback(name, _old, val) {
    if (name === "value" && !this.#valueSet) this.#setValue(val, false);
    if (name === "disabled") this.#applyDisabled();
    if (name === "required" || name === "max") this.#update(false);
    if (name === "aria-label" || name === "aria-labelledby") this.#syncLabel();
  }

  get value() { return this.#value; }
  set value(v) { this.#valueSet = true; this.#setValue(v, false); }
  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v) { this.setAttribute("value", v); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { this.toggleAttribute("disabled", Boolean(v)); }
  get required() { return this.hasAttribute("required"); }
  set required(v) { this.toggleAttribute("required", Boolean(v)); }
  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", v); }
  get form() { return this.#internals.form; }
  get labels() { return this.#internals.labels; }
  get validity() { return this.#internals.validity; }
  get validationMessage() { return this.#internals.validationMessage; }
  get willValidate() { return this.#internals.willValidate; }
  get type() { return "midori-date"; }
  checkValidity() { return this.#internals.checkValidity(); }
  reportValidity() { return this.#internals.reportValidity(); }
  setCustomValidity(msg) { this.#custom = String(msg ?? ""); this.#update(false); }
  #custom = "";

  /** The parts as typed: { era, year, month, day } (strings). */
  get parts() { return { era: this.#era.value, year: this.#year.value, month: this.#month.value, day: this.#day.value }; }

  #setValue(v, fromUser) {
    const p = parseIso(v);
    if (p) {
      const mode = this.#era.value;
      if (mode === "ad") this.#year.value = String(p[0]);
      else {
        const e = eraOf(...p);
        if (e) { this.#era.value = e.key; this.#year.value = String(p[0] - e.start[0] + 1); }
        else { this.#era.value = "ad"; this.#year.value = String(p[0]); }
      }
      this.#month.value = String(p[1]); this.#day.value = String(p[2]);
    } else {
      this.#year.value = ""; this.#month.value = ""; this.#day.value = "";
    }
    this.#update(fromUser);
  }

  #westernYear() {
    const y = Number(toHalf(this.#year.value));
    if (!this.#year.value || !y) return null;
    if (this.#era.value === "ad") return y;
    const e = ERAS.find((x) => x.key === this.#era.value);
    return e.start[0] + y - 1;
  }

  #onEraChange() {
    // Keep the same date when the calendar is switched: recompute the year in the new calendar.
    const before = parseIso(this.#value);
    if (before) {
      if (this.#era.value === "ad") this.#year.value = String(before[0]);
      else {
        const e = ERAS.find((x) => x.key === this.#era.value);
        const ey = before[0] - e.start[0] + 1;
        this.#year.value = ey >= 1 ? String(ey) : "";
      }
    }
    this.#onPartInput();
  }

  #onPartInput() {
    const half = toHalf(this.#year.value).slice(0, 4);
    if (half !== this.#year.value) this.#year.value = half;
    this.#update(true);
  }

  #compute() {
    const y = this.#westernYear(); const m = Number(this.#month.value); const d = Number(this.#day.value);
    const any = this.#year.value || this.#month.value || this.#day.value;
    if (!any) return { value: "", error: this.required ? ["valueMissing", "生年月日を入力してください。"] : null };
    if (!y || !m || !d) return { value: "", error: ["badInput", "年・月・日をすべて入力してください。"] };
    if (!parseIso(iso(y, m, d))) return { value: "", error: ["badInput", `${m}月${d}日は存在しない日付です。`] };
    if (this.#era.value !== "ad") {
      const e = ERAS.find((x) => x.key === this.#era.value);
      if (cmp([y, m, d], e.start) < 0 || (e.end && cmp([y, m, d], e.end) > 0)) return { value: "", error: ["badInput", `${e.label}${this.#year.value}年${m}月${d}日は${e.label}の期間外です。`] };
    }
    const max = parseIso(this.getAttribute("max")) ?? today();
    if (cmp([y, m, d], max) > 0) return { value: iso(y, m, d), error: ["rangeOverflow", "未来の日付は入力できません。"] };
    return { value: iso(y, m, d), error: null };
  }

  #update(fromUser) {
    const { value, error } = this.#compute();
    const next = error && error[0] !== "valueMissing" ? "" : value;
    const changed = next !== this.#value;
    this.#value = next;
    const flags = {}; let msg = "";
    if (error) { flags[error[0]] = true; msg = error[1]; }
    if (!error && this.#custom) { flags.customError = true; msg = this.#custom; }
    this.#internals.setValidity(flags, msg, this.#year);
    this.#internals.setFormValue(next, JSON.stringify(this.parts));
    if (fromUser) this.#userTouched = true;
    this.#syncState();
    if (changed && fromUser) this.#emit();
  }

  #emit() {
    this.dispatchEvent(new CustomEvent("midori-date:value-changed", { detail: this.#value, bubbles: true }));
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  #syncState() {
    try {
      if (this.#userTouched && !this.#internals.validity.valid) this.#internals.states.add("user-invalid");
      else this.#internals.states.delete("user-invalid");
    } catch { /* CustomStateSet unsupported */ }
  }

  #syncLabel() {
    const label = this.getAttribute("aria-label");
    this.#era.setAttribute("aria-label", label ? `${label} 暦` : "暦");
    this.#year.setAttribute("aria-label", label ? `${label} 年` : "年");
    this.#month.setAttribute("aria-label", label ? `${label} 月` : "月");
    this.#day.setAttribute("aria-label", label ? `${label} 日` : "日");
  }

  #applyDisabled() {
    const off = this.disabled || this.#formDisabled;
    for (const el of [this.#era, this.#year, this.#month, this.#day]) el.disabled = off;
  }
  #formDisabled = false;

  formDisabledCallback(disabled) { this.#formDisabled = disabled; this.#applyDisabled(); }
  formResetCallback() {
    this.#valueSet = false; this.#era.value = "ad"; this.#userTouched = false;
    const before = this.#value;
    this.#setValue(this.defaultValue, false);
    if (before !== this.#value) this.#emit();   // tell listeners (and bindings) that the value changed
  }
  formStateRestoreCallback(state) {
    const before = this.#value;
    try {
      const p = typeof state === "string" && state.startsWith("{") ? JSON.parse(state) : null;
      if (p) { this.#era.value = p.era || "ad"; this.#year.value = p.year || ""; this.#month.value = p.month || ""; this.#day.value = p.day || ""; this.#update(false); }
      else this.#setValue(state, false);
    } catch { this.#setValue("", false); }
    this.#valueSet = true;
    if (before !== this.#value) this.#emit();   // the browser restored it: listeners must hear it
  }
}

if (!customElements.get("midori-date")) customElements.define("midori-date", MidoriDate);
