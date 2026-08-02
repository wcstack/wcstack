/**
 * Example-local UI components for the synth playground.
 *
 * These are deliberately NOT part of `@wcstack/audio`. wcstack I/O nodes carry
 * no rendering (docs/architecture-hardening/14-handle-graph-wiring.md, gate G6),
 * so a keyboard and an oscilloscope belong to the page that wants them — which
 * is exactly what this file demonstrates: the package produces data and state,
 * the demo draws.
 *
 *   <demo-keys>  — on-screen + computer keyboard, calls noteOn/noteOff
 *   <demo-scope> — canvas over a <wcs-analyser>, pulled once per frame
 */

const attrNum = (el, name, dflt) => {
  const n = parseFloat(el.getAttribute(name));
  return Number.isFinite(n) ? n : dflt;
};

/** Semitone offsets from the base C for computer-keyboard play (A = C). */
const KEY_OFFSETS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13,
  KeyL: 14, KeyP: 15, Semicolon: 16,
};
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];

class DemoKeys extends HTMLElement {
  static get observedAttributes() {
    return ["octaves", "octave"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._kbShift = 0;
    this._kbHeld = new Map();   // e.code   -> midi
    this._ptrHeld = new Map();  // pointerId -> midi
  }

  connectedCallback() {
    this._render();
    if (this.getAttribute("keyboard") !== "off") {
      window.addEventListener("keydown", this._onKeyDown);
      window.addEventListener("keyup", this._onKeyUp);
      window.addEventListener("blur", this._onBlur);
    }
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    this._releaseAll();
  }

  attributeChangedCallback(_n, oldV, newV) {
    if (oldV === newV) return;
    this._releaseAll();
    if (this.isConnected) this._render();
  }

  /** The <wcs-audio> this keyboard plays: `for=` by id, else the enclosing one. */
  _synth() {
    const id = this.getAttribute("for");
    const target = id ? document.getElementById(id) : this.closest("wcs-audio");
    return target ?? document.querySelector("wcs-audio");
  }

  get _baseMidi() {
    return 12 * (attrNum(this, "octave", 4) + 1);
  }

  _render() {
    const octaves = Math.max(attrNum(this, "octaves", 2), 1);
    const base = this._baseMidi;
    const count = octaves * 12 + 1; // include the top C
    const whites = [];
    const blacks = [];
    let whitesBefore = 0;
    for (let i = 0; i < count; i++) {
      const midi = base + i;
      if (WHITE_SEMIS.includes(i % 12)) {
        whites.push({ midi, label: i % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : "" });
        whitesBefore++;
      } else {
        blacks.push({ midi, whitesBefore });
      }
    }
    const whiteW = 100 / whites.length;
    const blackW = whiteW * 0.6;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; user-select: none; touch-action: none; }
        .kb { position: relative; display: flex; height: 130px;
              background: #111; border-radius: 6px; padding: 4px; gap: 1px; }
        .key { box-sizing: border-box; cursor: pointer; }
        .key.white { flex: 1; background: linear-gradient(#ffffff, #e8e8e8);
                     border: 1px solid #222; border-radius: 0 0 4px 4px;
                     display: flex; align-items: flex-end; justify-content: center;
                     font: 10px/1.6 system-ui, sans-serif; color: #999; }
        .key.black { position: absolute; top: 4px; height: 58%; background: #1c1c1c;
                     border: 1px solid #000; border-radius: 0 0 3px 3px; z-index: 2; }
        .key.white.active { background: #ffd54f; }
        .key.black.active { background: #ff8f00; }
      </style>
      <div class="kb">
        ${whites.map((k) => `<div class="key white" data-midi="${k.midi}">${k.label}</div>`).join("")}
        ${blacks.map((k) =>
          `<div class="key black" data-midi="${k.midi}" style="left:calc(${(k.whitesBefore * whiteW).toFixed(4)}% - ${(blackW / 2).toFixed(4)}%);width:${blackW.toFixed(4)}%"></div>`,
        ).join("")}
      </div>`;
    const kb = this.shadowRoot.querySelector(".kb");
    kb.addEventListener("pointerdown", this._onPointerDown);
    kb.addEventListener("pointermove", this._onPointerMove);
    kb.addEventListener("pointerup", this._onPointerUp);
    kb.addEventListener("pointercancel", this._onPointerUp);
  }

  _keyAt(x, y) {
    return this.shadowRoot.elementFromPoint(x, y)?.closest?.(".key") ?? null;
  }

  _press(midi) {
    this._synth()?.noteOn(midi, 0.9);
    this._light(midi, true);
  }

  _lift(midi) {
    this._synth()?.noteOff(midi);
    this._light(midi, false);
  }

  _light(midi, on) {
    this.shadowRoot.querySelector(`.key[data-midi="${midi}"]`)?.classList.toggle("active", on);
  }

  _onPointerDown = (e) => {
    const key = this._keyAt(e.clientX, e.clientY);
    if (!key) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const midi = Number(key.dataset.midi);
    this._ptrHeld.set(e.pointerId, midi);
    this._press(midi);
  };

  // Glissando: dragging across the keyboard lifts the old note and presses the new.
  _onPointerMove = (e) => {
    if (!this._ptrHeld.has(e.pointerId)) return;
    const key = this._keyAt(e.clientX, e.clientY);
    const midi = key ? Number(key.dataset.midi) : null;
    const prev = this._ptrHeld.get(e.pointerId);
    if (midi === prev) return;
    this._lift(prev);
    if (midi !== null) {
      this._ptrHeld.set(e.pointerId, midi);
      this._press(midi);
    } else {
      this._ptrHeld.delete(e.pointerId);
    }
  };

  _onPointerUp = (e) => {
    const midi = this._ptrHeld.get(e.pointerId);
    if (midi === undefined) return;
    this._ptrHeld.delete(e.pointerId);
    this._lift(midi);
  };

  _onKeyDown = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.code === "KeyZ") { this._shiftOctave(-1); return; }
    if (e.code === "KeyX") { this._shiftOctave(1); return; }
    const offset = KEY_OFFSETS[e.code];
    if (offset === undefined || this._kbHeld.has(e.code)) return;
    const midi = this._baseMidi + 12 * this._kbShift + offset;
    this._kbHeld.set(e.code, midi);
    this._press(midi);
  };

  _onKeyUp = (e) => {
    const midi = this._kbHeld.get(e.code);
    if (midi === undefined) return;
    this._kbHeld.delete(e.code);
    this._lift(midi);
  };

  _onBlur = () => this._releaseAll();

  _shiftOctave(delta) {
    this._kbShift = Math.min(Math.max(this._kbShift + delta, -3), 3);
    this._releaseAll();
  }

  _releaseAll() {
    for (const midi of this._kbHeld.values()) this._lift(midi);
    for (const midi of this._ptrHeld.values()) this._lift(midi);
    this._kbHeld.clear();
    this._ptrHeld.clear();
  }
}

/**
 * Draws a <wcs-analyser>. The analyser hands out data; every pixel here is the
 * demo's own doing — which is the whole point of keeping drawing out of the
 * package.
 */
class DemoScope extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 110px; }
        canvas { display: block; width: 100%; height: 100%;
                 background: #0b0f14; border-radius: 6px; }
      </style>
      <canvas width="600" height="120"></canvas>`;
    this._canvas = this.shadowRoot.querySelector("canvas");
  }

  connectedCallback() {
    this._raf = requestAnimationFrame(this._draw);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
  }

  _analyser() {
    const id = this.getAttribute("for");
    return id ? document.getElementById(id) : this.closest("wcs-audio")?.querySelector("wcs-analyser");
  }

  _draw = () => {
    this._raf = requestAnimationFrame(this._draw);
    const c = this._canvas;
    const g = c.getContext("2d");
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#3ddc84";
    g.lineWidth = 2;

    const mode = this.getAttribute("mode") === "fft" ? "fft" : "wave";
    // One pull per frame — a fresh array every time, so nothing is retained.
    const data = this._analyser()?.sample(mode) ?? null;

    if (!data) {
      g.beginPath();
      g.moveTo(0, c.height / 2);
      g.lineTo(c.width, c.height / 2);
      g.stroke();
      return;
    }

    if (mode === "fft") {
      const bars = 64;
      const step = Math.floor(data.length / bars);
      const bw = c.width / bars;
      g.fillStyle = "#3ddc84";
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        g.fillRect(i * bw + 1, c.height * (1 - v), bw - 2, c.height * v);
      }
      return;
    }

    g.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * c.width;
      const y = (data[i] / 255) * c.height;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  };
}

if (!customElements.get("demo-keys")) customElements.define("demo-keys", DemoKeys);
if (!customElements.get("demo-scope")) customElements.define("demo-scope", DemoScope);
