
let id= 0;
class MyComponent extends HTMLElement {
  id = id++;
  get myName() {
    return "my_" + this.id;
  }

  outer = {
    message: ""
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state name='${this.myName}' bind-component="outer">
</wcs-state>
<div style="background-color: lightgray; padding: 4px; margin: 4px;">
  <div>{{ message@${this.myName} }}</div>
  <input type="text" data-bind-state="value: message@${this.myName}" />
</div>
    `;
  }

} 

customElements.define('my-component', MyComponent);
