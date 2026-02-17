
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `<h1>Multi Lazy "main" Loaded Component</h1><button id="loadSub">Load Sub Component</button>`;
    this.shadowRoot.querySelector("#loadSub").addEventListener("click", () => {
      const subElement = document.createElement("app-sub");
      this.shadowRoot.appendChild(subElement);
    });
  }
}