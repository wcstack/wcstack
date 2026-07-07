# @wcstack/tilt

`@wcstack/tilt` は wcstack エコシステム向けのヘッドレスな Device Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの傾き（`deviceorientation`）をリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-tilt>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し
- **出力 state サーフェス**: `alpha`、`beta`、`gamma`、`absolute`、`permissionState`、`error`

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
      tiltBeta: null,
      tiltGamma: null,
      async enableTilt() {
        const el = document.querySelector("wcs-tilt");
        const result = await el.requestPermission();
        if (result === "granted") el.start();
      },
      get tiltTransform() {
        return `rotate(${this.tiltBeta ?? 0}deg)`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma"></wcs-tilt>
<button data-wcs="onclick: enableTilt">傾き検知を有効にする</button>
<div data-wcs="style.transform: tiltTransform"></div>
```

`data-wcs` が参照する全てのパス（`tiltBeta`、`tiltGamma`、`tiltTransform`、`enableTilt`）は state オブジェクトに宣言が必須です——未宣言の top-level パスはバインド初期化時に例外を投げます。`tiltTransform` は素の path getter（計算プロパティ、`@wcstack/state` の README 参照）です——`@wcstack/state` には文字列テンプレート化フィルタが無いため、CSS 文字列は getter 側で組み立てます。`tiltBeta` が変わるたびに再計算されます。

## 観測可能プロパティ（出力）

| プロパティ        | イベント                     | 説明 |
| ----------------- | ----------------------------- | ---- |
| `alpha`           | `wcs-tilt:change`             | Z軸回転、`start()`前は`null`。 |
| `beta`            | `wcs-tilt:change`             | X軸回転。 |
| `gamma`           | `wcs-tilt:change`             | Y軸回転。 |
| `absolute`        | `wcs-tilt:change`             | 地磁気に対する絶対方位かどうか。ブラウザにより信頼性が異なるため実機で確認してください。 |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`。 |
| `error`           | `wcs-tilt:error`              | 直近の`requestPermission()`の失敗（gesture文脈外呼び出しのrejectなど）、無ければ`null`。never-throw: 失敗はreject/throwせず、ここに流れます。 |

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
- **非secure context（素のHTTP）では`deviceorientation`は一切発火しません**——ブラウザがネイティブに抑止し、`<wcs-tilt>`自身はガードを持たない（nativeの非発火を信頼する設計）ため、傾き値は`null`のまま・`wcs-tilt:change`は飛ばず・`permissionState`も（`requestPermission()`を呼ばない限り）`"unknown"`のまま変化しません。`requestPermission()`でも検出できません: gatingの無いプラットフォームではフォールバックが何も問い合わせずに`"granted"`を返します。何も起きないときは、まず配信元（HTTPS/localhost）を確認してください。
- **Permissions-Policyでゲートされます。** `deviceorientation`イベントは`accelerometer`と`gyroscope`のPermissions-Policyディレクティブが許可されている場合にのみ発火します（既定allowlist: `self`、Device Orientation Events仕様§4準拠）。クロスオリジンの`<iframe>`内で`<wcs-tilt>`を使うには、その`<iframe>`要素に`allow="accelerometer; gyroscope"`が必要です——無いとイベントは無音のまま一切発火しません。上記の非secure originのケースと同じ失敗モードです。
- **高頻度なイベントストリーム。** `deviceorientation`は多くのデバイスで毎秒数十回発火します。`@wcstack/state`にビルトインのdebounce/throttleフィルタは無いため、より粗い頻度に間引きたい場合は`@wcstack/debounce`のvalue surfaceで中継してください: `<wcs-tilt data-wcs="beta: tiltBeta">`のあと`<wcs-throttle wait="100" data-wcs="source: tiltBeta; value: throttledBeta"></wcs-throttle>`（詳細は`@wcstack/debounce`のREADME参照）。

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
