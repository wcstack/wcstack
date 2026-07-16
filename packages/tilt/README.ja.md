# @wcstack/tilt

`@wcstack/tilt` は wcstack エコシステム向けのヘッドレスな Device Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの傾き（`deviceorientation`）をリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-tilt>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し
- **出力 state サーフェス**: `alpha`、`beta`、`gamma`、`absolute`、`permissionState`、`error`、`errorInfo`

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
| `errorInfo`       | `wcs-tilt:error-info-changed` | `error`から派生した、失敗のserializableなtaxonomy（`WcsIoErrorInfo`: 安定した`code` / `phase` / `recoverable`）、無ければ`null`。additive —— `error`の形状は不変。 |

## コマンド

| コマンド            | 非同期 | 説明 |
| -------------------- | ------ | ---- |
| `requestPermission`  | はい   | iOSではgesture-gatedな静的メソッドを呼ぶ（**実際のuser gestureハンドラ内から呼ぶ必要があります**）。それ以外の全プラットフォームでは即座に`"granted"`でresolve。 |
| `start`              | いいえ | `deviceorientation`を購読。冪等。 |
| `stop`               | いいえ | 購読解除。未開始でも安全に呼べます。 |

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
- **`errorInfo` taxonomy（additive）。** `error`と並んで、`<wcs-tilt>`は*同一の*失敗を安定した`WcsIoErrorInfo`（`code` / `phase` / `recoverable`）に分類したserializableな`errorInfo`（`wcs-tilt:error-info-changed`）を公開します。`error`の形状は変えません。ここで失敗しうるのは`requestPermission()`だけで、reject理由の`Error.name`で分類されます: `NotAllowedError`（iOSのDevice Orientation権限拒否）→ `not-allowed`（phase `start`）、それ以外（user-gesture文脈外のreject、非`Error`のreason）→ `tilt-error`（phase `execute`）。どちらも`recoverable: false`です。`capability-missing`コードは**ありません**: gatingの無いプラットフォームでは未対応環境はエラーにならず`"granted"`へ倒れるため、その分岐には到達しないからです。`errorInfo`は`error`とまったく同じタイミングで遷移し（回復時に`null`へクリア）、共有の`WcsIoErrorInfo`型と`WCS_TILT_ERROR_CODE`定数はexportされています。
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
