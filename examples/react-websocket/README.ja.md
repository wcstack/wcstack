# React + wcstack websocket demo

React 19 アプリ内で `<wcs-ws>` Web Component を `@wc-bindable/react` アダプター経由で使う、フレームワーク相互運用デモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## このデモが示すこと

**Web Components はどのフレームワークでも動く。** `<wcs-ws>` カスタム要素は [wc-bindable プロトコル](https://github.com/user/wc-bindable-protocol) を実装しています。`@wc-bindable/react` アダプターの `useWcBindable()` フックにより、全バインド可能プロパティが自動的に React state に同期されます。手動の `addEventListener` は不要です。

## 使用するもの

- React 19（esm.sh 経由の ESM、ビルド不要）
- htm（タグ付きテンプレートによる JSX 代替）
- `@wc-bindable/react` アダプター
- `/packages/websocket/dist/auto.js`

## 起動手順

```bash
# 1. websocket パッケージをビルド
cd packages/websocket && npm run build && cd ../..

# 2. サーバー依存をインストール
cd examples/react-websocket && npm install && cd ../..

# 3. 起動
node examples/react-websocket/server.js
```

ブラウザで `http://localhost:3301` を開いてください。
複数タブを開くとブロードキャストの動作を確認できます。

## 環境変数

- `PORT`: 任意。既定値は `3301`

## @wc-bindable による React での使い方

```js
import { useWcBindable } from "@wc-bindable/react";

function App() {
  // wc-bindable プロパティが自動的に同期される
  const [wsRef, ws] = useWcBindable({
    message: null,
    connected: false,
    loading: false,
    error: null,
  });

  // ws.connected, ws.message 等はライブな React state
  return html`
    <wcs-ws ref=${wsRef} url="ws://..." auto-reconnect="" />
    <p>Status: ${ws.connected ? "Connected" : "Disconnected"}</p>
  `;
}
```

## WebSocket プロトコル

[state-websocket example](../state-websocket/README.ja.md#websocket-プロトコル) と同じです。

## このデモで確認できること

- React コンポーネントツリー内での `<wcs-ws>` レンダリング
- `useWcBindable()` による自動プロパティ同期 — 手動イベントリスナー不要
- `send` プロパティセッターを使ったメッセージ送信
- `auto-reconnect` による自動再接続
- リアルタイムなクライアント数・アップタイム表示
- 完全 ESM、ビルドレス（Import Maps + esm.sh + htm）
