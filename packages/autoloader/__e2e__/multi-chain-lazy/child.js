
export default class extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<h1>Multi Lazy "child" Loaded Component</h1><app-grandchild></app-grandchild>`;
  }
}