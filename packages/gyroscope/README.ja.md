# @wcstack/gyroscope

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/gyroscope` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（Gyroscope）コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの角速度読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-gyroscope>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `x`、`y`、`z`、`error`、`errorInfo`、そして 4.25（未リリース）から `permissionState`、`supported`

`@wcstack/gyroscope` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`GyroscopeCore`）がプラットフォームの`Gyroscope`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-gyroscope>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`（4.25（未リリース）から`requestPermission`も）を宣言

## なぜ存在するか — プラットフォームAPI自体がnever-throwと最初から一致する稀な例

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`Gyroscope`のコンストラクタ自体です。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"gyroscope"})`が既に存在するため、`<wcs-gyroscope>`は`<wcs-permission name="gyroscope">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

> **Chromium/Android中心の対応。** デスクトップでは`Gyroscope`クラスが存在しても`SecurityError`になりがちです。unsupported/deniedを既定状態として設計してください。4.25（未リリース）から、`Gyroscope`クラスは無いが`devicemotion`のあるブラウザ（iPhone / iPad の Safari、Android の Firefox）では、そのイベントから読みます: [どこで動くか](#どこで動くか--センサーのクラスまたは-devicemotion)を参照。

## インストール

```bash
npm install @wcstack/gyroscope
```

## クイックスタート

### 1. 角速度をライブ表示

`<wcs-gyroscope>`は接続時に**自動開始しません** — バインドしただけでは
`x`/`y`/`z`は初期値`null`のままです。読み取りを流すには（例えばボタンから）
`start`コマンドを発火する必要があります:

```html
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      x: null, y: null, z: null,
    };
  </script>
</wcs-state>

<wcs-gyroscope
  data-wcs="x: x; y: y; z: z; command.start: $command.startGyro"
></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro">開始</button>
<p data-wcs="textContent: x"></p>
```

ボタンは`<wcs-gyroscope>`に直接触れません: クリックは`startGyro`コマンドトークンを発火し（`$commandTokens: ["startGyro"]`で名前を宣言）、`<wcs-gyroscope>`は`command.start: $command.startGyro`でそれを購読します（[command-token プロトコル](../state/) — コマンドメソッドを持つ要素が*subscriber*であり、emitter ではありません）。

### 2. 権限を確認してから start する

この例では`@wcstack/permission`の登録も必要です（例1の`@wcstack/state` /
`@wcstack/gyroscope`の script に加えて）。`gyroGranted`を宣言する
独立した`<wcs-state>`を持ちます:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      gyroGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="gyroscope" data-wcs="granted: gyroGranted"></wcs-permission>
<wcs-gyroscope data-wcs="command.start: $command.startGyro"></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro; disabled: gyroGranted|not">開始</button>
```

バインドする state パスは事前にすべて宣言する必要があります — 未宣言のパスへのバインドは初期化時に例外を投げます。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ(`gyroGranted|not`)で行います。この例が待つのは Generic Sensor の許可で、これは `Gyroscope` クラスのものです。要素が代わりに `devicemotion` を読むところ（iPhone）では、その許可は何も教えません: 4.25（未リリース）から、そこでは例 3 を使ってください。

### 3. 振った回数（速い回転）を数える — iPhone でも

4.25（未リリース）から。1 回のタップで（聞くことがあるところでは）許可を聞いて開始します。読み取りは event token で state のハンドラへ届き、ハンドラは回転の向きではなく速さの大きさを見ます:

```html
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["ask", "start"],
      $eventTokens: ["reading"],
      $on: {
        // 角速度の大きさ（rad/s）。2π（約 6.3）が 1 秒に 1 回転。
        reading: (state, event) => {
          const { x, y, z } = event.detail;
          if (Math.hypot(x, y, z) > 6 && Date.now() - state.lastShakeAt > 1000) {
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

<wcs-gyroscope frequency="30"
  data-wcs="supported: motionSupported; eventToken.x: reading;
            command.requestPermission: $command.ask; command.start: $command.start"
></wcs-gyroscope>

<button data-wcs="hidden: motionSupported|not; onclick: enableShake">振る操作を有効にする</button>
<p>振った回数: <span data-wcs="textContent: shakes"></span></p>
```

`eventToken.x: reading` は、`wcs-gyroscope:reading` イベント（`x` を運ぶイベント）のたびに `reading` トークンへ渡し、ハンドラは `event.detail` から 3 軸とも取ります。`requestPermission` が聞くのは質問のあるところ（iPhone / iPad の Safari）だけで、それ以外では即 `"granted"` と答えるので、同じ 2 行がどのブラウザでも動きます。バインドするパスも、トークン（`$commandTokens`・`$eventTokens`）も、すべて state に宣言します。振る操作には、同じことをするボタンを添えてください（[アクセシビリティ](#アクセシビリティ)）。

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`Gyroscope`コンストラクタへそのまま渡る。読み取られるのは`start()`実行時のみ — 稼働中に変更しても`stop()`＋`start()`し直すまで反映されない（注意・制限を参照）。4.25（未リリース）から: `devicemotion` のフォールバックでは頻度を決める代わりに読み取りを間引き（[どこで動くか](#どこで動くか--センサーのクラスまたは-devicemotion)）、正の数でない値は `start()` のときにコンソールへ 1 回言います（`[wcs/frequency-invalid]`、注意・制限を参照）。 |

**`null` と `undefined`。** 属性に対応する入力（`frequency`）は、`null` を「クリア」として扱います。属性を外し、入力は既定値（プラットフォームのサンプリングレート）に戻ります。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらも文字列 `"null"` / `"undefined"` として書くことはありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | --------------------------- | ---- |
| `x`        | `wcs-gyroscope:reading` | x軸周りの角速度。初回読み取り前は`null`。 |
| `y`        | `wcs-gyroscope:reading` | y軸周りの角速度。 |
| `z`        | `wcs-gyroscope:reading` | z軸周りの角速度。 |
| `error`    | `wcs-gyroscope:error`   | 正規化された`{ error, message }`、無ければ`null`。 |
| `errorInfo` | `wcs-gyroscope:error-info-changed` | シリアライズ可能な失敗分類（`WcsIoErrorInfo` — 安定した `code` / `phase` / `recoverable`）、無ければ`null`。`error`から派生する追加的な出力で、既存の`error`の形状は不変。 |
| `permissionState` | `wcs-gyroscope:permission-changed` | 4.25（未リリース）から。`"granted"` \| `"denied"` \| `"unknown"`——`requestPermission()`へのブラウザの答え。答えるまでは`"unknown"`。Generic Sensor の許可ではありません（それは`<wcs-permission name="gyroscope">`）。 |
| `supported` | `wcs-gyroscope:supported-changed` | 4.25（未リリース）から。このページでセンサーを使えるなら`true`。[`supported`](#supported--このページで使えるか)を参照。 |

`x`/`y`/`z`は単一の`wcs-gyroscope:reading`イベントから派生します（ネイティブの1回の`reading`イベントで3軸が同時に更新される）。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `requestPermission` | はい | 4.25（未リリース）から。要素が`devicemotion`を読み、ブラウザに`DeviceMotionEvent.requestPermission()`がある（iPhone / iPad の Safari）とき、それを呼ぶ——**タップから**。センサーを開始できるほかの環境では聞くことが無く、即`"granted"`でresolveする。呼び出しの後の`permissionState`でresolveし、rejectしない。 |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。開始済みの間は冪等（再度呼んでも何もしない）。4.25（未リリース）から: ブラウザに`Gyroscope`クラスが無ければ代わりに`devicemotion`を購読し、センサー自身の`error`イベントの後は次の`start()`が新しいセンサーを作る。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## `supported` — このページで使えるか

4.25（未リリース）から。`supported` は、このページでセンサーを使えるときに `true` です: ブラウザに `Gyroscope` クラスか `DeviceMotionEvent` があり、ページが secure context で、Permissions-Policy が `gyroscope` を切っていない（サーバーのヘッダ、または `allow="gyroscope"` の無い `<iframe>`——ページが自分のポリシーを読めるブラウザ、つまり Chromium で分かります）。`false` のところでは `start()` は動かず、タップしても変わりません: 機能を出さないでください。

利用者が許可するかどうかは**言いません**（`permissionState`、センサーのクラスについては `<wcs-permission name="gyroscope">`）。そして**端末にセンサーがあるかどうかは言えません**: PC には API があってセンサーがありません。そこでは読み取りが来ないだけか、センサーが `error` で知らせます。

値は聞かれるたびにブラウザから読むので、バインドは張られた時点で正しい値を受け取ります。要素は接続されたときにも、最後に dispatch した値（初めは `false`）と違っていれば `wcs-gyroscope:supported-changed`（`detail` はその boolean）を dispatch します。

```html
<wcs-gyroscope data-wcs="supported: sensorSupported; command.start: $command.startSensor"></wcs-gyroscope>
<button data-wcs="hidden: sensorSupported|not; onclick: $command.startSensor">開始</button>
```

（state に `sensorSupported: false` と `$commandTokens: ["startSensor"]`。）

## どこで動くか — センサーのクラス、または `devicemotion`

4.25（未リリース）から。`start()` は、ブラウザに Generic Sensor の `Gyroscope` クラスがあればそれを、無ければ `window` の `devicemotion` イベントを使います。どちらを使うかは `start()` のたびに決めます。

| ブラウザ | `start()` が読むもの | `requestPermission()` |
| --- | --- | --- |
| Chrome・Edge などの Chromium 系（Android、デスクトップ） | `Gyroscope` クラス | 即 `"granted"`——ここで聞くことはありません。センサー自身の許可は `<wcs-permission name="gyroscope">` で見ます |
| iPhone / iPad の Safari | `devicemotion` | タップから聞く（[iPhone では](#iphone-では)） |
| Android の Firefox | `devicemotion` | 即 `"granted"` |
| どちらも無いブラウザ | 何も読まない——`error` が `unsupported` | `error` が `unsupported` |

4.24 までは 1 行目だけが動き、ほかは `unsupported` で終わっていました。

**どちらでも出力は同じです。** 読み取りは同じ `wcs-gyroscope:reading` イベントと `x` / `y` / `z` で届きます: 端末の x / y / z 軸まわりの角速度（ラジアン/秒）で、`Gyroscope` が報告するものです。フォールバックではイベントの `rotationRate` から作ります。こちらは度/秒で、軸の名前も違います: `x = beta × π/180`、`y = gamma × π/180`、`z = alpha × π/180`。値の無いイベント（センサーの無い PC が出します）は読み飛ばします。

**符号は確かめていません。** 対応づけは仕様に従っていますが、各軸の向きをこのプロジェクトは実機で確かめていません。振る例のように読み取りの大きさ（`Math.hypot(x, y, z)`）を使うか、対象の端末で符号を確かめてください。

**`frequency` は間引くだけで、頻度は決めません。** `devicemotion` の頻度はブラウザのもので、ページからは決められません。フォールバックでは `frequency` は読み取りを落とします: 最後に出した読み取りから `1000 / frequency` ms 経たないうちに届いたものは出さないので、通るのは 1 秒に多くても `frequency` 回です。`frequency` が無ければすべてのイベントを出します。

**フォールバックに `error` はありません。** `devicemotion` は失敗を知らせません: センサーの無い端末は何も送らないだけです。`supported` にもそれは分かりません（[下記](#supported--このページで使えるか)）。

## iPhone では

4.25（未リリース）から。iPhone / iPad の Safari には `Gyroscope` クラスが無いので、`<wcs-gyroscope>` はそこでは `devicemotion` を読みます。iOS はこのイベントを `DeviceMotionEvent.requestPermission()` でゲートします:

- **タップから聞く。** iOS が質問を出すのは、このメソッドをタップから呼んだときだけです。振る例のように、`requestPermission` と `start` を同じタップのハンドラから emit してください。`start()` は許可を確かめません: すぐに購読し、読み取りは利用者が許可してから届き始めます。
- **質問を出せなかったことは、利用者の拒否ではありません。** タップの外から呼ぶと、iOS は何も表示せずに reject します。そのとき `permissionState` は変わりません——変わるのはブラウザが答えたときだけです: `"granted"`、それ以外の答えは `"denied"`。reject は `error` に入り、`errorInfo.code: "not-allowed"`・`recoverable: true` になります（タップからの呼び出しなら許可されうるため）。「拒否されました」と書くのは `permissionState: "denied"` のときだけにしてください。
- **2 回目の訪問。** 再読み込みの後、`permissionState` はまた `"unknown"` です: 要素はページの読み込みをまたいで何も覚えず、iOS が答えをページに教えるのはページが聞いたときだけで、聞くにはタップが要ります。
- **`<wcs-tilt>` の質問は別のものです。** `<wcs-tilt>` は `DeviceOrientationEvent.requestPermission()` を、この要素は `DeviceMotionEvent.requestPermission()` を呼びます。両方を使うページは、1 つのタップのハンドラから両方を emit します——両方の要素の `command.requestPermission` を同じトークンにバインドしてください。

## `:state()` による CSS スタイリング

`<wcs-gyroscope>` は 1 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。`<wcs-gyroscope>` には
`loading`/`connected` のような boolean 出力は無く（`start`/`stop` は同期的な
購読/購読解除のトグルです）、反映されるのは `error` のみです。

| ステート | on になる条件 |
|----------|----------------|
| `error` | `wcs-gyroscope:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-gyroscope:state(error) ~ .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

なお `error` は（下記の注意・制限にある通り）**sticky（据え置き）** です — 一度 on に
なるとページを再読み込みするか自分で明示的にクリアするまで on のままで、`start()` の
成功では自動的に off に戻りません。4.25（未リリース）から、ブラウザが答えた`requestPermission()`もそれを消します。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-gyroscope>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-gyroscope:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["error"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-error` 属性にミラーします。Elements パネルを開いておけば、
  トグルのたびにハイライトされます:

  ```html
  <wcs-gyroscope debug-states></wcs-gyroscope>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。`requestPermission()`（4.25（未リリース）から）はブラウザを待ちますが、その後に書くのは`permissionState` / `error`の値だけで、切断とレースするものはありません。
- **`error`は sticky（据え置き）です。** 最後に観測した失敗（`unsupported`、`SecurityError`等）を保持し、その後の`start()`成功や`reading`受信では自動クリアされません。`stop()`＋`start()`でリトライが成功しても直前の`error`は残り続けます。必要なら利用側の state でクリア／再解釈してください。4.25（未リリース）から例外が 1 つあります: ブラウザが`requestPermission()`に答えると、それまでの`error`は消えます（`<wcs-tilt>`と同じ）。
- **`error`イベントの後、`start()`はまた動きます。** 4.25（未リリース）から、センサーが自分の`error`イベント（たとえば`NotReadableError`）を出すと、失敗したセンサーは片付けられ、次の`start()`が新しいセンサーを作ります。4.24までは、そのエラーの後の`start()`は`stop()`を呼ぶまで何もせず、それを知らせるものもありませんでした。`error`そのものは上記のとおり残ります。
- **`errorInfo` 分類（taxonomy）。** 同じ失敗をシリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-gyroscope:error-info-changed`）で、`error`の形状は変更しません。正規化された error 名に応じて対応づけます: `unsupported` → `capability-missing`（phase `probe`）、`SecurityError` / `NotAllowedError` → `not-allowed`（phase `start`）、`NotReadableError` → `not-readable`（phase `execute`）、その他のセンサー失敗 → `sensor-error`（phase `execute`）。いずれも `recoverable: false` ですが、4.25（未リリース）から例外が 1 つあります: reject された `requestPermission()`（`NotAllowedError`——呼び出しがタップの中でなかったので、iOS が質問を出さなかった）は `not-allowed` で `recoverable: true` です（タップからの呼び出しなら成功しうるため）。`errorInfo` は `error` と完全に同じタイミングで遷移するため、同様に **sticky** で、`error` が `null` に戻るときにのみ `null` に戻ります。共有の `WcsIoErrorInfo` 型と `WCS_GYROSCOPE_ERROR_CODE` 定数はエクスポートされます。
- **使えない`frequency`は知らせます。** 4.25（未リリース）から、空でなく正の数でもない`frequency`属性（`frequency="60hz"`、`frequency="0"`）で`start()`が走ると、コンソールに要素ごとに 1 回警告が出ます: `[@wcstack/gyroscope] [wcs/frequency-invalid] <wcs-gyroscope> frequency="60hz" is not a positive number of Hz: the sensor runs at the browser's default rate. Write a number, e.g. frequency="30".` センサーは既定の頻度で開始します——これまでも同じでしたが、何も言いませんでした。ブラウザが許す上限を超える頻度はブラウザが丸め、それを知らせるものはありません。
- **`frequency`は`start()`時にのみ読み取られます。** `attributeChangedCallback`は無く、`start()`は既に開始済みの間は冪等（再度呼んでも何もしない、上記コマンド参照）であるため、稼働中に`frequency`（属性またはプロパティ）を変更しても反映されません。新しいサンプリングレートを適用するには`stop()`してから`start()`し直してください。
- **再親付け（別の親要素への移動）はセンサーを停止し、自動再開しません。** 接続中の`<wcs-gyroscope>`要素を別の親へ移動すると`disconnectedCallback`→`connectedCallback`が発火します。Shellは接続時に自動開始しないため（上記クイックスタート参照）、これは実質的な停止であり自動再開はされません。`x`/`y`/`z`は最後のサンプル値のまま凍結され、`error`も発生しません — `start`を再度発行するまでセンサーは inert のままです。
- **生の`new Gyroscope(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="gyroscope">`と合成してください。`permissionState`（4.25（未リリース）から）は、iOS の`DeviceMotionEvent.requestPermission()`への答えだけです。これを知らせる Permissions API のエントリはありません。

## ヘッドレス利用（`GyroscopeCore`）

```typescript
import { GyroscopeCore } from "@wcstack/gyroscope";

const core = new GyroscopeCore();
core.addEventListener("wcs-gyroscope:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// 後始末:
core.dispose();
```

4.25（未リリース）から、`core.supported` はいつでも読め、`core.publishSupported()` は最後に dispatch した値と違うときに `wcs-gyroscope:supported-changed` を dispatch し、`await core.requestPermission()` は聞くことがあるところで聞き、`core.start(frequency)` は `Gyroscope` クラスが無ければ `devicemotion` を読みます。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## アクセシビリティ

**WCAG 2.5.4 Motion Actuation（レベル A）**: デバイスの回転で操作するものは、動かさずにも操作できなければ**ならず**、モーション入力を無効化できなければならない — 全員が端末を回せるわけではなく、不随意運動は角速度入力をノイズに変える。モーション駆動の操作には同じコードパスへ流れる並行入力（キーボード・ポインタ・ボタン）を用意し、監視を止める手段（`stop` コマンド）を露出すること。形は兄弟センサーの [`examples/state-tilt-maze`](https://github.com/wcstack/wcstack/tree/main/examples/state-tilt-maze) が示している。

## ライセンス

MIT
