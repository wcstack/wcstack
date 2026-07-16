# @wcstack/accelerometer

`@wcstack/accelerometer` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（Accelerometer）コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの加速度読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-accelerometer>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `x`、`y`、`z`、`error`、`errorInfo`

`@wcstack/accelerometer` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`AccelerometerCore`）がプラットフォームの`Accelerometer`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-accelerometer>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`を宣言

## なぜ存在するか — プラットフォームAPI自体がnever-throwと最初から一致する稀な例

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`Accelerometer`のコンストラクタ自体です。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"accelerometer"})`が既に存在するため、`<wcs-accelerometer>`は`<wcs-permission name="accelerometer">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

> **Chromium/Android中心の対応。** デスクトップでは`Accelerometer`クラスが存在しても`SecurityError`になりがちです。unsupported/deniedを既定状態として設計してください。

## インストール

```bash
npm install @wcstack/accelerometer
```

## クイックスタート

### 1. 加速度をライブ表示

`<wcs-accelerometer>`は接続時に**自動開始しません** — バインドしただけでは
`x`/`y`/`z`は初期値`null`のままです。読み取りを流すには（例えばボタンから）
`start`コマンドを発火する必要があります:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/accelerometer/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startAccel"],
      x: null, y: null, z: null,
    };
  </script>
</wcs-state>

<wcs-accelerometer
  data-wcs="x: x; y: y; z: z; command.start: $command.startAccel"
></wcs-accelerometer>

<button data-wcs="onclick: $command.startAccel">開始</button>
<p data-wcs="textContent: x"></p>
```

ボタンは`<wcs-accelerometer>`に直接触れません: クリックは`startAccel`コマンドトークンを発火し（`$commandTokens: ["startAccel"]`で名前を宣言）、`<wcs-accelerometer>`は`command.start: $command.startAccel`でそれを購読します（[command-token プロトコル](../state/) — コマンドメソッドを持つ要素が*subscriber*であり、emitter ではありません）。

### 2. 権限を確認してから start する

この例では`@wcstack/permission`の登録も必要です（例1の`@wcstack/state` /
`@wcstack/accelerometer`の script に加えて）。`accelGranted`を宣言する
独立した`<wcs-state>`を持ちます:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startAccel"],
      accelGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="accelerometer" data-wcs="granted: accelGranted"></wcs-permission>
<wcs-accelerometer data-wcs="command.start: $command.startAccel"></wcs-accelerometer>

<button data-wcs="onclick: $command.startAccel; disabled: accelGranted|not">開始</button>
```

バインドする state パスは事前にすべて宣言する必要があります — 未宣言のパスへのバインドは初期化時に例外を投げます。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ(`accelGranted|not`)で行います。

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`Accelerometer`コンストラクタへそのまま渡る。 |

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | --------------------------- | ---- |
| `x`        | `wcs-accelerometer:reading` | x軸方向の加速度。初回読み取り前は`null`。 |
| `y`        | `wcs-accelerometer:reading` | y軸方向の加速度。 |
| `z`        | `wcs-accelerometer:reading` | z軸方向の加速度。 |
| `error`    | `wcs-accelerometer:error`   | 正規化された`{ error, message }`、無ければ`null`。 |
| `errorInfo` | `wcs-accelerometer:error-info-changed` | シリアライズ可能な失敗分類（`WcsIoErrorInfo` — 安定した `code` / `phase` / `recoverable`）、無ければ`null`。`error`から派生する追加的な出力で、既存の`error`の形状は不変。 |

`x`/`y`/`z`は単一の`wcs-accelerometer:reading`イベントから派生します（ネイティブの1回の`reading`イベントで3軸が同時に更新される）。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。
- **`error`は sticky（据え置き）です。** 最後に観測した失敗（`unsupported`、`SecurityError`等）を保持し、その後の`start()`成功や`reading`受信では自動クリアされません。`stop()`＋`start()`でリトライが成功しても直前の`error`は残り続けます。必要なら利用側の state でクリア／再解釈してください。
- **`errorInfo` 分類（taxonomy）。** 同じ失敗をシリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-accelerometer:error-info-changed`）で、`error`の形状は変更しません。正規化された error 名に応じて対応づけます: `unsupported` → `capability-missing`（phase `probe`）、`SecurityError` / `NotAllowedError` → `not-allowed`（phase `start`）、`NotReadableError` → `not-readable`（phase `execute`）、その他のセンサー失敗 → `sensor-error`（phase `execute`）。いずれも `recoverable: false` です。`errorInfo` は `error` と完全に同じタイミングで遷移するため、同様に **sticky** で、`error` が `null` に戻るときにのみ `null` に戻ります。共有の `WcsIoErrorInfo` 型と `WCS_ACCELEROMETER_ERROR_CODE` 定数はエクスポートされます。
- **生の`new Accelerometer(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="accelerometer">`と合成してください。

## `:state()` による CSS スタイリング

`<wcs-accelerometer>` は1つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。`x`/`y`/`z`（連続的なセンサー読み取り値）
は意図的に反映**しません** — `docs/custom-state-reflection-design.md` §3.2 参照。

| ステート | on になる条件 |
|----------|----------------|
| `error` | `wcs-accelerometer:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-accelerometer:state(error) ~ .fallback { display: block; }
```

`error` は sticky です（上記「注意・制限」参照）: 一度 on になると、後続の
`wcs-accelerometer:error` が `null` の detail で発火するまで on のままです —
その後の `start()` 成功や `reading` 受信では自動クリアされません。

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-accelerometer>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-accelerometer:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["error"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-accelerometer debug-states></wcs-accelerometer>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`AccelerometerCore`）

```typescript
import { AccelerometerCore } from "@wcstack/accelerometer";

const core = new AccelerometerCore();
core.addEventListener("wcs-accelerometer:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// 後始末:
core.dispose();
```

## ライセンス

MIT
