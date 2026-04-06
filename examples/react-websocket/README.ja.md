# React + wcstack websocket demo

React 19 アプリ内で `<wcs-ws>` Web Component を `@wc-bindable/react` アダプター経由で使う、フレームワーク相互運用デモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## このデモが示すこと

**Web Components はどのフレームワークでも動く。** `<wcs-ws>` カスタム要素は [wc-bindable プロトコル](https://github.com/user/wc-bindable-protocol) を実装しています。`@wc-bindable/react` アダプターの `useWcBindable()` フックにより、全バインド可能プロパティが自動的に React state に同期されます。手動の `addEventListener` は不要です。

### 注目ポイント: 非同期処理を書いていない

WebSocket は本質的に非同期な通信ですが、このデモのアプリケーションコードには **`await`、`Promise`、`Suspense`、`async` 関数が一切登場しません。**

通常、React で WebSocket を扱うには以下のような非同期処理が付きまといます:

- 接続の確立・切断を管理する `useEffect` と cleanup 関数
- メッセージ受信を `addEventListener` や `onmessage` コールバックで購読
- 再接続ロジック（タイマー、バックオフ、リトライ上限）の自前実装
- 接続状態を `Suspense` や loading state で UI に反映

`<wcs-ws>` はこれらを **Web Component の内部に閉じ込めて** います。アプリケーション側から見ると、WebSocket の非同期性は完全に隠蔽され、`ws.connected` や `ws.message` といった**同期的なプロパティの読み取り**だけで済みます。

```jsx
// これだけで WebSocket の全状態が React state に同期される
const [wsRef, ws] = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});

// JSX 内では同期的な値として扱うだけ
<p>{ws.connected ? "Connected" : "Disconnected"}</p>
<p>{ws.message?.content}</p>
```

つまり `<wcs-ws>` は、WebSocket という非同期処理を**状態機械の購読**という形に変換しています。アプリケーションは非同期のイベントストリームを扱う代わりに、状態機械が公開するプロパティを購読するだけで済みます。非同期の複雑さは `<wcs-ws>` が吸収し、React アプリケーションは**同期的な値の表示に専念**できます。

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
