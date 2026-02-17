
export default class extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<h1>Single Eager Loaded Component</h1>`;
  }
}