
export default class extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    this.innerHTML = `<h1>Multi Lazy "sub" Loaded Component</h1>`;
  }
}