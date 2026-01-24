# @wcstack/autoloader

カスタム要素（要 Web Components 対応）を、HTMLにタグを書くだけで自動的にロードします。

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

### 2. ハンドラーの登録

メインスクリプトで`bootstrapAutoloader`をインポートして呼び出します。

```html
<script type="module">
  import { bootstrapAutoloader } from "@wcstack/autoloader";
  bootstrapAutoloader();
</script>
```

### 3. コンポーネントの使用

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

## 設定

`bootstrapAutoloader`に設定オブジェクトを渡すことでローダーを設定できます。

```javascript
import { bootstrapAutoloader } from "@wcstack/autoloader";

// 例: デフォルトのpostfixを変更
bootstrapAutoloader({
  loaders: {
    vanilla: {
      postfix: ".vanilla.js"
    }
  }
});
```

## ライセンス

MIT