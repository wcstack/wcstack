# websocket-chat — 1 つのシナリオ、5 つのスタック

同じリアルタイム Echo / Broadcast チャットを、同じ `<wcs-ws>` IO ノードと同じ
WebSocket サーバーの上に 5 通りの方法で実装したデモ群です。ポイントは
**IO ノードの可搬性** — 接続管理・自動再接続・JSON パースはカスタム要素の中に
封じられ、各スタックはその状態を*どう描画するか*だけを決めます。

| Variant | スタック | ポート | ビルド |
|---------|---------|--------|--------|
| [`vanilla/`](vanilla/) | 素の JS + `@wc-bindable/core` の `bind()` | 3304 | 不要 (CDN) |
| [`state/`](state/) | `@wcstack/state` (`data-wcs` バインディング) | 3300 | 不要 (CDN) |
| [`signals/`](signals/) | `@wcstack/signals` (`bindNode()` + `h()`/`For()`) | 3305 | 不要 (CDN) |
| [`react/`](react/) | React 19 + `@wc-bindable/react` | 3301 | Vite |
| [`vue/`](vue/) | Vue 3 + ネイティブなカスタム要素バインディング | 3302 | Vite |

`shared/` にはデモサーバー（静的配信 + `/ws` エンドポイント）、`ws` 依存、
共通スタイルシートが入っています。1 つの variant だけをリポジトリ外へコピー
する場合は `shared/` も一緒に持っていってください。

## セットアップ

```bash
# 1. 共有 WebSocket サーバーの依存をインストール（初回のみ）
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. ビルド不要の variant を起動 (vanilla / state / signals)
node examples/websocket-chat/state/server.js     # http://localhost:3300
node examples/websocket-chat/vanilla/server.js   # http://localhost:3304
node examples/websocket-chat/signals/server.js   # http://localhost:3305

# 3. React / Vue は install + build が必要
cd examples/websocket-chat/react && npm install && npm run build && node server.js  # http://localhost:3301
cd examples/websocket-chat/vue   && npm install && npm run build && node server.js  # http://localhost:3302
```

すべての variant が同じプロトコルを話すので、別々の variant を別タブで開いて
相互に broadcast できます。メッセージプロトコルは
[state variant の README](state/README.ja.md#websocket-プロトコル) を参照してください。
