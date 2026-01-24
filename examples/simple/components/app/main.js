
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <h1>Welcome to wcstack</h1>
      <p>wcstack is a lightweight Web Components stack that helps you build small, fast, and dependency-light SPAs.</p>
      <p>It pairs an autoloader that discovers custom elements on demand with a minimal router designed for nested layouts and dynamic routes.</p>
      <p>This demo shows how routes, layouts, and components compose together without a framework lock-in.</p>
    `;
  }
}
