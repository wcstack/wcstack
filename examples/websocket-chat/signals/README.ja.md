# signals + websocket デモ

[websocket-chat](../README.ja.md) シナリオの `@wcstack/signals` 版。
fine-grained なシグナルが実 DOM を直接駆動し、その下には同じヘッドレス
`<wcs-ws>` ノードがいます。

`bindNode()` が要素の wcBindable 出力（`connected` / `loading` / `error` /
`message`）を読み取りシグナルへ適応し、`effect()` が受信メッセージを keyed な
ログ（`For()` で描画）へ振り分け、`url` 入力は `bindInput()` でリアクティブに
書き込みます。完全ビルドレス — すべて CDN から import します。

## 使用しているもの

- `@wcstack/websocket`（CDN / `esm.run`）
- `@wcstack/signals/dom`（CDN import map、ヘッドレスコアを再エクスポート）

## セットアップ

```bash
# 1. 共有 WebSocket サーバーの依存をインストール（チェックアウトごとに初回のみ）
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. デモサーバーを起動
node examples/websocket-chat/signals/server.js
```

`http://localhost:3305` を開きます。
複数タブ（他の variant でも可）を開くと broadcast が確認できます。

## 環境変数

- `PORT`: 省略可、デフォルトは `3305`

## WebSocket プロトコル

[state variant](../state/README.ja.md#websocket-プロトコル) と同じです。

## このデモが示すもの

- wc-bindable な IO ノードをシグナルへ適応する `bindNode()`
- メッセージストリームをビュー状態へ振り分ける `effect()`（ログ vs stats ハートビート）
- `For()` による keyed リスト描画（ログ行は再構築されない）
- `bindInput()` によるリアクティブな入力書き込み（`url` が接続を開始）
- `sendMessage()` コマンドメソッドによる送信
