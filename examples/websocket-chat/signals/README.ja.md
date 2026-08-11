# signals + websocket デモ

[websocket-chat](../README.ja.md) シナリオの `@wcstack/signals` 版。
fine-grained なシグナルが実 DOM を直接駆動し、その下には同じ IO ロジックが
います — ただしこの variant は **`WebSocketCore` を直接**消費し、要素を一切
使いません。

他の variant はすべて `<wcs-ws>` 要素を束縛しますが、ここではその要素が包む
Core クラスを import してそのまま `bindNode()` に渡します（Core は同じ
wc-bindable descriptor を持つ `EventTarget` — 規範化されたサーフェスです。
[async-io-node-guidelines §3.9](../../../docs/async-io-node-guidelines.ja.md)
参照）。カスタム要素が関与しないので `customElements` レジストリも upgrade も
無く、定義タイミングの管理が不要 — 依存は import だけです。`bindNode()` が
Core の出力（`connected` / `loading` / `error` / `message`）を読み取りシグナル
へ適応し、`effect()` が受信メッセージを keyed なログ（`For()` で描画）へ
振り分け、`core.connect(url, options)` がソケットを開始します（auto-reconnect
込み — 接続管理と JSON パースは要素 variant と同じく Core の中にあります）。
完全ビルドレス — すべて CDN から import します。

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

- **Core 直接束縛**: `bindNode(new WebSocketCore())` — wc-bindable な IO ノードを
  要素なし・`customElements` レジストリ非関与で消費
- Core の手動ライフサイクル: `core.connect(url, { autoReconnect, … })` が要素
  variant の `url` 属性を置き換える（再接続ポリシーは options に移る）
- メッセージストリームをビュー状態へ振り分ける `effect()`（ログ vs stats ハートビート）
- `For()` による keyed リスト描画（ログ行は再構築されない）
- Core の `send()` コマンドによる送信（never-throw: 未接続での送信は例外でなく
  `error` シグナルに流れる）
