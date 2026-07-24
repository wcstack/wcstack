# @wcstack/screen-orientation

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/screen-orientation` は wcstack エコシステム向けのヘッドレスな Screen Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。`screen.orientation` をリアクティブな state に変え、`lock()`/`unlock()` を宣言的コマンドとして公開する**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-screen-orientation>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `screen.orientation` は設定すべきものを持たない単一のグローバル
- **出力 state サーフェス**: `type`、`angle`、`portrait`、`landscape`、`error`、`errorInfo`

## なぜ存在するか — このバッチで唯一のmonitor/command非対称性

`@wcstack/network`（純粋なmonitor）と異なり、本ノードは**双方向**です: orientationを監視しつつ`lock()`/`unlock()`コマンドも公開します。これにより内部に顕著な非対称性が生じます:

- **監視には`_gen`世代ガードが不要。** `screen.orientation`の`change`イベント購読は完全に同期的——`dispose()`とレースしうる非同期probeの解決が存在しません（`@wcstack/network`と同じ理由）。
- **`lock()`には必要。** 非同期・in-flightであり、古い`lock()`呼び出しの解決が、より新しい`lock()`/`unlock()`呼び出しが確立した状態を上書きしてはなりません。このガードは監視パスとは完全に独立しています。

> **`lock()`はbest-effort。** デスクトップ/モバイルの区別ではありません: 現行の多くのブラウザはデスクトップ・モバイルを問わず、ドキュメントがフルスクリーンであるか、インストール済みPWAとして動作していない限り、通常タブでの`lock()`呼び出しをrejectします（Safariはどの文脈でも`lock()`自体を実装していません）。rejectのエラー名はブラウザと原因によって異なります——現行仕様ではフルスクリーンpre-lock条件未達は`NotAllowedError`、その向きのロック自体が非対応なら`NotSupportedError`、過去の実装では`SecurityError`——特定の名前で分岐しないでください。never-throw: 失敗は呼び出し元から見てrejectされたpromiseとしてではなく、`error`に着地します。

## インストール

```bash
npm install @wcstack/screen-orientation
```

## クイックスタート

### 1. 向きをライブ表示

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/screen-orientation/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      portrait: true,
      // 初回スナップショットはバインド確立前に発火するため、一度だけ pull する（下記 Notes 参照）。
      async $connectedCallback() {
        await customElements.whenDefined("wcs-screen-orientation");
        this.portrait = document.querySelector("wcs-screen-orientation").portrait;
      },
    };
  </script>
</wcs-state>

<wcs-screen-orientation data-wcs="portrait: portrait"></wcs-screen-orientation>
<template data-wcs="if: portrait|not">
  <p>デバイスを縦向きにしてください。</p>
</template>
```

この例にはひとつのタイミング規則が適用されます: `<wcs-screen-orientation>`は`wcs-orientation:change`イベントでスナップショットを公開しますが、**最初の**スナップショットは接続時に同期的に発火します——`@wcstack/state`がbindingリスナーを取り付ける前に。そのためbindされたパスは**次の**向き変化からしか更新されません。`$connectedCallback`ブロックはその初回スナップショットを一度だけpullします。これが無いと、読み込み時点で既に横向きだった場合にこのページは反応しません（詳細はNotes & limitationsを参照）。

### 2. コマンドで向きをロックする

```html
<wcs-screen-orientation data-wcs="command.lock: $command.lockLandscape; error: lockError"></wcs-screen-orientation>
<button data-wcs="onclick: lockLandscape">横向きに固定</button>
```

```js
export default {
  lockError: null,
  $commandTokens: ["lockLandscape"],
  lockLandscape() {
    this.$command.lockLandscape.emit("landscape");
  },
};
```

この例のような通常タブでは、ボタンを押しても実際にはロックされません: ドキュメントがフルスクリーンであるか、インストール済みPWAとして動作していない限り、現行ブラウザは`lock()`をrejectします（`lockError`に現れます）。実際にロックが効くのを確認するには、`<wcs-fullscreen>`のようなフルスクリーントリガーと組み合わせ、フルスクリーンに入った後で`lock()`を呼んでください（詳細はNotes & limitationsを参照）。

## 観測可能プロパティ（出力）

| プロパティ  | イベント                  | 説明 |
| ----------- | -------------------------- | ---- |
| `type`      | `wcs-orientation:change`   | `screen.orientation.type`（例: `"portrait-primary"`）、非対応環境では`null`。 |
| `angle`     | `wcs-orientation:change`   | `screen.orientation.angle`、非対応環境では`null`。 |
| `portrait`  | `wcs-orientation:change`   | `type`が`"portrait"`で始まれば`true`。 |
| `landscape` | `wcs-orientation:change`   | `type`が`"landscape"`で始まれば`true`。 |
| `error`     | `wcs-orientation:error`    | 直近の`lock()`/`unlock()`の失敗、無ければ`null`。 |
| `errorInfo` | `wcs-orientation:error-info-changed` | `error`から派生した、失敗のserializableなtaxonomy（`WcsIoErrorInfo`: 安定した`code` / `phase` / `recoverable`）、無ければ`null`。additive —— `error`の形状は不変。 |

`type`/`angle`/`portrait`/`landscape`は全て単一の`wcs-orientation:change`イベントから派生します。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `lock`   | はい   | 特定の向きへのロックを要求（例: `"landscape"`、`"portrait-primary"`）。値は素通し——never-throw、未知の文字列や非対応環境は`error`へ。 |
| `unlock` | いいえ | 直前のロックを解除。プラットフォームAPIと同じく同期的。 |

## 属性 / 入力

**無し。** `screen.orientation`は単一のグローバルであり、インスタンスごとに設定すべきものがありません。

## 注意・制限

- 監視に**secure-context制約は無し**（`@wcstack/geolocation`/`@wcstack/permission`とは異なる）。
- **`lock()`にはフルスクリーンまたはインストール済みPWAという文脈が必要です — デスクトップ/モバイルの区別ではありません。** 通常タブでの呼び出しはデスクトップ・モバイルを問わずrejectされるのが通例です（エラー名はブラウザと原因により`NotAllowedError`/`NotSupportedError`/`SecurityError`などと異なるため、名前で分岐しないでください）。Safariはそもそも`lock()`を実装していません。best-effortであることを前提にUIを設計し、ロックを実際に効かせたい場面では`@wcstack/fullscreen`のような明示的なフルスクリーン導線と組み合わせてください。
- **初回スナップショットはbindingに届きません。** 最初の`wcs-orientation:change`は`connectedCallback`中に同期的に発火します——`@wcstack/state`がbindingリスナーを取り付ける前に（bindingのセットアップは後続のmicrotaskへ遅延されます。`docs/timing-and-firing-contract.md` §4.1参照）。イベントは後から購読した相手へ再送されないため、bindされたパスは**次の**向き変化からしか更新されません。初期値が重要な場合（`portrait`/`landscape`/`type`/`angle`はほぼ常にそうです）、Quick Startの例のように`$connectedCallback`で一度pullしてください。これは本パッケージ固有の癖ではなく、すべてのmonitor系ノードが共有するwc-bindableイベント契約の性質です。発火・世代管理の全体像（初回スナップショット・`lock()`の世代順序・`error`の重複排除）は`docs/timing-and-firing-contract.md` §7を参照してください。
- **`errorInfo` taxonomy（additive）。** `error`と並んで、`<wcs-screen-orientation>`は*同一の*`lock()`/`unlock()`失敗を安定した`WcsIoErrorInfo`（`code` / `phase` / `recoverable`）に分類したserializableな`errorInfo`（`wcs-orientation:error-info-changed` —— イベント名前空間はタグ名ではなく`wcs-orientation:`である点に注意）を公開します。`error`の形状は変えません。`screen.orientation`やメソッド自体の不在（synthetic な "unsupported"）→ `capability-missing`（phase `probe`）、通常タブでの lock reject である`NotAllowedError` / `NotSupportedError` / `SecurityError`は全て単一の`not-allowed`（phase `execute`、`recoverable: false` —— 上述の「名前で分岐するな」モデルに一致）へ畳まれ、`AbortError`（より新しい`lock()`による supersede）→ `aborted`（phase `execute`、`recoverable: true` —— 新しい`lock()`は成功しうる）、それ以外（`InvalidStateError`、生の throw、`.name`欠如など）→ `orientation-error`（phase `execute`）となります。`errorInfo`は`error`とまったく同じタイミングで遷移し（回復時に`null`へクリア）、共有の`WcsIoErrorInfo`型と`WCS_SCREEN_ORIENTATION_ERROR_CODE`定数はexportされています。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true`を宣言。監視が同期的なため`connectedCallbackPromise`は常に即座にsettleします。

## `:state()` による CSS スタイリング

`<wcs-screen-orientation>` は boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `portrait` | `wcs-orientation:change` が `"portrait"` で始まる `type` で発火 |
| `landscape` | `wcs-orientation:change` が `"landscape"` で始まる `type` で発火 |
| `error` | `wcs-orientation:error` が非 `null` の detail で発火（`null` でクリア） |

`portrait` と `landscape` は相互排他で、`type` が `null`（非対応環境）のときは
両方 off になります。イベント名前空間は `wcs-orientation:` であり、タグ名
`wcs-screen-orientation` とは異なる点に注意してください。`angle` は反映され
ません（連続値のため設計上除外——`docs/custom-state-reflection-design.md` §3.2 参照）。

```css
wcs-screen-orientation:state(portrait) ~ .portrait-hint  { display: block; }
wcs-screen-orientation:state(landscape) ~ .landscape-hint { display: block; }

form:has(wcs-screen-orientation:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-screen-orientation>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-screen-orientation:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["portrait"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-portrait` / `data-wcs-state-landscape` / `data-wcs-state-error`
  属性にミラーします。Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-screen-orientation debug-states></wcs-screen-orientation>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`ScreenOrientationCore`）

```typescript
import { ScreenOrientationCore } from "@wcstack/screen-orientation";

const core = new ScreenOrientationCore();
core.addEventListener("wcs-orientation:change", (e) => {
  console.log((e as CustomEvent).detail); // { type, angle }
});

core.observe();
await core.lock("landscape");
console.log(core.error);

// 後始末:
core.dispose();
```

## ライセンス

MIT
