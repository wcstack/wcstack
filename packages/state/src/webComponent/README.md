## Shadow DOM コンポーネント

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

## Light DOM コンポーネント

ShadowRootを持たないLight DOMコンポーネントでも`bind-component`が使用可能。
Light DOMの場合、名前空間が上位スコープと共有されるため`name`属性が必須。

<template data-wcs="for: users">
  <my-light-user data-wcs="state.user: .">
</template>

<script>
class MyLightUser extends HTMLElement {
  state = {
    user: { name:'', age: -1 }
  }
  connectedCallback() {
    this.innerHTML = `
<wcs-state bind-component='state' name='light-user'></wcs-state>
<div>
  <input type="text" data-wcs="value: user.name">
  <input type="number" data-wcs="value: user.age">
</div>
    `;
  }
}
</script>
