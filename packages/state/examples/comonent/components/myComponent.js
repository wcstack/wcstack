class MyComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
    <wcs-state name='my'>
    <script type="module">
export default {
  message: ""
};
    </script>
    </wcs-state>
    <p>{{ message@my }}</p>
    <input type="text" data-bind-state="value: message@my" />
    `;
  }

  async connectedCallback() {
    customElements.whenDefined('wcs-state').then(async () => {
      const innerStateElement = this.shadowRoot.querySelector('wcs-state');
      await innerStateElement.bindWebComponent(this);
    });
  }

} 

customElements.define('my-component', MyComponent);
