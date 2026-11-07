// The page's own elements. wcstack I/O nodes draw nothing (audio README: "drawing is the page's
// job"), so the on-screen keyboard and the computer-keyboard listener live here. Both speak
// wc-bindable so the state wires them with eventToken.* like any I/O node.

const NOTE_NAMES = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"];
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);
const label = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Computer keys → semitones above the base C. A S D F G H J K = white, W E T Y U = black. */
export const KEY_SEMITONES = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
};
const KEY_LETTER = Object.fromEntries(Object.entries(KEY_SEMITONES).map(([code, s]) => [s, code.slice(3)]));

const KEYBOARD_VELOCITY = 0.8;

// ---------------------------------------------------------------------------
// <mr-piano base="48" octaves="2"> — on-screen keyboard (mouse + touch)
//   inputs:  pressed (number[] of sounding notes), base (lowest C), letterBase (where A S D… sit)
//   output:  note (occurrence) { on, note, velocity }
// ---------------------------------------------------------------------------
class MrPiano extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [{ name: "note", event: "mr-piano:note", semantics: "event" }],
    inputs: [{ name: "pressed" }, { name: "base", attribute: "base" }, { name: "letterBase", attribute: "letter-base" }],
  };

  #pressed = [];
  #note = null;
  #pointers = new Map(); // pointerId -> note

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("pointerdown", this.#down);
    this.shadowRoot.addEventListener("pointerup", this.#up);
    this.shadowRoot.addEventListener("pointercancel", this.#up);
    this.shadowRoot.addEventListener("lostpointercapture", this.#up);
    this.shadowRoot.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get note() { return this.#note; }
  get pressed() { return this.#pressed; }
  set pressed(v) { this.#pressed = Array.isArray(v) ? v : []; this.#paint(); }
  get base() { return Number(this.getAttribute("base") ?? 48); }
  set base(v) {
    if (v == null) this.removeAttribute("base"); else this.setAttribute("base", String(v));
  }
  get letterBase() { return Number(this.getAttribute("letter-base") ?? 60); }
  set letterBase(v) {
    if (v == null) this.removeAttribute("letter-base"); else this.setAttribute("letter-base", String(v));
  }

  static observedAttributes = ["base", "letter-base", "octaves"];
  attributeChangedCallback() { if (this.isConnected) { this.#releaseAll(); this.#render(); } }

  connectedCallback() { this.#render(); }
  disconnectedCallback() { this.#releaseAll(); }

  #emit(on, note) {
    this.#note = { on, note, velocity: on ? KEYBOARD_VELOCITY : 0 };
    this.dispatchEvent(new CustomEvent("mr-piano:note", { detail: this.#note }));
  }

  #releaseAll() {
    for (const note of this.#pointers.values()) this.#emit(false, note);
    this.#pointers.clear();
  }

  #down = (e) => {
    const key = e.target.closest?.("[data-note]");
    if (!key || e.button > 0) return;
    e.preventDefault();
    const note = Number(key.dataset.note);
    try { key.setPointerCapture(e.pointerId); } catch { /* synthetic pointers have no capture */ }
    const prev = this.#pointers.get(e.pointerId);
    if (prev !== undefined) this.#emit(false, prev);
    this.#pointers.set(e.pointerId, note);
    this.#emit(true, note);
  };

  #up = (e) => {
    const note = this.#pointers.get(e.pointerId);
    if (note === undefined) return;
    this.#pointers.delete(e.pointerId);
    this.#emit(false, note);
  };

  #render() {
    const base = this.base;
    const count = Number(this.getAttribute("octaves") ?? 2) * 12 + 1;
    const letters = this.letterBase;
    const notes = Array.from({ length: count }, (_, i) => base + i);
    const whites = notes.filter((n) => !isBlack(n));
    const keyHtml = (n) => {
      const letter = KEY_LETTER[n - letters];
      return `<button type="button" class="key ${isBlack(n) ? "black" : "white"}" data-note="${n}"
        aria-label="${label(n)}" aria-pressed="false" tabindex="-1"
        style="${isBlack(n) ? `--x:${whites.filter((w) => w < n).length}` : ""}">
        ${letter ? `<span class="letter">${letter}</span>` : ""}</button>`;
    };
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; user-select: none; -webkit-user-select: none; touch-action: none; }
        .keys { position: relative; display: flex; height: var(--piano-height, 160px); }
        .key { font: inherit; border: 1px solid #333; padding: 0; cursor: pointer; display: flex;
               align-items: flex-end; justify-content: center; touch-action: none; }
        .white { flex: 1; background: #fff; color: #555; border-radius: 0 0 6px 6px; padding-bottom: 6px; }
        .black { position: absolute; top: 0; height: 60%; width: calc(100% / ${whites.length} * 0.6);
                 left: calc(100% / ${whites.length} * var(--x) - 100% / ${whites.length} * 0.3);
                 background: #222; color: #ddd; z-index: 1; border-radius: 0 0 4px 4px; padding-bottom: 4px; }
        .white.on { background: #ffd54f; }
        .black.on { background: #f9a825; }
        .letter { font-size: 12px; pointer-events: none; }
      </style>
      <div class="keys" part="keys" role="group" aria-label="けんばん">${notes.map(keyHtml).join("")}</div>`;
    this.#paint();
  }

  #paint() {
    const on = new Set(this.#pressed);
    for (const key of this.shadowRoot.querySelectorAll("[data-note]")) {
      const pressed = on.has(Number(key.dataset.note));
      key.classList.toggle("on", pressed);
      key.setAttribute("aria-pressed", String(pressed));
    }
  }
}

// ---------------------------------------------------------------------------
// <mr-qwerty> — plays from the computer keyboard (window-wide, renders nothing)
//   inputs:  enabled (boolean)
//   outputs: note (occurrence) { on, note, velocity }, octave (state), lost (occurrence) "blur" | "hidden"
// ---------------------------------------------------------------------------
class MrQwerty extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "note", event: "mr-qwerty:note", semantics: "event" },
      { name: "octave", event: "mr-qwerty:octave" },
      { name: "lost", event: "mr-qwerty:lost", semantics: "event" },
    ],
    inputs: [{ name: "enabled" }],
  };

  #enabled = true;
  #octave = 4;
  #held = new Map(); // code -> note
  #note = null;
  #lost = null;

  get note() { return this.#note; }
  get lost() { return this.#lost; }
  get octave() { return this.#octave; }
  get enabled() { return this.#enabled; }
  set enabled(v) {
    this.#enabled = v !== false && v !== "false";
    if (!this.#enabled) this.#releaseAll();
  }

  connectedCallback() {
    window.addEventListener("keydown", this.#down);
    window.addEventListener("keyup", this.#up);
    window.addEventListener("blur", this.#blur);
    document.addEventListener("visibilitychange", this.#visibility);
  }
  disconnectedCallback() {
    window.removeEventListener("keydown", this.#down);
    window.removeEventListener("keyup", this.#up);
    window.removeEventListener("blur", this.#blur);
    document.removeEventListener("visibilitychange", this.#visibility);
    this.#releaseAll();
  }

  #emit(on, note) {
    this.#note = { on, note, velocity: on ? KEYBOARD_VELOCITY : 0 };
    this.dispatchEvent(new CustomEvent("mr-qwerty:note", { detail: this.#note }));
  }

  #releaseAll() {
    for (const note of this.#held.values()) this.#emit(false, note);
    this.#held.clear();
  }

  static #typing(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName === "INPUT") return !["range", "checkbox", "radio", "button", "submit"].includes(el.type);
    return false;
  }

  #down = (e) => {
    if (!this.#enabled || e.ctrlKey || e.metaKey || e.altKey || MrQwerty.#typing(e.target)) return;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      if (e.repeat) return;
      const next = Math.min(7, Math.max(1, this.#octave + (e.code === "KeyX" ? 1 : -1)));
      if (next !== this.#octave) {
        this.#releaseAll();
        this.#octave = next;
        this.dispatchEvent(new CustomEvent("mr-qwerty:octave", { detail: next }));
      }
      e.preventDefault();
      return;
    }
    const semi = KEY_SEMITONES[e.code];
    if (semi === undefined) return;
    e.preventDefault();
    if (e.repeat || this.#held.has(e.code)) return;
    const note = 12 * (this.#octave + 1) + semi;
    this.#held.set(e.code, note);
    this.#emit(true, note);
  };

  #up = (e) => {
    const note = this.#held.get(e.code);
    if (note === undefined) return;
    this.#held.delete(e.code);
    this.#emit(false, note);
  };

  #signalLost(reason) {
    this.#releaseAll();
    this.#lost = reason;
    this.dispatchEvent(new CustomEvent("mr-qwerty:lost", { detail: reason }));
  }

  #blur = () => this.#signalLost("blur");
  #visibility = () => { if (document.visibilityState === "hidden") this.#signalLost("hidden"); };
}

customElements.define("mr-piano", MrPiano);
customElements.define("mr-qwerty", MrQwerty);
