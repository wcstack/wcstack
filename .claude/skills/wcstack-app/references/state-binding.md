# @wcstack/state リファレンス

出典: `packages/state/README.ja.md`（正本）・`packages/state/examples/*`・`packages/fetch/examples/users-crud`・`src/filters/builtinFilters.ts`・`src/bindTextParser/*`。すべて実コード確認済み。

## 1. CDN 読み込み

```html
<!-- 自動初期化（examples 全実物で使用されている一行） -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

```html
<!-- 手動初期化 -->
<script type="module">
  import { bootstrapState } from 'https://esm.run/@wcstack/state';
  bootstrapState();
</script>
```

## 2. `<wcs-state>` 状態定義（6方式）

解決順序: `state` 属性 → `src`(.json/.js) → `json` 属性 → 内包 `<script>` → `setInitialState()` 待機。

```html
<!-- 1. <script type="application/json"> を id で参照 -->
<script type="application/json" id="state">{ "count": 0 }</script>
<wcs-state state="state"></wcs-state>

<!-- 2. インライン JSON 属性 -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. 外部 JSON -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. 外部 JS モジュール (export default {...}) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. インラインスクリプト（最頻出。type="module" で export default） -->
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

`<wcs-state>` の属性: `name`(状態名、デフォルト `"default"`) / `state` / `src` / `json` / `bind-component`(Web Component バインディング) / `enable-ssr`。

### 名前付き状態

```html
<wcs-state name="cart">...</wcs-state>
<div data-wcs="textContent: total@cart"></div>
```

## 3. `data-wcs` バインディング構文

```
property[#modifier[,modifier...]][|入力フィルタ...]: path[@state][|出力フィルタ...]
```

- 複数バインディングは **`;` 区切り**: `data-wcs="textContent: count; class.over: count|gt(10)"`
- 左辺（プロパティ側）のフィルタは **DOM→state の入力方向**に適用: `<select data-wcs="value|number: selectedProductId">`
- 右辺フィルタは state→DOM の出力方向。
- 複数 modifier は `#` 1つの後にカンマ区切り: `value#ro,init=none: path`

### プロパティ種別

| プロパティ | 説明 |
|---|---|
| `value` | 要素の値（input/select/textarea で双方向） |
| `checked` | checkbox/radio の選択状態（双方向） |
| `textContent` / `text` | テキスト（`text` はエイリアス） |
| `html` | innerHTML |
| `class.NAME` | CSS クラスの on/off（真偽値で切替） |
| `style.PROP` | CSS スタイルプロパティ |
| `attr.NAME` | 属性設定（SVG 名前空間対応） |
| `radio` | ラジオグループ→単一値（双方向） |
| `checkbox` | チェックボックスグループ→配列（双方向） |
| `onclick`, `on*` | イベントハンドラ |

これに加え任意の DOM プロパティ名が使える（例: `disabled: createFetch.loading`）。

### 修飾子

| 修飾子 | 説明 |
|---|---|
| `#ro` | 読み取り専用（双方向を無効化） |
| `#prevent` | `event.preventDefault()` |
| `#stop` | `event.stopPropagation()` |
| `#onchange` | 双方向バインディングを `input` でなく `change` イベントで |
| `#init=state\|element\|auto\|none` | バインディング authority（wcBindable 要素向け初期同期の向き） |
| `#sync=call\|connect` | element authority 時のスナップショット読み取りタイミング |

### 双方向バインディング（自動有効）

`<input>`(value/checked/valueAsNumber/valueAsDate)・`<select>`(value, change イベント)・`<textarea>`(value)。`<input type="button">` は除外。

### Mustache 構文

テキストノードで `{{ path|filter }}`（デフォルト有効）:

```html
<p>こんにちは、{{ user.name }}さん！</p>
<p>カウント: {{ count|locale }}</p>
```

## 4. リスト描画（`for`）

```html
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: users.*.name"></span>  <!-- フルパス -->
    <span data-wcs="textContent: .name"></span>          <!-- ドット省略形 -->
  </div>
</template>
```

- キー属性不要（値ベース差分）。配列は**必ず新配列を再代入**（`concat`/`toSpliced`/`filter`/`toSorted`/`toReversed`/`with`）。`push`/`splice`/`sort` は検知されない。
- ドット省略形: `.name` → `users.*.name`、`.` → `users.*`（プリミティブ配列の要素値）、`.name|uc`・`.name@state` も可。
- Mustache 内でも `{{ .name }}` が使える。

### ネストループ

```html
<template data-wcs="for: regions">
  <template data-wcs="for: .states">        <!-- .states → regions.*.states -->
    <span data-wcs="textContent: .name"></span> <!-- → regions.*.states.*.name -->
  </template>
</template>
```

### ループインデックス

- getter/ハンドラ内: `this.$1`(外側)、`this.$2`(内側)…
- テンプレート内: `{{ $1|inc(1) }}`（1始まり行番号）
- `.length` パスも可: `data-wcs="if: cart.items.length|gt(0)"`

## 5. 条件描画（`if` / `elseif` / `else`）

```html
<template data-wcs="if: count|gt(0)"><p>正</p></template>
<template data-wcs="elseif: count|lt(0)"><p>負</p></template>
<template data-wcs="else:"><p>ゼロ</p></template>
```

`else:` は**末尾コロン必須**（右辺なし）。`if` のネストも可。

## 6. computed（パス getter）と Proxy API

class 構文ではなく **plain object の getter**。ドットパス文字列キー + `*` ワイルドカード:

```javascript
export default {
  users: [{ id: 1, firstName: "Alice", lastName: "Smith" }],
  get total() { return this.price * (1 + this.tax); },          // トップレベル
  get "cart.totalPrice"() { /* ネスト算出 */ },
  get "users.*.fullName"() {                                     // ワイルドカード
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  },
  set "users.*.fullName"(value) { /* パス setter、双方向対応 */ },
  get "categories.*.items.*.label"() { /* 多重ワイルドカード */ },
};
```

- getter 内の `this["users.*.firstName"]` は現在のループ要素に自動解決。依存自動追跡・アドレス単位キャッシュ。
- 数値インデックス直接アクセス可: `this["users.0.name"]`、`` this[`cart.items.${i}.quantity`] += 1 ``。
- getter の戻り値オブジェクトへのチェーン可: `this["cart.items.*.product.price"]`。

### Proxy API（`this` 経由）

| API | 説明 |
|---|---|
| `this.$getAll(path, indexes?)` | ワイルドカードパスの全値を配列で取得（集計用）。部分インデックス指定可: `this.$getAll("regions.*.states.*.population", [this.$1])` |
| `this.$resolve(path, indexes, value?)` | 特定インデックスで読み書き |
| `this.$postUpdate(path)` | 更新通知を手動発行 |
| `this.$trackDependency(path)` / `this.$untrackDependency(fn)` | 依存の手動登録 / 抑止 |
| `this.$stateElement` | IStateElement アクセス |
| `this.$1`, `this.$2`, ... | ループインデックス |

### 状態更新の鉄則

```javascript
this["user.name"] = "Bob";   // ✅ パスへの代入 → DOM 更新
this.user.name = "Bob";      // ❌ 検知されない
```

## 7. フィルタ（組み込み40種で固定・カスタム登録 API なし）

- 比較: `eq` `ne` `not` `lt` `le` `gt` `ge`
- 算術: `inc` `dec` `mul` `div` `mod`
- 数値フォーマット: `fix` `round` `floor` `ceil` `locale` `percent`
- 文字列: `uc` `lc` `cap` `trim` `slice` `substr` `pad` `rep` `rev`
- 型変換: `int` `float` `boolean` `number` `string` `null`
- 日付: `date` `time` `datetime` `ymd`
- 真偽/デフォルト: `truthy` `falsy` `defaults`

引数付き: `gt(10)`、`substr(0,10)`、`pad(5,0)`、`locale(ja-JP)`、`ymd(/)`、`eq('admin')`（クォート可・bare も可・カンマ区切り）。チェーン: `price|mul(1.1)|round(2)|locale(ja-JP)`。組み込みで書けない変換は getter で行う。

## 8. イベントハンドリング

```html
<button data-wcs="onclick: handleClick">クリック</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) { /* this = 状態プロキシ */ },
  removeItem(event, index) {        // ループ内なら (event, ...listIndexes)
    this.items = this.items.toSpliced(index, 1);
  }
};
```

- シグネチャ: `(event, ...listIndexes)`。ループ内では内包インデックスが event の後ろに付く。
- **`onclick:` はメソッド名バインドのみで引数を渡せない** — 引数違いはゼロ引数ラッパーメソッドを用意する（例: `filterAll() { this.filterBy(""); }`）。
- 右辺に `$command.<name>` を書くと直接 emit: `<button data-wcs="onclick: $command.refreshList">`。

## 9. command-token / event-token

### command token（state → 要素メソッド起動）

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["refreshList"],
      onClick() { this.$command.refreshList.emit("/api/users", { method: "GET" }); }
    };
  </script>
</wcs-state>
<!-- 購読側。右辺は必ず $command.<name>（ベア名不可） -->
<wcs-fetch data-wcs="command.fetch: $command.refreshList"></wcs-fetch>
```

- `$commandTokens: string[]` で宣言 → `this.$command.<name>.emit(...args)`。引数は購読要素のメソッドへそのまま転送（await されない。Promise は `Promise.all(token.emit(...))` で待つ）。
- 1 token → 複数要素にファンアウト、subscribe 順保持。

### event token（要素 → state）

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      $eventTokens: ["userCreated"],
      $on: {
        userCreated(state, event) {          // this でなく第1引数 state
          state.users = state.users.concat(event.detail);
        },
        // ループ内 emitter: (state, event, ...listIndexes)
      }
    };
  </script>
</wcs-state>
<!-- キーは wcBindable プロパティ名（生イベント名ではない）。token 名はベア名（$ なし） -->
<my-form data-wcs="eventToken.created: userCreated"></my-form>
```

### state ↔ wcs-fetch 実戦例（users-crud example の骨子）

```html
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["refreshList"],
      $eventTokens: ["userResponded"],
      // 1 fetch = 1 state slot。outputs は要素が authority なので実初期値(null)でシード
      listFetch: { value: null, loading: false, error: null, status: 0 },
      createFetch: { url: "/api/users", method: "POST", manual: true,
                     body: { name: "" }, value: null, error: null, loading: false, status: 0 },
      get "listFetch.url"() { return "/api/users"; },   // slot 内ネスト getter で URL を算出
      get listRows() { return this["listFetch.value"] ?? []; }, // for: は配列必須なので null ガード
      $on: {
        userResponded: (state, event) => {
          const status = event.detail?.status ?? 0;
          if (status < 200 || status >= 300) return;   // wcs-fetch:response はエラー時も発火
          state.$command.refreshList.emit();
        },
      },
    };
  </script>
</wcs-state>

<wcs-fetch data-wcs="...: listFetch; command.fetch: $command.refreshList"></wcs-fetch>
<wcs-fetch data-wcs="...: createFetch; eventToken.value: userResponded">
  <wcs-fetch-header name="Content-Type" value="application/json"></wcs-fetch-header>
</wcs-fetch>
```

### spread バインディング（`...`）

- `...: target` で wcBindable の properties + inputs を一括配線。`commands`/event token は対象外（明示配線必須）。
- for 内: `...: storesFetches.*`（推奨）または `...: .`。
- 後勝ち上書き: `...: usersFetch; status: alternateStatus`。
- 右辺フィルタは**エラー**。`@stateName` は伝播。wcBindable 未宣言要素は**エラー**。
- `undefined` の state パスはプロパティ書き込みスキップ（要素既定値が生きる）。クリアは `null` 代入。

## 10. その他の機能

- **ライフサイクル**: 状態オブジェクトに `$connectedCallback`(async 可・await される・再接続毎)、`$disconnectedCallback`(同期のみ)、`$updatedCallback(paths, indexesListByPath)`(async 可・await されない)。Web Component 側は `async $stateReadyCallback(stateProp)`。
- **$streams**: `$streams: { name: { args?, source, fold?, initial? } }` — source は `(args, signal) => AsyncIterable|ReadableStream|Promise<同>`、AbortSignal 尊重必須、`fold` 指定時 `initial` 必須。status/error は `$streamStatus.<name>`(`"idle"|"active"|"done"|"error"`) / `$streamError.<name>`。args は同期・wildcard 読み不可・自己依存禁止。無限ストリームは有界 fold 必須。
- **Web Component**: shadowRoot 内に `<wcs-state bind-component="state">`、ホストから `data-wcs="state.message: user.name"`。Light DOM では `name` 属性必須 + `@name` 参照必須（無いと名前空間衝突）。
- **DCC**: `<my-counter data-wc-definition><template shadowrootmode="open">...<wcs-state>...` + `$bindables: ["count"]` で JS クラス無しのカスタム要素定義。
- **設定**: `bootstrapState({ locale, debug, enableMustache, bindAttributeName, tagNames: { state }, enableDirectionalInitialSync, enablePropagationContext, enableContractAnalyzer })`。
- **TypeScript**: `defineState({...})` ラップで `this` 型補完（ランタイムコストゼロ）。
- **SSR**: `<wcs-state enable-ssr>` + `@wcstack/server` の `renderToString()`。

## 落とし穴チェックリスト

1. `this.user.name = "Bob"` は検知されない — 必ず `this["user.name"] = "Bob"`。
2. `push`/`splice`/`sort` 等の破壊的メソッドは検知されない — 新配列を再代入。
3. `onclick:` に引数は渡せない — ゼロ引数ラッパーメソッドで対応。
4. `for:` のパスは配列必須 — fetch の `value` が null の間は `?? []` の派生 getter を挟む。
5. command binding 右辺のベア名（`fetchUsers`）は不可 — `$command.fetchUsers` 必須。
6. `eventToken.` のキーは生 DOM イベント名でなく wcBindable **プロパティ名**。
7. `wcs-fetch:response`（value イベント）は HTTP/ネットワークエラー時も発火 — `$on` で status を確認。
8. output-only な wcBindable メンバに都合のよい初期値をシードしない（要素側実初期値が置き換える）。
9. `$streams` の source は AbortSignal 無視禁止。
10. `else:` の末尾コロンを忘れない。
11. `$commandTokens`/`$eventTokens` の重複エントリ・`$on` の未宣言キーは初期化時エラー。未宣言 token へのアクセス（`this.$command.typo`）は `undefined`。
12. カスタムフィルタ登録 API は存在しない — 組み込み 40 種で書けない変換は getter で行う。
13. `data-wcs` の複数バインディング区切りは `;` のみを正とする。
