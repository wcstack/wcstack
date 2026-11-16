# @wcstack/tilt

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/tilt` は wcstack エコシステム向けのヘッドレスな Device Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの傾き（`deviceorientation`）をリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-tilt>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し
- **出力 state サーフェス**: `alpha`、`beta`、`gamma`、`absolute`、`permissionState`、`error`、`errorInfo`、そして 4.25（未リリース）から `heading`、`supported`

## なぜ存在するか — `@wcstack/idle`の兄弟、iOSのgesture-gateを吸収する

iOS 13+ Safariは`deviceorientation`が発火する前に、明示的でgesture-gatedな`DeviceOrientationEvent.requestPermission()`を要求します。他の全プラットフォーム（Android Chrome、デスクトップ）にはこのgateがありません。`<wcs-tilt>`はこの差異を吸収します: gatingの無いプラットフォームでは`requestPermission()`は即座に`"granted"`でresolveするため、呼び出し元は**どこでも動く単一の**`requestPermission()` → `start()`フローを書けます。

> **`permissionState`は3値の語彙**（`"granted"` / `"denied"` / `"unknown"`）——このAPIに対応する`navigator.permissions.query()`エントリが存在しないため、意図的に4値のPermissions API状態とは別物にしています。`@wcstack/idle`（`@wcstack/permission`と合成）とは異なり、ローカルで追跡します。変わるのはブラウザが答えたときだけです（[iPhone では](#iphone-では)）。

> **connect時に自動startしません** — `@wcstack/idle`と同じ理由: 許可前の購読はiOSで無音のまま何も受け取れません。

> **secure context（HTTPSまたはlocalhost）が必須です。**

## インストール

```bash
npm install @wcstack/tilt
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/tilt/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["enableTilt"],
      tiltBeta: null,
      tiltGamma: null,
      get tiltTransform() {
        return `rotate(${this.tiltBeta ?? 0}deg)`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma;
                    command.requestPermission: $command.enableTilt; command.start: $command.enableTilt"></wcs-tilt>
<button data-wcs="onclick: $command.enableTilt">傾き検知を有効にする</button>
<div data-wcs="style.transform: tiltTransform"></div>
```

ボタンは `<wcs-tilt>` に触れません。クリックがコマンドトークン `enableTilt` を emit し（名前は `$commandTokens: ["enableTilt"]` で宣言）、`<wcs-tilt>` がそれを 2 回購読します——書いた順に `requestPermission`、次に `start`。どちらもタップの中で走ります。iOS が質問を出すのはそこだけです。`start()` は答えを待ちません: すぐに購読し、値はブラウザが送り始めたときから届きます（iOS では利用者が許可してから）。

`data-wcs` が参照する全てのパス（`tiltBeta`、`tiltGamma`、`tiltTransform`）は state オブジェクトに、`$command` のトークンは `$commandTokens` に宣言が必須です——未宣言のものはバインドを張るときに失敗します。`tiltTransform` は素の path getter（計算プロパティ、`@wcstack/state` の README 参照）です——`@wcstack/state` には文字列テンプレート化フィルタが無いため、CSS 文字列は getter 側で組み立てます。`tiltBeta` が変わるたびに再計算されます。

### コンパス（`heading`）

4.25（未リリース）から、`heading` は端末の上端が向いている方角です。北からの時計回りの度数（0 = 北、90 = 東）で、ブラウザが知らせるまでは `null` です。

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["ask", "start"],
      heading: null,
      tiltSupported: false,
      tiltPermission: "unknown",
      enableCompass() {
        // どちらもタップのハンドラの中で: iOS が質問を出すのはタップからだけ。
        this.$command.ask.emit();
        this.$command.start.emit();
      },
      get needleTransform() {
        return `rotate(${-(this.heading ?? 0)}deg)`;
      },
      get headingText() {
        return this.heading === null ? "—" : `${Math.round(this.heading)}°`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="heading: heading; supported: tiltSupported; permissionState: tiltPermission;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>

<button data-wcs="hidden: tiltSupported|not; onclick: enableCompass">コンパスを表示</button>
<p data-wcs="hidden: tiltPermission|ne(denied)">このサイトでは動作と方向へのアクセスが拒否されています。</p>
<div style="display: inline-block" data-wcs="style.transform: needleTransform">▲</div>
<output data-wcs="textContent: headingText"></output>
```

針は端末と逆向きに回す（`-heading`）ので、北を指し続けます。

`heading` の出どころは、イベントごとに次の順です:

1. 有限の数の `webkitCompassHeading` を持つ `deviceorientation` イベント（iOS Safari。そこでは `alpha` は相対値）→ その数
2. `deviceorientationabsolute` イベント（Android Chrome。そこでは `deviceorientation` は相対値）、または `absolute: true` の `deviceorientation` イベントで、`alpha` が有限の数 → `(360 - alpha) % 360`
3. それ以外のイベントは `heading` を変えません

`start()` は、ブラウザにあれば `deviceorientationabsolute` も購読します。このイベントが書くのは `heading` だけです——`alpha` / `beta` / `gamma` / `absolute` はこれまでどおり `deviceorientation` から来ます。`heading` が**そうではない**もの:

- **画面の回転は補正しません。** 画面の上ではなく、端末の上端の向きです。横向きでは画面の角度を足します: `<wcs-screen-orientation>` の `angle` をバインドして `(heading + angle) % 360`。
- **傾きは補正しません。** `(360 - alpha)` の式は、端末をほぼ水平（画面が上）に持っている間は正確です。立てて持つと、向いている方角にはなりません。
- **iOS では磁北です。** `webkitCompassHeading` は真北ではなく磁北からの角度です。
- **どちらの出どころも送らないブラウザ・端末では出ません**: `heading` は `null` のままです。

## 観測可能プロパティ（出力）

| プロパティ        | イベント                     | 説明 |
| ----------------- | ----------------------------- | ---- |
| `alpha`           | `wcs-tilt:change`             | Z軸回転、`start()`前は`null`。 |
| `beta`            | `wcs-tilt:change`             | X軸回転。 |
| `gamma`           | `wcs-tilt:change`             | Y軸回転。 |
| `absolute`        | `wcs-tilt:change`             | 地磁気に対する絶対方位かどうか。ブラウザにより信頼性が異なるため実機で確認してください。 |
| `heading`         | `wcs-tilt:heading-changed`    | 4.25（未リリース）から。端末の上端が向いている方角（北からの時計回りの度数）、分かるまでは`null`。イベントの`detail`はその数。[コンパス](#コンパスheading)を参照。 |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`。`requestPermission()`へのブラウザの答え。答えるまでは`"unknown"`。 |
| `error`           | `wcs-tilt:error`              | 直近の`requestPermission()` / `start()`の失敗（タップの外からの呼び出しのreject、このブラウザに`DeviceOrientationEvent`が無い、など）、無ければ`null`。never-throw: 失敗はreject/throwせず、ここに流れます。 |
| `errorInfo`       | `wcs-tilt:error-info-changed` | `error`から派生した、失敗のserializableなtaxonomy（`WcsIoErrorInfo`: 安定した`code` / `phase` / `recoverable`）、無ければ`null`。additive —— `error`の形状は不変。 |
| `supported`       | `wcs-tilt:supported-changed`  | 4.25（未リリース）から。このページでDevice Orientationを使えるなら`true`。イベントの`detail`はそのboolean。[`supported`](#supported--このページで使えるか)を参照。 |

`heading` と `wcs-tilt:change` は別のイベントです: 北を運ぶイベントが新しい角度を運ぶとは限らず、逆も同じです。どちらも同値ガードされます。

## コマンド

| コマンド            | 非同期 | 説明 |
| -------------------- | ------ | ---- |
| `requestPermission`  | はい   | iOSではgesture-gatedな静的メソッドを呼ぶ（**実際のuser gestureハンドラ内から呼ぶ必要があります**）。`DeviceOrientationEvent`にそのメソッドが無い環境（Android、デスクトップ）では即座に`"granted"`でresolve。呼び出しの後の`permissionState`でresolveします。4.25（未リリース）から: rejectは`permissionState`を変えず、`DeviceOrientationEvent`そのものが無いブラウザは`"granted"`ではなく`error`（`capability-missing`）になります。 |
| `start`              | いいえ | `deviceorientation`を購読（4.25（未リリース）から、ブラウザにあれば`deviceorientationabsolute`も）。冪等。許可は確かめません。4.25（未リリース）から: `DeviceOrientationEvent`の無いブラウザでは何も購読せず、`error`（`capability-missing`）にします。 |
| `stop`               | いいえ | 購読解除。未開始でも安全に呼べます。出力は最後の値のままです。 |

## `supported` — このページで使えるか

4.25（未リリース）から。`supported` は、このページで Device Orientation を使えるときに `true` です: `DeviceOrientationEvent` があり、ページが secure context で、Permissions-Policy が `accelerometer` と `gyroscope` のどちらも切っていない（サーバーのヘッダ、または `allow="accelerometer; gyroscope"` の無い `<iframe>` —— Chromium はそのポリシーの下では `deviceorientation` を送りません）。`false` のところでは値は決して来ず、タップしても変わりません: 機能を出さないでください。

利用者が許可するかどうかは**言いません**（それは `permissionState`）。そして**端末にセンサーがあるかどうかは言えません**: デスクトップ PC には API があってセンサーが無く、`supported: true` です。ページは待つことでそれを知ります: `start()` から 2 秒ほど経っても——iOS では `permissionState` が `"granted"` になってから——`beta` が `null` のままなら、センサーはありません（PC の Chromium は角度がすべて `null` のイベントを 1 回出し、その後は何も出しません）。同じコマンドトークンで始める `<wcs-timer interval="2000" once manual>` が、その時点をページに知らせます。

値は聞かれるたびにブラウザから読むので、バインドは張られた時点で正しい値を受け取ります。要素は接続されたときにも、最後に dispatch した値（初めは `false`）と違っていれば `wcs-tilt:supported-changed` を dispatch します。

```html
<wcs-tilt data-wcs="supported: tiltSupported; command.requestPermission: $command.enableTilt; command.start: $command.enableTilt"></wcs-tilt>
<button data-wcs="hidden: tiltSupported|not; onclick: $command.enableTilt">傾き検知を有効にする</button>
```

（state に `tiltSupported: false` と `$commandTokens: ["enableTilt"]`。）

## iPhone では

**タップから聞く。** iPhone / iPad の Safari が動作と方向の質問を出すのは、`DeviceOrientationEvent.requestPermission()` をタップ（クリックのハンドラ。上の例はそうしています）から呼んだときだけです。それ以外——ページの読み込み時、タイマーから——の呼び出しは、iOS が `NotAllowedError` で reject し、何も表示しません。

**質問を出せなかったことは、利用者の拒否ではありません。** 4.25（未リリース）から、この reject は `permissionState` を変えません——変わるのはブラウザが答えたときだけです: `"granted"`、それ以外の答えは `"denied"`。reject は `error` に入り、`errorInfo.code: "not-allowed"`・`recoverable: true` になります（タップからの呼び出しなら許可されうるため）。コマンドの promise は、変わっていない `permissionState` で resolve します。4.24 までは reject が `permissionState: "denied"`・`recoverable: false` にしていたので、ページは、聞かれてもいない利用者に「拒否しました」と告げていました。「拒否されました」と書くのは `permissionState: "denied"` のときだけにし、`recoverable: true` の `error` にはボタンをもう一度出してください。

**2 回目の訪問。** 再読み込みの後、`permissionState` はまた `"unknown"` です。要素はページの読み込みをまたいで何も覚えず、iOS が答えをページに教えるのはページが聞いたときだけで、聞くにはタップが要ります。つまり、戻ってきた利用者も同じボタンから始まります。「この利用者は前に許可した」ことを覚えておきたいページは、自分で控えを持ち（たとえば `<wcs-storage>`）、文言の出し分けに使ってください。その場合も、値を期待する前にタップから `requestPermission()` を呼びます。

**ゲートは 2 つ。** iOS は方向と動きを 2 つのメソッドでゲートします: `<wcs-tilt>` が呼ぶ `DeviceOrientationEvent.requestPermission()` と、4.25（未リリース）から `<wcs-accelerometer>` / `<wcs-gyroscope>` が呼ぶ `DeviceMotionEvent.requestPermission()`。要素はそれぞれ自分の分だけを聞き、それぞれの `permissionState` を持ちます。両方を使うページは 1 回のタップで両方を聞きます——1 つのハンドラが両方のコマンドを emit できます:

```html
<wcs-tilt data-wcs="command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-accelerometer data-wcs="command.requestPermission: $command.ask; command.start: $command.start"></wcs-accelerometer>
<button data-wcs="onclick: enableMotion">動きの検知を有効にする</button>
```

```js
export default {
  $commandTokens: ["ask", "start"],
  enableMotion() {
    this.$command.ask.emit();    // 両方の要素の requestPermission()。タップの中で
    this.$command.start.emit();  // 両方の要素の start()
  },
};
```

## 属性 / 入力

**無し。**

## `:state()` による CSS スタイリング

`<wcs-tilt>` は 1 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。`alpha` / `beta` / `gamma` /
`permissionState` は反映されません——連続値または対応する boolean 派生 getter を持たない
enum 出力のため（guidelines §4.2）、反映されるのは `error` のみです。`absolute`
も同様に除外されます——連続的な `wcs-tilt:change` ストリームからしか導出できず、
専用の boolean イベントを持たないためです。

| ステート | on になる条件 |
|----------|----------------|
| `error` | `wcs-tilt:error` が非 `null` の detail で発火（`null` でクリア） |

```css
form:has(wcs-tilt:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-tilt>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-tilt:not(:defined)` と組み合わせてください。

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
  <wcs-tilt debug-states></wcs-tilt>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **connect時に自動startしません。**
- **`@wcstack/permission`とは合成しません**（対応するPermissions APIエントリが存在しないため）——`permissionState`はローカルで追跡します。
- **`errorInfo` taxonomy（additive）。** `error`と並んで、`<wcs-tilt>`は*同一の*失敗を安定した`WcsIoErrorInfo`（`code` / `phase` / `recoverable`）に分類したserializableな`errorInfo`（`wcs-tilt:error-info-changed`）を公開します。`error`の形状（`{ error: <rejectの理由> }`）は変えません。rejectされた`requestPermission()`は理由の`Error.name`で分類されます: `NotAllowedError`（呼び出しがタップの中でなかったので、iOSが質問を出さなかった）→ `not-allowed`（phase `start`、4.25（未リリース）から`recoverable: true`——タップからの呼び出しなら成功しうる）、それ以外（別の失敗、非`Error`のreason）→ `tilt-error`（phase `execute`、`recoverable: false`）。4.25（未リリース）から、`DeviceOrientationEvent`そのものが無いブラウザ（一部のデスクトップブラウザ）は、`requestPermission()`でも`start()`でも`capability-missing`（phase `probe`、`recoverable: false`）になり、`error`は`{ error: { name: "unsupported", message: "DeviceOrientationEvent is not supported in this browser." } }`です。4.24までは、そこで`requestPermission()`が`"granted"`と答え、`start()`は来るはずのないイベントを待っていました。`DeviceOrientationEvent`はあるが`requestPermission`が無い環境（Android、デスクトップ）が即`"granted"`になるのは変わりません。`errorInfo`は`error`とまったく同じタイミングで遷移し（ブラウザが答えたときに`null`へクリア）、共有の`WcsIoErrorInfo`型と`WCS_TILT_ERROR_CODE`定数はexportされています。
- `_gen`世代ガードは無し: 購読は完全に同期的です。
- **非secure context（素のHTTP）では`deviceorientation`は一切発火しません**——ブラウザがネイティブに抑止するため、傾き値は`null`のまま・`wcs-tilt:change`は飛ばず・`permissionState`も（`requestPermission()`を呼ばない限り）`"unknown"`のまま変化しません。`requestPermission()`では検出できません: gatingの無いプラットフォームでは何も問い合わせずに`"granted"`を返します。`supported`なら分かります——非secure originでは`false`です。何も起きないときは、まず配信元（HTTPS/localhost）を確認してください。
- **Permissions-Policyでゲートされます。** `deviceorientation`イベントは`accelerometer`と`gyroscope`のPermissions-Policyディレクティブが許可されている場合にのみ発火します（既定allowlist: `self`、Device Orientation Events仕様§4準拠）。クロスオリジンの`<iframe>`内で`<wcs-tilt>`を使うには、その`<iframe>`要素に`allow="accelerometer; gyroscope"`が必要です——無いとイベントは無音のまま一切発火しません。上記の非secure originのケースと同じ失敗モードです。ページが自分のポリシーを読めるブラウザ（Chromium）では、そこで`supported`が`false`になります。
- **高頻度なイベントストリーム。** `deviceorientation`は多くのデバイスで毎秒数十回発火します。`@wcstack/state`にビルトインのdebounce/throttleフィルタは無いため、より粗い頻度に間引きたい場合は`@wcstack/debounce`のvalue surfaceで中継してください: `<wcs-tilt data-wcs="beta: tiltBeta">`のあと`<wcs-throttle wait="100" data-wcs="source: tiltBeta; value: throttledBeta"></wcs-throttle>`（詳細は`@wcstack/debounce`のREADME参照）。
- **`stop()`と切断は最後の値を残します。** `alpha` / `beta` / `gamma` / `absolute` / `heading`はリセットされず、更新されなくなるだけです。

## ヘッドレス利用（`TiltCore`）

```typescript
import { TiltCore } from "@wcstack/tilt";

const core = new TiltCore();
core.addEventListener("wcs-tilt:change", (e) => {
  console.log((e as CustomEvent).detail); // { alpha, beta, gamma, absolute }
});
core.addEventListener("wcs-tilt:heading-changed", (e) => {
  console.log((e as CustomEvent).detail); // 北からの時計回りの度数
});

await core.requestPermission();
core.start();
// 後始末:
core.dispose();
```

4.25（未リリース）から、`core.supported` はいつでも読め、`core.observe()`（または `core.publishSupported()`）は、最後に dispatch した値と違うときに `wcs-tilt:supported-changed` を dispatch します。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## アクセシビリティ

**WCAG 2.5.4 Motion Actuation（レベル A）**: デバイスを動かして操作するものは、動かさずにも操作できなければ**ならず**、モーション入力自体を無効化できなければならない。全員が端末を傾けられるわけではない — 車椅子に固定された端末もあれば、振戦は傾き入力をノイズに変える。具体的には: 傾き駆動の操作すべてに、同じコードパスへ流れる並行入力（キーボード・ポインタ・ボタン）と、センサーへの反応を止める手段（`stop` コマンドがまさにそれ）が要る。[`examples/state-tilt-maze`](https://github.com/wcstack/wcstack/tree/main/examples/state-tilt-maze) が参照実装: 矢印キーとドラッグがセンサーと同じ疑似傾きチャネルに乗り、ゲームロジックはどの入力が有効かを知らない。

## ライセンス

MIT
