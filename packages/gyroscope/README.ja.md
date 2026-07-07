# @wcstack/gyroscope

`@wcstack/gyroscope` は wcstack エコシステム向けのヘッドレスな Generic Sensor API（Gyroscope）コンポーネントです。

視覚的な UI ウィジェットではありません。デバイスの角速度読み取りをリアクティブな state に変える**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-gyroscope>` はパス契約で直接バインドできます:

- **入力サーフェス**: `frequency`（サンプリングレート、Hz）
- **出力 state サーフェス**: `x`、`y`、`z`、`error`

`@wcstack/gyroscope` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`GyroscopeCore`）がプラットフォームの`Gyroscope`を構築し、live な`reading`/`error`イベントを追従
- **Shell**（`<wcs-gyroscope>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な`properties`と`start`/`stop`の`commands`を宣言

## なぜ存在するか — プラットフォームAPI自体がnever-throwと最初から一致する稀な例

Generic Sensor API の`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`族は全て共通の形状を持ちます: `.start()`/`.stop()`、サンプルごとの`'reading'`イベント、そして——注目すべき点として——失敗は例外ではなく**`'error'`イベント**で通知されます。これは wcstack の never-throw 方針と最初から噛み合っています。唯一防御的な`try/catch`が要るのは、権限拒否やPermissions-Policyブロックで**同期的に例外を投げうる**`Gyroscope`のコンストラクタ自体です。

> **`@wcstack/permission`との合成を推奨。** `navigator.permissions.query({name:"gyroscope"})`が既に存在するため、`<wcs-gyroscope>`は`<wcs-permission name="gyroscope">`と併置して`granted`/`denied`/`prompt`状態を得てください（権限状態はこのノード自身では重複実装しません、`docs/sensor-tag-design.md`参照）。

> **Chromium/Android中心の対応。** デスクトップでは`Gyroscope`クラスが存在しても`SecurityError`になりがちです。unsupported/deniedを既定状態として設計してください。

## インストール

```bash
npm install @wcstack/gyroscope
```

## クイックスタート

### 1. 角速度をライブ表示

`<wcs-gyroscope>`は接続時に**自動開始しません** — バインドしただけでは
`x`/`y`/`z`は初期値`null`のままです。読み取りを流すには（例えばボタンから）
`start`コマンドを発火する必要があります:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      x: null, y: null, z: null,
    };
  </script>
</wcs-state>

<wcs-gyroscope
  data-wcs="x: x; y: y; z: z; command.start: $command.startGyro"
></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro">開始</button>
<p data-wcs="textContent: x"></p>
```

ボタンは`<wcs-gyroscope>`に直接触れません: クリックは`startGyro`コマンドトークンを発火し（`$commandTokens: ["startGyro"]`で名前を宣言）、`<wcs-gyroscope>`は`command.start: $command.startGyro`でそれを購読します（[command-token プロトコル](../state/) — コマンドメソッドを持つ要素が*subscriber*であり、emitter ではありません）。

### 2. 権限を確認してから start する

この例では`@wcstack/permission`の登録も必要です（例1の`@wcstack/state` /
`@wcstack/gyroscope`の script に加えて）。`gyroGranted`を宣言する
独立した`<wcs-state>`を持ちます:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      gyroGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="gyroscope" data-wcs="granted: gyroGranted"></wcs-permission>
<wcs-gyroscope data-wcs="command.start: $command.startGyro"></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro; disabled: gyroGranted|not">開始</button>
```

バインドする state パスは事前にすべて宣言する必要があります — 未宣言のパスへのバインドは初期化時に例外を投げます。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ(`gyroGranted|not`)で行います。

## 属性 / 入力

| 属性        | 型     | 既定値 | 説明 |
| ----------- | ------ | ------ | ---- |
| `frequency` | number | —      | サンプリングレート（Hz）。`Gyroscope`コンストラクタへそのまま渡る。読み取られるのは`start()`実行時のみ — 稼働中に変更しても`stop()`＋`start()`し直すまで反映されない（注意・制限を参照）。 |

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | --------------------------- | ---- |
| `x`        | `wcs-gyroscope:reading` | x軸周りの角速度。初回読み取り前は`null`。 |
| `y`        | `wcs-gyroscope:reading` | y軸周りの角速度。 |
| `z`        | `wcs-gyroscope:reading` | z軸周りの角速度。 |
| `error`    | `wcs-gyroscope:error`   | 正規化された`{ error, message }`、無ければ`null`。 |

`x`/`y`/`z`は単一の`wcs-gyroscope:reading`イベントから派生します（ネイティブの1回の`reading`イベントで3軸が同時に更新される）。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `start`  | いいえ | センサーを構築（never-throw: コンストラクタの同期例外はキャッチし`error`へ）し読み取りを開始する。開始済みの間は冪等（再度呼んでも何もしない）。 |
| `stop`   | いいえ | センサーを停止しリスナーを解除する。未開始でも安全に呼べる。 |

## 注意・制限

- **`_gen`世代ガードは無し。** `start()`/`stop()`は同期的な購読/購読解除のトグルであり、`dispose()`とレースしうる非同期probeが存在しません（`docs/sensor-tag-design.md` §1.5）。
- **`error`は sticky（据え置き）です。** 最後に観測した失敗（`unsupported`、`SecurityError`等）を保持し、その後の`start()`成功や`reading`受信では自動クリアされません。`stop()`＋`start()`でリトライが成功しても直前の`error`は残り続けます。必要なら利用側の state でクリア／再解釈してください。
- **`frequency`は`start()`時にのみ読み取られます。** `attributeChangedCallback`は無く、`start()`は既に開始済みの間は冪等（再度呼んでも何もしない、上記コマンド参照）であるため、稼働中に`frequency`（属性またはプロパティ）を変更しても反映されません。新しいサンプリングレートを適用するには`stop()`してから`start()`し直してください。
- **再親付け（別の親要素への移動）はセンサーを停止し、自動再開しません。** 接続中の`<wcs-gyroscope>`要素を別の親へ移動すると`disconnectedCallback`→`connectedCallback`が発火します。Shellは接続時に自動開始しないため（上記クイックスタート参照）、これは実質的な停止であり自動再開はされません。`x`/`y`/`z`は最後のサンプル値のまま凍結され、`error`も発生しません — `start`を再度発行するまでセンサーは inert のままです。
- **生の`new Gyroscope(...)`は唯一のガード付き構築ヘルパー以外では呼ばない。** 権限拒否・Permissions-Policyブロックは同期的に例外を投げます。
- 権限状態（`granted`/`denied`/`prompt`）は意図的にこのノードでは重複実装していません — `<wcs-permission name="gyroscope">`と合成してください。

## ヘッドレス利用（`GyroscopeCore`）

```typescript
import { GyroscopeCore } from "@wcstack/gyroscope";

const core = new GyroscopeCore();
core.addEventListener("wcs-gyroscope:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// 後始末:
core.dispose();
```

## ライセンス

MIT
