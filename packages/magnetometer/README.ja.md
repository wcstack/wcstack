# @wcstack/magnetometer

`@wcstack/magnetometer` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（Magnetometer）コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの磁束密度読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-magnetometer>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `x`、`y`、`z`、`error`

`@wcstack/magnetometer` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`MagnetometerCore`）がプラットフォームの`Magnetometer`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-magnetometer>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`を宣言

## なぜ存在するか — プラットフォームAPI自体がnever-throwと最初から一致する稀な例

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`Magnetometer`のコンストラクタ自体です。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"magnetometer"})`が既に存在するため、`<wcs-magnetometer>`は`<wcs-permission name="magnetometer">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

> **Chromium/Android中心の対応。** デスクトップでは`Magnetometer`クラスが存在しても`SecurityError`になりがちです。unsupported/deniedを既定状態として設計してください。

## インストール

```bash
npm install @wcstack/magnetometer
```

## クイックスタート

### 1. 磁束密度をライブ表示

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/magnetometer/auto"></script>

<wcs-state>
  <script type="module">
    export default { x: null, y: null, z: null };
  </script>
</wcs-state>

<wcs-magnetometer data-wcs="x: x; y: y; z: z"></wcs-magnetometer>
<p data-wcs="textContent: x"></p>
```

### 2. 権限を確認してから start する

```html
<wcs-permission name="magnetometer" data-wcs="granted: magnetGranted"></wcs-permission>
<wcs-magnetometer data-wcs="command.start: $command.startMagnet"></wcs-magnetometer>

<button data-wcs="onclick: startMagnet; disabled: !magnetGranted">開始</button>
```

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`Magnetometer`コンストラクタへそのまま渡る。 |

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | --------------------------- | ---- |
| `x`        | `wcs-magnetometer:reading` | x軸方向の磁束密度。初回読み取り前は`null`。 |
| `y`        | `wcs-magnetometer:reading` | y軸方向の磁束密度。 |
| `z`        | `wcs-magnetometer:reading` | z軸方向の磁束密度。 |
| `error`    | `wcs-magnetometer:error`   | 正規化された`{ error, message }`、無ければ`null`。 |

`x`/`y`/`z`は単一の`wcs-magnetometer:reading`イベントから派生します（ネイティブの1回の`reading`イベントで3軸が同時に更新される）。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。
- **生の`new Magnetometer(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="magnetometer">`と合成してください。

## ヘッドレス利用（`MagnetometerCore`）

```typescript
import { MagnetometerCore } from "@wcstack/magnetometer";

const core = new MagnetometerCore();
core.addEventListener("wcs-magnetometer:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// 後始末:
core.dispose();
```

## ライセンス

MIT
