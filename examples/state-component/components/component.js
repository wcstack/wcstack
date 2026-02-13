
export default class extends HTMLElement {
  state = {
    message: ""
  }

  constructor() {
    super();
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
