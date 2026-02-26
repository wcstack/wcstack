# @wcstack/autoloader

**もしカスタム要素が勝手に読み込まれたら？**

カスタム要素のタグを書くだけで、ブラウザが勝手にその定義を見つけてくれる未来を妄想してみる。`import` も `customElements.define()` も登録ボイラープレートも不要。タグを書けば、読み込まれる。

それが `<wcs-autoloader>` の探求するもの。CDN一発、依存ゼロ、Import Mapを活用。

## 特徴

### 基本機能
* **自動検出とロード**: 未定義のカスタム要素タグを検知し、自動的に `import()` します。
* **動的変更への対応**: `innerHTML` や `appendChild` で後から追加された要素も即座に検知します。
* **ゼロコンフィグ / ビルドレス**: バンドラー設定不要で、ブラウザ標準機能のみで動作します。
* **依存関係ゼロ**: 外部ライブラリに依存せず軽量です。

### ユニークな機能
* **Import Map 拡張**: 標準の Import Map 内に `@components/` ルールを記述する標準準拠のアプローチ。
* **名前空間プレフィックスによる自動解決**: 1つ1つの登録は不要。`@components/ui/` のようなプレフィックス定義だけで、`<ui-button>` → `button.js` のように自動解決します。
* **インラインローダー指定**: Import Map のキーで `@components/ui|lit/` のようにローダーを指定可能。複数フレームワークの混在も容易です。
* **高度な `is` 属性サポート**: 拡張ビルトイン要素も自動ロード。クラス定義から `extends` を推論し、適切に `define` します。
* **抽象化されたローダー**: ファイルの読み込みロジック自体がプラガブルで、拡張子や処理系をカスタマイズ可能です。

## 使い方

### 1. Import Mapの設定

`@wcstack/autoloader`キーに、オートローダーのパスを定義します。
`@components/`プレフィックスを使用して、importmap内にコンポーネントのパスを定義します。

```html
<script type="importmap">
  {
    "imports": {
      "@wcstack/autoloader": "/path/to/autoloader",
      "@components/ui/": "./components/ui/",
      "@components/app/": "./components/app/"
    }
  }
</script>
```

### 2. オートローダーの読み込み

`<script>`タグでオートローダースクリプトを読み込むか、手動で`bootstrapAutoloader`をインポートして呼び出します。

```html
<!-- 方法A: ゼロコンフィグスクリプト（推奨） -->
<script type="module" src="/path/to/autoloader/auto.js"></script>

<!-- 方法B: 手動初期化 -->
<script type="module">
  import { bootstrapAutoloader } from "@wcstack/autoloader";
  bootstrapAutoloader();
</script>
```

### 3. `<wcs-autoloader>`要素の配置

HTMLに`<wcs-autoloader>`を追加します。この要素がロードライフサイクルのトリガーとなり、要素の生成時に即時読み込みが開始され、DOMへの接続時に遅延読み込みが開始されます。

```html
<body>
  <wcs-autoloader></wcs-autoloader>
  <!-- アプリのコンポーネント -->
</body>
```

### 4. コンポーネントの使用

HTMLでカスタム要素を使用するだけです。`@wcstack/autoloader`が自動的に対応するファイルをインポートします。

```html
<!-- ./components/ui/button.js を読み込み -->
<ui-button></ui-button>

<!-- ./components/app/header.js を読み込み -->
<app-header></app-header>
```

## Import Map構文

`@wcstack/autoloader`は`@components/`で始まるimportmapのキーを解析します。

### 遅延読み込み（名前空間）

コンポーネントグループの遅延読み込みを有効にするには、`/`で終わるキーを使用します。

形式: `"@components/<プレフィックス>[|<ローダー>]/": "<パス>"`

- **プレフィックス**: タグのプレフィックス。スラッシュはダッシュに変換されます。
- **ローダー**（オプション）: 使用するローダー（例: `vanilla`、`lit`）。デフォルトは`vanilla`。

**例:**

```json
{
  "imports": {
    // <my-component> を ./components/component.js にマッピング
    "@components/my/": "./components/",

    // <ui-button> を ./ui/button.js にマッピング（'lit'ローダーを使用）
    "@components/ui|lit/": "./ui/"
  }
}
```

### 即時読み込み

特定のコンポーネントを即座に読み込むには、`/`で終わらないキーを使用します。

形式: `"@components/<タグ名>[|<ローダー>[,<extends>]]": "<パス>"`

- **ローダー**（オプション）: 省略した場合、ファイル拡張子に基づいて自動解決されます（例: `.js` -> デフォルトローダー、`.lit.js` -> litローダー）。
- **extends**（オプション）: 省略した場合、コンポーネントクラスがビルトインHTML要素を継承しているかどうかを自動検出します（例: `HTMLButtonElement` -> `extends: 'button'`）。

**例:**

```json
{
  "imports": {
    // <my-button> を ./my-button.js から即時読み込み
    // ローダー: 自動検出（.js）
    // extends: 自動検出（例: クラスがHTMLButtonElementを継承している場合）
    "@components/my-button": "./my-button.js",

    // ローダーとextendsを明示的に指定
    "@components/fancy-input|vanilla,input": "./fancy-input.js",
    
    // Lit要素のローダーを自動検出（litローダーが設定されている場合）
    "@components/my-lit-button": "./my-button.lit.js"
  }
}
```

## コンポーネントの要件

デフォルト（`vanilla`ローダー使用時）では、コンポーネントファイルは以下を満たす必要があります：

1. `.js`拡張子（設定で変更可能）
2. カスタム要素クラスを`default`としてエクスポート

```javascript
// components/ui/button.js
export default class UiButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
  }
}
```

## カスタマイズドビルトイン要素（`is`属性）

オートローダーは`is`属性を使用したカスタマイズドビルトイン要素を検出します：

```html
<!-- オートローダーが自動的に "my-button" を検出してロード -->
<button is="my-button">Click me</button>
```

**遅延読み込み**: `extends`値はホスト要素のタグから自動推論されます（例: `<button>` → `extends: "button"`）。

**即時読み込み**: `extends`値はコンポーネントクラスのプロトタイプから推論されます（例: `HTMLButtonElement` → `extends: "button"`）。Import Mapで明示的に指定することもできます：

```json
{
  "imports": {
    "@components/my-button|vanilla,button": "./my-button.js"
  }
}
```

```javascript
// my-button.js
export default class MyButton extends HTMLButtonElement {
  connectedCallback() {
    this.style.color = 'red';
  }
}
// オートローダーが呼び出す: customElements.define('my-button', MyButton, { extends: 'button' })
```

## 設定

`bootstrapAutoloader()`にオプションの設定オブジェクトを渡して初期化します：

```typescript
interface ILoader {
  postfix: string;
  loader: (path: string) => Promise<CustomElementConstructor | null>;
}

interface IWritableTagNames {
  autoloader?: string;
}

interface IWritableConfig {
  loaders?: Record<string, ILoader | string>;
  observable?: boolean;
  tagNames?: IWritableTagNames;
}
```

| オプション | 型 | デフォルト | 説明 |
|--------|------|---------|-------------|
| `loaders` | `Record<string, ILoader \| string>` | 下記参照 | ローダー定義。値は`ILoader`オブジェクトまたは他のローダーキーへの文字列エイリアス。 |
| `observable` | `boolean` | `true` | MutationObserverによる動的追加要素の検出を有効化。`false`で無効化。 |
| `tagNames` | `IWritableTagNames` | `{ autoloader: "wcs-autoloader" }` | カスタム要素のタグ名。名前衝突を避けるために変更可能。 |

### デフォルト設定

```javascript
{
  loaders: {
    // 組み込みvanillaローダー: モジュールをインポートしdefaultエクスポートを返す
    vanilla: { postfix: ".js", loader: vanillaLoader },
    // デフォルトキー: どのローダーにも一致しない場合のフォールバック
    "*": "vanilla"
  },
  observable: true
}
```

- **`vanilla`**: 組み込みローダー。モジュールを動的インポートし、`default`エクスポートをカスタム要素コンストラクタとして返します。
- **`"*"`（デフォルトキー）**: フォールバックローダー。値は文字列エイリアス`"vanilla"`で、マッチしないコンポーネントはvanillaローダーを使用します。

### ローダー解決

コンポーネントに明示的なローダーキーがない場合（例: `|loader`なしの遅延読み込み名前空間）、以下の順序でローダーを解決します：

1. **postfix一致**: ファイルパスを登録済みローダーの`postfix`値と照合（最長一致優先）。
2. **デフォルトキーフォールバック**: postfixが一致しない場合、`"*"`キーで参照されるローダーを使用。

### 例

```javascript
import { bootstrapAutoloader } from "@wcstack/autoloader";

bootstrapAutoloader({
  loaders: {
    // vanillaローダーのファイル拡張子を変更
    vanilla: { postfix: ".vanilla.js" },
    // .lit.jsファイル用のカスタムローダーを追加
    lit: {
      postfix: ".lit.js",
      loader: async (path) => {
        const module = await import(path);
        return module.default;
      }
    }
  },
  // MutationObserverを無効化（動的コンテンツ検出なし）
  observable: false
});
```

## 動作の仕組み

### ロードライフサイクル

1. **登録**: `bootstrapAutoloader()`が`customElements.define()`で`<wcs-autoloader>`カスタム要素を登録。
2. **constructor**（要素生成時）: すべての`<script type="importmap">`要素から`@components/`エントリを解析。名前空間でないキー（`/`で終わらない）のコンポーネントを即座に並列ロード開始。
3. **connectedCallback**（DOM接続時）: ドキュメントがまだ読み込み中であれば`DOMContentLoaded`を待機し、TreeWalkerを使用してDOMをスキャンして登録済み名前空間に一致する未定義カスタム要素を検出。
4. **ネストされたロード**: カスタム要素が定義・アップグレードされた後、そのShadow DOM（存在する場合）もスキャンしてネストされたカスタム要素を検出。
5. **監視**（`observable: true`の場合）: MutationObserverがDOMへの新規要素追加を監視し、遅延読み込みをトリガー。
6. **disconnectedCallback**（要素削除時）: MutationObserverを切断し、シングルトンインスタンスを解放。

### エラーハンドリング

- ロードに失敗したコンポーネントは内部的に追跡され、以降のスキャンで再試行されません。
- 重複ロードの防止: コンポーネントが既にロード中の場合、後続のリクエストは既存のロード完了を待機します。

## ライセンス

MIT