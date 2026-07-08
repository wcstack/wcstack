# @wcstack/clipboard

`@wcstack/clipboard` は wcstack エコシステム向けのヘッドレスなクリップボードコンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変え、`@wcstack/geolocation` がデバイスの位置情報をリアクティブな状態に変えるのと同じように、**クリップボードへのアクセスをリアクティブな状態に変える非同期プリミティブノード**です。

位置情報（読み取り専用センサ）と異なり、クリップボードは**双方向**です。そのため `<wcs-clipboard>` は wc-bindable トークンプロトコルの両方向のショーケースになっています。

- **write**（`state → element`）— command-token プロトコル経由（`command.writeText: $command.copy`）
- **read**（`element → state`）— コマンド結果経由。加えて、ユーザーの `copy` / `cut` / `paste` を event-token プロトコルで再発行する monitor モード（`eventToken.pasted: clipboardPasted`）

`@wcstack/state` と組み合わせると、`<wcs-clipboard>` はパス契約を通じて直接バインドできます。

- **入力面**: `monitor`
- **コマンド面**: `writeText`, `write`, `readText`, `read`, `startMonitor`, `stopMonitor`
- **出力状態面**: `text`, `items`, `loading`, `error`, `readPermission`, `writePermission`, `monitoring`, `copied`, `cut`, `pasted`

つまり、クリップボードを扱う処理を HTML 上で宣言的に表現でき、UI 層に `navigator.clipboard.writeText()` / `readText()` / `read()`、イベントリスナ、後始末のグルーコードを書く必要がありません。

`@wcstack/clipboard` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`ClipboardCore`）が read/write、リッチな `ClipboardItem` の正規化、エラー処理、monitor の購読、パーミッションのライブ追跡を担当
- **Shell**（`<wcs-clipboard>`）がその状態を DOM 属性・ライフサイクル・宣言的コマンドに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

Clipboard API は `fetch` と同様、値を非同期に生み出すソースですが、加えて**双方向**（read *かつ* write）であり、**2 つの独立したパーミッション**（`clipboard-read` / `clipboard-write`）でゲートされています。命令的に書くと、ジェスチャに紐づく呼び出し・パーミッション照会・イベント配線・切断時の後始末が必要になります。

`@wcstack/clipboard` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。コピーやペーストが命令的なコールバック配線ではなく、**状態遷移**になります。

> **セキュアコンテキスト + ユーザージェスチャが必須。** Clipboard API はセキュアコンテキスト（HTTPS、または `localhost`）でのみ動作します。書き込み（`writeText` / `write`）には一時的なアクティベーション（transient activation）が必要なので、クリックハンドラやユーザー操作に配線した command-token から呼び出してください。読み取り（`readText` / `read`）にはフォーカスと読み取りパーミッションが必要です。`navigator.clipboard` が存在しない場合（非セキュアコンテキストや非対応ブラウザ）、コマンドは throw せず `error` プロパティを通じて `NotSupportedError` を表面化します。Firefox はクリップボードのパーミッション名を公開しないため、そこでは `readPermission` / `writePermission` は `"unsupported"` にフォールバックします。

## インストール

```bash
npm install @wcstack/clipboard
```

## クイックスタート

### 1. テキストをコピー（write）

書き込みにはユーザージェスチャが必要なので、DOM クリック（autoTrigger）または command-token から起動します。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/clipboard/auto"></script>

<wcs-clipboard id="cb"></wcs-clipboard>

<!-- 任意の DOM トリガ: クリックでリテラルテキストをコピー -->
<input id="token" value="abc-123" readonly />
<button data-clipboardtarget="cb" data-clipboard-from="#token">Copy</button>
<button data-clipboardtarget="cb" data-clipboard-text="Hello!">Copy greeting</button>
```

`data-clipboard-text` はリテラル文字列をコピーします。`data-clipboard-from` はセレクタにマッチした要素の `value`（なければ `textContent`）をコピーします。

### 2. 状態からコピー（command-token）

```html
<wcs-state>
  <script type="module">
    export default {
      message: "Shareable link",
      $commandTokens: ["copy"],
      onShare() { this.$command.copy.emit(this.message); }
    };
  </script>
</wcs-state>

<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
<button data-wcs="onclick: onShare">Share</button>
```

### 3. テキストを読み取り（command-token で readText を起動）

DOM の autoTrigger は書き込み（`writeText`）のみを起動します。読み取りを起動する DOM トリガ経路はありません。読み取りは command-token、または要素への命令的な `readText()` / `read()` 呼び出しで起動してください。

```html
<wcs-state>
  <script type="module">
    export default {
      pasted: "",
      busy: false,
      $commandTokens: ["paste"],
      onPaste() { this.$command.paste.emit(); }
    };
  </script>
</wcs-state>

<wcs-clipboard
  data-wcs="command.readText: $command.paste; text: pasted; loading: busy"></wcs-clipboard>
<button data-wcs="onclick: onPaste">Paste</button>
<p data-wcs="textContent: pasted"></p>
```

> 読み取りにはフォーカスと読み取りパーミッションが必要で、ブラウザが許可を求めることがあります。拒否された読み取りを扱うには `error` をバインドしてください。

### 4. ユーザーのクリップボード操作を監視（event-token）

`monitor` 属性を付けると、ドキュメントの `copy` / `cut` / `paste` をリアクティブな状態として再発行します。

```html
<wcs-state>
  <script type="module">
    export default {
      lastPaste: "",
      $eventTokens: ["clipboardPasted"],
      $on: {
        clipboardPasted: (state, event) => { state.lastPaste = event.detail; }
      }
    };
  </script>
</wcs-state>

<wcs-clipboard monitor
  data-wcs="pasted: lastPaste; eventToken.pasted: clipboardPasted"></wcs-clipboard>
```

## 属性 / 入力（Attributes / Inputs）

| 属性      | 型      | 既定値  | 説明                                                                        |
| --------- | ------- | ------- | --------------------------------------------------------------------------- |
| `monitor` | boolean | `false` | 接続時にドキュメントの `copy` / `cut` / `paste` を購読し、`copied` / `cut` / `pasted` として再発行する。 |

### DOM トリガ属性（autoTrigger、クリックでコピー）

| 属性                  | 付与先         | 説明                                                                   |
| --------------------- | -------------- | ---------------------------------------------------------------------- |
| `data-clipboardtarget`| トリガボタン   | 駆動する `<wcs-clipboard>` の id。                                     |
| `data-clipboard-text` | トリガボタン   | コピーするリテラルテキスト（優先される。空文字列も有効）。              |
| `data-clipboard-from` | トリガボタン   | CSS セレクタ。マッチした要素の `value`（なければ `textContent`）をコピー。 |

> DOM トリガは**書き込み専用**です。クリックは常に `writeText` を起動し、読み取り（`readText` / `read`）を起動する経路はありません。読み取りは command-token または命令的呼び出しで起動してください。

> DOM トリガによる `writeText` は fire-and-forget（`Promise` を await しません）ですが、決して reject しません。コピー失敗は他の書き込みと同様 `error` プロパティに現れます。autoTrigger の失敗を観測するには `error` をバインドしてください（例: `text: error.message@cb`）。

> **autoTrigger は既定で有効。** 最初に接続した `<wcs-clipboard>` が document レベルの `click` リスナーを 1 つ設置します（`data-clipboardtarget` 要素のクリックで `writeText` を起動）。DOM ショートカットを使わないなら bootstrap エントリで無効化してください:
>
> ```js
> import { bootstrapClipboard, getConfig } from "@wcstack/clipboard";
> bootstrapClipboard({ autoTrigger: false });        // document クリックリスナーを設置しない
> bootstrapClipboard({ triggerAttribute: "data-copy" }); // トリガ属性名を変更（既定: data-clipboardtarget）
> getConfig();                                        // 実効設定（deep-frozen）を読む
> ```
>
> `bootstrapClipboard()` は要素が接続される前に呼んでください。（`setConfig` は内部用。設定は `bootstrapClipboard` 経由で行います。）

## 観測可能なプロパティ（出力）

| プロパティ        | イベント                                  | 説明                                                                  |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `text`            | `wcs-clipboard:read`                      | 直近の `readText()` / `read()` のプレーンテキスト（なければ `null`）。 |
| `items`           | `wcs-clipboard:read`                      | `read()` から正規化した `ClipboardItem` スナップショット（`{ types, data }[]`）、なければ `null`。 |
| `loading`         | `wcs-clipboard:loading-changed`           | 非同期の read/write 中は `true`。                                     |
| `error`           | `wcs-clipboard:error`                     | 正規化された `{ name, message }`（例: `NotAllowedError`, `NotSupportedError`）。 |
| `readPermission`  | `wcs-clipboard:read-permission-changed`   | `clipboard-read` の `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`。 |
| `writePermission` | `wcs-clipboard:write-permission-changed`  | `clipboard-write` について同様の状態。                               |
| `monitoring`      | `wcs-clipboard:monitoring-changed`        | ドキュメントのクリップボードイベントを監視中は `true`。              |
| `copied`          | `wcs-clipboard:copied`                    | 直近に監視した `copy` のテキスト（選択範囲から取得）。               |
| `cut`             | `wcs-clipboard:cut`                       | 直近に監視した `cut` のテキスト。                                    |
| `pasted`          | `wcs-clipboard:pasted`                    | 直近に監視した `paste` の `text/plain`。                             |

## コマンド

| コマンド       | 説明                                                                       |
| -------------- | ------------------------------------------------------------------------- |
| `writeText`    | クリップボードに文字列を書き込む（非同期。reject しない — 失敗は `error` へ）。ユーザージェスチャが必要。 |
| `write`        | `ClipboardItem[]`（画像・HTML・複数 MIME タイプ）を書き込む（非同期）。   |
| `readText`     | プレーンテキストを読み取り、`text` と `wcs-clipboard:read` を発行（非同期）。 |
| `read`         | リッチな `ClipboardItem` を読み取り、各表現を `Blob` に解決する（非同期）。 |
| `startMonitor` | ドキュメントの `copy` / `cut` / `paste` の監視を開始（既に監視中なら no-op）。 |
| `stopMonitor`  | 監視を停止。`monitoring` が `false` になる。                              |

状態からの起動には command-token プロトコルを使います。

```html
<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
```

## `:state()` による CSS スタイリング

`<wcs-clipboard>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-clipboard:loading-changed` が `true` で発火（`false` でクリア） |
| `monitoring` | `wcs-clipboard:monitoring-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-clipboard:error` が非 `null` の detail で発火（`null` でクリア） |

> `readPermission` / `writePermission` は v1 では反映**しません** — 単一のステート名に
> マップできる boolean 派生 getter が無いためです（
> [async-io-node-guidelines.md](../../docs/async-io-node-guidelines.md) §4.2 参照）。
> これらは従来どおり `data-wcs` でバインドしてください。

```css
wcs-clipboard:state(loading) ~ .spinner { display: block; }
wcs-clipboard:state(loading) ~ .spinner { display: none; } /* デフォルト */

wcs-clipboard:state(monitoring) ~ .live-badge { display: inline-block; }

form:has(wcs-clipboard:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-clipboard>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-clipboard:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-monitoring` /
  `data-wcs-state-error` 属性にミラーします。Elements パネルを開いておけば、
  トグルのたびにハイライトされます:

  ```html
  <wcs-clipboard monitor debug-states></wcs-clipboard>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意点と制約

- **属性は接続時に読み取られ、監視されない。** `<wcs-clipboard>` は `observedAttributes` / `attributeChangedCallback` を実装していません。`monitor` 属性は要素の接続時に読み取られます。接続*後*に命令的にトグルしても、それだけでは監視は開始/停止しません。`startMonitor()` / `stopMonitor()` を呼ぶか、要素を再接続してください。
- **接続時の読み取りは無い。** `<wcs-geo>` と異なり、クリップボードは接続時に自動読み取りできません（読み取りにはユーザージェスチャとパーミッションが必要）。接続時のアクションは初回パーミッション照会と任意の監視です。ただし `connectedCallbackPromise`（`hasConnectedCallbackPromise = true`）は公開しており、state バインダ / SSR はこれを await して初回パーミッションスナップショットの確定を待ってからバインドできます。
- **再接続で再購読する。** 要素を削除して再挿入すると `connectedCallback` が再度実行されるため、パーミッション追跡が復活し、`monitor` 属性を持つ要素は監視を再開します（切断時に解体するのと対称です）。監視の永続性は**属性駆動のみ**です。`monitor` 属性*なし*の要素で `startMonitor()` を使って命令的に監視を開始した場合、再接続では復元されません（属性が真実の源）。リペアレント間で監視を永続させたい場合は `monitor` 属性を付けてください。
- **`copy` / `cut` のテキストは選択範囲から取得する。** `copy` / `cut` イベント中はクリップボードのペイロードがまだ読めない（セキュリティ上ブラウザは空文字列を返す）ため、`copied` / `cut` は `document.getSelection().toString()` — ユーザーの選択テキストを報告します。ページが `clipboardData.setData(...)` でペイロードを上書きするカスタム `copy` ハンドラを設置している場合、その上書きは `copied` / `cut` に**反映されません**。`pasted` は `event.clipboardData.getData("text/plain")` を読み取ります。
- **無言のエラー処理（ゼロログ）。** wcstack 全体のゼロ依存・最小主義に従い、`<wcs-clipboard>` は実行時の失敗に対して一切ログ出力も throw もしません。パーミッション照会の失敗（クリップボードのパーミッション名を持たない Firefox など）は無言で `"unsupported"` にフォールバックします。read/write の失敗（パーミッション拒否・フォーカス無し・Clipboard API 欠如）は `error` プロパティ / `wcs-clipboard:error` イベントを通じてのみ表面化します — コマンドは resolve し、決して reject しません。観測・対処するには `error`（および `*Permission` プロパティ）をバインドしてください。

## ヘッドレス利用（`ClipboardCore`）

Core はグローバルな `document` / `navigator` 以外に DOM 依存を持たず、`@wc-bindable/core` の `bind()` と直接組み合わせて使えます。

```typescript
import { ClipboardCore } from "@wcstack/clipboard";

const clip = new ClipboardCore();
clip.addEventListener("wcs-clipboard:read", (e) => {
  console.log((e as CustomEvent).detail); // { text, items }
});

await clip.writeText("hello");
await clip.readText();
// または、ユーザーのクリップボード操作を監視する場合:
clip.startMonitor();
// ...後で
clip.stopMonitor();
```

## ライセンス

MIT
