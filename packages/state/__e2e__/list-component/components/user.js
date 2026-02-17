
class User extends HTMLElement {
  // bind-component="state" で親の users.* が注入されるため、
  // 初期状態はフローズンな空オブジェクトでも問題ない。
  // なお、ここに path getter を定義すると状態に組み込まれて評価される。
  // 例:
  // state = Object.freeze({
  //   get "user.title"() {
  //     return this["user.name"] + " (Age: " + this["user.age"] + ")";
  //   }
  // });
  state = Object.freeze({
     get "user.title"() {
       return this["user.name"] + " (Age: " + this["user.age"] + ")";
     }
  });
  constructor() {
    super();
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state bind-component="state"></wcs-state>
<div>
  <input type="text" data-wcs="value: user.name">
  <input type="number" data-wcs="valueAsNumber: user.age">
  <div>{{ user.title }}</div>

</div>
    `;
  }
}

customElements.define('my-user', User);
       
