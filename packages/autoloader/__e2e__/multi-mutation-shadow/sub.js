
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `<h1>Multi Lazy "sub" Loaded Component</h1>`;
  }
}