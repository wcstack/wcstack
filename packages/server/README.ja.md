# @wcstack/server

**Web Components がサーバーでレンダリングされたら？**

`<wcs-state>` テンプレートがブラウザに届く前に完全にレンダリングされる世界を想像してください。データは取得済み、バインディングは解決済み、リストは展開済み、条件分岐は評価済み。ユーザーは即座にコンテンツを目にし、クライアントはサーバーが中断した地点からシームレスに引き継ぎます。

`@wcstack/server` はそれを実現します。既存の `@wcstack/state` テンプレートを happy-dom 上で実行し、ハイドレーションデータを埋め込んだレンダリング済み HTML を生成。クライアントはフリッカーなしでリアクティビティを再開します。特別なテンプレート構文もサーバー専用のマークアップも不要 — いつも書いている HTML がそのまま使えます。

## 特徴

### 基本機能
- **テンプレートの完全レンダリング**: `@wcstack/state` のバインディングをサーバーサイドで実行 — テキスト、属性、`for` ループ、`if`/`elseif`/`else` 条件分岐、フィルタ、Mustache `{{ }}` 構文に対応
- **ハイドレーションデータの自動生成**: 状態スナップショット、テンプレートフラグメント、プロパティマップを含む `<wcs-ssr>` 要素を生成し、クライアント側でシームレスにハイドレーション
- **非同期データ取得**: `$connectedCallback` 内の `fetch()` に対応 — サーバーはすべての非同期処理の完了を待ってからレンダリング
- **RenderCore**: `wc-bindable` プロトコルに準拠したヘッドレスのイベント駆動レンダリングクラス。`html` / `loading` / `error` の状態を監視可能
- **ブラウザ依存ゼロ**: Node.js 上で動作し、ランタイム依存は happy-dom のみ

### ユニークな機能
- **ドロップイン SSR**: クライアント側テンプレートの変更不要。`<wcs-state>` に `enable-ssr` を追加して `renderToString()` で呼び出すだけ
- **テンプレートフラグメントの保存**: `for`/`if` テンプレートのソースを UUID 参照付きでキャプチャし、クライアント側で構造ディレクティブを再実行可能に
- **プロパティハイドレーション**: 属性では表現できない DOM プロパティ（`innerHTML` など）を個別にシリアライズし、ハイドレーション時に復元
- **wc-bindable プロトコル**: `RenderCore` は標準プロトコルでレンダリング状態を公開し、サーバーでもクライアントでも同じ `bind()` パターンで利用可能

## インストール

```bash
npm install @wcstack/server
```

## クイックスタート

### `renderToString()` — ワンショットレンダリング

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(`
  <wcs-state json='{"items":["Apple","Banana","Cherry"]}' enable-ssr>
  </wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: items.*"></li>
    </template>
  </ul>
`);

console.log(html);
// ハイドレーションデータ付きのレンダリング済み HTML
```

### `RenderCore` — 監視可能なレンダリング（キャッシュ付き）

```javascript
import { RenderCore } from "@wcstack/server";

const renderer = new RenderCore();

// wc-bindable プロトコル経由で状態変更をリッスン
renderer.addEventListener("wcs-render:loading-changed", (e) => {
  console.log("loading:", e.detail);
});

renderer.addEventListener("wcs-render:html-changed", (e) => {
  console.log("rendered:", e.detail.length, "bytes");
});

// レンダリングしてキャッシュ
await renderer.render(templateHtml);

// 以降の読み取りはキャッシュを利用
console.log(renderer.html);
```

## API リファレンス

### `renderToString(html: string): Promise<string>`

`@wcstack/state` テンプレートを含む HTML 文字列をレンダリングします。`<wcs-state enable-ssr>` を持つ要素のハイドレーションデータ付きのレンダリング済み HTML を返します。

**レンダリングパイプライン:**
1. happy-dom ウィンドウを作成し、ブラウザグローバルをインストール
2. HTML をパースし、すべての `<wcs-state>` 要素の `connectedCallback` を発火
3. すべての `$connectedCallback` プロミス（`fetch()` 呼び出し含む）の完了を待機
4. `buildBindings` の完了を待機
5. `enable-ssr` を持つ状態に `<wcs-ssr>` 要素を生成
6. グローバルを復元し、レンダリング済み HTML を返却

### `RenderCore`

`EventTarget` を継承したヘッドレスレンダリングクラス。`wc-bindable` プロトコルを実装。

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `html` | `string \| null` | レンダリング済み HTML（`render()` 後にキャッシュ） |
| `loading` | `boolean` | レンダリング中は `true` |
| `error` | `Error \| null` | 直前の `render()` のエラー（エラーがあれば） |

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `render(html)` | `Promise<string \| null>` | テンプレートをレンダリングして結果をキャッシュ。エラー時は `null` を返却 |

| イベント | Detail | 説明 |
|-------|--------|-------------|
| `wcs-render:html-changed` | `string` | レンダリング成功時に発火 |
| `wcs-render:loading-changed` | `boolean` | ローディング状態の変更時に発火 |
| `wcs-render:error` | `Error` | レンダリング失敗時に発火 |

**wc-bindable 宣言:**

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "html", event: "wcs-render:html-changed" },
    { name: "loading", event: "wcs-render:loading-changed" },
    { name: "error", event: "wcs-render:error" },
  ],
};
```

### ヘルパー関数

| 関数 | 説明 |
|----------|-------------|
| `installGlobals(window)` | happy-dom のグローバルを `globalThis` にインストール。復元関数を返す |
| `extractStateData(stateEl)` | `<wcs-state>` 要素からデータプロパティを抽出（`$` プレフィックスのキーと関数は除外） |

### 定数

| 名前 | 説明 |
|------|-------------|
| `GLOBALS_KEYS` | SSR 中にインストールされるブラウザグローバルキーの配列（`document`、`HTMLElement`、`Node` 等） |
| `VERSION` | `package.json` から取得したパッケージバージョン文字列 |

## SSR 出力構造

`<wcs-state>` に `enable-ssr` 属性がある場合、`renderToString()` はその直前にハイドレーションデータを含む `<wcs-ssr>` 要素を挿入します：

```html
<!-- renderToString() が生成 -->
<wcs-ssr name="default" version="0.1.0">

  <!-- 状態スナップショット -->
  <script type="application/json">{"items":["Apple","Banana","Cherry"]}</script>

  <!-- テンプレートフラグメント（クライアント側での再実行用） -->
  <template id="uuid-1234" data-wcs="for: items">
    <li data-wcs="textContent: items.*"></li>
  </template>

  <!-- 属性で代替不可なプロパティ（オプション） -->
  <script type="application/json" data-wcs-ssr-props>
    {"wcs-ssr-0": {"innerHTML": "<b>rich</b>"}}
  </script>

</wcs-ssr>

<wcs-state json='...' enable-ssr></wcs-state>

<!-- レンダリング済み出力（即座に表示） -->
<ul>
  <li>Apple</li>
  <li>Banana</li>
  <li>Cherry</li>
</ul>
```

クライアント側の `@wcstack/state` はハイドレーション時に `<wcs-ssr>` 要素を読み取り、状態とテンプレートを復元し、再レンダリングなしでリアクティビティを再開します。

## サーバー統合の例

```javascript
import { createServer } from "node:http";
import { RenderCore } from "@wcstack/server";

const renderer = new RenderCore();

const template = `
  <wcs-state enable-ssr>
    <script type="module">
      export default {
        async $connectedCallback() {
          const res = await fetch("http://localhost:3000/api/data");
          this.items = await res.json();
        },
        items: []
      };
    </script>
  </wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: items.*"></li>
    </template>
  </ul>
`;

createServer(async (req, res) => {
  if (!renderer.html) {
    await renderer.render(template);
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(renderer.html);
}).listen(3000);
```

## 入力 HTML のルール

- `<body>` の中身だけを渡す（`<html>`, `<head>`, `<body>` タグは含めない）
- `<script>` / `<link>` による外部リソース読み込みは実行されない
  → 必要なパッケージは `options.bootstraps` で明示的に渡す

## SSR でできること

### 状態の初期化とデータ取得

- `<wcs-state>` の状態ロード（json 属性, src 属性, inline `<script type="module">`）
- `$connectedCallback` でのサーバーサイド fetch（API 呼び出し等）

```html
<!-- JSON 直接指定 -->
<wcs-state enable-ssr json='{"title":"Hello"}'></wcs-state>

<!-- $connectedCallback で API からデータ取得 -->
<!-- $connectedCallback は状態オブジェクトのメソッドとして定義、this が state proxy -->
<wcs-state enable-ssr>
  <script type="module">
    export default {
      async $connectedCallback() {
        const res = await fetch('/api/users');
        this.users = await res.json();
      }
    };
  </script>
</wcs-state>
```

### wcs-fetch を使ったサーバー通信

- `<wcs-fetch>` の auto-fetch（`manual` なし）はサーバーでも実行される
- `manual` + `$connectedCallback` で明示的に制御する場合：

```html
<wcs-fetch id="api" url="/api/users" manual></wcs-fetch>
<wcs-state enable-ssr>
  <script type="module">
    export default {
      async $connectedCallback() {
        const el = document.getElementById('api');
        this.users = await el.fetch();
      }
    };
  </script>
</wcs-state>
```

> ※ `bootstraps` オプションに `bootstrapFetch` を含める必要あり

### バインディングと構造レンダリング

- `data-wcs` バインディングの適用（text, attribute, class, style, property）
- `<template data-wcs="for:">` / `if:` / `elseif:` / `else:` の構造レンダリング

```html
<ul>
  <template data-wcs="for: users">
    <li data-wcs="textContent: .name"></li>
  </template>
</ul>
<template data-wcs="if: isAdmin">
  <div class="admin-panel">...</div>
</template>
```

### ハイドレーション

- `enable-ssr` 付き `<wcs-state>` の `<wcs-ssr>` メタデータ自動生成
- クライアント側でのハイドレーション（再レンダリングなしでバインディング復元）
- `enable-ssr` を外した `<wcs-state>` はクライアントのみで動作（部分 CSR）

### カスタム要素の待機

- `static hasConnectedCallbackPromise = true` プロトコル準拠の全カスタム要素を自動待機
- 安定化ループ: await 後に DOM を再走査し、`$connectedCallback` 中に動的追加されたカスタム要素も待機（最大 10 回）

## SSR でできないこと

- `<head>` 内の `<script src="...">` や `<link>` の自動実行
- ブラウザ固有 API（localStorage, sessionStorage, navigator 等）
- Shadow DOM のレンダリング（Declarative Shadow DOM 非対応）
- イベントハンドラの登録（クライアント側のハイドレーションで復元）
- `<wcs-autoloader>` による動的コンポーネント読み込み

## HTML の分割パターン

`renderToString` には `<body>` の中身だけを渡し、`<head>` や `<script>` タグは外側のテンプレートで囲む：

```javascript
// server.js
const ssrBody = await renderToString(template, {
  baseUrl: 'http://localhost:3001',
});
const page = `<!DOCTYPE html>
<html lang="ja">
<head>
  <script type="module" src="/packages/state/dist/auto.js"></script>
</head>
<body>${ssrBody}</body>
</html>`;
```

### 複数パッケージを使う場合

```javascript
import { bootstrapState, getBindingsReady } from '@wcstack/state';
import { bootstrapFetch } from '@wcstack/fetch';

const ssrBody = await renderToString(template, {
  baseUrl: 'http://localhost:3001',
  bootstraps: [bootstrapState, bootstrapFetch],
  ready: [(doc) => getBindingsReady(doc)],
});
```

## 仕組み

### レンダリングパイプライン

1. **グローバルのセットアップ**: happy-dom の `Window` を作成し、ブラウザグローバル（`document`、`HTMLElement`、`MutationObserver` 等）を `globalThis` に一時的にインストール。`URL.createObjectURL` を無効化し、インラインスクリプトの base64 data URL フォールバックを強制。

2. **SSR モード**: `<html>` 要素に `data-wcs-server` 属性を設定。`@wcstack/state` はこの属性を検出して SSR 動作を有効化。

3. **ブートストラップ**: ユーザー提供の bootstrap 関数を呼び出す（省略時は `bootstrapState()` をデフォルト使用）。

4. **HTML パースとコールバック**: `document.body.innerHTML` に HTML をセットすることで、happy-dom の要素ライフサイクルが発火。各 `<wcs-state>` がデータソースをロードし `$connectedCallback` を実行。`hasConnectedCallbackPromise` を持つ全カスタム要素を安定化ループで待機 — await 後に DOM を再走査し、動的追加された要素も検出（最大 10 回）。

5. **Ready**: ユーザー提供の ready 関数を待機（デフォルトは `getBindingsReady()`） — テキスト補間、属性マッピング、リスト展開、条件評価。

6. **SSR メタデータ**: 各 `<wcs-state enable-ssr>` が `connectedCallback` 内で自動的に `<wcs-ssr>` 要素を生成。

7. **クリーンアップ**: 元のグローバルを復元し、happy-dom ウィンドウを閉じる。

### クライアント側のハイドレーション

クライアント側の `@wcstack/state` は `<wcs-ssr>` 要素を検出し、以下を行います：
1. JSON スナップショットから状態を復元（ネットワークリクエストをスキップ）
2. UUID 参照を使ってテンプレートフラグメントを再接続
3. props スクリプトから属性で代替不可なプロパティを適用
4. 通常のリアクティブバインディングを再開

レンダリング済みの DOM は即座に表示されます — ハイドレーションはインタラクティビティの復元のみを行います。

## ライセンス

MIT
