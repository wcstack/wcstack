
<!-- 初期データ -->
<script type="application/json" id="state">
{
  "count": 0,
  "users": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" },
    { "id": 3, "name": "Charlie" }
  ]
}
</script>

<!-- 宣言と初期化方法の指定 -->
<wcs-state state="state"></wcs-state>
<wcs-state json="{ count: 0 }"></wcs-state>
<wcs-state src="./data.json"></wcs-state>
<wcs-state src="./data.js"></wcs-state>
<wcs-state>
  <script type="module">
    export default {
      "count": 0,
      "users": [
        { "id": 1, "name": "Alice" },
        { "id": 2, "name": "Bob" },
        { "id": 3, "name": "Charlie" }
      ],
      get "users.*.displayName"() {
        return this["users.*.name"] + ' (ID: ' + this["users.*.id"] + ')';
      }
    };
  </script>
</wcs-state>
<script>
  const stateElement = document.createElement('wcs-state');
  stateElement.state = { message: 'Hello, World!' };
  document.body.appendChild(stateElement);
</script>

<!-- データバインディング -->
<input type="text" name="count" data-bind-state="value: count">
<!--@@:count--><!-- 埋込表示 -->

<template data-bind-state="for: users">
  <div>
    <!-- users.*.idはあえてフルパス、状態管理のパスを一意に特定したい -->
    <span data-bind-state="text: users.*.id"></span>:
    <span data-bind-state="text: users.*.displayName"></span>
  </div>
</template>

<template data-bind-state="if: count|gt,0">
  <p>The count is positive.</p>
</template>
<template data-bind-state="else:">
    <p>The count is zero or negative.</p>
</template>

### data-bind-state属性構文

[property][#modifier]: [path][@state][|(filter | filter(args))...]

property  : DOM属性 (value, checked, text, html, class, style.*, attr.*)
modifier  : ro (read-only), wo (write-only)
path      : 状態パス (users.*.name)
state     : 名前つき状態 (@cart, @user)
filter    : 変換フィルタ (|round|currency(JPY))

// value#ro: count@cart|gt(0)|currency(JPY)
// $1 = "value"      (プロパティ)
// $2 = "#ro"        (修飾子)
// $3 = "count"      (パス)
// $4 = "@cart"      (状態名)
// $5 = "|round|currencyJPY" (フィルタチェーン)

input[type=radio,checkbox].checked
input[type上記以外].value
select.value
textarea.value
は双方向