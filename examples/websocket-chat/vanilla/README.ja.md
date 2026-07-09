# vanilla + websocket デモ

[websocket-chat](../README.ja.md) シナリオのフレームワーク不使用ベースライン。
素の JavaScript と手組みの DOM を、同じヘッドレス `<wcs-ws>` ノードの上に載せています。

`@wc-bindable/core` の `bind()` が要素の wcBindable 出力
（`connected` / `loading` / `error` / `message`）を小さなビュー状態オブジェクトへ
流し込み、送信は要素の公開コマンド `sendMessage()` を直接呼びます。
エンジンなし・ビルドなし — アプリ全体が 1 つの `<script type="module">` です。

## 使用しているもの

- `@wcstack/websocket`（CDN / `esm.run`）
- `@wc-bindable/core`（CDN import map）

## セットアップ

```bash
# 1. 共有 WebSocket サーバーの依存をインストール（チェックアウトごとに初回のみ）
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. デモサーバーを起動
node examples/websocket-chat/vanilla/server.js
```

`http://localhost:3304` を開きます。
複数タブ（他の variant でも可）を開くと broadcast が確認できます。

## 環境変数

- `PORT`: 省略可、デフォルトは `3304`

## WebSocket プロトコル

[state variant](../state/README.ja.md#websocket-プロトコル) と同じです。

## このデモが示すもの

- リアクティブエンジン**なし**で消費する可搬な IO ノードとしての `<wcs-ws>`
- 最小の wc-bindable コンシューマとしての `bind()`（プロパティをミラー → 描画）
- `sendMessage()` コマンドメソッドによる送信
- 要素の内部で完結する `auto-reconnect`
