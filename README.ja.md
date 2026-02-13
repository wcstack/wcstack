# wcstack

**Web Components Stack** — Web Componentsで SPA を構築するための、標準技術ファーストなツールキット。

3つの独立したパッケージ。ランタイム依存ゼロ。ビルドステップ不要。

## パッケージ

| パッケージ | 説明 |
|---------|-------------|
| [`@wcstack/autoloader`](packages/autoloader/) | Import Mapによるカスタム要素の自動検出・動的インポート |
| [`@wcstack/router`](packages/router/) | レイアウト・型付きパラメータ・head管理を備えた宣言的SPAルーティング |
| [`@wcstack/state`](packages/state/) | 宣言的データバインディングと算出プロパティによるリアクティブ状態管理 |

---

## @wcstack/autoloader

カスタム要素のタグを書くだけで、自動的にロード。

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/ui|lit/": "./components/ui-lit/"
    }
  }
</script>

<!-- ./components/ui/button.js から自動ロード -->
<ui-button></ui-button>

<!-- Litローダーで ./components/ui-lit/card.js から自動ロード -->
<ui-lit-card></ui-lit-card>
```

- **Import Mapベース**の名前空間解決 — コンポーネントの個別登録不要
- **即時・遅延読み込み** — 重要なコンポーネントを先に、残りはオンデマンドで
- **MutationObserver** — 動的に追加された要素も自動検出
- **プラガブルなローダー** — Vanilla、Lit、カスタムローダーを自由に混在
- **`is`属性サポート** — カスタマイズドビルトイン要素と `extends` の自動検出

[詳細ドキュメント &rarr;](packages/autoloader/README.ja.md)

---

## @wcstack/router

宣言的SPAルーティング — ルートをJavaScriptではなくHTMLで定義。

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <nav slot="header">
          <wcs-link to="/">ホーム</wcs-link>
          <wcs-link to="/products">商品一覧</wcs-link>
        </nav>
        <wcs-route index>
          <wcs-head><title>ホーム</title></wcs-head>
          <app-home></app-home>
        </wcs-route>
        <wcs-route path="products">
          <wcs-head><title>商品一覧</title></wcs-head>
          <wcs-route index>
            <product-list></product-list>
          </wcs-route>
          <wcs-route path=":id(int)">
            <product-detail data-bind="props"></product-detail>
          </wcs-route>
        </wcs-route>
      </wcs-layout>
    </wcs-route>
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>
```

- **ネストされたルート&レイアウト** — Light DOMレイアウトシステムによる宣言的なUI構成
- **型付きパラメータ** — `:id(int)`、`:slug(slug)`、`:date(isoDate)` による自動型変換
- **Auto-binding** — `data-bind`（`props`、`states`、`attr`）でURLパラメータをコンポーネントに自動注入
- **Head管理** — `<wcs-head>`でルートごとに`<title>`や`<meta>`を切り替え
- **Navigation API** — モダンな標準APIベース、popstateフォールバック対応
- **ルートガード** — 非同期判定関数によるルート保護

[詳細ドキュメント &rarr;](packages/router/README.ja.md)

---

## @wcstack/state

宣言的バインディングによるリアクティブ状態管理 — 仮想DOMもコンパイルも不要。

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { name: "ウィジェット", price: 500, quantity: 2 },
          { name: "ガジェット", price: 1200, quantity: 1 }
        ]
      },
      removeItem(event, index) {
        this["cart.items"] = this["cart.items"].toSpliced(index, 1);
      },
      // パスゲッター — ループ要素ごとの算出プロパティ
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.price"] * this["cart.items.*.quantity"];
      },
      get "cart.total"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
      },
      get "cart.grandTotal"() {
        return this["cart.total"] * (1 + this.taxRate);
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    {{ .name }} &times;
    <input type="number" data-wcs="value: .quantity">
    = <span data-wcs="textContent: .subtotal|locale"></span>
    <button data-wcs="onclick: removeItem">削除</button>
  </div>
</template>
<p>合計: <span data-wcs="textContent: cart.grandTotal|locale(ja-JP)"></span></p>
```

- **パスゲッター** — `get "users.*.fullName"()` 任意の深さにフラット定義できる仮想プロパティ（自動依存追跡付き）
- **構造ディレクティブ** — `<template>`による `for`、`if` / `elseif` / `else`
- **37個の組み込みフィルター** — 比較・算術・文字列・日付・数値フォーマット
- **双方向バインディング** — `<input>`、`<select>`、`<textarea>`、ラジオ・チェックボックスグループの自動対応
- **Mustache構文** — テキストノード内の `{{ path|filter }}`
- **Web Componentバインディング** — Shadow DOMコンポーネントとの双方向状態バインディング

[詳細ドキュメント &rarr;](packages/state/README.ja.md)

---

## 設計哲学

| 原則 | 説明 |
|-----------|-------------|
| **標準技術ファースト** | Custom Elements、Shadow DOM、ES Modules、Import Maps |
| **宣言的** | HTMLの構造がアプリケーションの意図を表現 |
| **ゼロコンフィグ・ビルドレス** | バンドラーもトランスパイラも不要 — ブラウザでそのまま動作 |
| **依存関係ゼロ** | 全パッケージでランタイム依存なし |
| **低学習コスト** | 馴染みのあるWeb標準技術がベース |
| **予測可能な挙動** | 暗黙の魔法より明示的な動作を優先 |

## プロジェクト構造

```
wcstack/
├── packages/
│   ├── autoloader/    # @wcstack/autoloader
│   ├── router/        # @wcstack/router
│   └── state/         # @wcstack/state
```

各パッケージは独立してビルド・テスト・公開されます。ルートレベルのワークスペース管理はありません。

## 開発

コマンドは各パッケージディレクトリ内で実行します（例: `packages/state/`）:

```bash
npm run build            # dist削除 → TypeScriptコンパイル → Rollupバンドル
npm test                 # テスト実行（Vitest）
npm run test:coverage    # カバレッジ（100%閾値）
npm run lint             # ESLint
```

## ライセンス

MIT
