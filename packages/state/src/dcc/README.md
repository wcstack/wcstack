
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
      <wcs-state>
        <script type="module">
export default {
  count: 0,
  inc() { this.count++ },
  $bindables: ["count"]
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
    let func;
    this.stateElement.createState("readonly", (state) => {
      func = state[name];
    })
    if (typeof func !== "function") return;
    if (typeof func.constructor.name === "AsyncFunction") {
      this.stateElement.createStateAsync("writable", async (state) => {
        await state[name](...args);
      });
    } else {
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
    if (isParentShadowRoot && hasDefinition) {
      // DCC定義
      // 以降処理は行わない
      return;
    }
  }
}
```

DCCクラス例

```js

// stateElement内
const fragment = document.createDocumentFragment();
fragment.appendChild(parentElement.shadowRoot.cloneNode(true));
class extends HTMLElement {
  static fragment = fragment;
  static shadowRootMode = shadowRootMode;
  constructor() {
    super();
  }
  connectedCallback() {
    if (this.hasAttribute("data-wc-definition")) return;
    this.attachShadow({ mode: this.constructor.shadowRootMode });
    this.shadowRoot.appendChild(this.constructor.fragment.cloneNode(true));
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
const descriptors = Object.getOwnPropertyDescriptors(stateObj);
for(const [name, desc] of Object.entries(descriptors)) {
  const newDesc = { configurable: true, enumerable: true };
  if (typeof desc.value === "function") {
    newDesc.value = callFn(name);
  } else {
    newDesc.get = getterFn(name);
    newDesc.set = setterFn(name);
  }
  Object.defineProperty(dccClass.prototype, name, newDesc);
}
```

wcBindableの生成

```js
const tagName = component.tagName.toLowerCase();
const bindables = stateObj["$bindables"] ?? [];
const wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: []
};
for(const propName of bindables) {
  const prop = {
    name: propName,
    event: `${tagName}:${propName}-changed`
  }
  wcBindable.properties.push(prop);
}
return wcBindable;
```

wcBindableのカスタムイベントマップ、bindableEventMap
stateElementが持つ

```js
const bindableEventMap = {};
for(const propName of bindables) {
  bindableEventMap[propName] = `${tagName}:${propName}-changed`;
}
return bindableEventMap;
```

CustomEvent

```js
function _setByAddress(
  target   : object, 
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
): any {
  try {

  } finally {
    if (address.pathInfo.path in handler.stateElement.bindableEventMap) {
      const eventName = handler.stateElement.bindableEventMap[address.pathInfo.path];
      handler.stateElement.dispatchEvent(new CustomEvent(eventName, {
        detail: value,
        bubbles: true,
      }));
    }
  }
