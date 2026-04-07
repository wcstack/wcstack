# wcstack

**もしブラウザにこれが最初からあったら？**

wcstack は「未来のWeb標準を想像し、ライブラリとして実装する」プロジェクトです。リアクティブなデータバインディング、宣言的ルーティング、コンポーネントの自動読み込み — これらがブラウザに最初から組み込まれていたら、どんな形になるでしょうか？

フレームワークではなく、*あるべきだった* HTMLタグの実現を目指しています。

---

## ルール

このプロジェクトには5つの縛りがあります。これが面白さの源泉です。

| # | ルール | 理由 |
|---|--------|------|
| 1 | **CDN一発** | `<script>` タグ1つ。npm不要、バンドラー不要、設定不要。 |
| 2 | **機能はカスタムタグで提供** | すべてがカスタム要素。`<wcs-something>` で表現できないなら、このプロジェクトの範囲外。 |
| 3 | **初期ロード = タグ定義だけ** | スクリプトはカスタム要素を登録するだけ。初期化コードもブートストラップも不要。 |
| 4 | **HTMLのセマンティクスを崩さない** | 式は `data-*` 属性とテキストノードに収まる — HTMLが拡張を許している場所だけを使う。DOM構造とセマンティクスはそのまま。 |
| 5 | **最新のECMAScript** | 最新のJS機能を積極的に採用。ES5へのトランスパイルはしない。未来を作ってるんだから。 |

この縛り、簡単そうに見えるでしょう？　そうでもないです。

HTMLのセマンティクスを崩さないためには、仕様のどこが拡張を許していて、どこが許していないかを深く理解していないと破綻する。すべてをカスタムタグで作るには、ライフサイクル・順序制御・コンポーネント間通信をCustom Elementsの仕組みの中で解決しないといけない。依存ライブラリゼロということは、すべてのアルゴリズムを自分で書くということ。そしてそのすべてが、「ブラウザ組み込みかも」と思えるクオリティでなければならない。

---

## 設計の核心

既存のすべてのフレームワークでは、**コンポーネント**がUIと状態の出会う場所になっている。状態ストアを外部に切り出しても、コンポーネント内に状態を引き込むグルーコードを書くことになる。UIと状態は常にJavaScriptの中で結合する。

wcstack は、文字通り別の **パス** を選んだ。

UIと状態を結びつけている**唯一の契約（コントラクト）**は**パス文字列**です。 — `user.name`、`cart.items.*.subtotal`、`@shared`。フックもインポートも結合のためのコードもありません。コンポーネントのJavaScriptには状態を参照するコードが一切含まれていません。HTMLだけが、すべてのデータ依存関係を宣言的に記述します。

```
State  ← "user.name" →  UI          パスが2つのレイヤーを結ぶ
Comp A ← "@app" →       Comp B      名前付きパスがコンポーネントを横断する
Loop   ← "items.*" →    Template    ワイルドカードがインデックスを抽象化する
```

つまり、UIを作り直しても状態に触れなくていい。状態をリファクタリングしてもDOMに触れなくていい。HTMLを読めばすべてが分かる。REST APIのURLと同じ発想 — シンプルな文字列契約、共有コードなし。

---

## パッケージ

9つの独立したランタイムパッケージ + 1つのツール拡張パッケージ。ランタイム依存ゼロ（SSR用のhappy-domと任意のAuth SDK連携を除く）。ビルド不要。

### もしHTMLにリアクティブなデータバインディングがあったら？

[`@wcstack/state`](packages/state/) — 状態をインラインで宣言し、属性でDOMにバインドする。

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

- **パスgetter** — `get "users.*.fullName"()` あらゆる深さの算出プロパティ
- **構造ディレクティブ** — `<template>` による `for`、`if` / `elseif` / `else`
- **40以上のフィルタ** — 比較、算術、文字列、日付、フォーマット
- **双方向バインディング** — `<input>`、`<select>`、`<textarea>` で自動
- **Mustache構文** — テキストノード内の `{{ path|filter }}`
- **Web Componentバインディング** — Shadow DOMとの双方向状態同期

[詳細ドキュメント &rarr;](packages/state/README.ja.md)

---

### もしルーティングがただのHTMLタグだったら？

[`@wcstack/router`](packages/router/) — アプリのナビゲーション構造をマークアップで定義する。

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

- **ネストされたルート & レイアウト** — Light DOMで宣言的にUI構造を組み立て
- **型付きパラメータ** — `:id(int)`、`:slug(slug)`、`:date(isoDate)` で自動変換
- **自動バインディング** — `data-bind` でURLパラメータをコンポーネントに注入
- **Head管理** — `<wcs-head>` でルートごとに `<title>` と `<meta>` を切り替え
- **Navigation API** — モダンな標準APIベース、popstateフォールバック付き
- **ルートガード** — 非同期の判定関数でルートを保護

[詳細ドキュメント &rarr;](packages/router/README.ja.md)

---

### もし fetch がタグだったら？

[`@wcstack/fetch`](packages/fetch/) — 宣言的な HTTP 通信をヘッドレス Web Component として。

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      loading: false,
      filterRole: "",
      get usersUrl() {
        const role = this.filterRole;
        return role ? "/api/users?role=" + role : "/api/users";
      },
    };
  </script>
</wcs-state>

<!-- URL が変わると自動的に再フェッチ -->
<wcs-fetch data-wcs="url: usersUrl; value: users; loading: loading"></wcs-fetch>

<template data-wcs="if: loading">
  <p>読み込み中...</p>
</template>
<template data-wcs="for: users">
  <div data-wcs="textContent: .name"></div>
</template>
```

- **HAWC パターン** — Core (`EventTarget`) / Shell (`HTMLElement`) 分離
- **wc-bindable-protocol** — React、Vue、Svelte、Solid と薄いアダプタで連携
- **URL 監視** — バインドされた URL の変更で自動再フェッチ
- **trigger プロパティ** — 状態から宣言的に fetch 実行、DOM 参照不要
- **HTML リプレースモード** — htmx 的な `target` 属性でサーバーレンダリング断片を差し替え
- **ヘッドレス Core** — `FetchCore` は Node.js、Deno、Cloudflare Workers で動作

[詳細ドキュメント &rarr;](packages/fetch/README.ja.md)

---

### もしカスタム要素が勝手に読み込まれたら？

[`@wcstack/autoloader`](packages/autoloader/) — タグを書くだけで読み込まれる。登録コード不要。

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/ui|lit/": "./components/ui-lit/"
    }
  }
</script>

<!-- ./components/ui/button.js から自動読み込み -->
<ui-button></ui-button>

<!-- Litローダーで ./components/ui-lit/card.js から自動読み込み -->
<ui-lit-card></ui-lit-card>
```

- **Import Mapベース** — 名前空間解決、コンポーネントごとの登録不要
- **即時 & 遅延読み込み** — 重要なコンポーネントを先に、残りはオンデマンドで
- **MutationObserver** — 動的に追加された要素も自動検知
- **プラガブルローダー** — Vanilla、Lit、カスタムローダーを混在可能
- **`is` 属性** — カスタマイズされた組み込み要素の `extends` 自動検出

[詳細ドキュメント &rarr;](packages/autoloader/README.ja.md)

---

### もしテンプレートがサーバーでレンダリングされたら？

[`@wcstack/server`](packages/server/) — 同じHTML、サーバーでレンダリング。特別な構文不要。

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(`
  <wcs-state enable-ssr>
    <script type="module">
      export default {
        items: [],
        async $connectedCallback() {
          const res = await fetch("/api/items");
          this.items = await res.json();
        }
      };
    </script>
  </wcs-state>
  <template data-wcs="for: items">
    <div data-wcs="textContent: items.*.name"></div>
  </template>
`, { baseUrl: "http://localhost:3000" });
```

- **ドロップインSSR** — `<wcs-state>` に `enable-ssr` を追加して `renderToString()` を呼ぶだけ
- **自動ハイドレーション** — クライアントがサーバーの続きをシームレスに引き継ぎ、フリッカーなし
- **相対URL自動解決** — `baseUrl` オプションで `fetch("/api/...")` がサーバー上でも動作
- **バージョン安全フォールバック** — バージョン不一致時はDOMをクリーンアップしてCSRにフォールバック
- **`<wcs-ssr>` ハイドレーションデータ** — 状態スナップショット、テンプレート、プロパティを1要素に集約

[詳細ドキュメント &rarr;](packages/server/README.ja.md)

---

### 追加パッケージ

- [`@wcstack/websocket`](packages/websocket/) — `<wcs-websocket>` でリアルタイム通信を宣言的に扱い、接続状態や受信データをバインド可能。
- [`@wcstack/upload`](packages/upload/) — ファイルアップロードを宣言的に記述し、進捗・状態管理をフレームワーク非依存で提供。
- [`@wcstack/auth0`](packages/auth0/) — Auth0 認証をカスタム要素として提供し、ログイン/ログアウト/セッション状態を宣言的に扱える。
- [`@wcstack/ai`](packages/ai/) — ストリーミング前提の LLM 推論コンポーネント（OpenAI / Anthropic / Azure OpenAI）。
- [`wcstack-intellisense`](packages/vscode-wcs/) — `<wcs-state>` インラインスクリプト向けの VS Code 言語サポート拡張。

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>
<body>

<wcs-state>
  <script type="module">
    export default {
      count: 0,
      countUp() { this.count++; }
    };
  </script>
</wcs-state>

<p>Count: {{ count }}</p>
<button data-wcs="onclick: countUp">+1</button>

</body>
</html>
```

`<script>` タグ1つ。カスタム要素1つ。あとはHTML。以上。

---

## プロジェクト構成

```
wcstack/
├── packages/
│   ├── state/         # @wcstack/state
│   ├── router/        # @wcstack/router
│   ├── fetch/         # @wcstack/fetch
│   ├── autoloader/    # @wcstack/autoloader
│   ├── server/        # @wcstack/server
│   ├── websocket/     # @wcstack/websocket
│   ├── upload/        # @wcstack/upload
│   ├── auth0/         # @wcstack/auth0
│   ├── ai/            # @wcstack/ai
│   └── vscode-wcs/    # wcstack-intellisense (VS Code拡張)
```

各パッケージは独立してビルド・テスト・公開されます。

## 開発

各パッケージのディレクトリ内で実行します（例: `packages/state/`）:

```bash
npm run build            # dist削除、TypeScriptコンパイル、Rollupバンドル
npm test                 # テスト実行 (Vitest)
npm run test:coverage    # カバレッジ（100%閾値）
npm run lint             # ESLint
```

## License

MIT
