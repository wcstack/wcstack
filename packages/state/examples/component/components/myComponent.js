
class MyComponent extends HTMLElement {
  outer = {
    message: ""
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state bind-component="outer">
</wcs-state>
<div style="background-color: lightgray; padding: 4px; margin: 4px;">
  <div>{{ message }}</div>
  <input type="text" data-bind-state="value: message" />
</div>
    `;
  }

} 

customElements.define('my-component', MyComponent);
