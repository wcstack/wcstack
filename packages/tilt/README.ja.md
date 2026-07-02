# @wcstack/tilt

`@wcstack/tilt` は wcstack エコシステム向けのヘッドレスな Device Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの傾き（`deviceorientation`）をリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-tilt>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し
- **出力 state サーフェス**: `alpha`、`beta`、`gamma`、`absolute`、`permissionState`

## なぜ存在するか — `@wcstack/idle`の兄弟、iOSのgesture-gateを吸収する

iOS 13+ Safariは`deviceorientation`が発火する前に、明示的でgesture-gatedな`DeviceOrientationEvent.requestPermission()`を要求します。他の全プラットフォーム（Android Chrome、デスクトップ）にはこのgateがありません。`<wcs-tilt>`はこの差異を吸収します: gatingの無いプラットフォームでは`requestPermission()`は即座に`"granted"`でresolveするため、呼び出し元は**どこでも動く単一の**`requestPermission()` → `start()`フローを書けます。

> **`permissionState`は3値の語彙**（`"granted"` / `"denied"` / `"unknown"`）——このAPIに対応する`navigator.permissions.query()`エントリが存在しないため、意図的に4値のPermissions API状態とは別物にしています。`@wcstack/idle`（`@wcstack/permission`と合成）とは異なり、ローカルで追跡します。

> **connect時に自動startしません** — `@wcstack/idle`と同じ理由: 許可前の購読はiOSで無音のまま何も受け取れません。

> **secure context（HTTPSまたはlocalhost）が必須です。**

## インストール

```bash
npm install @wcstack/tilt
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/tilt/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      async enableTilt() {
        const el = document.querySelector("wcs-tilt");
        const result = await el.requestPermission();
        if (result === "granted") el.start();
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma"></wcs-tilt>
<button data-wcs="onclick: enableTilt">傾き検知を有効にする</button>
<div data-wcs="style.transform: tiltBeta|tpl('rotate(${0}deg)')"></div>
```

## 観測可能プロパティ（出力）

| プロパティ        | イベント                     | 説明 |
| ----------------- | ----------------------------- | ---- |
| `alpha`           | `wcs-tilt:change`             | Z軸回転、`start()`前は`null`。 |
| `beta`            | `wcs-tilt:change`             | X軸回転。 |
| `gamma`           | `wcs-tilt:change`             | Y軸回転。 |
| `absolute`        | `wcs-tilt:change`             | 地磁気に対する絶対方位かどうか。ブラウザにより信頼性が異なるため実機で確認してください。 |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`。 |

## コマンド

| コマンド            | 非同期 | 説明 |
| -------------------- | ------ | ---- |
| `requestPermission`  | はい   | iOSではgesture-gatedな静的メソッドを呼ぶ（**実際のuser gestureハンドラ内から呼ぶ必要があります**）。それ以外の全プラットフォームでは即座に`"granted"`でresolve。 |
| `start`              | いいえ | `deviceorientation`を購読。冪等。 |
| `stop`               | いいえ | 購読解除。未開始でも安全に呼べます。 |

## 属性 / 入力

**無し。**

## 注意・制限

- **connect時に自動startしません。**
- **`@wcstack/permission`とは合成しません**（対応するPermissions APIエントリが存在しないため）——`permissionState`はローカルで追跡します。
- `_gen`世代ガードは無し: 購読は完全に同期的です。

## ヘッドレス利用（`TiltCore`）

```typescript
import { TiltCore } from "@wcstack/tilt";

const core = new TiltCore();
core.addEventListener("wcs-tilt:change", (e) => {
  console.log((e as CustomEvent).detail); // { alpha, beta, gamma, absolute }
});

await core.requestPermission();
core.start();
// 後始末:
core.dispose();
```

## ライセンス

MIT
