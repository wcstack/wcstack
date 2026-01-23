
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <h1>Hello, World!</h1>
      <p>This is a simple web component.</p>
    `;
  }
}
