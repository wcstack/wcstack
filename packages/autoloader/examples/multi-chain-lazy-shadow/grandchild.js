
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<h1>Multi Lazy "grandchild" Loaded Component</h1>`;
  }
}