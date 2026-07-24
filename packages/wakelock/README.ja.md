# @wcstack/wakelock

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/wakelock` は wcstack エコシステムのためのヘッドレスな Screen Wake Lock コンポーネントです。

視覚的な UI ウィジェットではありません。
**非同期プリミティブノード** ですが、他のすべての @wcstack センサーとは *逆向き* に動作します。`@wcstack/geolocation` や `@wcstack/intersection` などは **プロデューサー**（`element → state`）で、デバイスのシグナルをリアクティブな状態に変換します。`@wcstack/wakelock` は **純粋なシンク**（`state → element`）で、バインドされた真偽値が画面を起こし続けるかどうかを駆動します。

`@wcstack/state` と組み合わせると、`<wcs-wakelock>` は宣言的な1行として読めます:

```html
<wcs-wakelock data-wcs="active: isPlaying"></wcs-wakelock>
```

*「`isPlaying` が true である **間** 画面を起こし続ける」*。`navigator.wakeLock.request()` も、`visibilitychange` での再取得のグルーコードも、後始末も不要です。

- **入力サーフェス**: `active`, `type`, `manual`
- **出力ステートサーフェス**: `held`, `error`, `errorInfo`
- **コマンド**: `request()`, `release()`

`@wcstack/wakelock` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core** (`WakeLockCore`) が sentinel、desired/actual の分離、自動解放後の再取得ループ、never-throw な失敗処理を所有
- **Shell** (`<wcs-wakelock>`) が `active` 属性を `request()` / `release()` にマップし、ライフサイクルを管理
- **Binding Contract** (`static wcBindable`) が観測可能な `properties`、書き込み可能な `inputs`、呼び出し可能な `commands` を宣言

## なぜ存在するのか

Screen Wake Lock API には扱いにくい性質があります。ページが可視でなくなった瞬間（タブが非表示、ウィンドウが最小化）に、OS が **自動的にロックを解放** してしまうのです。実際に「再生中は画面を起こし続ける」を実現するには、望み（desired intent）を自分で保持し、ページが再び可視になるたびにロックを再取得しなければなりません。

`@wcstack/wakelock` はそのリース管理をコンポーネントの内側に閉じ込めます。真偽値をバインドすれば、その値が true である限り、コンポーネントが可視性変化をまたいでロックを生かし続けます。

## 望み（`active`）と実状態（`held`）

自動解放があるため、*望んでいること* と *いま実際に保持していること* は乖離します。そこで両者は別々のサーフェスになっています:

| サーフェス  | 向き    | 意味 |
|----------|---------|------|
| `active` | 入力     | **望み（desired intent）。** `true` の間ロックを保持。OS の自動解放を越えて維持される。 |
| `held`   | 出力     | **実状態。** *いま* sentinel を保持しているか。自動解放で `false` になり、ページが再び可視になると `true` に戻る。 |

`active` は意図的に観測可能な出力 **ではありません**。OS がロックを落としても変化せず、変化するのは `held` だけだからです。UI でライブな「画面が起き続けている」状態を反映したい場合は `held` をバインドしてください。

## インストール

```bash
npm install @wcstack/wakelock
```

## クイックスタート

### 動画再生中に画面を起こし続ける

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/wakelock/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      playing: false,
      startPlaying() { this.playing = true; },
      stopPlaying() { this.playing = false; },
    };
  </script>

  <video
    src="/movie.mp4"
    data-wcs="onplay: startPlaying; onpause: stopPlaying"
  ></video>

  <!-- ロックは `playing` が true の間だけ保持され、タブ切り替えを越えて生き残る。 -->
  <wcs-wakelock data-wcs="active: playing"></wcs-wakelock>
</wcs-state>
```

### 実際のロック状態を UI に反映する

```html
<wcs-wakelock data-wcs="active: keepAwake; held: screenLocked"></wcs-wakelock>

<span data-wcs="textContent: screenLocked"></span>
```

### コマンド駆動（命令的）

```html
<wcs-wakelock data-wcs="command.request: $command.stayAwake"></wcs-wakelock>
```

> **コマンドは `active` 属性をミラーしません。** `request` / `release` コマンドは
> `active` 属性に触れずに Core の望み（desired intent）を直接切り替えるため、コマンド後は
> 要素の `active` プロパティ（属性のミラー）が `false` のまま `held` が `true`（またはその逆）
> になりえます。同一要素でコマンド駆動と `active` 属性バインドを混在させないでください
> — どちらか一方を選ぶこと。単一情報源には `active: ...` でバインドします。

## 属性

| 属性      | 型      | 既定値    | 説明 |
|-----------|---------|----------|------|
| `active`  | boolean | `false`  | 望み: 存在する間、画面を起こし続ける。看板バインディング（`active: isPlaying`）。 |
| `type`    | string  | `screen` | ロックの種類。標準化されているのは `screen` のみ。属性は将来互換のために存在。 |
| `manual`  | boolean | `false`  | `active` が付いていても接続時に自動取得しない。代わりに `request()` / `release()` で駆動する。 |

> **`manual` は接続時のポリシーであり、ライブなスイッチではありません。** 接続 *後* に `manual` 属性を外しても自動取得はしません — `active` をトグルするか `request()` を呼んでください。（ライブな `active` のトグルは `manual` に関係なく常に request/release を駆動します。）

## 出力ステート

| プロパティ | 型               | 説明 |
|----------|------------------|------|
| `held`   | `boolean`        | wake lock の sentinel をいま保持しているか。OS の自動解放と再取得を反映する。 |
| `error`  | `Error \| null`  | 直近のリクエスト失敗（拒否、未対応など）、または `null`。 |
| `errorInfo` | `WcsIoErrorInfo \| null` | `error` から派生した、失敗の serializable な taxonomy（安定した `code` / `phase` / `recoverable`）、または `null`。additive —— `error` の形状は不変。 |

> **`wcs-wakelock:error` は単なる失敗シグナルではなく、プロパティ変更通知**（wc-bindable モデル）です: 失敗時には `detail` = エラーで発火し、その後のリクエストが成功して `error` プロパティがクリアされると `detail = null` で再度発火します。`error == null` は「過去に一度もエラーがなかった」ではなく「いまエラーがない」と解釈してください。

## コマンド

| コマンド     | 説明 |
|-------------|------|
| `request()` | ロックを望み状態にして取得する（可視かつ対応環境なら）。reject しない — `error` を参照。 |
| `release()` | ロックを望まない状態にして、保持中の sentinel を解放する。 |

## `:state()` による CSS スタイリング

`<wcs-wakelock>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `held` | `wcs-wakelock:held-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-wakelock:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-wakelock:state(held) ~ .awake-indicator { display: block; }
wcs-wakelock:state(held) ~ .awake-indicator { display: none; } /* デフォルト */

form:has(wcs-wakelock:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-wakelock>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-wakelock:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["held"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-held` / `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-wakelock data-wcs="active: isPlaying" debug-states></wcs-wakelock>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## Binding Contract（`wcBindable`）

Core も Shell も [wc-bindable](https://github.com/csbc-dev) プロトコルを宣言します。

```js
// WakeLockCore (ヘッドレス)
WakeLockCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "held", event: "wcs-wakelock:held-changed" },
    { name: "error", event: "wcs-wakelock:error" },
    { name: "errorInfo", event: "wcs-wakelock:error-info-changed" },
  ],
  commands: [
    { name: "request", async: true }, { name: "release" },
  ],
};
```

Shell（`<wcs-wakelock>`）は Core の `properties` / `commands` を継承し、DOM 駆動の `inputs`（`active`, `type`, `manual`）を宣言します。

## Core を単体で使う

`WakeLockCore` はフレームワーク非依存で、カスタム要素なしでも使えます:

```js
import { WakeLockCore } from "@wcstack/wakelock";

const core = new WakeLockCore();
core.addEventListener("wcs-wakelock:held-changed", (e) => {
  console.log("screen awake:", e.detail);
});

await core.request();   // 取得（そして可視性変化をまたいで維持）
// 後で
core.release();         // 起こし続けるのを停止
core.dispose();         // visibilitychange リスナを除去
```

Core を直接駆動する場合は、終わったら `dispose()` を呼んで `visibilitychange` リスナを除去してください。

## ノートと制限

- **プロデューサーではなくシンク。** 他の @wcstack センサーとは違い、wake lock は状態に *よって* 駆動されます（`state → element`）。それが返すのは `held` だけです。
- **自動解放は肩代わりされます。** OS は複数の理由でロックを落とします — ページの非表示だけでなく、ページが可視のままでもバッテリー低下や省電力モードで落ちることがあります。コンポーネントはどちらの場合もリースを更新します: *可視*中の解放は即座に再取得し、*非表示*中の解放は次に可視へ戻ったときに再取得します（`active` が立っている限り）。このバインディングは「一度取得する」ではなく「active の **間** 起こし続ける」を意味します。再取得が**拒否**された場合はループせず、`error` で surface して静止します（支配的なケース: 仕様上バッテリー低下/省電力下の再リクエストは拒否されます）。再取得が**許可**された場合はリースを更新するため、OS が許可と解放を繰り返す限りコンポーネントも更新を続けます（解放1回につき request 1回、OS 駆動であり同期的なスピンではありません）。
- **セキュアコンテキスト（HTTPS）。** Screen Wake Lock API はセキュアコンテキスト（HTTPS、または `localhost`）でのみ動作します。
- **決して throw しない。** 未対応環境はサイレントな no-op（`held` は `false` のまま）。拒否されたリクエストは throw せず `error` プロパティで surface します。`request()` は決して reject しません。
- **`errorInfo` taxonomy（additive）。** `error` と並んで、`<wcs-wakelock>` は*同一の*失敗を安定した `WcsIoErrorInfo`（`code` / `phase` / `recoverable`）に分類した serializable な `errorInfo`（`wcs-wakelock:error-info-changed`）を公開します。`error` の形状は変えません。reject された `request()` はその `Error.name` で分類されます: `NotAllowedError`（ページ非可視、または permission / feature-policy によるブロック）→ `not-allowed`（phase `start`）、それ以外（非 `Error` の reject を正規化したものなど）→ `wakelock-error`（phase `execute`）。どちらも `recoverable: false` です。`capability-missing` コードは**ありません**: 未対応環境はサイレントな no-op（`held` は `false` のまま・`error` 未設定）で、その分岐には到達しないためです。`errorInfo` は `error` とまったく同じタイミングで遷移し（後続の成功で `null` へクリア）、共有の `WcsIoErrorInfo` 型と `WCS_WAKELOCK_ERROR_CODE` 定数は export されています。
- **パーミッションゲートなし。** 別個のパーミッションプロンプトはありません（ページが可視でない場合はリクエストが拒否されることがあり、それは `error` として surface します）。

## ライセンス

MIT
