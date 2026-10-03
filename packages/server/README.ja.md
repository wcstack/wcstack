# @wcstack/server

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**Web Components がサーバーでレンダリングされたら？**

`<wcs-state>` テンプレートがブラウザに届く前に完全にレンダリングされる世界を想像してください。データは取得済み、バインディングは解決済み、リストは展開済み、条件分岐は評価済み。ユーザーは即座にコンテンツを目にし、クライアントはサーバーが中断した地点からシームレスに引き継ぎます。

`@wcstack/server` はそれを実現します。既存の `@wcstack/state` テンプレートを happy-dom 上で実行し、ハイドレーションデータを埋め込んだレンダリング済み HTML を生成。クライアントはフリッカーなしでリアクティビティを再開します。特別なテンプレート構文もサーバー専用のマークアップも不要 — いつも書いている HTML がそのまま使えます。

## 特徴

### 基本機能
- **テンプレートの完全レンダリング**: `@wcstack/state` のバインディングをサーバーサイドで実行 — テキスト、属性、`for` ループ、`if`/`elseif`/`else` 条件分岐、フィルタ、Mustache `{{ }}` 構文に対応
- **ハイドレーションデータの自動生成**: 状態のデータとページ直下のテンプレートを含む `<wcs-ssr>` 要素を生成し、行・枝・テキストバインディングをコメントで印付けして、クライアント側でシームレスにハイドレーション
- **非同期データ取得**: `$connectedCallback` 内の `fetch()` に対応 — サーバーはすべての非同期処理の完了を待ってからレンダリング
- **RenderCore**: `wc-bindable` プロトコルに準拠したヘッドレスのイベント駆動レンダリングクラス。`html` / `loading` / `error` の状態を監視可能
- **ブラウザ依存ゼロ**: Node.js 上で動作し、ランタイム依存は happy-dom のみ

### ユニークな機能
- **ドロップイン SSR**: クライアント側テンプレートの変更不要。`<wcs-state>` に `enable-ssr` を追加して `renderToString()` で呼び出すだけ
- **テンプレートフラグメントの保存**: ページ直下の `for`/`if` テンプレートを、アンカーのコメントが名指す id で `<wcs-ssr>` に残し、クライアントがそれを戻して以後の描画に使えるように
- **フォームの値をマークアップに**: input の `value` / `checked`、select で選ばれている option、textarea のテキストを HTML に書き込み、クライアントがバインドする前からページに値が見える。その他の DOM プロパティ（`innerHTML` など）は描画結果がそのまま HTML に入り、クライアントは引き取ったノードに全バインディングを当てる
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

同じ呼び出しはページの**スナップショットテスト**にもなります。vitest で `expect(await renderToString(html)).toMatchSnapshot()` と書けば、ブラウザなしで描画結果を固定できます。書き込みやハンドラまで動かすヘッドレス DOM テストでは、後述の `installGlobals()` がそのまま再利用できるグローバル差し替えです — state README の[ページをテストする](../state/README.ja.md#ページをテストする)を参照してください。

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

### `renderToString(html: string, options?: RenderOptions): Promise<string>`

`@wcstack/state` テンプレートを含む HTML 文字列をレンダリングします。`<wcs-state enable-ssr>` を持つ要素のハイドレーションデータ付きのレンダリング済み HTML を返します。

**オプション:**

| オプション | 説明 |
|--------|-------------|
| `url` | このリクエストの完全 URL（例 `"http://localhost:3000/products/1"`）。`window.location` / `document.baseURI` に反映される。URL でルーティングするコンポーネントのサーバーレンダリングに必要。 |
| `baseHref` | `<head>` へ注入する `<base href>` の値。`url` 指定時の既定は `"/"`。サブパス配備では明示する。 |
| `baseUrl` | 相対 fetch URL の解決に使うベース URL。既定は `url` の origin。 |
| `bootstraps` | bootstrap 関数の配列（既定は `bootstrapState`）。非同期ローダーも渡せる — モジュールスコープで `HTMLElement` を継承するクラスを持つパッケージは純 Node でトップレベル import できないため、`async () => (await import('@wcstack/fetch')).bootstrapFetch()` のように渡す（ローダーは DOM グローバル設置後に実行される）。 |
| `timeoutMs` | ページが ready になるのを待つ上限（ミリ秒）。既定は `DEFAULT_RENDER_TIMEOUT_MS`（**30,000**）。超えると原因を名指しして reject する。**上限を外すときは `0`。** 上限として機能しえない値も「無制限」に倒す: `NaN`・`0` 以下・`MAX_RENDER_TIMEOUT_MS`（2,147,483,647）より大きい値（**`Infinity` を含む**）。Node の `setTimeout` は 2³¹−1 を超える delay を 1 ms に丸めるため、そうしないと「上限を上げたつもり」が即時タイムアウトに反転する。 |

> **なぜ上限があるか。** `renderToString` は `globalThis` を差し替えるので、レンダリングは 1 本の mutex で直列化され、解放は `finally` にあります。上限が無かった頃は、ready にならないページがその `finally` に到達せず、**1 ページの不具合で以後そのプロセスの全レンダリングが永久に返らなく**なっていました。上限は mutex が必ず戻ることを保証します。
>
> 予算は「ready 待ち」と「`finally` の後始末（drain）」で共有します。後始末には残り時間を渡しますが、`CLEANUP_MIN_TIMEOUT_MS`（1,000 ms）は下回りません（0 は「上限なし」と同義になるため）。したがって実時間の最悪値は `timeoutMs + 1,000 ms` です。`timeoutMs: 0` では後始末も無制限になります — それが「上限を外す」の意味です。

> **長時間動くプロセスについて。** 後始末の最後に、state 側がそのレンダリングのために持っていたものを捨てさせます（ssr-snapshot builder の `reset()`）。`@wcstack/state` 4.0 はここでテンプレートの id を振り直すので、レンダリングをまたいで id が増え続けず、毎回 `wcs-t0` から番号が付きます。ウィンドウを閉じた後に走り、任意メンバなので、これを持たない提供側には呼ばれないだけです。どちらでもスナップショットは常に自分の文書の中で閉じています。

**レンダリングパイプライン:**
1. happy-dom ウィンドウを作成し、ブラウザグローバルをインストール
2. HTML をパースし、すべての `<wcs-state>` 要素の `connectedCallback` を発火
3. すべての `$connectedCallback` プロミス（`fetch()` 呼び出し含む）の完了を待機
4. `buildBindings` の完了を待機
5. `@wcstack/state` のスナップショットビルダーを呼び出す — フォームの値をマークアップに書き込み、`enable-ssr` を持つ状態に `<wcs-ssr>` 要素を生成
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
| `waitForReady(root, { maxIterations? })` | `root`（`document` または `ShadowRoot`）配下で readiness プロトコルに従う全カスタム要素を待つ — `static hasConnectedCallbackPromise` を持つ要素の `connectedCallbackPromise`（待機中に増えた要素も再走査。`<wcs-router>` の初期ルートなど）、次に `static getBindingsReady(root)`（`<wcs-state>` のバインディング構築）。`renderToString` がシリアライズ前に行う待機そのもので、[`@wcstack/testing`](../testing/README.ja.md) の `mount()` が再利用する。バインディング初期化に失敗すると reject |

### 定数

| 名前 | 説明 |
|------|-------------|
| `GLOBALS_KEYS` | SSR 中にインストールされるブラウザグローバルキーの配列（`document`、`HTMLElement`、`Node` 等） |
| `VERSION` | `package.json` から取得したパッケージバージョン文字列 |
| `DEFAULT_RENDER_TIMEOUT_MS` | `RenderOptions.timeoutMs` の既定値（30,000） |
| `MAX_RENDER_TIMEOUT_MS` | Node の `setTimeout` が受け付ける最大 delay（2,147,483,647）。これを超える値は「無制限」に倒す |
| `CLEANUP_MIN_TIMEOUT_MS` | 後始末の drain に必ず与える下限（1,000） |

## SSR 出力構造

`<wcs-state>` に `enable-ssr` 属性がある場合、`renderToString()` はその直前に `<wcs-ssr>` 要素を挿入します。中身はページを描いた `@wcstack/state` のバージョン、状態のデータ、ページ直下のテンプレートです。描画結果はその場に残り、コメントで印付けされます：

```html
<!-- renderToString() が生成 -->
<wcs-ssr version="4.0.0">

  <!-- 状態スナップショット -->
  <script type="application/json">{"items":["Apple","Banana","Cherry"]}</script>

  <!-- ページ直下のテンプレート（アンカーのコメントが名指す id 付き） -->
  <template id="wcs-t0" data-wcs="for: items">
    <li data-wcs="textContent: items.*"></li>
  </template>

</wcs-ssr>

<wcs-state json='...' enable-ssr></wcs-state>

<!-- レンダリング済み出力（即座に表示） -->
<ul>
  <!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><li>Apple</li><!--wcs-|--><li>Banana</li><!--wcs-|--><li>Cherry</li><!--wcs-]-->
</ul>
```

| マーク | 意味 |
|--------|------|
| `<!--wcs-p:ID-->` | ページ直下の `for:` / `if:` / `elseif:` / `else:` テンプレートがあった位置。テンプレートは `<wcs-ssr>` の中に `<template id="ID">` として残る（`wcs-t0`, `wcs-t1`, … とレンダリングごとに採番） |
| `<!--wcs-[-->` 〜 `<!--wcs-]-->` | リストの行。アンカーの直後に置かれ、各行は `<!--wcs-\|-->` で始まる |
| `<!--wcs-[:i-->` 〜 `<!--wcs-]-->` | `if:` / `elseif:` / `else:` の連なりが描いた枝（`i` は連なりの中の位置、0 始まり）。連なりの最後のアンカーの直後に置かれる。どの枝も描かれなければ領域は無い |
| `<!--wcs-t:EXPR-->値<!--wcs-/t-->` | ページ直下のテキストバインディング（`{{ }}` または `<!--@@: -->`）。`EXPR` はフィルタも含めた式全体（URI エンコード） |
| `<!--wcs-s-->` / `<!--wcs-e-->` | 隣り合う 2 つのテキストノードの区切り / 空のテキストノードの代わり。HTML をパースし直しても同じテキストノードに戻るようにする |
| `data-wcs-raw="…"` | `{{ }}` を含むテキスト専用要素（`<textarea>`、`<title>`）に付く。書かれたままの中身で、クライアントがこれを戻す |

行や枝の中の入れ子の `for:` / `if:` は自分のアンカーのコメントをそのまま持ち、その直後に同じ形で領域が続きます。

- **出力のコメントは消さないこと。** 後段の minify（`removeComments` など）で消すとハイドレーションが壊れます。また、形式は API ではないので、これを当てにして出力を後処理しないでください。
- プロパティの値の表はありません。バインディングが描いた結果（`innerHTML` を含む）はそのまま HTML に入り、クライアントは引き取ったノードに全バインディングを当てます。3.x の `data-wcs-ssr-id` 属性と `<script type="application/json" data-wcs-ssr-props>` は無くなりました。
- フォームの値は、マークアップと違う場合にマークアップへ書き込まれます（`<wcs-state>` のあるページなら `enable-ssr` の有無を問わない）: input の `value` 属性と `checked` 属性、select で選ばれている option の `selected`、textarea のテキスト。パスワードの値は書き込まず（クライアントのバインディングが入れる）、`{{` を含む textarea の値も書き込みません。
- `<wcs-ssr>` が生成されるのはルートの `<wcs-state enable-ssr>` だけで、ボリューム（`mount="…"`）やコンポーネントの `<wcs-state bind-component>` には生成されません。ボリュームのデータはルートのスナップショットに入ります。

クライアント側の `@wcstack/state` はハイドレーション時に `<wcs-ssr>` 要素を読み取り、状態とテンプレートを復元し、再レンダリングなしでリアクティビティを再開します。

### サーバーとクライアントのバージョン

`<wcs-ssr version>` はページを描いた `@wcstack/state` のバージョンで、クライアントは自分と同じ major.minor のスナップショットだけをハイドレーションします。**`@wcstack/server` とクライアントは同じ major.minor でそろえて同時にデプロイしてください。**

- 4.0 のクライアントは 3.x のサーバーの出力を捨てます。`<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` と警告し、サーバーが無かったものとしてクライアントでページを描きます — 状態は自分のソースから読み込まれ、`$connectedCallback` はクライアントで実行され、サーバーの行・枝・マーカーは元のテンプレートに戻されます。さらに、3.5.2 までの 3.x サーバーの出力では、テンプレートの外のテキストバインディングがフィルタを失います（警告にもそう出ます）。切り替えるときは、3.x のサーバーが描いてキャッシュされた HTML を破棄してください。
- 4.0 のサーバーと 3.x のクライアントの組み合わせはサポートしません。3.x のクライアントは 4.0 のマーカーを読めません。

詳しくは[移行ガイド §3.6](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.ja.md#36-ssr) を参照してください。

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
- クライアント側でのハイドレーション（再レンダリングなしでバインディング復元）。サーバーの行と枝は、入れ子のものも含めてその場で引き取られる
- `enable-ssr` の無い `<wcs-state>` もサーバーでは描画されるが、`<wcs-ssr>` が付かずハイドレーションされない。クライアントで状態に追従するのはテンプレートの外の `data-wcs` 属性のバインディングだけで、`{{ }}` のテキスト・行・枝はサーバーが描いたまま残る

### カスタム要素の待機

- `static hasConnectedCallbackPromise = true` プロトコル準拠の全カスタム要素を自動待機
- 安定化ループ: await 後に DOM を再走査し、`$connectedCallback` 中に動的追加されたカスタム要素も待機（最大 10 回）

### Router SSR

`<wcs-router>` に `enable-ssr` を付け、リクエストの `url` を渡します（設計: [docs/ssr-router-design.md](https://github.com/wcstack/wcstack/blob/main/docs/ssr-router-design.md)）:

```javascript
const body = await renderToString(template, {
  url: `http://localhost:3000${req.url}`,
  bootstraps: [
    // HTMLElement を継承するクラスは純 Node でトップレベル import できないため
    // 非同期ローダーで渡す（DOM グローバル設置後にモジュール評価される）
    async () => (await import('@wcstack/state')).bootstrapState(),
    async () => (await import('@wcstack/router')).bootstrapRouter(),
  ],
});
```

- リクエスト URL の初期ルートがサーバーで描画される — 型付きパラメータ・ネストルート・ルート内容中の構造テンプレート（`for:` / `if:`）を含む。
- クライアント側 router はサーバー描画済み DOM を再描画せずに**採用（adopt）**する。採用ノード上で state のバインディングは生きたまま。サーバー出力が検証に通らない場合（URL 不一致・template 変更等）は静かに通常のクライアント描画へフォールバックする。
- `<wcs-ssr>` スナップショットはサーバー主導の最終パス（ssr-snapshot プロトコル）で生成され、読み込み順に関係なくルート内容がハイドレーションデータに載る。
- `<wcs-link>` の anchor はサーバーで描画され（`active` / `aria-current` 付き）、クライアントが採用する。
- サブパス配備は `baseHref` を渡し、クライアントにも同じ `<base href>` を配信する。

## SSR でできないこと

- `<head>` 内の `<script src="...">` や `<link>` の自動実行
- ブラウザ固有 API（localStorage, sessionStorage, navigator 等）
- Shadow DOM のレンダリング（Declarative Shadow DOM 非対応）
- イベントハンドラの登録（クライアント側のハイドレーションで復元）
- `<wcs-autoloader>` による動的コンポーネント読み込み
- `outerHTML:` / `outerText:` の適用（クライアントで適用される。サーバー出力には書かれたままの要素が入るので、検索エンジンや JS なしの表示が見る HTML にその値は載らない）
- ページ直下でバインドされた Light DOM のカスタム要素が値から描く子要素の描画（クライアントが描く。自分で書いた子要素は出力に残る）
- `$watch` ハンドラや `$stream` のソースの実行（サーバーではストリームは `initial` の値のまま。どちらもクライアントで始まる）
- guard 付きルートのサーバー描画（設計上 — guard はクライアントで実行される認可の地点なので、アウトレットは空のまま）、`<wcs-layout>` ルート（採用したページはクライアント描画へフォールバック）、`<wcs-head>` の中身（反映先は `document.head` で、body だけの出力には載らない）

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
  <script type="module" src="/packages/state/dist/auto.min.js"></script>
</head>
<body>${ssrBody}</body>
</html>`;
```

### 複数パッケージを使う場合

```javascript
const ssrBody = await renderToString(template, {
  baseUrl: 'http://localhost:3001',
  // 非同期ローダーで渡す: これらのパッケージは純 Node でトップレベル import できない
  bootstraps: [
    async () => (await import('@wcstack/state')).bootstrapState(),
    async () => (await import('@wcstack/fetch')).bootstrapFetch(),
  ],
});
```

## 仕組み

### レンダリングパイプライン

1. **グローバルのセットアップ**: happy-dom の `Window` を作成し、ブラウザグローバル（`document`、`HTMLElement`、`MutationObserver` 等）を `globalThis` に一時的にインストール。`URL.createObjectURL` を無効化し、インラインスクリプトの base64 data URL フォールバックを強制。

2. **SSR モード**: `<html>` 要素に `data-wcs-server` 属性を設定。`@wcstack/state` はこの属性を検出して SSR 動作を有効化。

3. **ブートストラップ**: ユーザー提供の bootstrap 関数を呼び出す（省略時は `bootstrapState()` をデフォルト使用）。

4. **HTML パースとコールバック**: `document.body.innerHTML` に HTML をセットすることで、happy-dom の要素ライフサイクルが発火。各 `<wcs-state>` がデータソースをロードし `$connectedCallback` を実行。`hasConnectedCallbackPromise` を持つ全カスタム要素を安定化ループで待機 — await 後に DOM を再走査し、動的追加された要素も検出（最大 10 回）。

5. **Ready**: `getBindingsReady()` を持つ全カスタム要素クラスのそれを待機（`<wcs-state>` のバインディング構築。`waitForReady` 参照） — テキスト補間、属性マッピング、リスト展開、条件評価。

6. **SSR メタデータ**: `@wcstack/state` が設置したスナップショットビルダー（ssr-snapshot プロトコル）を最終パスとして呼び出す。フォームの値をマークアップに書き込み、各リストの行と描かれた枝をアンカー直後の印付きの領域へ移し、各ルートの `<wcs-state enable-ssr>` の直前に `<wcs-ssr>` 要素を挿入。

7. **クリーンアップ**: 元のグローバルを復元し、happy-dom ウィンドウを閉じる。

### クライアント側のハイドレーション

クライアント側の `@wcstack/state` は `<wcs-ssr>` 要素を検出し、バージョンが自分と同じ major.minor なら以下を行います：
1. 状態を自分のソースから読み込んでスナップショットのデータで上書きし（getter・setter・メソッドはそのまま）、サーバーで実行済みの `$connectedCallback` はスキップ
2. テンプレートをアンカー（`<!--wcs-p:ID-->`）の位置に戻し、テキストのマーカーをバインディングに戻す
3. サーバーの行と枝をその場で引き取り、全バインディングを当てる — その中のカスタム要素は一度だけ接続され、切断されることはない。テンプレートと形の合わなくなったサーバーの行はその場で作り直し、クライアントが描かない行や枝（行が減った、別の枝）はページのバインドが済むとすぐに取り除く
4. 通常のリアクティブバインディングを再開

レンダリング済みの DOM は即座に表示されます — ハイドレーションはインタラクティビティの復元のみを行います。別の major.minor のスナップショットは捨てられ、ページはクライアントで描かれます（[サーバーとクライアントのバージョン](#サーバーとクライアントのバージョン)）。

## ライセンス

MIT
