# @wcstack/ambient-light-sensor

`@wcstack/ambient-light-sensor` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（AmbientLightSensor）コンポーネントです。

視覚的な UI ウィジェットではありません。周囲の明るさ読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-ambient-light-sensor>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `illuminance`、`error`

明るさ駆動のUI（自動ダークモード、画面減光）を、`AmbientLightSensor`/`reading`/`error`リスナーの配線コードを書かずにHTML上で宣言的に表現できます。

`@wcstack/ambient-light-sensor` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`AmbientLightSensorCore`）がプラットフォームの`AmbientLightSensor`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-ambient-light-sensor>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`を宣言

## なぜ存在するか — Generic Sensor族の中で最も対応が弱いメンバー

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`AmbientLightSensor`のコンストラクタ自体です。

他の3兄弟と異なり、**`AmbientLightSensor`はx/y/z軸ではなく単一のスカラー値**（`illuminance`、lux単位）を報告します。

> **対応状況は狭いだけでなく悪化しています。** 他のセンサー族と共通のChromium/Android中心という制約に加え、`AmbientLightSensor`は特にfingerprinting対策を理由に複数のブラウザで無効化・削除されてきた経緯があります。採用前に現在の対応状況（MDN/caniuse）を必ず確認してください——対象ブラウザによってはこのパッケージの採用自体を見送るべき場合もあります。

> **`@wcstack/permission`との合成を推奨。** センサー自体が対応している環境では`navigator.permissions.query({name:"ambient-light-sensor"})`が存在するため、`<wcs-ambient-light-sensor>`は`<wcs-permission name="ambient-light-sensor">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

## インストール

```bash
npm install @wcstack/ambient-light-sensor
```

## クイックスタート

### 1. 明るさをライブ表示

`<wcs-ambient-light-sensor>`は接続時に**自動開始しません** — バインドしただけでは
`illuminance`は初期値`null`のままです。読み取りを流すには（例えばボタンから）
`start`コマンドを発火する必要があります:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/ambient-light-sensor/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startLight"],
      illuminance: null,
    };
  </script>
</wcs-state>

<wcs-ambient-light-sensor
  data-wcs="illuminance: illuminance; command.start: $command.startLight"
></wcs-ambient-light-sensor>

<button data-wcs="onclick: $command.startLight">開始</button>
<p data-wcs="textContent: illuminance"></p>
```

ボタンは`<wcs-ambient-light-sensor>`に直接触れません: クリックは`startLight`コマンドトークンを発火し（`$commandTokens: ["startLight"]`で名前を宣言）、`<wcs-ambient-light-sensor>`は`command.start: $command.startLight`でそれを購読します（[command-token プロトコル](../state/) — コマンドメソッドを持つ要素が*subscriber*であり、emitter ではありません）。

### 2. 権限を確認してから start する

この例では`@wcstack/permission`の登録も必要です（例1の`@wcstack/state` /
`@wcstack/ambient-light-sensor`の script に加えて）。`lightGranted`を宣言する
独立した`<wcs-state>`を持ちます:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startLight"],
      lightGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="ambient-light-sensor" data-wcs="granted: lightGranted"></wcs-permission>
<wcs-ambient-light-sensor data-wcs="command.start: $command.startLight"></wcs-ambient-light-sensor>

<button data-wcs="onclick: $command.startLight; disabled: lightGranted|not">開始</button>
```

バインドする state パスは事前にすべて宣言する必要があります — 未宣言のパスへのバインドは初期化時に例外を投げます。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ(`lightGranted|not`)で行います。

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`AmbientLightSensor`コンストラクタへそのまま渡る。 |

## 観測可能プロパティ（出力）

| プロパティ     | イベント                              | 説明 |
| -------------- | --------------------------------------- | ---- |
| `illuminance`  | `wcs-ambient-light-sensor:reading`       | 周囲の明るさ（lux）。初回読み取り前は`null`。 |
| `error`        | `wcs-ambient-light-sensor:error`         | 正規化された`{ error, message }`、無ければ`null`。 |

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。
- **`error`は sticky（据え置き）です。** 最後に観測した失敗（`unsupported`、`SecurityError`等）を保持し、その後の`start()`成功や`reading`受信では自動クリアされません。`stop()`＋`start()`でリトライが成功しても直前の`error`は残り続けます。必要なら利用側の state でクリア／再解釈してください。
- **生の`new AmbientLightSensor(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="ambient-light-sensor">`と合成してください。
- **採用前に現在のブラウザ対応状況を必ず確認してください** — 上記「なぜ存在するか」参照。

## ヘッドレス利用（`AmbientLightSensorCore`）

```typescript
import { AmbientLightSensorCore } from "@wcstack/ambient-light-sensor";

const core = new AmbientLightSensorCore();
core.addEventListener("wcs-ambient-light-sensor:reading", (e) => {
  console.log((e as CustomEvent).detail); // { illuminance }
});

core.start();
// 後始末:
core.dispose();
```

## ライセンス

MIT
