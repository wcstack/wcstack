
let id= 0;
class MyComponent extends HTMLElement {
  id = id++;
  outer = {
    message: ""
  }
  get myName() {
    return "my_" + this.id;
  }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state name='${this.myName}'>
  <script type="module">
export default {
  message: ""
};
  </script>
</wcs-state>
<div style="background-color: lightgray; padding: 4px; margin: 4px;">
  <div>{{ message@${this.myName} }}</div>
  <input type="text" data-bind-state="value: message@${this.myName}" />
</div>
    `;
  }

  async connectedCallback() {
    const innerStateElement = this.shadowRoot.querySelector(`wcs-state[name="${this.myName}"]`);
    await customElements.whenDefined('wcs-state');
    await innerStateElement.bindWebComponent(this);
  }

} 

customElements.define('my-component', MyComponent);
