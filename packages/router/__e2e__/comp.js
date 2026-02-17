
export class Comp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <p>Hello from Comp component!</p>
      <slot name="default">default</slot>
    `;
  }
  
}

customElements.define('my-comp', Comp);