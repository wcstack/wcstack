# wcstack SSR デモ

`@wcstack/state` と `@wcstack/server` を使ったサーバーサイドレンダリングのデモです。

## クイックスタート

```bash
cd examples/ssr
npm install
npm start
```

http://localhost:3001 を開いてください。

## このデモで確認できること

### サーバーサイドレンダリング
- HTML はブラウザに送信される前にサーバー上で完全にレンダリングされます
- `$connectedCallback` → `fetch("/api/users")` によるデータ取得もサーバー上で実行されます
- レンダリング済み HTML にはすべてのユーザーデータが含まれるため、JavaScript のロード前にコンテンツが表示されます

### ハイドレーション
- ブラウザで `auto.js` がロードされると、既存の DOM がハイドレーションされます（再レンダリングではありません）
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
│  2. auto.js がロード             │
│  3. <wcs-state enable-ssr>       │
│     → <wcs-ssr> データを読み取り │
│     → $connectedCallback をスキップ │
│  4. hydrateBindings()            │
│     → テンプレートを復元         │
│     → for/if ブロックを Content 化 │
│     → バインディングを登録       │
│  5. ページがインタラクティブに    │
│     → ボタン、状態変更が動作     │
└──────────────────────────────────┘
```

## ファイル構成

| ファイル | 説明 |
|---|---|
| `package.json` | 依存パッケージ: `@wcstack/server`, `@wcstack/state` |
| `server.js` | SSR レンダリングと `/api/users` エンドポイントを持つ Node.js サーバー |
| `template.html` | `<wcs-state enable-ssr>` とバインディングを含むソーステンプレート |

## エンドポイント

| URL | 説明 |
|---|---|
| `http://localhost:3001/` | SSR レンダリング済みページ（キャッシュあり） |
| `http://localhost:3001/nocache` | SSR レンダリング済みページ（毎回レンダリング、ベンチマーク用） |
| `http://localhost:3001/api/users` | ユーザーデータを返す JSON API |

## SSR 出力構造

サーバーは以下のような HTML を生成します：

```html
<!-- ハイドレーション用 SSR メタデータ -->
<wcs-ssr name="default" version="1.5.3">
  <script type="application/json">{"users":[...],"show":true,"counter":0}</script>
  <template id="u0" data-wcs="for: users">...</template>
  <template id="u1" data-wcs="if: show">...</template>
  <template id="u2" data-wcs="else:">...</template>
</wcs-ssr>

<!-- 状態要素（クライアント側では $connectedCallback をスキップ） -->
<wcs-state enable-ssr>
  <script type="module">export default { ... };</script>
</wcs-state>

<!-- プリレンダリング済みコンテンツ -->
<h2>Counter: <!--@@wcs-text-start:counter-->0<!--@@wcs-text-end:counter--></h2>

<!-- プリレンダリング済み for ブロック -->
<!--@@wcs-for:u0-->
<!--@@wcs-for-start:u0:users:0-->
<li class="user-item">...</li>
<!--@@wcs-for-end:u0:users:0-->

<!-- プリレンダリング済み if/else ブロック -->
<!--@@wcs-if:u1-->
<!--@@wcs-if-start:u1:show-->
<div class="info-box">This block is visible...</div>
<!--@@wcs-if-end:u1:show-->
```
