
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <h1>About wcstack</h1>
      <p>wcstack is a minimal Web Components stack designed for composition-first UI development, featuring an autoloader and a lightweight router.</p>
    `;
  }
}