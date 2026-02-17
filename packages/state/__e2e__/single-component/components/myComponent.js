
class MyComponent extends HTMLElement {
  // 状態は、Object.freezeで凍結されたオブジェクトで定義する必要があります。
  // コンポーネントが有効になると、凍結が解除された状態に置き換えられ、状態のプロパティは書き換え可能になります。
  state = Object.freeze({
    message: "Hello, World!",
  });
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `
<wcs-state bind-component="state"></wcs-state>
<div>{{ message }}</div>
    `;
  }
}

customElements.define('my-component', MyComponent);
