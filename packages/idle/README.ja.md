# @wcstack/idle

`@wcstack/idle` は wcstack エコシステム向けのヘッドレスな Idle Detection コンポーネントです。

視覚的な UI ウィジェットではありません。`IdleDetector`のlive なユーザー/画面状態をリアクティブな state に変える**非同期プリミティブノード**で、明示的でgesture駆動な権限コマンドの後段に位置します。

`@wcstack/state` と組み合わせると、`<wcs-idle>` はパス契約で直接バインドできます:

- **入力サーフェス**: `threshold`（ms、最小60000）
- **出力 state サーフェス**: `userState`、`screenState`、`active`、`error`

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

<button data-wcs="onclick: enableIdleDetection">離席検知を有効にする</button>
<template data-wcs="if: !presenceActive">
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

## 注意・制限

- **connect時に自動startしません。** 上記「なぜ存在するか」を参照。
- **permission状態を重複実装しません。** `<wcs-permission name="idle-detection">`と合成してください。
- Chromium限定。それ以外では`error`経由の`unsupported`が既定です。

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
