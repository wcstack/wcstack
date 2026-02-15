
<template data-wcs="for: users">
  <my-user data-wcs="state.user: .">
</template>

<script>
class MyUser extends HTMLElement {
  state = {
    user: { name:'', age: -1 }
  }
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `
<wcs-state bind-component='state'></wcs-state>
<div>
  <input type="text" data-wcs="value: user.name">
  <input type="number" data-wcs="value: user.age">
</div>
    `;
  }
}
</script>

state.userの参照
state.userの変更