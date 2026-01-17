
export default class extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<h1>Multi Lazy "grandchild" Loaded Component</h1>`;
  }
}