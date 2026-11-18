// <midori-qty> — the city's quantity stepper. A custom element of its own: no wcstack inside,
// so it works in a page without wcstack, and it speaks the wc-bindable protocol so a wcstack
// page can bind `value` in both directions.
//
//   <midori-qty min="1" max="5" step="1" value="2" label="数量"></midori-qty>
//   el.addEventListener("midori-qty:change", (e) => e.detail /* number */);

/** The one event the element dispatches when the user changes the value; `detail` is the new number. */
export const MIDORI_QTY_CHANGE = "midori-qty:change";
export type MidoriQtyChangeEvent = CustomEvent<number>;

// The protocol's own declaration type is `WcBindableDeclaration` in `@wc-bindable/core` (no @wcstack package
// exports one). The component declares the shape itself, without that dependency, and stricter than the
// protocol's: names must be members of the class, events must be our constant.
interface BindableDeclaration<C, E extends string> {
  readonly protocol: "wc-bindable";
  readonly version: 1;
  readonly properties: readonly { readonly name: keyof C & string; readonly event: E; readonly getter?: (e: Event) => unknown }[];
  readonly inputs?: readonly { readonly name: keyof C & string; readonly attribute?: string }[];
  readonly commands?: readonly { readonly name: keyof C & string; readonly async?: boolean }[];
}

const STYLE = `
:host { display: inline-flex; align-items: stretch; font: inherit; }
:host([hidden]) { display: none; }
button { font: inherit; min-width: 2.2em; border: 1px solid #8a9a8a; background: #f2f6f2; cursor: pointer; }
button:first-of-type { border-radius: 6px 0 0 6px; }
button:last-of-type { border-radius: 0 6px 6px 0; }
button:disabled { color: #aaa; cursor: default; background: #f6f6f6; }
input { font: inherit; width: 3.5em; text-align: center; border: 1px solid #8a9a8a; border-left: 0; border-right: 0; }
input:focus { outline: 2px solid #2f7d4f; outline-offset: -2px; }
`;

function toInt(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Clamp to [min, max] and snap to the step grid that starts at min. Exported for the unit tests. */
export function clampQty(v: number, min: number, max: number, step: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const s = step > 0 ? step : 1;
  let n = Number.isFinite(v) ? v : lo;
  n = Math.min(hi, Math.max(lo, n));
  n = lo + Math.round((n - lo) / s) * s;
  if (n > hi) n -= s;
  return n;
}

export class MidoriQty extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["min", "max", "step", "value", "label", "disabled"];

  static wcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [{ name: "value", event: MIDORI_QTY_CHANGE }],
    inputs: [{ name: "value", attribute: "value" }, { name: "min", attribute: "min" }, { name: "max", attribute: "max" },
      { name: "step", attribute: "step" }, { name: "label", attribute: "label" }, { name: "disabled", attribute: "disabled" }],
  } as const satisfies BindableDeclaration<MidoriQty, typeof MIDORI_QTY_CHANGE>;

  #min = 0;
  #max = Number.MAX_SAFE_INTEGER;
  #step = 1;
  #value = 0;
  #label = "数量";
  #disabled = false;
  #typing = false;
  #internals: ElementInternals | null;
  #root: ShadowRoot;
  #dec: HTMLButtonElement;
  #inc: HTMLButtonElement;
  #input: HTMLInputElement;

  constructor() {
    super();
    this.#internals = typeof this.attachInternals === "function" ? this.attachInternals() : null;
    this.#root = this.attachShadow({ mode: "open", delegatesFocus: true });
    this.#root.innerHTML = `<style>${STYLE}</style><button type="button" part="decrement" tabindex="-1">−</button><input part="input" type="text" inputmode="numeric" role="spinbutton" autocomplete="off"><button type="button" part="increment" tabindex="-1">＋</button>`;
    const [dec, inc] = this.#root.querySelectorAll("button");
    this.#dec = dec!;
    this.#inc = inc!;
    this.#input = this.#root.querySelector("input")!;
    this.#dec.addEventListener("click", () => this.#user(this.#value - this.#step));
    this.#inc.addEventListener("click", () => this.#user(this.#value + this.#step));
    this.#input.addEventListener("keydown", (e) => this.#onKey(e));
    this.#input.addEventListener("input", () => this.#onInput());
    this.#input.addEventListener("blur", () => this.#commitTyped());
    this.#input.addEventListener("change", () => this.#commitTyped());
  }

  connectedCallback(): void {
    // a property state set before the upgrade sits on the instance: run it through the setter
    for (const name of ["value", "min", "max", "step", "label", "disabled"] as const) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const v: unknown = (this as Record<string, unknown>)[name];
        delete (this as Record<string, unknown>)[name];
        (this as Record<string, unknown>)[name] = v;
      }
    }
    this.#render();
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    switch (name) {
      case "min": this.min = toInt(v, 0); break;
      case "max": this.max = toInt(v, Number.MAX_SAFE_INTEGER); break;
      case "step": this.step = toInt(v, 1); break;
      case "value": this.value = toInt(v, this.#min); break;
      case "label": this.label = v ?? "数量"; break;
      case "disabled": this.disabled = v !== null; break;
    }
  }

  get value(): number { return this.#value; }
  set value(v: number) { this.#set(clampQty(toInt(v, this.#min), this.#min, this.#max, this.#step)); }

  get min(): number { return this.#min; }
  set min(v: number) { this.#min = toInt(v, 0); this.#reclamp(); }

  get max(): number { return this.#max; }
  set max(v: number) { this.#max = toInt(v, Number.MAX_SAFE_INTEGER); this.#reclamp(); }

  get step(): number { return this.#step; }
  set step(v: number) { const s = toInt(v, 1); this.#step = s > 0 ? s : 1; this.#reclamp(); }

  get label(): string { return this.#label; }
  set label(v: string) { this.#label = String(v ?? "数量"); this.#render(); }

  get disabled(): boolean { return this.#disabled; }
  set disabled(v: boolean) { this.#disabled = Boolean(v); this.#render(); }

  /** Step up or down by `n` steps, as a user would (dispatches the change event). */
  stepBy(n: number): void { this.#user(this.#value + n * this.#step); }

  formResetCallback(): void { this.#user(this.#min); }

  #reclamp(): void {
    // a new range clamps the current value; that is a change the user did not make: no event
    this.#set(clampQty(this.#value, this.#min, this.#max, this.#step));
  }

  #set(v: number): void {
    this.#value = v;
    this.#internals?.setFormValue(String(v));
    this.#render();
  }

  #user(v: number): void {
    if (this.#disabled) return;
    const next = clampQty(v, this.#min, this.#max, this.#step);
    const changed = next !== this.#value;
    this.#set(next);
    if (changed) this.dispatchEvent(new CustomEvent<number>(MIDORI_QTY_CHANGE, { detail: next, bubbles: true, composed: true }));
  }

  #onKey(e: KeyboardEvent): void {
    const big = Math.max(1, Math.round((this.#max - this.#min) / 10)) * this.#step;
    const keys: Record<string, () => number> = {
      ArrowUp: () => this.#value + this.#step,
      ArrowDown: () => this.#value - this.#step,
      PageUp: () => this.#value + big,
      PageDown: () => this.#value - big,
      Home: () => this.#min,
      End: () => this.#max,
    };
    const f = keys[e.key];
    if (f) { e.preventDefault(); this.#commitTyped(); this.#user(f()); return; }
    if (e.key === "Enter" && !e.isComposing) this.#commitTyped();
  }

  #onInput(): void {
    // keep digits only (full-width digits typed with an IME become ASCII); clamp on blur
    const raw = this.#input.value;
    const digits = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, "");
    if (digits !== raw) this.#input.value = digits;
    this.#typing = true;
  }

  #commitTyped(): void {
    if (!this.#typing) return;
    this.#typing = false;
    const text = this.#input.value.trim();
    if (text === String(this.#value)) return;
    this.#user(text === "" ? this.#value : toInt(text, this.#value));
    this.#input.value = String(this.#value);
  }

  #render(): void {
    if (!this.#input) return;
    if (!this.#typing) this.#input.value = String(this.#value);
    this.#input.setAttribute("aria-valuenow", String(this.#value));
    this.#input.setAttribute("aria-valuemin", String(this.#min));
    this.#input.setAttribute("aria-valuemax", String(this.#max));
    this.#input.setAttribute("aria-valuetext", String(this.#value));
    this.#input.setAttribute("aria-label", this.#label);
    this.#input.disabled = this.#disabled;
    this.#dec.disabled = this.#disabled || this.#value <= Math.min(this.#min, this.#max);
    this.#inc.disabled = this.#disabled || this.#value >= Math.max(this.#min, this.#max);
    this.#dec.setAttribute("aria-label", `${this.#label}を減らす`);
    this.#inc.setAttribute("aria-label", `${this.#label}を増やす`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "midori-qty": MidoriQty;
  }
  interface HTMLElementEventMap {
    "midori-qty:change": MidoriQtyChangeEvent;
  }
}

if (!customElements.get("midori-qty")) customElements.define("midori-qty", MidoriQty);
