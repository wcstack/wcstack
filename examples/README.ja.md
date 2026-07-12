# wcstack examples

パッケージ横断のデモアプリ集: どのデモも **2 つ以上の wcstack パッケージの複合**
（または SSR・フレームワーク相互運用といったリポジトリレベルの関心事）を示します。
単一パッケージにフォーカスしたデモは、各パッケージ自身の `examples/` にあります:

- `packages/fetch/examples/` — `pagination`（5 スタック比較）, `users-crud`, `infinite-scroll`
- `packages/speech/examples/` — `speech-echo`, `speak-highlight`
- `packages/defined/examples/` — `defined-loader`
- `packages/state/examples/` — バインディングの基礎

すべてのデモはビルドレスで、パッケージを CDN から直接ロードします
（`https://esm.run/@wcstack/<pkg>/auto` の 1 行。signals デモは単一の
`@wcstack/signals/dom` エントリを import）。例外は `websocket-chat` の
React / Vue variant（Vite 使用）と、`$streams` がリリースされるまで
ローカルの `packages/state` ビルドを import する `state-sse-dashboard` です。

## デモ一覧

| デモ | 組み合わせ | 起動 | URL |
|------|-----------|------|-----|
| [`websocket-chat/`](websocket-chat/) | websocket × 5 スタック (vanilla / state / signals / React / Vue) | [README](websocket-chat/README.ja.md) 参照 | :3300–:3305 |
| [`router-spa/`](router-spa/) | router + fetch + state（SPA カタログ: URL ⇄ state ブリッジ） | `node examples/router-spa/server.js` | :3000 |
| [`state-camera-record-upload/`](state-camera-record-upload/) | camera + permission + upload + state | 任意の静的サーバー（secure context 必須） | — |
| [`state-color-palette/`](state-color-palette/) | eyedropper + clipboard + storage + state | 任意の静的サーバー（EyeDropper は Chromium 限定） | — |
| [`state-cross-tab-todo/`](state-cross-tab-todo/) | storage + broadcast + state | `node examples/state-cross-tab-todo/server.js`（2 タブで開く） | :3000 |
| [`state-custom-states/`](state-custom-states/) | fetch + websocket + state（`:state()` ショーケース） | `node examples/state-custom-states/server.js`（[websocket-chat の shared インストール](websocket-chat/README.ja.md#セットアップ)が必要） | :3303 |
| [`state-intersect-scroll/`](state-intersect-scroll/) | fetch + intersection + state | `node examples/state-intersect-scroll/server.js` | :3000 |
| [`state-notification-chat/`](state-notification-chat/) | notification + permission + state | 任意の静的サーバー | — |
| [`state-permission-banner/`](state-permission-banner/) | geolocation + permission + state | 任意の静的サーバー | — |
| [`state-pomodoro/`](state-pomodoro/) | timer + wakelock + notification + state | 任意の静的サーバー（secure context 必須） | — |
| [`state-search/`](state-search/) | fetch + debounce + state | `node examples/state-search/server.js` | :3000 |
| [`state-sse-dashboard/`](state-sse-dashboard/) | sse + state（`$streams`）+ network — 1 フィード・2 流儀 | `node examples/state-sse-dashboard/server.js`（先に `packages/state` をビルド — `$streams` 未リリースのため） | :3000 |
| [`state-tilt-maze/`](state-tilt-maze/) | tilt + accelerometer + raf + wakelock + state（センサーゲーム） | 任意の静的サーバー（secure context 必須） | — |
| [`signals-live-search/`](signals-live-search/) | signals + fetch | `node examples/signals-live-search/server.js` | :3000 |
| [`signals-tilt-maze/`](signals-tilt-maze/) | signals × `state-tilt-maze` と同じ 4 センサーノード（コア差し替え比較） | 任意の静的サーバー（secure context 必須） | — |
| [`ssr/`](ssr/) | @wcstack/server（SSR + ハイドレーション） | `cd examples/ssr && npm install && node server.js` | :3001 |

「任意の静的サーバー」のデモにはバックエンドが一切ありません —
`http://localhost` で配信できれば何でも動きます。例:

```bash
npx serve examples/state-permission-banner
```

## 共有サーバーコア

`shared/server.js` は上記デモが委譲する静的配信 + JSON API コアです —
各デモの `server.js` は自分のルート定義だけを持つ薄いファイルに保たれています。
デモを 1 つだけリポジトリ外へコピーする場合は `examples/shared/` も一緒に
コピーしてください。（例外は `websocket-chat/`: `ws` 依存が必要なため
`websocket-chat/shared/` に自己完結サーバーを持ち、シナリオ単位で持ち出せます。）

多くのデモサーバーはデフォルトでポート 3000 を使うため（`PORT=…` で変更可）、
同時起動は 1 つずつにするか、リポジトリ全体をモック API 付きで配信する e2e 静的
サーバー（`cd e2e && npm run serve` → `http://127.0.0.1:4173`）を使ってください。
