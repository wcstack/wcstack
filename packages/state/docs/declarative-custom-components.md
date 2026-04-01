
構文はこんな感じ

```html

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Declarative Custom Components</title>
  <script type="module" src="../../dist/auto.js"></script>
  <style>
:not(:defined) {
  display: none;
}
[data-wc-definition] {
  display: none;
}
  </style>
</head>
<body>
  <!-- コンポーネント定義、非表示 -->
  <my-component data-wc-definition>
    <template shadowrootmode="open">
      <p>This is a declarative shadow DOM example.</p>
      <p>{{ count }}</p>
      <button data-wcs="onclick: inc">inc</button>
      <wcs-state auto-define>
        <script type="module">
export default {
  count: 0,
  inc() { this.count++ }
};          
        </script>
      </wcs-state>
    </template>
  </my-component>

  <!-- コンポーネント実体 -->
  <my-component></my-component>

</body>
</html>  

```

```js
// getter/setterの断片

function getterFn(name) {
  return function () {
    let value;
    this.stateElement.createState("readonly", (state) => {
      value = state[name];
    });
    return value;
  }
}

function setterFn(name) {
  return function (value) {
    this.stateElement.createState("writable", (state) => {
      state[name] = value;
    });
  }
}

// 非同期は要検討
function callFn(name) {
  return function (...args) {
    if (typeof state[name] === "asyncfunction") {
      this.stateElement.createStateAsync("writable", async (state) => {
        await state[name](...args);
      });
    } else if (typeof state[name] === "function") {
      this.stateElement.createState("writable", (state) => {
        state[name](...args);
      });
    }
  }
}


```

DCC定義判定の断片

```js:State.ts

class {
  connectedCallback() {
    // DCC定義判定
    const parentElement = this.parentNode;
    const isParentShadowRoot = (parentElement instanceof ShadowRoot);
    const hasDefinition = 
      isParentShadowRoot ? parentElement.host.hasAttribute("data-wc-definition") : false;
    const hasAutoDefine = this.hasAttribut("auto-define");
    if (isParentShadowRoot && hasDefinition && hasAutoDefine) {
      // DCC定義
      // 以降処理は行わない
      return;
    }
  }
}
```

DCCクラス例

```js

const fragment = document.createDocumentFragment();
fragment.innerHTML = html;
class extends HTMlElement {
  static fragment = fragment;
  static shadowRootMode = shadowRootMode;
  constructor() {
    super();
  }
  connectedCallback() {
    if (this.hasAttribute("data-wc-definition")) return;
    this.attachShadow({ mode: this.constructor.shadowRootMode });
    this.shadowRoot.innerHTML = this.constructor.fragment.cloneNode(true);
  }
  get stateElement() {
    const stateElement = this.shadowRoot.querySelector("wcs-state:not([name])");
    return stateElement;
  }
}

```

DCCクラスにgetter/setterを生やす

```js
const dccClass = class {...}; 
const descriptors = Object.getOwnPropertyDescriptors(object);
for(const [name, desc] of Objec.entries(descriptors)) {
  const newDesc = { configurable: true, enumrable: true };
  if (typeof desc.value === "function") {
    newDesc.value = callFn(name);
  } else {
    newDesc.get = getterFn(name);
    newDesc.set = setterFn(name);
  }
  Object.defineProperty(dccClass.prototype, name, newDesc);
}
```
