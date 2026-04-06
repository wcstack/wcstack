# React + wcstack websocket demo

React 19 アプリ内で `<wcs-ws>` Web Component を `@wc-bindable/react` アダプター経由で使う、フレームワーク相互運用デモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## このデモが示すこと

**Web Components はどのフレームワークでも動く。** `<wcs-ws>` カスタム要素は [wc-bindable プロトコル](https://github.com/user/wc-bindable-protocol) を実装しています。`@wc-bindable/react` アダプターの `useWcBindable()` フックにより、全バインド可能プロパティが自動的に React state に同期されます。手動の `addEventListener` は不要です。

## スタック

| レイヤー | 技術 |
|---------|-----|
| UI | React 19 + JSX |
| ビルド | Vite |
| アダプター | `@wc-bindable/react` |
| WebSocket | `@wcstack/websocket` (`<wcs-ws>`) |
| サーバー | Node.js + ws |

## 起動手順

```bash
# 1. websocket パッケージをビルド
cd packages/websocket && npm run build && cd ../..

# 2. 依存インストール & ビルド
cd examples/react-websocket && npm install && npm run build && cd ../..

# 3. サーバー起動
node examples/react-websocket/server.js
```

ブラウザで `http://localhost:3301` を開いてください。
複数タブを開くとブロードキャストの動作を確認できます。

### 開発モード

```bash
cd examples/react-websocket
npm run dev
```

Vite dev サーバーが HMR 付きで起動します。WebSocket サーバーは別途起動が必要です。

## 環境変数

- `PORT`: 任意。既定値は `3301`

## @wc-bindable による React での使い方

```jsx
import { useWcBindable } from "@wc-bindable/react";

function App() {
  const [wsRef, ws] = useWcBindable({
    message: null,
    connected: false,
    loading: false,
    error: null,
  });

  return (
    <>
      <wcs-ws ref={wsRef} url="ws://..." auto-reconnect="" />
      <p>Status: {ws.connected ? "Connected" : "Disconnected"}</p>
    </>
  );
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
- 標準的な Vite ビルドパイプライン（JSX、バンドル、ミニファイ）
