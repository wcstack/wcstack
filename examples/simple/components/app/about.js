
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <h1>About Page</h1>
      <p>This is the about page of the simple web component example.</p>
    `;
  }
}