# @wcstack/idle

`@wcstack/idle` は wcstack エコシステム向けのヘッドレスな Idle Detection コンポーネントです。

視覚的な UI ウィジェットではありません。`IdleDetector`のlive なユーザー/画面状態をリアクティブな state に変える**非同期プリミティブノード**で、明示的でgesture駆動な権限コマンドの後段に位置します。

`@wcstack/state` と組み合わせると、`<wcs-idle>` はパス契約で直接バインドできます:

- **入力サーフェス**: `threshold`（ms、最小60000）
- **出力 state サーフェス**: `userState`、`screenState`、`active`、`error`、`errorInfo`

## なぜ存在するか — gesture-gated permission パターンの参照実装

`IdleDetector.requestPermission()`は**静的メソッド**で、実際のuser gesture内から呼ぶ必要があります。`connectedCallback`はこの文脈の外なので、**本ノードはconnect時に自動startしません** — 呼び出し元が`requestPermission()` → `start()`を明示的に、典型的にはクリックハンドラから駆動します。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"idle-detection"})`が既に存在するため、`<wcs-idle>`は`<wcs-permission name="idle-detection">`と併置して`granted`/`denied`/`prompt`状態を得てください。`<wcs-idle>`自身は実際のアイドル状態と一回限りの`requestPermission()`アクションだけを公開し、4値permission状態は重複実装しません。

> **Chromium限定。** Firefox と Safari は`IdleDetector`を実装していません。

## インストール

```bash
npm install @wcstack/idle
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>
<script type="module" src="https://esm.run/@wcstack/idle/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      // start()前は在席とみなす: `wcs-idle:change`はstart()前は発火しないため、
      // ここを`false`にすると実際には在席なのに初回ロード時点で常に「離席中」が
      // 表示されてしまう(在席が単に未検知なだけ)。
      presenceActive: true,
      idleGranted: false,
      async enableIdleDetection() {
        const el = document.querySelector("wcs-idle");
        const result = await el.requestPermission();
        if (result === "granted") await el.start();
      },
    };
  </script>
</wcs-state>

<wcs-permission name="idle-detection" data-wcs="granted: idleGranted"></wcs-permission>
<wcs-idle threshold="60000" data-wcs="active: presenceActive"></wcs-idle>

<!-- 注意: ここに `disabled: idleGranted` をバインドしてはいけません——permission の
     許可はページロードを跨いで永続化されるため、再訪問時にボタンが最初から無効になり
     start()（このクリックが唯一の到達経路）が二度と実行できなくなります。許可済みでの
     再クリックは無害です: requestPermission() は即座に "granted" を返し start() に進みます。 -->
<button data-wcs="onclick: enableIdleDetection">離席検知を有効にする</button>
<p>許可状態: <span data-wcs="textContent: idleGranted"></span></p>
<template data-wcs="if: presenceActive|not">
  <span class="badge">離席中</span>
</template>
```

## 観測可能プロパティ（出力）

| プロパティ    | イベント          | 説明 |
| ------------- | ------------------ | ---- |
| `userState`   | `wcs-idle:change`  | `"active"` \| `"idle"`、`start()`前は`null`。 |
| `screenState` | `wcs-idle:change`  | `"locked"` \| `"unlocked"`、`start()`前は`null`。 |
| `active`      | `wcs-idle:change`  | `userState === "active"`のとき`true`。 |
| `error`       | `wcs-idle:error`   | 直近の`requestPermission()`/`start()`の失敗、無ければ`null`。 |
| `errorInfo`   | `wcs-idle:error-info-changed` | その同じ失敗のシリアライズ可能な失敗タクソノミ `WcsIoErrorInfo \| null`（安定した `code` / `phase` / `recoverable`）、クリア時は `null`。追加的で、`error` の形状は不変。 |

## コマンド

| コマンド             | 非同期 | 説明 |
| -------------------- | ------ | ---- |
| `requestPermission`  | はい   | 静的でgesture-gatedな`IdleDetector.requestPermission()`をラップ。**実際のuser gestureハンドラ内から呼ぶ必要があります。** never-throw: rejectは`"denied"`に倒れます。 |
| `start`              | はい   | アイドル検知セッションを開始（`threshold`はms、最小60000）。後続の`start()`/`stop()`で上書きされます。 |
| `stop`               | いいえ | 現在のセッションを停止。未開始でも安全に呼べます。 |

## 属性 / 入力

| 属性        | 型     | 既定値  | 説明 |
| ----------- | ------ | ------- | ---- |
| `threshold` | number | `60000` | `userState`が`"idle"`になるまでの最小アイドル時間（ms）。バリデーションなし——範囲外の値はブラウザ自身のrejectに委ねます。 |

## `:state()` による CSS スタイリング

`<wcs-idle>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `active` | `wcs-idle:change` が `detail.userState === "active"` で発火（`"idle"` になったらクリア） |
| `error` | `wcs-idle:error` が非 `null` の detail で発火（`null` でクリア） |

`screenState` には派生 boolean getter が無いため（§4.2）、v1 では反映対象外です。

```css
wcs-idle:state(active) ~ .presence-dot { background: green; }
wcs-idle:not(:state(active)) ~ .presence-dot { background: gray; }

form:has(wcs-idle:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-idle>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-idle:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["active"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-active` / `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-idle debug-states></wcs-idle>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **connect時に自動startしません。** 上記「なぜ存在するか」を参照。
- **permission状態を重複実装しません。** `<wcs-permission name="idle-detection">`と合成してください。
- **Chromium限定、かつ secure context 限定です。** Firefox と Safari は`IdleDetector`自体を実装していません。Chromiumであっても`IdleDetector`は`[SecureContext]`専用インターフェースのため、平文の`http://`（`localhost`を除く）では`window.IdleDetector`自体が`undefined`になり——非対応ブラウザと同じ`unsupported`（`error`経由）の分岐に落ちます。
- **Permissions-Policyでゲートされます。** アイドル検知は`idle-detection`のPermissions-Policyディレクティブ（既定allowlist: `self`）に支配されます。クロスオリジンの`<iframe>`内で`<wcs-idle>`を使うには、その`<iframe>`要素に`allow="idle-detection"`が必要です——無いと`requestPermission()`/`start()`は非対応ブラウザと同様に失敗します。
- **`stop()`/切断では`userState`/`screenState`/`active`をリセットしません。** 次に`start()`が成功するまで直近の観測値を保持します——Generic Sensor族（`<wcs-gyroscope>`等）と同じ「直近の読み取り値を保持する」挙動です。
- **`errorInfo` タクソノミ。** `error` に現れるのと同じ `requestPermission()`/`start()` の失敗を、シリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-idle:error-info-changed`）です。`error` の形状は変えません。`IdleDetector` の欠如（非対応ブラウザ、または `window.IdleDetector` が `undefined` になる非セキュアコンテキスト）は `capability-missing`（phase `probe`）、`NotAllowedError`（権限拒否、または user gesture 外での呼び出し——両者は意図的に区別しません）は `not-allowed`（phase `start`）、その他の失敗（生の throw、不正な `threshold` による `TypeError`、nullish な reject）は `idle-error`（phase `execute`）です。いずれも `recoverable: false`。`errorInfo` は `error` と同じタイミングで遷移し（`error` と共に `null` にクリアされる）ます。共有の `WcsIoErrorInfo` 型と `WCS_IDLE_ERROR_CODE` 定数は export 済みです。

## ヘッドレス利用（`IdleCore`）

```typescript
import { IdleCore } from "@wcstack/idle";

const core = new IdleCore();
core.addEventListener("wcs-idle:change", (e) => {
  console.log((e as CustomEvent).detail); // { userState, screenState }
});

// 実際のuser gestureハンドラ内から:
const result = await core.requestPermission();
if (result === "granted") await core.start(60000);

// 後始末:
core.dispose();
```

## ライセンス

MIT
