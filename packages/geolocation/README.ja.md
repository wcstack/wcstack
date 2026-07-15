# @wcstack/geolocation

`@wcstack/geolocation` は wcstack エコシステム向けのヘッドレスな位置情報コンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変え、`@wcstack/timer` が時間の経過をリアクティブな状態に変えるのと同じように、**デバイスの位置情報をリアクティブな状態に変える非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-geo>` はパス契約を通じて直接バインドできます。

- **入力 / コマンド面**: `high-accuracy`, `timeout`, `maximum-age`, `watch`, `manual`, `trigger`
- **出力状態面**: `position`, `latitude`, `longitude`, `accuracy`, `coords`, `timestamp`, `watching`, `loading`, `error`, `permission`

つまり、位置情報を扱う処理を HTML 上で宣言的に表現でき、UI 層に `navigator.geolocation.getCurrentPosition()` / `watchPosition()` / `clearWatch()` や後始末のグルーコードを書く必要がありません。

`@wcstack/geolocation` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`GeolocationCore`）が位置取得、一発取得 / 連続監視の二相、位置の正規化、エラー処理、パーミッションのライブ追跡を担当
- **Shell**（`<wcs-geo>`）がその状態を DOM 属性・ライフサイクル・宣言的コマンドに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

位置情報は `fetch` と同様、値を非同期に生み出すソースですが、加えて**パーミッションのゲート**と**連続監視モード**を持ちます。命令的に書くと、コールバック配線・パーミッション照会・切断時の後始末が必要になります。

`@wcstack/geolocation` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。位置の取得が命令的なコールバック配線ではなく、**状態遷移**になります。これは読み取り専用センサであり、要素は状態へ値を生み出すだけ（`element → state`）で、逆向きの「送信」経路はありません。

> **セキュアコンテキストが必須。** Geolocation API はセキュアコンテキスト（HTTPS、または `localhost`）でのみ動作します。non-localhost オリジンの平文 HTTP では取得が失敗し、`<wcs-geo>` は `error` として表面化します。正確なコードはブラウザ依存です。`navigator.geolocation` 自体が存在しない場合のみ `<wcs-geo>` は `POSITION_UNAVAILABLE`（code `2`）を報告しますが、多くのブラウザは `navigator.geolocation` を存在させたままリクエストを拒否するため、エラーは通常 `PERMISSION_DENIED`（code `1`）として届きます。単一のコードで分岐するのではなく、`error` をバインドして失敗を扱ってください。

## インストール

```bash
npm install @wcstack/geolocation
```

## クイックスタート

### 1. 接続時に一発取得（既定）

`<wcs-geo>` が DOM に接続されると、単一の位置 fix を要求して結果を公開します。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/geolocation/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      lat: null,
      lng: null,
      get label() {
        return this.lat == null ? "Locating…" : `${this.lat}, ${this.lng}`;
      }
    };
  </script>
</wcs-state>

<wcs-geo data-wcs="latitude: lat; longitude: lng"></wcs-geo>

<p data-wcs="textContent: label"></p>
```

### 2. 連続監視

`watch` 属性を付けると、要素が切断されるまで `watchPosition` を通じて fix をストリームします。

```html
<wcs-geo watch data-wcs="latitude: lat; longitude: lng; watching: isTracking"></wcs-geo>
```

### 3. 高精度 / オプション

```html
<wcs-geo high-accuracy timeout="10000" maximum-age="0"
  data-wcs="coords: position; error: geoError"></wcs-geo>
```

### 4. 必要なときに手動取得

`manual` は接続時の自動取得をスキップします。命令的に、DOM のクリックで、あるいは状態から取得を起動できます。

```html
<wcs-geo id="loc" manual data-wcs="latitude: lat; longitude: lng"></wcs-geo>

<!-- DOM トリガ（任意）: クリックで一発取得を要求 -->
<button data-geotarget="loc">Locate me</button>
```

> `data-geotarget` のクリックはモードに関わらず、常に `getCurrentPosition()` による**単一**の fix を要求します。`watch` 要素に向けた場合は、監視を再起動するのではなく、継続中の監視と並行して一発取得が走ります（その間だけ `loading` がトグルします）。本来の対象は `manual` 要素です。

## 属性 / 入力（Attributes / Inputs）

| 属性            | 型      | 既定値     | 説明                                                                    |
| --------------- | ------- | ---------- | ----------------------------------------------------------------------- |
| `high-accuracy` | boolean | `false`    | 可能な限り高精度な結果を要求する（`enableHighAccuracy`）。              |
| `timeout`       | number  | `Infinity` | fix を待つ最大ミリ秒。不正な値は `Infinity` にフォールバック。          |
| `maximum-age`   | number  | `0`        | 許容するキャッシュ済み fix の最大経過時間（ms）。不正な値は `0` にフォールバック。 |
| `watch`         | boolean | `false`    | 接続時に単一取得ではなく位置を連続監視する。                            |
| `manual`        | boolean | `false`    | 接続時に自動取得しない。コマンド / トリガで取得する。                   |

## 観測可能なプロパティ（出力）

| プロパティ   | イベント                       | 説明                                                                  |
| ------------ | ------------------------------ | --------------------------------------------------------------------- |
| `position`   | `wcs-geo:position`             | 正規化されたスナップショット `{ latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed, timestamp, coords }`。 |
| `latitude`   | `wcs-geo:position`             | 最新 fix の緯度。                                                     |
| `longitude`  | `wcs-geo:position`             | 最新 fix の経度。                                                     |
| `accuracy`   | `wcs-geo:position`             | 最新 fix の精度（メートル）。                                         |
| `coords`     | `wcs-geo:position`             | 最新 fix の座標サブオブジェクト。                                     |
| `timestamp`  | `wcs-geo:position`             | 最新 fix の取得タイムスタンプ。                                       |
| `watching`   | `wcs-geo:watching-changed`     | 連続監視中は `true`、それ以外は `false`。                            |
| `loading`    | `wcs-geo:loading-changed`      | 一発取得 `getCurrentPosition` のリクエスト中は `true`。              |
| `error`      | `wcs-geo:error`                | 正規化された `{ code, message }`（`PERMISSION_DENIED=1`, `POSITION_UNAVAILABLE=2`, `TIMEOUT=3`）。 |
| `permission` | `wcs-geo:permission-changed`   | `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`。Permissions API でライブ追跡。 |
| `errorInfo`  | `wcs-geo:error-info-changed`   | serializable な失敗 taxonomy（`WcsIoErrorInfo`）、または `null`。追加的で `error` から導出（`code` → `permission-denied` / `position-unavailable` / `timeout`、`recoverable` は `permission-denied` のみ `false`）。`error` の shape は不変。 |

## コマンド

| コマンド            | 説明                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `getCurrentPosition`| 単一の fix を取得（非同期。reject しない — 失敗は `error` へ）。  |
| `watchPosition`     | 連続監視を開始（既に監視中なら no-op）。                          |
| `clearWatch`        | 監視を停止。`watching` が `false` になる。                        |

状態からの起動には command-token プロトコルを使います。

```html
<wcs-geo manual data-wcs="command.getCurrentPosition: $command.locate"></wcs-geo>
```

## `:state()` による CSS スタイリング

`<wcs-geo>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `watching` | `wcs-geo:watching-changed` が `true` で発火（`false` でクリア） |
| `loading` | `wcs-geo:loading-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-geo:error` が非 `null` の detail で発火（`null` でクリア） |

`permission` は反映されません。`granted` / `denied` のような派生 boolean getter
が存在せず（v1 のスコープ外）、ステートを立てる先がないためです — 代わりに
`permission` を直接バインドしてください。

```css
wcs-geo:state(loading) ~ .spinner { display: block; }
wcs-geo:state(watching) ~ .stop-button { display: inline-block; }

form:has(wcs-geo:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-geo>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-geo:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-watching` / `data-wcs-state-loading` / `data-wcs-state-error`
  属性にミラーします。Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-geo watch debug-states></wcs-geo>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意点と制約

- **属性は接続時に読み取られ、監視されない。** `<wcs-geo>` は `observedAttributes` / `attributeChangedCallback` を実装していません。オプション属性（`high-accuracy`, `timeout`, `maximum-age`, `watch`, `manual`）は要素の接続時とコマンド実行のたびに読み取られます。接続*後*に命令的に変更しても、それだけでは再取得・再監視は行われません。新しいオプションを反映するには、`getCurrentPosition()` / `clearWatch()` + `watchPosition()` を再度呼ぶか、要素を再接続してください。
- **再接続で再取得する。** 要素を削除して再挿入すると `connectedCallback` が再度実行されるため、既定モードの要素は新しい fix を取得し、`watch` 要素は監視を再開します（切断時に監視を解体するのと対称です）。
- **SSR（`@wcstack/server`）。** 既定の一発取得モードは `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開するため、サーバレンダラはスナップショット前に接続時の fix を待機します。（`watch` / `manual` モードには待つべき接続時 fix がありません。）
- **`timeout` / `maximum-age` のパース。** 値は厳密にパースされます。数値でない（`"10px"`）・有限でない・負の値は既定値（`Infinity` / `0`）にフォールバックします。クリーンな非負数のみが受け入れられます。
- **無言のエラー処理（ゼロログ）。** wcstack 全体のゼロ依存・最小主義に従い、`<wcs-geo>` は実行時の失敗に対して一切ログ出力も throw もしません。パーミッション照会の失敗（`geolocation` パーミッション名を拒否するブラウザや Permissions API を持たない環境など）は無言で `permission = "unsupported"` にフォールバックします。取得の失敗（`PERMISSION_DENIED` / `POSITION_UNAVAILABLE` / `TIMEOUT`、および Geolocation API の欠如を含む）は `error` プロパティ / `wcs-geo:error` イベントを通じてのみ表面化します — `getCurrentPosition()` は resolve し、決して reject しません。これらの状況を観測・対処するには `error`（および `permission`）をバインドしてください。

## ヘッドレス利用（`GeolocationCore`）

Core は DOM に依存せず、`@wc-bindable/core` の `bind()` と直接組み合わせて使えます。

```typescript
import { GeolocationCore } from "@wcstack/geolocation";

const geo = new GeolocationCore();
geo.addEventListener("wcs-geo:position", (e) => {
  console.log((e as CustomEvent).detail); // { latitude, longitude, accuracy, ... }
});

await geo.getCurrentPosition({ enableHighAccuracy: true });
// または、連続更新の場合:
geo.watch();
// ...後で
geo.clearWatch();
```

## ライセンス

MIT
