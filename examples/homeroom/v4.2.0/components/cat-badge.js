// <hr-cat-badge cat="event">行事</hr-cat-badge> — the category badge. Loaded by @wcstack/autoloader
// (<hr-cat-badge> → cat-badge.js). The label is the element's own text (bound from state), so the badge reads
// correctly before this script arrives; the component only adds the colours.
const COLORS = {
  event: ["#fde7c8", "#7a3e00"],
  homework: ["#d9ecff", "#0b4a8a"],
  health: ["#d8f3e3", "#0f5b32"],
  general: ["#ececf2", "#3a3a4f"],
};

export default class HrCatBadge extends HTMLElement {
  static observedAttributes = ["cat"];
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<style>
      :host { display: inline-block; padding: 0.1em 0.65em; border-radius: 999px; font-size: 0.85em; font-weight: 600;
              background: var(--bg, #ececf2); color: var(--fg, #3a3a4f); white-space: nowrap; }
    </style><slot></slot>`;
  }
  connectedCallback() { this.#render(); }
  attributeChangedCallback() { this.#render(); }
  #render() {
    const [bg, fg] = COLORS[this.getAttribute("cat")] ?? COLORS.general;
    this.style.setProperty("--bg", bg);
    this.style.setProperty("--fg", fg);
  }
}
