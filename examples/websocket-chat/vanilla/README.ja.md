# vanilla + websocket デモ

[websocket-chat](../README.ja.md) シナリオのフレームワーク不使用ベースライン。
素の JavaScript と手組みの DOM を、同じ IO ロジックの上に載せています — ただし
**`WebSocketCore` を直接**消費し、要素は一切使いません。

`bind()` が要求するのは consumer 側の `EventTarget` 面と
`constructor.wcBindable` 宣言だけで、wcstack の Core はまさにそれです
（規範化されたサーフェス —
[async-io-node-guidelines §3.9](../../../docs/async-io-node-guidelines.md)
参照）。つまりアダプタはヘッドレスな Core を一級ターゲットとして束縛できます:
カスタム要素なし・`customElements` レジストリ非関与・定義タイミング管理不要。
`bind()` が Core の wcBindable 出力（`connected` / `loading` / `error` /
`message`）を小さなビュー状態オブジェクトへ流し込み、
`core.connect(url, options)` がソケットを開始し（auto-reconnect 込み）、送信は
Core の `send()` コマンドを直接呼びます。エンジンなし・ビルドなし — アプリ全体
が 1 つの `<script type="module">` です。

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

- リアクティブエンジン**なし**・**要素もなし**で消費する可搬な IO ノード:
  `bind(new WebSocketCore(), …)` がヘッドレスな Core を直接束縛
- 最小の wc-bindable コンシューマとしての `bind()`（プロパティをミラー → 描画）
  — プロトコルが要求するのは `EventTarget` 面だけ、の実演
- Core の手動ライフサイクル: `core.connect(url, { autoReconnect, … })` が要素
  variant の属性を置き換える。送信は Core の `send()` コマンド
- Core の内部で完結する `auto-reconnect`
