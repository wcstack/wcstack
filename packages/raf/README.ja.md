# @wcstack/raf

`@wcstack/raf` は wcstack エコシステムのヘッドレス requestAnimationFrame コンポーネントです。

視覚的な UI ウィジェットではありません。
ブラウザの「描画機会」をリアクティブな状態に変える**非同期プリミティブノード**であり、時間源を周期（`setInterval`）からフレーム（`requestAnimationFrame`）に差し替えた `@wcstack/timer` の兄弟です。

`@wcstack/state` と組み合わせると、`<wcs-raf>` はパス契約で直接バインドできます:

- **入力面**: `once` / `repeat` / `manual` / `trigger`
- **出力状態面**: `tick` / `elapsed` / `dt` / `running` / `suspended`
- **コマンド**: `start` / `stop` / `reset` / `pause` / `resume`

ゲームループやアニメーションドライバを、rAF の再登録・dt の簿記・後始末コードなしに、HTML で宣言的に書けるということです。

## なぜ存在するか — `wcs-timer` とどう使い分けるか

`<wcs-timer interval="16">` でもゲームループは回せますが、`setInterval` はディスプレイのリフレッシュに揃わず、フレーム差分は利用側で自前計測が必要でした。`<wcs-raf>` は実際の描画機会で tick し、差分（`dt`）を一級の出力として配ります。

| | `<wcs-timer>` | `<wcs-raf>` |
|---|---|---|
| 時間源 | `setInterval`（選んだ周期） | `requestAnimationFrame`（ディスプレイのフレーム） |
| `interval` 入力 | あり | **なし** — rAF に周期は無い |
| `dt` 出力 | なし | **あり**（中断を跨ぐと `0`、下記参照） |
| 非表示タブ | ~1Hz にスロットル | **完全停止** — `suspended` で顕在化 |
| 向く用途 | ポーリング・カウントダウン・時計 | ゲームループ・アニメーション・毎フレーム計測 |

## インストール

```bash
npm install @wcstack/raf
```

## クイックスタート

### 1. 宣言的ゲームループ

`<wcs-raf>` は DOM に接続されると自動でフレームループを開始します。`tick` / `dt` をバインドするか、event token でフレームを受けて 1 フレーム 1 ステップを回します:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/raf/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      x: 0,
      $eventTokens: ["frame"],
      $on: {
        frame: (state, e) => { state.x += 60 * (e.detail.dt / 1000); }, // 60px/s
      },
      get transform() { return `translateX(${this.x}px)`; },
    };
  </script>
</wcs-state>

<wcs-raf data-wcs="eventToken.tick: frame"></wcs-raf>
<div class="box" data-wcs="style.transform: transform"></div>
```

`e.detail` は `{ count, elapsed, dt, timestamp }` を運びます — `dt` で積分すればフレームレート非依存の運動になります。

### 2. 1 フレームだけ（rAF 一発呼びの宣言化）

`once` は次の描画機会にちょうど 1 tick 発火して自動停止します:

```html
<wcs-raf once data-wcs="tick: afterNextPaint"></wcs-raf>
```

補足: 自動 start された `once` フレームは接続の約 1 フレーム後に一度だけ発火し、再発火しません。state 自体を非同期ロードする構成（`<wcs-state src="...">` 等）ではバインディングの attach がこの唯一の tick より遅れ、永久に取りこぼす可能性があります。その構成では `manual` にして state 準備後にコマンド / trigger で起動するか、state をインラインにしてください（同一タスク内の attach は必ず間に合います）。

### 3. 有限フレーム

`repeat="N"` は N フレームで停止します（`running` が `false` になります）。

## 属性 / 入力

| 属性 | 型 | 既定 | 説明 |
| --------- | ------- | ------- | ------------ |
| `once`    | boolean | `false` | 1 フレームだけ発火して停止。`repeat="1"` の糖衣。 |
| `repeat`  | number  | `0`     | N フレームで停止（`0` = 無制限）。`once` より優先。 |
| `manual`  | boolean | `false` | 接続時に自動 start しない。コマンド / trigger で開始。 |

`<wcs-timer>` から意図的に削除したもの: `interval`（rAF に周期は無い）と `immediate`（初回フレームがすでに「次の描画機会」であり、それより早い意味のある時点が存在しない）。

## 観測可能プロパティ（出力）

| プロパティ | イベント | 説明 |
| ----------- | ------------------------- | ------------ |
| `tick`      | `wcs-raf:tick`            | フレームカウンタ。毎発火で増加（`reset` で 0）。 |
| `elapsed`   | `wcs-raf:tick`            | 最後の reset からの**アクティブ**時間（Σdt、ms）。非表示・ポーズ期間は加算されない。粒度はフレーム単位。 |
| `dt`        | `wcs-raf:tick`            | 直前フレームとの差分（ms）。**`start()` / `resume()` / visibility 中断の直後の初回フレームは `0`** — 中断を跨いだ値は観測者に届かない。上限クランプは無し: 遅いフレームの扱いはドメイン判断（物理ループなら自前の `Math.min(dt, …)`）。 |
| `running`   | `wcs-raf:running-changed` | 開始済みの**意図**。非表示タブでフレームが届かなくても `true` のまま。 |
| `suspended` | `wcs-raf:suspended-changed` | 配送の**実態**。`running` かつ非表示タブで `true`（rAF はスロットルでなく完全停止）。desired/actual の分離は `@wcstack/wakelock` の `active`/`held` と同型。 |

`tick` / `elapsed` / `dt` は単一の `wcs-raf:tick` イベントからの派生です（`detail = { count, elapsed, dt, timestamp }`。`timestamp` はフレームの `DOMHighResTimeStamp`、`reset()` 通知では `0`）。`tick` は同値ガード無しで毎フレーム発火、`running` / `suspended` は同値ガード付きです。

## コマンド

| コマンド | 説明 |
| --------- | ----------------------------------------------------------------------- |
| `start`   | フレームループ開始（実行中は no-op）。 |
| `stop`    | 停止。`tick` / `elapsed` は保持。 |
| `reset`   | 停止して `tick` / `elapsed` / `dt` を `0` に。 |
| `pause`   | 値と有限 run の残数を保持したまま中断。 |
| `resume`  | `pause` から再開。直後の初回フレームは `dt = 0`。 |

state からの起動は command-token プロトコルで:

```html
<wcs-raf manual data-wcs="command.start: $command.beginLoop"></wcs-raf>
```

## DOM トリガー（オプション）

`autoTrigger`（既定 on）が有効なら、`data-raftarget="<id>"` を持つ要素のクリックで対象 `<wcs-raf>` の `start()` が呼ばれます。マッチしたクリックは `event.preventDefault()` されます — デフォルトアクションも活かしたい要素（実リンク・submit ボタン等）には `data-raftarget` を付けないでください。

```html
<button data-raftarget="loop">Start</button>
<wcs-raf id="loop" manual data-wcs="eventToken.tick: frame"></wcs-raf>
```

## `:state()` による CSS スタイリング

`<wcs-raf>` は 2 つの boolean 出力状態を CustomStateSet に反映します:

| 状態 | オンになる条件 |
|-------|---------|
| `running` | `wcs-raf:running-changed` が `true` で発火（`false` でクリア） |
| `suspended` | `wcs-raf:suspended-changed` が `true` で発火（`false` でクリア） |

```css
wcs-raf:state(running) ~ .indicator { color: green; }
wcs-raf:state(suspended) ~ .indicator { color: orange; } /* タブ非表示でループ枯渇 */
```

対応: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。非対応環境では状態が付かないだけで動作は継続します（graceful degradation / never-throw）。`debug-states` 属性は DevTools 用に `data-wcs-state-*` 属性をミラーします（デバッグ補助のみ — CSS は `:state()` に書くこと）。

## 注意と制約

- **非表示タブで rAF は完全停止します**（`setInterval` の ~1Hz スロットルと違う点）。`running` は意図を、`suspended` は実態を報告し、`elapsed` はアクティブ時間のみを数え、復帰後の初回フレームは `dt = 0` — dt 積分する利用側がテレポートを見ることはありません。
- **`error` 面はありません。** rAF に恒常的な失敗モードは無く、rAF の無い環境（SSR プリパス、worker）では `start()` が silent no-op になります（never-throw）。
- **SSR**: サーバーレンダリングするマークアップでは `manual` を推奨 — 自動開始したループは DOM エミュレーション環境でもフレームを予約し続けます。
- プラットフォーム API は呼び出し時に解決され（`globalThis.requestAnimationFrame`）、テスト用に `RafCore` へスケジューラを注入できます。

## ヘッドレス利用（`RafCore`）

```typescript
import { RafCore } from "@wcstack/raf";

const core = new RafCore();
core.addEventListener("wcs-raf:tick", (e) => {
  console.log((e as CustomEvent).detail); // { count, elapsed, dt, timestamp }
});
core.observe();  // visibilitychange を購読（`suspended` と hidden 跨ぎの dt=0 正規化の両方を駆動）
core.start();
// 後で:
core.dispose();
```

## 設定

```javascript
import { bootstrapRaf } from "@wcstack/raf";

bootstrapRaf({
  autoTrigger: true,               // data-raftarget クリック起動（既定: true）
  triggerAttribute: "data-raftarget",
  tagNames: { raf: "wcs-raf" },
});
```

## ライセンス

MIT
