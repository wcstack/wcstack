# :state() ショーケース

> **注意**: このデモが示す `:state()` へのビジュアル状態反映は `@wcstack/fetch` / `@wcstack/websocket`
> **v1.17.0 以降**で有効です。それより古いバージョンが CDN（`esm.run`）から解決された場合でも
> コンポーネント自体は正常に動作しますが、状態に応じた CSS は一切当たりません（`:state()` セレクタが
> サイレントに一度もマッチしないだけで、壊れたり例外が出たりはしません）。

## これは何か

`@wcstack/state` と `@wcstack/fetch` / `@wcstack/websocket` を組み合わせたデモです。全ての wcstack I/O
ノードは自身のブール出力状態（`loading` / `error` / `connected` など）を
[`CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet) に反映しており、
CSS の `:state()` 疑似クラスだけでローディングスピナー・エラーバナー・接続インジケータを組み立てられます。

**このページの `<wcs-state>` 内スクリプトは `loading` / `error` / `connected` を一度も読みません。**
スピナー・エラーバナー・接続ドットの見た目は、すべて `<style id="state-css">` ブロックの CSS だけで
駆動されています（ページ下部の「Show the CSS」から実際に効いているルールをそのまま読めます）。

## 起動方法

各パッケージは CDN（[esm.run](https://esm.run)）から読み込むため、ローカルビルドは不要です。

```bash
# 1. 共有 WebSocket サーバーの依存をインストール（初回のみ。examples/websocket-chat と共用）
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. 起動
node examples/state-custom-states/server.js
```

http://localhost:3303 でアクセスできます。

環境変数 `PORT` で変更可能です（既定値 `3303`）。

## 機能

- **セクション1: 非同期データ取得**（権限プロンプト不要・ファーストビュー）
  「Load (fast)」「Load (slow, ~2.5s)」「Load (fails)」の3ボタンでモック API
  `/api/widgets?mode=fast|slow|fail` を叩き分けます。`<wcs-fetch>` の
  `:state(loading)` でスピナー表示・一覧の減光、`:state(error)` でエラーバナー表示。
  `:has()` の例として、DOM 上で要素より前（ページ最上部）に置かれた共通エラーバナーも
  同じ `:state(error)` から連動させています（`~` の隣接兄弟セレクタは後方の兄弟しか
  選択できないため、前方の要素をスタイルするには `:has()` が唯一の手段です）。
- **セクション2: 接続インジケータ**
  `<wcs-ws>` の `:state(connected)` で緑ドット、`:state(loading)`（接続/再接続中）で
  オレンジドット、`:state(error)` でカード全体が赤枠に切り替わります。
  Disconnect / Reconnect ボタンは command-token 経由（`$command.disconnectWs` /
  `$command.reconnectWs` → `<wcs-ws>` の `close()` / `connect()`）で駆動します。
- **デバッグ観測性チェックボックス**
  `debug-states` 属性を両ノード（`#widgets-fetch` / `#ws-conn`）にトグルします。ON にして
  DevTools の Elements パネルを開いたままボタン操作すると、`data-wcs-state-loading` /
  `data-wcs-state-error` / `data-wcs-state-connected` がリアルタイムに切り替わる様子を
  確認できます（スタイリング用途ではなく、あくまでデバッグ観測用のミラー属性です）。
- **CSS が主役**
  ページ下部の「Show the CSS」を開くと、実際に効いている `:state()` セレクタ一式がそのまま
  読めます（`<style id="state-css">` の内容を、ページ末尾の小さなスクリプトでそのまま
  `<pre>` にコピーしているだけで、手書きの二重管理はしていません）。

## ポイント

- **状態購読コード0行**: `<wcs-state>` の `<script type="module">` は `mode` / `attempt` /
  `widgets`（データ）と `url`（入力）、コマンドトークンしか読み書きしません。`loading` /
  `error` / `connected` は一切バインドしていません — CSS が直接コンポーネント自身の
  `:state()` を読むため、JS 側の購読コードが不要になります。
- **`:state()` は書き込み不可**: 属性や class と違い `:state()` は要素の外側から書き換えられ
  ないため、入力と出力が混同する余地がありません（`docs/custom-state-reflection-design.md`
  決定1・2）。
- **隣接兄弟セレクタが基本形**: `#widgets-fetch:state(loading) ~ .spinner` のように、状態を
  持つ要素の**後方**にある兄弟（の子孫を含む）だけを選択できます。`<wcs-fetch>` /
  `<wcs-ws>` はヘッドレスなので、見た目を持つ要素より前に置くのが定石です。
- **`:has()` は前方・祖先方向に届く唯一の手段**: ページ最上部の共通バナーのように、状態を
  持つ要素より DOM 上で前にある要素をスタイルしたい場合は、共通の祖先（ここでは
  `<body>`）に対して `:has()` を使います。
- **デグレードは静か**: 対応ブラウザ未満（Chrome/Edge 125 未満・Safari 17.4 未満・
  Firefox 126 未満）や `attachInternals` 非対応環境では、状態は単に一度もセットされず
  `:state()` セレクタが常にマッチしないだけです。コンポーネントの機能そのものは影響を
  受けません（never-throw）。
- **SSR は非対応**: `:state()` は HTML にシリアライズできないため、`@wcstack/server` で
  サーバーレンダリングしても初期ペイントには状態スタイルが乗りません。事前ペイントの
  ギャップを埋めたい場合は `wcs-fetch:not(:defined)` のようなパターンを併用してください。
- **`ws` 依存の再利用**: このデモの WebSocket サーバーは新規に依存を追加せず、
  `examples/websocket-chat` と同じく `examples/websocket-chat/shared/` の共有ヘルパー
  （`ws` パッケージが既にインストール済み）を再利用しています。

## 関連ドキュメント

- [docs/custom-state-reflection-design.md](../../docs/custom-state-reflection-design.md) — この機能の設計文書
- `packages/fetch/README.ja.md` / `packages/websocket/README.ja.md` の「`:state()` による CSS スタイリング」節
