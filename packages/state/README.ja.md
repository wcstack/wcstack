# @wcstack/state

Web Components のための宣言的リアクティブ状態管理。  
`<wcs-state>` カスタム要素と `data-wcs` 属性バインディング — ランタイム依存ゼロ。

## 特徴

- **宣言的データバインディング** — `data-wcs` 属性によるプロパティ / テキスト / イベント / 構造バインディング
- **リアクティブ Proxy** — ES Proxy による依存追跡付き自動 DOM 更新
- **構造ディレクティブ** — `<template>` 要素による `for`, `if` / `elseif` / `else`
- **組み込みフィルタ** — フォーマット、比較、算術、日付など 37 種類
- **双方向バインディング** — `<input>`, `<select>`, `<textarea>` で自動有効
- **Web Component バインディング** — Shadow DOM コンポーネントとの双方向状態バインディング
- **算出プロパティ** — getter ベースの派生値と自動キャッシュ無効化
- **Mustache 構文** — テキストノードでの `{{ path|filter }}`
- **複数の状態ソース** — JSON, JS モジュール, インラインスクリプト, API, 属性
- **SVG サポート** — `<svg>` 要素内でのフルバインディング対応
- **依存ゼロ** — ランタイム依存なし

## インストール

### CDN（推奨）

```html
<!-- 自動初期化 — これだけで動作します -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state/dist/auto.js"></script>
```

### CDN（手動初期化）

```html
<script type="module">
  import { bootstrapState } from 'https://cdn.jsdelivr.net/npm/@wcstack/state/dist/index.esm.js';
  bootstrapState();
</script>
```

## 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      user: { id: 1, name: "Alice" },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ],
      countUp() { this.count += 1; },
      clearCount() { this.count = 0; },
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<!-- テキストバインディング -->
<div data-wcs="textContent: count"></div>
{{ count }}

<!-- 双方向入力バインディング -->
<input type="text" data-wcs="value: user.name">

<!-- イベントバインディング -->
<button data-wcs="onclick: countUp">Increment</button>

<!-- 条件付きクラス -->
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>

<!-- ループ -->
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: .id"></span>:
    <span data-wcs="textContent: .displayName"></span>
  </div>
</template>

<!-- 条件分岐レンダリング -->
<template data-wcs="if: count|gt(0)">
  <p>カウントは正の値です。</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>カウントは負の値です。</p>
</template>
<template data-wcs="else:">
  <p>カウントはゼロです。</p>
</template>
```

## 状態の初期化

`<wcs-state>` は複数の方法で初期状態を読み込めます：

```html
<!-- 1. <script type="application/json"> を id で参照 -->
<script type="application/json" id="state">
  { "count": 0 }
</script>
<wcs-state state="state"></wcs-state>

<!-- 2. インライン JSON 属性 -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. 外部 JSON ファイル -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. 外部 JS モジュール (export default { ... }) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. インラインスクリプトモジュール -->
<wcs-state>
  <script type="module">
    export default { count: 0 };
  </script>
</wcs-state>

<!-- 6. プログラム API -->
<script>
  const el = document.createElement('wcs-state');
  el.setInitialState({ count: 0 });
  document.body.appendChild(el);
</script>
```

解決順序: `state` → `src` (.json / .js) → `json` → 内包 `<script>` → `setInitialState()` 待機。

### 名前付き状態

複数の状態要素を `name` 属性で共存できます。バインディングでは `@name` で参照します：

```html
<wcs-state name="cart">...</wcs-state>
<wcs-state name="user">...</wcs-state>

<div data-wcs="textContent: total@cart"></div>
<div data-wcs="textContent: name@user"></div>
```

デフォルト名は `"default"`（`@` 不要）です。

## バインディング構文

### `data-wcs` 属性

```
property[#modifier]: path[@state][|filter[|filter(args)...]]
```

複数バインディングは `;` で区切ります：

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

| 要素 | 説明 | 例 |
|---|---|---|
| `property` | バインドする DOM プロパティ | `value`, `textContent`, `checked` |
| `#modifier` | バインディング修飾子 | `#ro`, `#prevent`, `#stop`, `#onchange` |
| `path` | 状態プロパティパス | `count`, `user.name`, `users.*.name` |
| `@state` | 名前付き状態の参照 | `@cart`, `@user` |
| `\|filter` | 変換フィルタチェーン | `\|gt(0)`, `\|round\|locale` |

### プロパティ種別

| プロパティ | 説明 |
|---|---|
| `value` | 要素の値（input では双方向） |
| `checked` | チェックボックス / ラジオボタンの選択状態（双方向） |
| `textContent` | テキストコンテンツ |
| `text` | textContent のエイリアス |
| `html` | innerHTML |
| `class.NAME` | CSS クラスの切り替え |
| `style.PROP` | CSS スタイルプロパティの設定 |
| `attr.NAME` | 属性の設定（SVG 名前空間対応） |
| `onclick`, `on*` | イベントハンドラバインディング |

### 修飾子

| 修飾子 | 説明 |
|---|---|
| `#ro` | 読み取り専用 — 双方向バインディングを無効化 |
| `#prevent` | イベントハンドラで `event.preventDefault()` を呼び出す |
| `#stop` | イベントハンドラで `event.stopPropagation()` を呼び出す |
| `#onchange` | 双方向バインディングで `input` の代わりに `change` イベントを使用 |

### 双方向バインディング

以下の要素で自動的に有効化されます：

| 要素 | プロパティ | イベント |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>`（その他の type） | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` は除外されます。`#ro` で無効化、`#onchange` でイベントを変更できます。

### Mustache 構文

`enableMustache` が `true`（デフォルト）の場合、テキストノードで `{{ expression }}` が使用できます：

```html
<p>こんにちは、{{ user.name }}さん！</p>
<p>カウント: {{ count|locale }}</p>
```

内部的にはコメントベースのバインディング（`<!--@@:expression-->`）に変換されます。

## 構造ディレクティブ

構造ディレクティブは `<template>` 要素で使用します：

### ループ (`for`)

```html
<template data-wcs="for: users">
  <div>
    <!-- フルパス -->
    <span data-wcs="textContent: users.*.name"></span>
    <!-- 省略形（ループコンテキストからの相対パス） -->
    <span data-wcs="textContent: .name"></span>
  </div>
</template>
```

多重ワイルドカードによるネストループに対応しています：

```html
<template data-wcs="for: regions">
  <template data-wcs="for: .states">
    <span data-wcs="textContent: .name"></span>
  </template>
</template>
```

### 条件分岐 (`if` / `elseif` / `else`)

```html
<template data-wcs="if: count|gt(0)">
  <p>正の値</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>負の値</p>
</template>
<template data-wcs="else:">
  <p>ゼロ</p>
</template>
```

条件をチェーンできます。`elseif` は前の条件を自動的に反転します。

## 算出プロパティ（Getter）

JavaScript の getter とドットパスキーで算出プロパティを定義します：

```html
<wcs-state>
  <script type="module">
    export default {
      price: 100,
      tax: 0.1,
      get total() {
        return this.price * (1 + this.tax);
      },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" }
      ],
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>
```

- getter は自動的に追跡・キャッシュされます
- 依存先が変更されるとキャッシュが無効化（dirty）され、次回アクセス時に再計算されます
- ワイルドカード getter（`users.*.displayName`）はループ内で動作します

### Proxy API

状態オブジェクト内（getter / メソッド）で `this` 経由で以下の API が利用できます：

| API | 説明 |
|---|---|
| `this.$getAll(path, indexes?)` | ワイルドカードパスにマッチする全ての値を取得 |
| `this.$resolve(path, indexes, value?)` | ワイルドカードパスを特定のインデックスで解決 |
| `this.$postUpdate(path)` | 指定パスの更新通知を手動で発行 |
| `this.$trackDependency(path)` | キャッシュ無効化のための依存関係を手動で登録 |
| `this.$stateElement` | `IStateElement` インスタンスへのアクセス |
| `this.$1`, `this.$2`, ... | 現在のループインデックス（1始まりの命名、0始まりの値） |

## イベントハンドリング

`on*` プロパティでイベントハンドラをバインドします：

```html
<button data-wcs="onclick: handleClick">クリック</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

ハンドラメソッドはイベントとループインデックスを受け取ります：

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) {
    console.log("clicked");
  },
  removeItem(event, index) {
    // index はループコンテキスト ($1)
    this.items.splice(index, 1);
  }
};
```

```html
<template data-wcs="for: items">
  <button data-wcs="onclick: removeItem">削除</button>
</template>
```

## フィルタ

37 種類の組み込みフィルタが入力（DOM → 状態）と出力（状態 → DOM）の両方向で利用できます。

### 比較

| フィルタ | 説明 | 例 |
|---|---|---|
| `eq(value)` | 等しい | `count\|eq(0)` → `true/false` |
| `ne(value)` | 等しくない | `count\|ne(0)` |
| `not` | 論理否定 | `isActive\|not` |
| `lt(n)` | より小さい | `count\|lt(10)` |
| `le(n)` | 以下 | `count\|le(10)` |
| `gt(n)` | より大きい | `count\|gt(0)` |
| `ge(n)` | 以上 | `count\|ge(0)` |

### 算術

| フィルタ | 説明 | 例 |
|---|---|---|
| `inc(n)` | 加算 | `count\|inc(1)` |
| `dec(n)` | 減算 | `count\|dec(1)` |
| `mul(n)` | 乗算 | `price\|mul(1.1)` |
| `div(n)` | 除算 | `total\|div(100)` |
| `mod(n)` | 剰余 | `index\|mod(2)` |

### 数値フォーマット

| フィルタ | 説明 | 例 |
|---|---|---|
| `fix(n)` | 固定小数点桁数 | `price\|fix(2)` → `"100.00"` |
| `round(n?)` | 四捨五入 | `value\|round(2)` |
| `floor(n?)` | 切り捨て | `value\|floor` |
| `ceil(n?)` | 切り上げ | `value\|ceil` |
| `locale(loc?)` | ロケール数値フォーマット | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | パーセンテージフォーマット | `ratio\|percent(1)` |

### 文字列

| フィルタ | 説明 | 例 |
|---|---|---|
| `uc` | 大文字変換 | `name\|uc` |
| `lc` | 小文字変換 | `name\|lc` |
| `cap` | 先頭大文字 | `name\|cap` |
| `trim` | 空白除去 | `text\|trim` |
| `slice(n)` | 文字列スライス | `text\|slice(5)` |
| `substr(start, length)` | 部分文字列 | `text\|substr(0,10)` |
| `pad(n, char?)` | 先頭パディング | `id\|pad(5,0)` → `"00001"` |
| `rep(n)` | 繰り返し | `text\|rep(3)` |
| `rev` | 反転 | `text\|rev` |

### 型変換

| フィルタ | 説明 | 例 |
|---|---|---|
| `int` | 整数パース | `input\|int` |
| `float` | 浮動小数点パース | `input\|float` |
| `boolean` | 真偽値に変換 | `value\|boolean` |
| `number` | 数値に変換 | `value\|number` |
| `string` | 文字列に変換 | `value\|string` |
| `null` | null に変換 | `value\|null` |

### 日付 / 時刻

| フィルタ | 説明 | 例 |
|---|---|---|
| `date(loc?)` | 日付フォーマット | `timestamp\|date` / `timestamp\|date(ja-JP)` |
| `time(loc?)` | 時刻フォーマット | `timestamp\|time` |
| `datetime(loc?)` | 日付 + 時刻 | `timestamp\|datetime(en-US)` |
| `ymd(sep?)` | YYYY-MM-DD | `timestamp\|ymd` / `timestamp\|ymd(/)` |

### 真偽値 / デフォルト

| フィルタ | 説明 | 例 |
|---|---|---|
| `truthy` | truthy チェック | `value\|truthy` |
| `falsy` | falsy チェック | `value\|falsy` |
| `defaults(v)` | フォールバック値 | `name\|defaults(Anonymous)` |

### フィルタチェーン

フィルタは `|` で連結できます：

```html
<div data-wcs="textContent: price|mul(1.1)|round(2)|locale(ja-JP)"></div>
```

## Web Component バインディング

`@wcstack/state` は Shadow DOM を使用したカスタム要素との双方向状態バインディングに対応しています。

### コンポーネント定義

```javascript
class MyComponent extends HTMLElement {
  state = { message: "" };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-component", MyComponent);
```

### ホスト側の使用方法

```html
<wcs-state>
  <script type="module">
    export default {
      user: { name: "Alice" }
    };
  </script>
</wcs-state>

<!-- コンポーネントの state.message を外側の user.name にバインド -->
<my-component data-wcs="state.message: user.name"></my-component>
```

- `bind-component="state"` で Shadow DOM 内のコンポーネントの `state` プロパティを `<wcs-state>` にマッピング
- `data-wcs="state.message: user.name"` でホスト要素上の外部状態パスを内部コンポーネント状態プロパティにバインド
- 変更はコンポーネントと外部状態間で双方向に伝播

### ループ内でのコンポーネント使用

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>
```

## SVG サポート

全てのバインディングが `<svg>` 要素内で動作します。SVG 属性には `attr.*` を使用します：

```html
<svg width="200" height="100">
  <template data-wcs="for: points">
    <circle data-wcs="attr.cx: .x; attr.cy: .y; attr.fill: .color" r="5" />
  </template>
</svg>
```

## 設定

```javascript
import { config } from '@wcstack/state';

// 全オプションとデフォルト値:
config.bindAttributeName = 'data-wcs';          // バインディング属性名
config.bindComponentAttributeName = 'bind-component'; // コンポーネントバインディング属性
config.tagNames.state = 'wcs-state';            // 状態要素のタグ名
config.locale = 'en';                           // フィルタのデフォルトロケール
config.debug = false;                           // デバッグモード
config.enableMustache = true;                   // {{ }} 構文の有効化
```

## API リファレンス

### `bootstrapState()`

状態システムを初期化します。`<wcs-state>` カスタム要素を登録し、DOM コンテンツ読み込みハンドラを設定します。

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState();
```

### `<wcs-state>` 要素

| 属性 | 説明 |
|---|---|
| `name` | 状態名（デフォルト: `"default"`） |
| `state` | `<script type="application/json">` 要素の ID |
| `src` | `.json` または `.js` ファイルの URL |
| `json` | インライン JSON 文字列 |
| `bind-component` | Web Component バインディングのプロパティ名 |

### IStateElement

| プロパティ / メソッド | 説明 |
|---|---|
| `name` | 状態名 |
| `initializePromise` | 状態の完全な初期化時に解決される Promise |
| `listPaths` | `for` ループで使用されるパスの Set |
| `getterPaths` | getter として定義されたパスの Set |
| `setterPaths` | setter として定義されたパスの Set |
| `createState(mutability, callback)` | 状態プロキシを作成（`"readonly"` または `"writable"`） |
| `createStateAsync(mutability, callback)` | `createState` の非同期版 |
| `setInitialState(state)` | プログラムから状態を設定（初期化前） |
| `bindProperty(prop, descriptor)` | 生の状態オブジェクトにプロパティを定義 |
| `nextVersion()` | バージョン番号をインクリメントして返す |

## アーキテクチャ

```
bootstrapState()
  ├── registerComponents()    // <wcs-state> カスタム要素を登録
  └── registerHandler()       // DOMContentLoaded ハンドラ
        ├── waitForStateInitialize()    // 全 <wcs-state> の読み込み待機
        ├── convertMustacheToComments() // {{ }} → コメントノードに変換
        ├── collectStructuralFragments() // for/if テンプレートを収集
        └── initializeBindings()        // DOM 走査、data-wcs 解析、バインディング設定
```

### リアクティビティフロー

1. Proxy の `set` トラップによる状態変更 → `setByAddress()`
2. アドレス解決 → updater が絶対アドレスをキューに登録
3. 依存関係ウォーカーが下流のキャッシュを無効化（dirty）
4. updater が `applyChangeFromBindings()` によりバインド済み DOM ノードに変更を適用

### 状態アドレスシステム

`users.*.name` のようなパスは以下に分解されます：

- **PathInfo** — 静的パスメタデータ（セグメント、ワイルドカード数、親パス）
- **ListIndex** — ランタイムループインデックスチェーン
- **StateAddress** — PathInfo + ListIndex の組み合わせ
- **AbsoluteStateAddress** — 状態名 + StateAddress（クロス状態参照用）

## ライセンス

MIT
