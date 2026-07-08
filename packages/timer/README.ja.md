# @wcstack/timer

`@wcstack/timer` は wcstack エコシステム向けのヘッドレスなタイマーコンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変えるのと同じように、**時間の経過をリアクティブな状態に変える非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-timer>` はパス契約を通じて直接バインドできます。

- **入力面**: `interval`, `once`, `repeat`, `immediate`, `manual`, `trigger`
- **出力状態面**: `tick`, `elapsed`, `running`
- **コマンド**: `start`, `stop`, `reset`, `pause`, `resume`

> `trigger` はコマンドではなく、モーメンタリな命令*プロパティ*（入力）です。`false`→`true` の書き込みでタイマーが開始します。状態から command-token プロトコルで起動する場合は `command.start:` を使ってください（[コマンド](#コマンド)参照）。`command.trigger` は存在しません。

つまり、繰り返し処理を HTML 上で宣言的に表現でき、UI 層に `setInterval()` / `clearInterval()` や後始末のグルーコードを書く必要がありません。

`@wcstack/timer` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`TimerCore`）がスケジューリング・tick カウント・経過時間・pause/resume を担当
- **Shell**（`<wcs-timer>`）がその状態を DOM 属性・ライフサイクル・宣言的コマンドに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

タイマーは `fetch` と同様、時間とともに値を生み出す非同期ソースです。命令的に書くと、開始・クリア・カウント・切断時の後始末といったライフサイクル管理が必要になります。

`@wcstack/timer` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。時間が命令的なイベント配線ではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/timer
```

## クイックスタート

### 1. 状態へのリアクティブな tick

`<wcs-timer>` が DOM に接続されると、自動的にインターバルタイマーを開始します。`tick` / `elapsed` / `running` を状態パスにバインドします。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/timer/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      count: 0,
      isRunning: false,
      get statusLabel() {
        return this.isRunning ? "動作中" : "停止";
      }
    };
  </script>
</wcs-state>

<wcs-timer
  interval="1000"
  data-wcs="tick: count; running: isRunning">
</wcs-timer>

<p data-wcs="textContent: count"></p>
<p data-wcs="textContent: statusLabel"></p>
```

### 2. ワンショット（`setTimeout` 相当）

`once` は `interval` ミリ秒後に1回だけ tick して自動停止します（`once` は `repeat="1"` の糖衣構文です）。

```html
<wcs-timer interval="3000" once data-wcs="tick: showBanner"></wcs-timer>
```

### 3. 回数制限付きの繰り返し

`repeat="N"` は N 回 tick して停止します（`running` が `false` になります）。

```html
<wcs-timer interval="1000" repeat="5" data-wcs="tick: countdownStep"></wcs-timer>
```

### 4. 即時発火

`immediate` は最初の1回を、1インターバル待たずに開始時点で発火します。

```html
<wcs-timer interval="5000" immediate data-wcs="tick: pollNow"></wcs-timer>
```

## 属性 / Inputs

| 属性        | 型      | 既定値  | 説明                                                            |
| ----------- | ------- | ------- | --------------------------------------------------------------- |
| `interval`  | number  | `1000`  | tick の周期（ミリ秒）。有限かつ `> 0` であること。不正値（`0`・負数・非数値）は `1000` にフォールバック。 |
| `once`      | boolean | `false` | 1回だけ発火して停止。`repeat="1"` の糖衣構文。                  |
| `repeat`    | number  | `0`     | N 回で停止（`0` = 無制限）。`once` より優先されます。           |
| `immediate` | boolean | `false` | 最初の tick を開始時点で発火（1インターバル待たない）。         |
| `manual`    | boolean | `false` | 接続時に自動開始しない。コマンド / trigger で開始します。       |

## 観測プロパティ（出力）

| プロパティ | イベント                    | 説明                                                          |
| ---------- | --------------------------- | ------------------------------------------------------------- |
| `tick`     | `wcs-timer:tick`            | 発火ごとに増えるカウンタ（`reset` で 0 に戻る）。             |
| `elapsed`  | `wcs-timer:tick`            | 最後の reset からの経過時間（ミリ秒）。                       |
| `running`  | `wcs-timer:running-changed` | tick 中は `true`、停止 / 一時停止中は `false`。               |

## コマンド

| コマンド  | 説明                                                             |
| --------- | ---------------------------------------------------------------- |
| `start`   | tick を開始（既に動作中なら no-op）。                            |
| `stop`    | tick を停止。`tick` / `elapsed` は保持されます。                 |
| `reset`   | 停止し `tick` / `elapsed` を `0` に戻します。                    |
| `pause`   | 周期の途中経過と経過時間を保持したまま一時停止します。           |
| `resume`  | `pause` から、周期の残り時間を尊重して再開します。               |

`interval` のライブ変更が即時反映されるのは**動作中**のときだけです。**一時停止中**に `interval` を変更しても現在の周期には影響せず、次の `start` で新しい値が反映されます。

状態駆動の呼び出しには command-token プロトコルを使います。

```html
<wcs-timer manual data-wcs="command.start: $command.beginPolling"></wcs-timer>
```

## 任意の DOM トリガ

`autoTrigger` が有効（既定）なら、`data-timertarget="<id>"` を持つ要素のクリックで、参照先の `<wcs-timer>` の `start()` が呼ばれます。

```html
<button data-timertarget="poll">ポーリング開始</button>
<wcs-timer id="poll" interval="5000" manual data-wcs="tick: pollNow"></wcs-timer>
```

イベント委譲を使うため動的に追加された要素でも動作し、`closest()` によりネストした要素（ボタン内のアイコンなど）にも対応します。一致したクリックは `start()` の前に `event.preventDefault()` を呼ぶため、要素の既定動作は抑制されます。既定動作も必要な要素（実際の `<a href>` リンクや form 送信ボタンなど）には `data-timertarget` を付けないでください（キャンセルされます）。

## `:state()` による CSS スタイリング

`<wcs-timer>` は 1 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `running` | `wcs-timer:running-changed` が `true` で発火（`false` でクリア） |

`<wcs-timer>` には `error` イベントが無いため、`error` ステートは反映されません。

```css
wcs-timer:state(running) ~ .indicator { color: green; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-timer>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-timer:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["running"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-running` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-timer interval="1000" debug-states></wcs-timer>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 設定

`bootstrapTimer()` が `<wcs-timer>` を登録し、必要に応じて既定値を上書きします。部分的な設定を渡せます。

```javascript
import { bootstrapTimer } from "@wcstack/timer";

bootstrapTimer({
  autoTrigger: true,             // data-timertarget クリックトリガを有効化（既定: true）
  triggerAttribute: "data-timertarget", // クリックトリガで走査する属性
  tagNames: {
    timer: "wcs-timer",          // カスタム要素のタグ名
  },
});
```

`getConfig()` は現在の設定の deep-frozen なスナップショットを返します。

```javascript
import { getConfig } from "@wcstack/timer";

const { autoTrigger, triggerAttribute, tagNames } = getConfig();
```

| オプション          | 型      | 既定               | 説明                                         |
| ------------------ | ------- | ------------------ | -------------------------------------------- |
| `autoTrigger`      | boolean | `true`             | `data-timertarget` クリックトリガを有効化。   |
| `triggerAttribute` | string  | `data-timertarget` | DOM クリックトリガで走査する属性。            |
| `tagNames.timer`   | string  | `wcs-timer`        | 登録するカスタム要素のタグ名。                |

## ヘッドレス利用（`TimerCore`）

Core は DOM に依存せず、`@wc-bindable/core` の `bind()` と直接組み合わせられます。

```typescript
import { TimerCore } from "@wcstack/timer";

const timer = new TimerCore();
timer.addEventListener("wcs-timer:tick", (e) => {
  console.log((e as CustomEvent).detail); // { count, elapsed }
});
timer.start({ interval: 1000, repeat: 10 });
```

## ライセンス

MIT
