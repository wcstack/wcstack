
export default class extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<h1>Multi Lazy "parent" Loaded Component</h1><app-child></app-child>`;
  }
}