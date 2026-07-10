# tilt + accelerometer + raf + wakelock デモ（ボール迷路）

木製の迷路おもちゃ、あれの wcstack 版です。スマホを傾けてボールを転がし、
4 つの穴を避けて旗までたどり着く。5 パッケージすべてに本物の役割があり、
**ゲームループまでもが宣言的なタグ**です。

> 同じゲームの `@wcstack/signals` コア版もあります — 迷路も I/O ノード
> （無改変）も同一: コア差し替えで何が変わるかの比較は
> [`examples/signals-tilt-maze`](../signals-tilt-maze/) を参照。

| パッケージ | 役割 |
|---|---|
| `@wcstack/tilt` | `beta` / `gamma` が重力ベクトルになる |
| `@wcstack/raf` | `<wcs-raf>` が 1 フレーム = 1 物理ステップを駆動（一級の `dt` 付き） |
| `@wcstack/accelerometer` | シェイク検出（\|accel\| が 9.8 m/s² から大きく乖離）→ リスタート |
| `@wcstack/wakelock` | `phase === "playing"` の**あいだだけ**画面を消灯させない |
| `@wcstack/state` | 物理・衝突・フェーズ管理・描画のすべて |

## はじめかた

バックエンドもビルドも不要 — 静的サーバーなら何でも動きます:

```bash
npx serve examples/state-tilt-maze
```

- **デスクトップ**: ボードをドラッグして傾けます（DevTools → Sensors の
  orientation エミュレーションでも可）。物理座標は 320×320 ボードの CSS
  ピクセルそのものなので、見えているものと衝突判定が完全に一致します。
- **スマホ**: センサーには secure context が必要 — HTTPS で配信するか
  `adb reverse tcp:3000 tcp:3000`（Android）を使ってください。iOS は Start
  ボタンのタップで tilt の許可が下ります。シェイクは Generic Sensor API
  （Chromium/Android）が必要で、無い環境では Retry ボタンが代わりです。

## データフロー

```
<wcs-tilt> ──beta/gamma──▶ state.tiltBeta/tiltGamma ─┐
ポインタドラッグ ──▶ state.simBeta/simGamma ─────────┤ get effBeta/effGamma
                                                     ▼
<wcs-raf> ──eventToken.tick (detail.dt)──▶ $on.frameTick ─▶ step(dt)
                                                     │  速度積分・衝突判定・
                                                     │  穴/ゴール判定
                                                     ▼
                       state.ballX/ballY ──▶ style.transform（ボールが動く）

<wcs-accelerometer> ──x/y/z──▶ step() 内のシェイク判定 ──▶ restart()
state.isPlaying ──active──▶ <wcs-wakelock> ──held──▶ HUD チップ
```

## 押さえどころ

- **ゲームループが宣言的 — しかも vsync 整合。** `<wcs-raf>` がブラウザの
  フレームを event token（`eventToken.tick: frameTick`）として配り、
  `$on.frameTick` が `step(detail.dt)` を 1 回実行します。フレーム差分 `dt`
  はノードの一級出力で、start/リスタート/タブ可視性の境界では `0` —
  ゲーム側に時計の簿記が一切なく、バックグラウンドのタブがボールを
  テレポートさせることもありません。HUD の「game loop」チップは純 CSS:
  `wcs-raf:state(running)` で緑、非表示タブでループが枯渇すると
  `wcs-raf:state(suspended)` でアンバーになります。
- **センサーはただの入力ノード。** 物理は `effBeta` / `effGamma` getter しか
  読みません。実センサーとドラッグフォールバックは**別々の** state パスに
  書き込み、getter がソースを選ぶだけ — 入力を差し替えても下流は何も
  変わりません。デスクトップでも、許可拒否でも、センサー非搭載でも、
  同じゲームがそのまま遊べます。
- **センサー有効化は command token。** Start ボタンの `startGame()` は
  `$command.startSensors` トークンを 1 回 emit するだけ。各要素は自分の
  メソッドを HTML 側で購読しています（`<wcs-tilt>` に
  `command.requestPermission` + `command.start`、`<wcs-accelerometer>` に
  `command.start`）— state は DOM に一切触れません。emit の前に
  `whenDefined` ゲートを挟んでいます（command 購読は要素定義まで遅延され、
  それより早い emit は購読者ゼロで空撃ちになるため。user activation は
  時間窓なので、この await を挟んでも iOS の許可ゲートは満たされます）。
  許可を await せずに `start()` を撃っても安全です: ゲートはイベント
  **配送**側にあってリスナー登録側には無いため、未許可の購読はただ沈黙
  するだけです（それ以外の環境では `requestPermission()` が即 `"granted"`
  を返します）。
- **シェイクは導出シグナル。** `<wcs-accelerometer>` は `x/y/z` を流すだけ。
  `step()` が `|accel|` を計算し、重力（9.81 m/s²）からの大きな乖離を
  シェイクとみなします（クールダウン 1.2 秒）。デスクトップではセンサーが
  仕様どおりエラー（`NotReadableError`）になりますが、never-throw なので
  sticky な `error` プロパティに残るだけで、ゲームは続行します。
- **wakelock は一文で読める。** `active: isPlaying` で「プレイ中だけ画面を
  起こしておく」。`held` 出力が HUD チップに入り、OS が実際にロックを
  保持しているかを正直に表示します（ヘッドレスやデスクトップでは保持
  されないことが多い — ゲームには影響しません）。
- **物理はトンネリング不能な設計。** `V_MAX`（260 px/s）×クランプ済み
  フレーム時間（40 ms）が壁の厚み 12 px を下回るため、軸分離の衝突判定が
  壁をすり抜けることは構造的にありません。
- **ポインタキャプチャの罠。** `dragStart` はポインタをキャプチャしますが、
  キャプチャは派生 `click` の宛先も変えてしまうため、Start オーバーレイ上で
  キャプチャするとボタンの click が奪われます。そこでドラッグ開始を
  `phase === "playing"`（ボードにオーバーレイが無い唯一のフェーズ）に
  ゲートしています。

## 検証済み

実ブラウザ（headless Chromium）で検証してから出荷しています: 描画・
ドラッグフォールバック・壁衝突・合成 tilt 操作・穴落下・シェイク配線に
加えて、クローズドループの自動操縦がボールを 4 レーンすべて通してゴールまで
運びきる走破テストを実施 — 迷路がクリア可能であることまで証明済みです。
