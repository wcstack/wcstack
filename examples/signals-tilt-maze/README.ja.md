# signals ボール迷路

[`examples/state-tilt-maze`](../state-tilt-maze/) と**同じゲーム**です — 同じ迷路、
同じ物理、同じ 4 つの無改変 I/O ノード（`<wcs-tilt>` / `<wcs-accelerometer>` /
`<wcs-timer>` / `<wcs-wakelock>`）。入れ替わったのはただひとつ、リアクティブ
コアが `@wcstack/state` ではなく **`@wcstack/signals`** である点だけです。

それがこのデモの主題です。I/O 層は wc-bindable を話すだけで、背後でどの
リアクティブコアが聴いているかを知りません（気にもしません）: `bindNode` が
各ノードのプロパティイベントを signal に畳み込み、`bound.set` が入力を書き、
`bound.command` がコマンドを起動します。**コアを差し替えても、ノードはそのまま。**

## はじめかた

バックエンドもビルドも不要 — 静的サーバーなら何でも動きます:

```bash
npx serve examples/signals-tilt-maze
```

デスクトップはボードをドラッグ（または DevTools → Sensors）。スマホは HTTPS か
`adb reverse`、iOS は Start ボタンのタップで tilt の許可が下ります。プラット
フォーム上の注意は [state 版](../state-tilt-maze/README.ja.md)と同じです。

## コアを signals にすると何が変わるか

| | state 版 | signals 版 |
|---|---|---|
| I/O ノードへの配線 | `data-wcs` 属性（宣言的 DSL） | JS で `bindNode(el)`（`signals` / `set` / `command`） |
| ゲーム tick | event-token → `$on.frameTick` | `effect(() => { loop.signals.tick.get(); step(); })` |
| ホットループの値（`vx`, `lastT`…） | state プロパティ（proxy を通る） | **素の JS 変数** — リアクティブグラフに一切触れない |
| 描画に効く値 | バインドされた全パス | signal はちょうど 3 つ: `phase` / `pos` / `timeMs` |
| レンダリング | HTML テンプレート + 構造 `if:`/`for:` | `h()` — 実 DOM を一度構築、バインディング単位の effect |
| 毎フレームの DOM 仕事 | バインド済みパスごとのパイプライン更新 | `style` effect **1 個**だけ再実行（`transform: translate(...)`） |
| センサー有効化コマンド | command-token: `$command.startSensors` の emit 1 回が HTML 側の `command.*` 購読にファンアウト | ブリッジ経由の `tilt.command("requestPermission")` |
| `:state()` スタイリング（game loop チップ） | 同一 | 同一 — CSS なのでコアは無関係 |

真似する価値のある規律が 2 つ:

- **step 内は `peek()`。** 物理はすべての signal（tilt・accel・phase・pos）を
  `peek()` で読むため、駆動 effect の依存はタイマー tick ただ 1 つ。センサー
  レートで飛んでくる tilt イベントが step を余分に走らせることはありません。
- **DOM に見えるものだけを signal に。** 速度・ドラッグ状態・タイムスタンプは
  素の `let`。リアクティブグラフが見るのは 3 値だけで、フレームあたりの
  コストは的を絞った `style` 書き込み 1 回 — diff なし、ホットパスに proxy
  トラップなし。「リアルタイム描画は signals 向き」というトレードを具体化
  したものです。

## 検証済み

state 版と同じ実ブラウザ（headless Chromium）検証を通しています: 描画・
ドラッグフォールバック・壁衝突・合成 tilt 操作・穴落下、さらに自動操縦が
4 レーンすべてを通してゴールまで走破（ゲーム内約 21 秒 — state 版の物理と
一致）。
