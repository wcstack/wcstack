# wcstack SSR デモ

`@wcstack/state` と `@wcstack/server` を使ったサーバーサイドレンダリングのデモです。

## クイックスタート

```bash
cd examples/ssr
npm install
npm start
```

http://localhost:3001 を開いてください（ポートは `PORT` で変えられます）。

### リポジトリのビルドで動かす（`WCS_LOCAL=1`）

作業ツリーの変更を公開前に試すには、npm のインストールと CDN の代わりにリポジトリ自身のビルドでデモを動かします（`npm install` は不要です）。

```bash
WCS_LOCAL=1 node examples/ssr/server.js
```

`WCS_LOCAL=1` は `packages/server/dist`（`@wcstack/state` は `packages/server/node_modules` を通して `packages/state` に解決されます）で描画し、`/packages/<pkg>/dist/…` をリポジトリから配り、クライアントを固定した `esm.run` の URL ではなく `/packages/state/dist/auto.min.js` から読み込みます。サーバーとクライアントが同じエンジンで動きます。指定しなければ何も変わりません。e2e スイート（`e2e/tests/ssr-example.spec.ts`）はこの形でデモを動かします。

## このデモで確認できること

### サーバーサイドレンダリング
- HTML はブラウザに送信される前にサーバー上で完全にレンダリングされます
- `$connectedCallback` → `fetch("/api/users")` によるデータ取得もサーバー上で実行されます
- レンダリング済み HTML にはすべてのユーザーデータが含まれるため、JavaScript のロード前にコンテンツが表示されます

### ハイドレーション
- ブラウザで auto バンドル（CDN の `/auto` エントリ、実体は `dist/auto.min.js`）がロードされると、既存の DOM がハイドレーションされます（再レンダリングではありません）
- イベントハンドラが有効化されます（ボタンが動作するようになります）
- 状態の変更がリアクティブに DOM へ反映されます

### デモに含まれる機能

| 機能 | 説明 |
|---|---|
| `$connectedCallback` + `fetch()` | サーバーが `/api/users` を取得してリストをレンダリング |
| `{{ counter }}` | Mustache テキストバインディング（+1 ボタン付き） |
| `for: users` | リストレンダリング（追加・削除ボタン付き） |
| `if: show` / `else:` | 条件ブロック（トグルボタン付き） |
| `<wcs-ssr>` | 初期状態 JSON、テンプレート、バージョン情報を含むハイドレーションデータ |

## アーキテクチャ

```
ブラウザリクエスト
    │
    ▼
┌──────────────────────────────────┐
│  server.js (Node.js)             │
│                                  │
│  1. template.html を読み込み     │
│  2. renderToString() で          │
│     happy-dom + @wcstack/state   │
│     を使ってレンダリング         │
│  3. $connectedCallback が実行    │
│     → fetch("/api/users")        │
│  4. バインディングが適用         │
│     → for/if/text がレンダリング │
│  5. <wcs-ssr> を生成             │
│     → 状態データ + テンプレート  │
│  6. 完全な HTML を返却           │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│  ブラウザ                        │
│                                  │
│  1. HTML が即座に表示            │
│     （JavaScript 不要）          │
│  2. auto バンドルがロード        │
│  3. <wcs-state enable-ssr>       │
│     → <wcs-ssr> データを読み取り │
│     → $connectedCallback をスキップ │
│  4. サーバーの DOM を引き取る    │
│     → テンプレートを印の位置へ   │
│     → 行・枝はその場に残す       │
│     → バインディングを当てる     │
│  5. ページがインタラクティブに    │
│     → ボタン、状態変更が動作     │
└──────────────────────────────────┘
```

## ファイル構成

| ファイル | 説明 |
|---|---|
| `package.json` | 依存パッケージ: `@wcstack/server`（`@wcstack/state` は推移的依存） |
| `server.js` | SSR レンダリングと `/api/users` エンドポイントを持つ Node.js サーバー |
| `template.html` | `<wcs-state enable-ssr>` とバインディングを含むソーステンプレート |

## エンドポイント

| URL | 説明 |
|---|---|
| `http://localhost:3001/` | SSR レンダリング済みページ（キャッシュあり） |
| `http://localhost:3001/nocache` | SSR レンダリング済みページ（毎回レンダリング、ベンチマーク用） |
| `http://localhost:3001/api/users` | ユーザーデータを返す JSON API |

## SSR 出力構造

サーバーは以下のような HTML を生成します（4.0。抜粋）：

```html
<!-- ハイドレーション用 SSR メタデータ: 描画した @wcstack/state の版・状態・ページ直下のテンプレート -->
<wcs-ssr version="4.0.0-rc.8">
  <script type="application/json">{"users":[...],"show":true,"counter":0}</script>
  <template id="wcs-t0" data-wcs="for: users">...</template>
  <template id="wcs-t1" data-wcs="if: show">...</template>
  <template id="wcs-t2" data-wcs="else:">...</template>
</wcs-ssr>

<!-- 状態要素（クライアント側では $connectedCallback をスキップ） -->
<wcs-state enable-ssr>
  <script type="module">export default { ... };</script>
</wcs-state>

<!-- プリレンダリング済みテキストバインディング -->
<h2>Counter: <!--wcs-t:counter-->0<!--wcs-/t--></h2>

<!-- プリレンダリング済み for ブロック: 印に続けて行 -->
<!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><li class="user-item">...</li><!--wcs-|-->...<!--wcs-]-->

<!-- プリレンダリング済み if/else の連なり: テンプレートごとの印に続けて、描いた枝（0 = if:） -->
<!--wcs-p:wcs-t1-->
<!--wcs-p:wcs-t2--><!--wcs-[:0--><div class="info-box">This block is visible...</div><!--wcs-]-->
```

ページ直下のテキストの印は、束縛の式全体を出力フィルタごと URI エンコードして運ぶので、ハイドレーションは同じ束縛を復元します。`{{ price|toFixed(2) }}` は `<!--wcs-t:price%7CtoFixed(2)-->3.14<!--wcs-/t-->` になります。行と枝にはテキストの印がありません。式は `<wcs-ssr>` の中のテンプレートが持ち、クライアントが引き取ったノードに当てます。印の一覧は [`@wcstack/server` の README](../../packages/server/README.ja.md#ssr-出力構造) にあります。印の形式は API ではないので、それを前提に出力を加工しないでください。コメントも消さないでください（HTML 圧縮の `removeComments` などはハイドレーションを壊します）。
