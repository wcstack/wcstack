# @wcstack/accelerometer

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/accelerometer` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（Accelerometer）コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの加速度読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-accelerometer>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `x`、`y`、`z`、`error`、`errorInfo`、そして 4.25 から `permissionState`、`supported`

`@wcstack/accelerometer` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`AccelerometerCore`）がプラットフォームの`Accelerometer`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-accelerometer>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`（4.25 から`requestPermission`も）を宣言

## なぜ存在するか — プラットフォームAPI自体がnever-throwと最初から一致する稀な例

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`Accelerometer`のコンストラクタ自体です。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"accelerometer"})`が既に存在するため、`<wcs-accelerometer>`は`<wcs-permission name="accelerometer">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

> **Chromium/Android中心の対応。** デスクトップでは`Accelerometer`クラスが存在しても`SecurityError`になりがちです。unsupported/deniedを既定状態として設計してください。4.25 から、`Accelerometer`クラスは無いが`devicemotion`のあるブラウザ（iPhone / iPad の Safari、Android の Firefox）では、そのイベントから読みます: [どこで動くか](#どこで動くか--センサーのクラスまたは-devicemotion)を参照。

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
<script type="module" src="https://esm.run/@wcstack/accelerometer/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

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

バインドする state パスは事前にすべて宣言する必要があります — 未宣言のパスへのバインドは初期化時に例外を投げます。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ(`accelGranted|not`)で行います。この例が待つのは Generic Sensor の許可で、これは `Accelerometer` クラスのものです。要素が代わりに `devicemotion` を読むところ（iPhone）では、その許可は何も教えません: 4.25 から、そこでは例 3 を使ってください。

### 3. 振った回数を数える — iPhone でも

4.25 から。1 回のタップで（聞くことがあるところでは）許可を聞いて開始します。読み取りは event token で state のハンドラへ届き、ハンドラは加速度の向きではなく大きさを見ます:

```html
<script type="module" src="https://esm.run/@wcstack/accelerometer/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["ask", "start"],
      $eventTokens: ["reading"],
      $on: {
        // 静止時の読み取りの大きさは重力（約 9.8 m/s²）。振るとそこから大きく外れる。
        reading: (state, event) => {
          const { x, y, z } = event.detail;
          const jolt = Math.abs(Math.hypot(x, y, z) - 9.81);
          if (jolt > 15 && Date.now() - state.lastShakeAt > 1000) {
            state.lastShakeAt = Date.now();
            state.shakes += 1;
          }
        },
      },
      shakes: 0,
      lastShakeAt: 0,
      motionSupported: false,
      enableShake() {
        // どちらもタップのハンドラの中で: iOS が質問を出すのはタップからだけ。
        this.$command.ask.emit();
        this.$command.start.emit();
      },
    };
  </script>
</wcs-state>

<wcs-accelerometer frequency="30"
  data-wcs="supported: motionSupported; eventToken.x: reading;
            command.requestPermission: $command.ask; command.start: $command.start"
></wcs-accelerometer>

<button data-wcs="hidden: motionSupported|not; onclick: enableShake">振る操作を有効にする</button>
<p>振った回数: <span data-wcs="textContent: shakes"></span></p>
```

`eventToken.x: reading` は、`wcs-accelerometer:reading` イベント（`x` を運ぶイベント）のたびに `reading` トークンへ渡し、ハンドラは `event.detail` から 3 軸とも取ります。`requestPermission` が聞くのは質問のあるところ（iPhone / iPad の Safari）だけで、それ以外では即 `"granted"` と答えるので、同じ 2 行がどのブラウザでも動きます。バインドするパスも、トークン（`$commandTokens`・`$eventTokens`）も、すべて state に宣言します。振る操作には、同じことをするボタンを添えてください（[アクセシビリティ](#アクセシビリティ)）。

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`Accelerometer`コンストラクタへそのまま渡る。4.25 から: `devicemotion` のフォールバックでは頻度を決める代わりに読み取りを間引き（[どこで動くか](#どこで動くか--センサーのクラスまたは-devicemotion)）、正の数でない値は `start()` のときにコンソールへ 1 回言います（`[wcs/frequency-invalid]`、注意・制限を参照）。 |

**`null` と `undefined`。** 属性に対応する入力（`frequency`）は、`null` を「クリア」として扱います。属性を外し、入力は既定値（プラットフォームのサンプリングレート）に戻ります。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらも文字列 `"null"` / `"undefined"` として書くことはありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | --------------------------- | ---- |
| `x`        | `wcs-accelerometer:reading` | x軸方向の加速度。初回読み取り前は`null`。 |
| `y`        | `wcs-accelerometer:reading` | y軸方向の加速度。 |
| `z`        | `wcs-accelerometer:reading` | z軸方向の加速度。 |
| `error`    | `wcs-accelerometer:error`   | 正規化された`{ error, message }`、無ければ`null`。 |
| `errorInfo` | `wcs-accelerometer:error-info-changed` | シリアライズ可能な失敗分類（`WcsIoErrorInfo` — 安定した `code` / `phase` / `recoverable`）、無ければ`null`。`error`から派生する追加的な出力で、既存の`error`の形状は不変。 |
| `permissionState` | `wcs-accelerometer:permission-changed` | 4.25 から。`"granted"` \| `"denied"` \| `"unknown"`——`requestPermission()`へのブラウザの答え。答えるまでは`"unknown"`。Generic Sensor の許可ではありません（それは`<wcs-permission name="accelerometer">`）。 |
| `supported` | `wcs-accelerometer:supported-changed` | 4.25 から。このページでセンサーを使えるなら`true`。[`supported`](#supported--このページで使えるか)を参照。 |

`x`/`y`/`z`は単一の`wcs-accelerometer:reading`イベントから派生します（ネイティブの1回の`reading`イベントで3軸が同時に更新される）。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `requestPermission` | はい | 4.25 から。要素が`devicemotion`を読み、ブラウザに`DeviceMotionEvent.requestPermission()`がある（iPhone / iPad の Safari）とき、それを呼ぶ——**タップから**。センサーを開始できるほかの環境では聞くことが無く、即`"granted"`でresolveする。呼び出しの後の`permissionState`でresolveし、rejectしない。 |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。4.25 から: ブラウザに`Accelerometer`クラスが無ければ代わりに`devicemotion`を購読し、センサー自身の`error`イベントの後は次の`start()`が新しいセンサーを作る。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## `supported` — このページで使えるか

4.25 から。`supported` は、このページでセンサーを使えるときに `true` です: ブラウザに `Accelerometer` クラスか `DeviceMotionEvent` があり、ページが secure context で、Permissions-Policy が `accelerometer` を切っていない（サーバーのヘッダ、または `allow="accelerometer"` の無い `<iframe>`——ページが自分のポリシーを読めるブラウザ、つまり Chromium で分かります）。`false` のところでは `start()` は動かず、タップしても変わりません: 機能を出さないでください。

利用者が許可するかどうかは**言いません**（`permissionState`、センサーのクラスについては `<wcs-permission name="accelerometer">`）。そして**端末にセンサーがあるかどうかは言えません**: PC には API があってセンサーがありません。そこでは読み取りが来ないだけか、センサーが `error` で知らせます。

値は聞かれるたびにブラウザから読むので、バインドは張られた時点で正しい値を受け取ります。要素は接続されたときにも、最後に dispatch した値（初めは `false`）と違っていれば `wcs-accelerometer:supported-changed`（`detail` はその boolean）を dispatch します。

```html
<wcs-accelerometer data-wcs="supported: sensorSupported; command.start: $command.startSensor"></wcs-accelerometer>
<button data-wcs="hidden: sensorSupported|not; onclick: $command.startSensor">開始</button>
```

（state に `sensorSupported: false` と `$commandTokens: ["startSensor"]`。）

## どこで動くか — センサーのクラス、または `devicemotion`

4.25 から。`start()` は、ブラウザに Generic Sensor の `Accelerometer` クラスがあればそれを、無ければ `window` の `devicemotion` イベントを使います。どちらを使うかは `start()` のたびに決めます。

| ブラウザ | `start()` が読むもの | `requestPermission()` |
| --- | --- | --- |
| Chrome・Edge などの Chromium 系（Android、デスクトップ） | `Accelerometer` クラス | 即 `"granted"`——ここで聞くことはありません。センサー自身の許可は `<wcs-permission name="accelerometer">` で見ます |
| iPhone / iPad の Safari | `devicemotion` | タップから聞く（[iPhone では](#iphone-では)） |
| Android の Firefox | `devicemotion` | 即 `"granted"` |
| どちらも無いブラウザ | 何も読まない——`error` が `unsupported` | `error` が `unsupported` |

4.24 までは 1 行目だけが動き、ほかは `unsupported` で終わっていました。

**どちらでも出力は同じです。** 読み取りは同じ `wcs-accelerometer:reading` イベントと `x` / `y` / `z` で届きます: 端末の x / y / z 軸方向の加速度（m/s²、重力を含む）。フォールバックではイベントの `accelerationIncludingGravity` で、`Accelerometer` が報告するのと同じ量です。値の無いイベント（センサーの無い PC が出します）は読み飛ばします。

**符号は確かめていません。** 画面を上にして置いた端末が `z ≈ +9.8` になるか `z ≈ -9.8` になるかは、`accelerationIncludingGravity` ではプラットフォームによって違うことがあり、このプロジェクトは実機で確かめていません。振る例のように読み取りの大きさ（`Math.hypot(x, y, z)`）を使うか、対象の端末で符号を確かめてください。

**`frequency` は間引くだけで、頻度は決めません。** `devicemotion` の頻度はブラウザのもので、ページからは決められません。フォールバックでは `frequency` は読み取りを落とします: 最後に出した読み取りから `1000 / frequency` ms 経たないうちに届いたものは出さないので、通るのは 1 秒に多くても `frequency` 回です。`frequency` が無ければすべてのイベントを出します。

**フォールバックに `error` はありません。** `devicemotion` は失敗を知らせません: センサーの無い端末は何も送らないだけです。`supported` にもそれは分かりません（[下記](#supported--このページで使えるか)）。

## iPhone では

4.25 から。iPhone / iPad の Safari には `Accelerometer` クラスが無いので、`<wcs-accelerometer>` はそこでは `devicemotion` を読みます。iOS はこのイベントを `DeviceMotionEvent.requestPermission()` でゲートします:

- **タップから聞く。** iOS が質問を出すのは、このメソッドをタップから呼んだときだけです。振る例のように、`requestPermission` と `start` を同じタップのハンドラから emit してください。`start()` は許可を確かめません: すぐに購読し、読み取りは利用者が許可してから届き始めます。
- **質問を出せなかったことは、利用者の拒否ではありません。** タップの外から呼ぶと、iOS は何も表示せずに reject します。そのとき `permissionState` は変わりません——変わるのはブラウザが答えたときだけです: `"granted"`、それ以外の答えは `"denied"`。reject は `error` に入り、`errorInfo.code: "not-allowed"`・`recoverable: true` になります（タップからの呼び出しなら許可されうるため）。「拒否されました」と書くのは `permissionState: "denied"` のときだけにしてください。
- **2 回目の訪問。** 再読み込みの後、`permissionState` はまた `"unknown"` です: 要素はページの読み込みをまたいで何も覚えず、iOS が答えをページに教えるのはページが聞いたときだけで、聞くにはタップが要ります。
- **`<wcs-tilt>` の質問は別のものです。** `<wcs-tilt>` は `DeviceOrientationEvent.requestPermission()` を、この要素は `DeviceMotionEvent.requestPermission()` を呼びます。両方を使うページは、1 つのタップのハンドラから両方を emit します——両方の要素の `command.requestPermission` を同じトークンにバインドしてください。

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。`requestPermission()`（4.25 から）はブラウザを待ちますが、その後に書くのは`permissionState` / `error`の値だけで、切断とレースするものはありません。
- **`error`は sticky（据え置き）です。** 最後に観測した失敗（`unsupported`、`SecurityError`等）を保持し、その後の`start()`成功や`reading`受信では自動クリアされません。`stop()`＋`start()`でリトライが成功しても直前の`error`は残り続けます。必要なら利用側の state でクリア／再解釈してください。4.25 から例外が 1 つあります: ブラウザが`requestPermission()`に答えると、それまでの`error`は消えます（`<wcs-tilt>`と同じ）。
- **`error`イベントの後、`start()`はまた動きます。** 4.25 から、センサーが自分の`error`イベント（たとえば`NotReadableError`）を出すと、失敗したセンサーは片付けられ、次の`start()`が新しいセンサーを作ります。4.24までは、そのエラーの後の`start()`は`stop()`を呼ぶまで何もせず、それを知らせるものもありませんでした。`error`そのものは上記のとおり残ります。
- **`errorInfo` 分類（taxonomy）。** 同じ失敗をシリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-accelerometer:error-info-changed`）で、`error`の形状は変更しません。正規化された error 名に応じて対応づけます: `unsupported` → `capability-missing`（phase `probe`）、`SecurityError` / `NotAllowedError` → `not-allowed`（phase `start`）、`NotReadableError` → `not-readable`（phase `execute`）、その他のセンサー失敗 → `sensor-error`（phase `execute`）。いずれも `recoverable: false` ですが、4.25 から例外が 1 つあります: reject された `requestPermission()`（`NotAllowedError`——呼び出しがタップの中でなかったので、iOS が質問を出さなかった）は `not-allowed` で `recoverable: true` です（タップからの呼び出しなら成功しうるため）。`errorInfo` は `error` と完全に同じタイミングで遷移するため、同様に **sticky** で、`error` が `null` に戻るときにのみ `null` に戻ります。共有の `WcsIoErrorInfo` 型と `WCS_ACCELEROMETER_ERROR_CODE` 定数はエクスポートされます。
- **使えない`frequency`は知らせます。** 4.25 から、空でなく正の数でもない`frequency`属性（`frequency="60hz"`、`frequency="0"`）で`start()`が走ると、コンソールに要素ごとに 1 回警告が出ます: `[@wcstack/accelerometer] [wcs/frequency-invalid] <wcs-accelerometer> frequency="60hz" is not a positive number of Hz: the sensor runs at the browser's default rate. Write a number, e.g. frequency="30".` センサーは既定の頻度で開始します——これまでも同じでしたが、何も言いませんでした。ブラウザが許す上限を超える頻度はブラウザが丸め、それを知らせるものはありません。
- **生の`new Accelerometer(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="accelerometer">`と合成してください。`permissionState`（4.25 から）は、iOS の`DeviceMotionEvent.requestPermission()`への答えだけです。これを知らせる Permissions API のエントリはありません。

## `:state()` による CSS スタイリング

`<wcs-accelerometer>` は1つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。`x`/`y`/`z`（連続的なセンサー読み取り値）
は意図的に反映**しません** — `docs/custom-state-reflection-design.ja.md` §3.2 参照。

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

4.25 から、`core.supported` はいつでも読め、`core.publishSupported()` は最後に dispatch した値と違うときに `wcs-accelerometer:supported-changed` を dispatch し、`await core.requestPermission()` は聞くことがあるところで聞き、`core.start(frequency)` は `Accelerometer` クラスが無ければ `devicemotion` を読みます。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## アクセシビリティ

**WCAG 2.5.4 Motion Actuation（レベル A）**: デバイスを動かして操作するもの（シェイクで取り消し・振って再開など）は、動かさずにも操作できなければ**ならず**、モーション入力を無効化できなければならない — 振戦はシェイク検出を誤発火させ続けるし、固定された端末はそもそも振れない。モーションジェスチャには同じコードパスへ流れるボタンの双子を必ず用意し、監視を止める手段（`stop` コマンド）を露出すること。[`examples/state-tilt-maze`](https://github.com/wcstack/wcstack/tree/main/examples/state-tilt-maze) が手本: シェイク再開の隣には常に Retry ボタンがある。

## ライセンス

MIT
