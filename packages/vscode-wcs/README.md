# WcStack IntelliSense

[@wcstack/state](https://github.com/wcstack/wcstack) 用の VSCode 拡張。HTML 内の `<wcs-state>` インラインスクリプトと `data-wcs` 属性にTypeScript 言語機能を提供します。

## Features

### Inline Script Type Support

`<wcs-state>` 内の `<script type="module">` で TypeScript の型補完が動作します。`import` や `defineState()` の記述は不要です。

```html
<wcs-state>
  <script type="module">
export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],

  increment() {
    this.count++;              // number
    this["users.*.name"];      // string
    this["users.*.age"];       // number
    this.$getAll("path", []);  // WcsStateApi
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
};
  </script>
</wcs-state>
```

### Attribute Binding Completions

`data-wcs` 属性値でプロパティ名、状態パス、フィルタ名の補完候補が表示されます。

- `data-wcs="` → `textContent`, `class.`, `style.`, `onclick`, `for`, `if` ...
- `data-wcs="textContent: ` → `count`, `users`, `users.*.name` ...
- `data-wcs="textContent: count|` → `gt`, `eq`, `uc`, `trim` ...
- `data-wcs="onclick#` → `prevent`, `stop`

### Binding Diagnostics

`data-wcs` 式のリアルタイム検証:

| チェック | 例 | 診断 |
|---|---|---|
| 存在しないパス | `textContent: typo` | ⚠ warning |
| 存在しないフィルタ | `textContent: count\|fake` | ⚠ warning |
| `for:` に非配列 | `for: count` | ❌ error |
| `if:` に非 boolean | `if: count` | ⚠ warning |
| `class.` に非 boolean | `class.active: count` | ⚠ warning |
| `attr.`/`style.` に非 string | `attr.href: count` | ⚠ warning |
| フィルタ入力型不一致 | `count\|uc` (number→string filter) | ⚠ warning |
| フィルタ引数不足 | `count\|mul` | ❌ error |
| フィルタ引数型不一致 | `count\|gt(abc)` | ⚠ warning |
| イベント+フィルタ | `onclick: fn\|gt(10)` | ⚠ warning |

フィルタチェーンの型追跡により、`if: count|gt(0)` (number→boolean) は正しく OK と判定されます。

### JSDoc Type Validation

`@type` アノテーションと初期値の整合性を検証:

```javascript
/** @type {string} */
label: null,        // ⚠ 型 "null" は @type {string} と互換性がありません

/** @type {string|null} */
label: null,        // ✅ OK
```

## Settings

| 設定 | デフォルト | 説明 |
|---|---|---|
| `wcstack.bindAttributeName` | `"data-wcs"` | バインド属性名 |

## Requirements

- VSCode 1.95+
- HTML ファイル内に `<wcs-state>` 要素があること

## License

MIT
