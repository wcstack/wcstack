// <hr-avatar name="田中 花子"> — the user's initials in a circle. Loaded by @wcstack/autoloader
// ("@components/hr/" → /components/, <hr-avatar> → avatar.js). Decorative: the name is next to it in text.
const initials = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (/^[A-Za-z]/.test(words[0])) return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return [...words[0]][0];
};
// A stable hue per name, so each person keeps their colour.
const hue = (name) => [...String(name ?? "")].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);

export default class HrAvatar extends HTMLElement {
  static observedAttributes = ["name"];
  #span;
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: inline-grid; place-items: center; inline-size: 2.2em; block-size: 2.2em; border-radius: 50%;
              background: hsl(var(--hue, 210) 55% 42%); color: #fff; font-weight: 700; font-size: 0.95em; flex: none; }
    </style><span part="initials"></span>`;
    this.#span = root.querySelector("span");
  }
  connectedCallback() { this.#render(); }
  attributeChangedCallback() { this.#render(); }
  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", v ?? ""); }
  #render() {
    const name = this.name;
    this.#span.textContent = initials(name);
    this.style.setProperty("--hue", String(hue(name)));
  }
}
