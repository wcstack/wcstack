
export default class extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    this.innerHTML = `<h1>Multi Lazy "main" Loaded Component</h1><button id="loadSub">Load Sub Component</button>`;
    this.querySelector("#loadSub").addEventListener("click", () => {
      const subElement = document.createElement("app-sub");
      this.appendChild(subElement);
    });
  }
}