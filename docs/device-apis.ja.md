# 画面とセンサーの API

**English**: [device-apis.md](./device-apis.md)

端末が持っているもの — 画面全体、小窓の動画、ポインター、スマホの向きと動き、共有シート、連絡先ピッカー、保存したパスワード、スポイト — を使うページは、フォームや一覧が出会わないことに 3 つ出会います。どれも、どこかの端末には無い。何かをするものは、どれもタップを求める。そして、どれも投げない: 断りは値です。この案内は、wcstack の要素がそれについて何をするかと、ページに残る仕事をまとめます。継ぎ目アプリ `stamp-rally`（[seam-apps.ja.md](./seam-apps.ja.md)）から書きました。その機械にスマホはありませんでした: ここでスマホについて言うことは、プラットフォームの文書どおりに振る舞う代役で確かめたもので、未確認のことが残る所は各節に書いてあります。

対象の要素: `<wcs-fullscreen>`・`<wcs-pip>`・`<wcs-pointer-lock>`・`<wcs-screen-orientation>`・`<wcs-tilt>`・`<wcs-accelerometer>`・`<wcs-gyroscope>`・`<wcs-magnetometer>`・`<wcs-ambient-light-sensor>`・`<wcs-share>`・`<wcs-contacts>`・`<wcs-credential>`・`<wcs-eyedropper>` と、そのそばの `<wcs-permission>`。

## 何が起きて、どうするか

| ページで | 起きること | すること |
|---|---|---|
| タップの外で出したコマンド: `$watch` から、応答が届いたとき、タップのハンドラーの `await` の後 | ブラウザが断る: `errorInfo.code` は `not-allowed`。Chromium ではタップの効力が約 5 秒続くので、速い回線では動き、遅い回線で失敗する。 | タップのハンドラーの中で、何かを待つ前に出す: [タップ](#タップ)。 |
| コマンドが失敗する | 何も投げられず、何も出力されない: 失敗は要素の `error` / `errorInfo` に入る。4.25 から、誰も読んでいなければ `diagnostics` アドオンが警告する（`[wcs/io-error-unobserved]`）。 | `errorInfo` を束ねて見せる: [失敗](#失敗)。 |
| その機能が無い — iPhone の全画面、Firefox の Picture-in-Picture、多くのデスクトップの共有シート、Chromium 以外のスポイトと保存したパスワード、Android 以外の連絡先ピッカー | 4.24 までは、ボタンが出て、タップが失敗した。4.25 から、これらの要素はどれも出力 `supported` を持つ。 | `supported` のときだけボタンを出す: [そこにあるか](#そこにあるか)。 |
| ページが、その機能を許していない `<iframe>` の中にある。または、それを禁じる `Permissions-Policy` 付きで配られている | `supported` は `false`。`<wcs-permission>` は `unsupported` と言い、4.25 から `unsupportedReason` が `policy-blocked` と言う。 | ページそのものを新しいタブで開くよう伝える: ブラウザのサイトの設定では変えられない。 |
| iPhone の向きと動きのセンサー | Safari は、タップから問われたときだけ問いを出し、問いは 2 つある。ほかの所から問うと、何も出さずに断る。4.25 から、そのとき `permissionState` は元のまま（以前は `"denied"` と言った）。 | ボタン 1 つ、問い 2 つ、タップの中で: [iPhone](#iphone)。 |
| 北 | `<wcs-tilt>` の `alpha` は、どちらのスマホでも相対値。4.25 から: 出力 `heading`。 | `heading` を束ねる。`null` は、端末がまだ言っていないということ。 |
| iPhone の加速度と回転 | Safari には Generic Sensor のクラスが無い。4.25 から、`<wcs-accelerometer>` と `<wcs-gyroscope>` はそこで `devicemotion` を読む。 | 問いのほかには何も。 |
| 利用者が Escape やスワイプで全画面を出る。小窓を × で閉じる | 要素の `active` は `false` になる。ページ自身のフラグはならない。 | `active` を束ねる。ボタンが反転させるフラグを持たない。 |
| 働いている最中に、要素が文書から外れる — ルートの中身、`if:` | 対象が外れると、ブラウザは全画面とポインターの捕捉を解く。4.25 から、`active` は `false` になる（以前は `true` のまま）。 | ページをまたいで続けたいものは、ルーターの外に置く: [遷移をまたぐ](#遷移をまたぐ)。 |
| 画面を横向きに固定する | `lock()` が効くのは、文書が全画面の間だけ。 | `active` に束ねたパスの `$watch` から固定し、戻ったら解く: [fullscreen の README](../packages/fullscreen/README.ja.md)。 |
| 利用者が、共有シート・スポイト・連絡先ピッカーを選ばずに閉じる | `error` ではなく `cancelled`（連絡先ピッカーは 4.25 から）。 | 何も見せない。 |
| `onclick: $command.share` — データを受け取るコマンドのトークンを、ボタンに直結する | イベントがコマンドの最初の引数になる: `share`・`select`・`lock` はブラウザの `TypeError`、`<wcs-credential>` の `get` は何も言わずに `null`。4.25 から lint が言う（`wcs/command-event-argument`）。 | state のメソッドから、データを付けて出す。 |
| センサーの値 | センサーの頻度で届き、状態に束ねた値は 1 つごとに書き込みになる。 | 見せるものが変わるまで、状態に入れない: [動き続けるセンサー](#動き続けるセンサー)。 |
| サインアウト | 次の訪問で、ブラウザが利用者をまたサインインさせる。 | `preventSilentAccess` コマンド（4.25）: [credential の README](../packages/credential/README.ja.md)。 |

## タップ

全画面、Picture-in-Picture、ポインターの捕捉、共有シート、ピッカー、iPhone のセンサーの問いは、タップ・クリック・キー入力を処理している最中のページにだけ与えられます。決めるのはブラウザで、厳しさはそれぞれ違います: Chromium は効力を約 5 秒保ち、Firefox は短く終わるハンドラーの中での要求を求め、Safari のセンサーの問いはタップそのものを求めます。

`on…:` のハンドラーはイベントの中で走り、state のメソッドが最初の `await` より前に出すものも同じです:

```js
export default {
  $commandTokens: ["share"],
  cardFile: null,   // スタンプ帳を見せるときに作っておく。タップの中では作らない

  // 共有は、タップの中で頼む。
  shareCard() {
    this.$command.share.emit({ files: [this.cardFile], text: "まち歩きスタンプラリー" });
  },

  // これはしない: 画像ができたときには、タップはもう終わっている。
  async shareCardLate() {
    const file = await this.makePicture();
    this.$command.share.emit({ files: [file], text: "まち歩きスタンプラリー" });
  },
};
```

2 つ目の形は、開発者の機械では動きます — 画像は数ミリ秒でできる — が、スマホや回線の遅い利用者の所で失敗します。コマンドに要るもの（画像、サーバーの答え）はタップの前に用意し、できるまでボタンを無効にしておきます。

同じ更新が描く要素へのコマンドは、まだ相手がいません: ハンドラーが今開いたばかりの `if:` の中に `target` がある `<wcs-fullscreen>` は、`Fullscreen target could not be resolved.` と答えます。描いた後に出してください（[fullscreen の README](../packages/fullscreen/README.ja.md)）。

## そこにあるか

4.25 から、`supported` は **このページがその機能を使えるか** を言います: API があり、ページがそれを使うことを禁じられていない。束縛が付くときに読まれる出力なので、最初の描画から正しく出ます:

```html
<wcs-fullscreen target="#stage" data-wcs="supported: fsSupported; active: fsActive; errorInfo: fsError;
                                          command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<div id="stage">
  <button data-wcs="hidden: fsSupported|not; onclick: $command.goFullscreen">全画面で見る</button>
</div>
```

利用者が許すこと、向きの固定が効くこと、端末にセンサーがあることは言いません: デスクトップのブラウザにはイベントがあり、値は決して来ません。知る必要のあるページは、`start` の後で少し待ち、「値が来ない」を「ここには無い」と扱います。

利用者に**理由**を伝える行 — 端末のチェックの 5 つの答え — は、問いの答えと `<wcs-permission>` を合わせて作ります:

```html
<wcs-tilt data-wcs="supported: tiltSupported; permissionState: tiltPermission; errorInfo: tiltError;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-permission name="accelerometer" data-wcs="state: sensorPermission; unsupportedReason: sensorWhy"></wcs-permission>

<p>向きのセンサー: <span data-wcs="textContent: compassLine"></span>
  <button data-wcs="hidden: needsAsking|not; onclick: allow">許可する</button></p>
```

```js
get compassLine() {
  if (this.sensorWhy === "policy-blocked") return "このページでは使えません"; // 埋め込み元のページが禁じている
  if (!this.tiltSupported) return "この端末では使えません";
  if (this.tiltPermission === "denied" || this.sensorPermission === "denied") return "許可されていません";
  if (this.tiltPermission !== "granted") return "許可が必要です";
  return "使えます";
},
get needsAsking() { return this.compassLine === "許可が必要です"; },
```

`unsupportedReason` は `policy-blocked`・`insecure-context`・`no-permissions-api`・`unknown-name` のどれかです。後ろの 2 つは「ブラウザには言えない」という意味で、機能が無いという意味ではありません: Firefox と Safari は、センサーの名前を受け付けません。ページのポリシーを見せるのは Chromium だけです。Firefox と WebKit では、禁じている枠は、ブラウザがそのためのフラグを持つ所（`document.fullscreenEnabled`）で `supported` に現れます。

## iPhone

iOS の Safari は、利用者が許すまで向きも動きも値を渡さず、タップからだけ問い、向き（`<wcs-tilt>`）と動き（`<wcs-accelerometer>`・`<wcs-gyroscope>`）を別々に問います。1 つのトークンですべての問いを出し、1 つのトークンですべてのセンサーを始められるので、タップ 1 回で済みます:

```html
<wcs-tilt data-wcs="permissionState: tiltPermission; heading: heading; errorInfo: tiltError;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-accelerometer data-wcs="errorInfo: motionError; eventToken.x: moved;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-accelerometer>
<button data-wcs="onclick: allow">許可する</button>
```

```js
$commandTokens: ["ask", "start"],
$eventTokens: ["moved"],
// どちらもタップの中で。emit の前に何も待たない。
allow() {
  this.$command.ask.emit();
  this.$command.start.emit();
},
```

- タップの外で出した問いは、出されずに断られます: `errorInfo.code` は `not-allowed`、`recoverable: true` で、`permissionState` は元のままです。`"denied"` は利用者自身の答えです。その後 Safari はもう問わず、利用者が Safari の設定で変えます。
- 再読み込みの後、`permissionState` はまた `"unknown"` です: Safari は、問われたときだけページに答えを教えます。覚えておきたいページは、自分でメモを持ちます。答えの決まった問いに Safari がタップなしで答えるかどうかは、スマホでは確かめていません。
- ほかの所 — Android、デスクトップ — でも同じボタンが働きます: 問いは無く、`requestPermission` はすぐに `"granted"` と答えます。
- `devicemotion` の経路では、軸の符号がプラットフォームで違いうることを、実機では確かめていません: 値の大きさ（振る、歩く）を使うか、対象のスマホで確かめてください。

## 遷移をまたぐ

ルートの中身は、利用者がそこを離れると文書から外されます（[router の README](../packages/router/README.ja.md)）。閉じた `if:` の枝も同じです。対象が外れると、ブラウザは全画面とポインターの捕捉を解き、要素は — 4.25 から — 外れるときに `active: false` を報告します。

ほかのページを読んでいる間も小窓で流し続ける動画は、`<wcs-pip>` と一緒にルーターの外に置き、見せない所では取り除かずに隠します:

```html
<wcs-router>…</wcs-router>

<!-- ルートの外: どのページでも同じノード -->
<section data-wcs="class.offscreen: onSpotPage|not">
  <wcs-pip data-wcs="supported: pipSupported; active: pipActive; errorInfo: pipError;
                     command.requestPictureInPicture: $command.openPip; command.exitPictureInPicture: $command.closePip">
    <video data-wcs="attr.src: videoUrl" playsinline></video>
  </wcs-pip>
</section>
```

Chromium は、文書から外れた後も動画を小窓で流し続けるので、この間違いはそこでは見えません。ほかのブラウザは、閉じるか止めるかもしれません。

## 動き続けるセンサー

- **頼まれて始まり、外れると止まる。** どのセンサーの要素も接続では始まらず、切断で止まり、ルートが戻ってきても誰も始め直しません: それを要するページが見えたときに `start` を出し（ルーターの `routeName` の `$watch`）、見えなくなったら `stop` を出します。
- **隠れたタブ。** ページの可視性を報告する wcstack の要素はありません。書き方は [long-lived-pages.ja.md](./long-lived-pages.ja.md) にあります。そこからセンサーを止め、ページが何かを数えていたなら、利用者が戻ったときにそう伝えます。
- **値 1 つの費用。** 状態に束ねると（`x: ax; y: ay; z: az`）、値 1 つごとに書き込みが起き、そこから描いたものはすべて描き直されます。継ぎ目アプリでは、値のたびに描く一覧は、スクリプトの時間が約 2 倍になり、値 1 つごとにレイアウトが走りました（毎秒 35 回）。見せるものが変わったときだけ描く形では、レイアウトはそのときだけです。値はイベントトークンのハンドラーで受け、そこから計算したものは状態の外に置き、見せるものが変わるときだけパスに書きます — 向きは 2 度動いたとき、歩数は 1 歩数えたとき:

```js
$on: {
  moved(state, event) {
    const { x, y, z } = event.detail;          // 値の全体
    if (steps.feed(Math.hypot(x, y, z))) state.stepCount = steps.count;
  },
},
```

- **`frequency`** は、センサーに頻度を頼みます（`devicemotion` の経路では、値を間引きます）。正の数でない値は、4.25 から報告されます（`[wcs/frequency-invalid]`）。ブラウザが許す以上の頻度は、何も言わずに頭打ちになります。

## 失敗

利用者がコマンドを引き起こす要素には、どれも `errorInfo` を束ね、何かを見せます:

```html
<wcs-share data-wcs="command.share: $command.share; cancelled: shareCancelled; errorInfo: shareError"></wcs-share>
<p role="alert" data-wcs="hidden: shareError|not">共有できませんでした。</p>
```

`errorInfo.code` は、どの要素でも同じ少数の語です: `capability-missing`（API が無い — 代わりの手段を出す）、`not-allowed`（断られた: タップが無い、ポリシー、許可）、`invalid-argument`（何も指さない `target`）。残りは、その要素自身の code です。`cancelled` は別です: 利用者がシートやピッカーを閉じるのは、失敗ではありません。

4.25 から、`diagnostics` アドオン（`/auto` に入っています）があれば、失敗を報告した要素の `data-wcs` が `error`・`errorInfo`・`status`・`connected` のどれも読まず、イベントトークンも無いとき、その要素がコンソールに挙げられます。タグと code ごとに 1 回です（[state の README](../packages/state/README.ja.md)）。

## 端末なしで試す

- **Chromium のセンサー**: DevTools プロトコルが値を送れます（`Emulation.setSensorOverrideEnabled`・`Emulation.setSensorOverrideReadings`）。コンテキストに許可を与えておきます。`Magnetometer` と `AmbientLightSensor` は、`--enable-features=GenericSensorExtraClasses` を付けたときだけ存在します。
- **iPhone の問い、共有シート、ピッカー、保存したパスワード**: ページのスクリプトより先に入れるスクリプト（`page.addInitScript`）で、プラットフォームと同じに振る舞わせます — `navigator.userActivation.isActive` のときだけ問う、断りを覚える、選ばずに閉じたピッカー。このリポジトリのものは `e2e/tests/io-screen-sensors-stubs.ts` にあります。代役が証明するのは、答えに対してページがすることで、スマホが何と答えるかではありません。
- **タップでない呼び出し**は、テストが触っていないページの、ページ自身のタイマーから出します: Playwright のクリック、`page.evaluate()`、`expect(locator)` の裏の待ち受けは、どれもユーザーの操作に数えられます。
- **headless のブラウザ**: Chromium の `screen.orientation.lock()` は、普通のタブでも、解決して何も変えません。Escape は、headless の Chromium では全画面を出ません（Firefox と WebKit では出ます）。別のタブの後ろのタブは、隠れていません。Windows の Playwright の WebKit には `DeviceOrientationEvent` が無く、動画を再生しません。
