// 県 共通部品 <ken-postal> 1.4.2 — 郵便番号から住所を引く入力欄。
// This file is shipped by the prefecture. Do not edit it; report problems to the prefecture's web team.
// Documentation: ./README.md

const TEMPLATE = `
  <style>
    :host { display: inline-flex; gap: 0.4em; align-items: center; font: inherit; }
    :host([hidden]) { display: none; }
    input { font: inherit; width: 8em; padding: 0.3em 0.5em; border: 1px solid var(--ken-border, #767676); border-radius: 4px;
      background: var(--ken-bg, #fff); color: var(--ken-fg, #111); }
    input[aria-invalid="true"] { border-color: var(--ken-error, #b00020); }
    button { font: inherit; padding: 0.3em 0.8em; border: 1px solid var(--ken-border, #767676); border-radius: 4px;
      background: var(--ken-button-bg, #f2f2f2); color: var(--ken-fg, #111); cursor: pointer; }
    button:disabled, input:disabled { opacity: 0.5; cursor: default; }
    output { font-size: 0.85em; color: var(--ken-error, #b00020); }
  </style>
  <input part="input" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="8" placeholder="123-4567"
    aria-label="郵便番号">
  <button part="button" type="button">住所を検索</button>
  <output part="status" role="status"></output>
`;

/** "1234567" / "123-4567" / "１２３４５６７" → "123-4567"; anything shorter stays as typed digits. */
function normalize(raw) {
  const digits = String(raw ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "")
    .slice(0, 7);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

class KenPostal extends HTMLElement {
  static observedAttributes = ["value", "disabled"];

  #input;
  #button;
  #status;
  #address = "";
  #request = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "closed" });
    root.innerHTML = TEMPLATE;
    this.#input = root.querySelector("input");
    this.#button = root.querySelector("button");
    this.#status = root.querySelector("output");

    this.#input.addEventListener("input", () => {
      const caretAtEnd = this.#input.selectionStart === this.#input.value.length;
      const next = normalize(this.#input.value);
      if (next !== this.#input.value) {
        this.#input.value = next;
        if (caretAtEnd) this.#input.setSelectionRange(next.length, next.length);
      }
      this.#setInvalid("");
      this.dispatchEvent(new CustomEvent("ken-input", { bubbles: true, composed: true, detail: { value: next } }));
    });
    this.#input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.lookup();
      }
    });
    this.#button.addEventListener("click", () => this.lookup());
  }

  attributeChangedCallback(name, _old, value) {
    if (name === "value") this.value = value ?? "";
    if (name === "disabled") {
      this.#input.disabled = value !== null;
      this.#button.disabled = value !== null;
    }
  }

  /** The postal code, as "123-4567". Setting it from a script fires no event. */
  get value() {
    return this.#input.value;
  }
  set value(v) {
    const next = normalize(v);
    if (next !== this.#input.value) this.#input.value = next;
  }

  /** The address of the last successful lookup ("" before one). Read-only. */
  get address() {
    return this.#address;
  }

  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(v) {
    this.toggleAttribute("disabled", Boolean(v));
  }

  /** Looks the current code up. Resolves with the address, or null when there is none. */
  async lookup() {
    const value = this.#input.value;
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 7) {
      this.#setInvalid("7 桁で入力してください");
      this.dispatchEvent(new CustomEvent("ken-error", { bubbles: true, composed: true, detail: { value, reason: "format" } }));
      return null;
    }
    const request = ++this.#request;
    this.#button.disabled = true;
    try {
      const base = this.getAttribute("endpoint") || "/api/postal";
      const response = await fetch(`${base}/${digits}`);
      if (request !== this.#request) return null;
      if (!response.ok) {
        this.#setInvalid(response.status === 404 ? "住所が見つかりません" : "検索できませんでした");
        this.dispatchEvent(
          new CustomEvent("ken-error", { bubbles: true, composed: true, detail: { value, reason: response.status === 404 ? "unknown" : "server", status: response.status } }),
        );
        return null;
      }
      const { address } = await response.json();
      if (request !== this.#request) return null;
      this.#address = address;
      this.#setInvalid("");
      this.dispatchEvent(new CustomEvent("ken-resolved", { bubbles: true, composed: true, detail: { value, address } }));
      return address;
    } catch {
      if (request !== this.#request) return null;
      this.#setInvalid("検索できませんでした");
      this.dispatchEvent(new CustomEvent("ken-error", { bubbles: true, composed: true, detail: { value, reason: "network" } }));
      return null;
    } finally {
      if (request === this.#request) this.#button.disabled = this.disabled;
    }
  }

  #setInvalid(message) {
    this.#status.textContent = message;
    if (message) this.#input.setAttribute("aria-invalid", "true");
    else this.#input.removeAttribute("aria-invalid");
  }
}

customElements.define("ken-postal", KenPostal);
