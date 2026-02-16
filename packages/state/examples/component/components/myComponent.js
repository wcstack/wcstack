
class MyComponent extends HTMLElement {
  state = Object.freeze({});
  constructor() {
    super();
  }
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state bind-component="state">
</wcs-state>
<div style="background-color: lightgray; padding: 4px; margin: 4px;">
  <div>{{ message }}</div>
  <input type="text" data-wcs="value: message" />
</div>
`;
  }
} 

customElements.define('my-component', MyComponent);
