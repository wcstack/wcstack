
class User extends HTMLElement {
  state = {
    user : {
      name: "",
      age: 0,
    }
  }


  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>
        <input type="text" data-wcs="value: user.name">
        <input type="number" data-wcs="value#change: user.age">
      </div>
    `;
  }
}

customElements.define('my-user', User);
       
