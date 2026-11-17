# @wcstack/pointer-lock

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/pointer-lock` は wcstack エコシステム向けのヘッドレスな Pointer Lock API コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/fullscreen` が Fullscreen API のアクティブ状態をリアクティブな state に変えるのと同じように、Pointer Lock API のロック状態をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-pointer-lock>` はパス契約で直接バインドできます:

- **入力サーフェス**: `target`
- **出力 state サーフェス**: `active`、`error`、`errorInfo`、`supported`
- **コマンド**: `requestPointerLock`、`exitPointerLock`

`@wcstack/pointer-lock` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`PointerLockCore`）が `Element.requestPointerLock()` / `document.exitPointerLock()` / `document.pointerLockElement` をラップし、`document`単位で発火する `pointerlockchange` イベントを自身が解決した target と自己判定でフィルタする
- **Shell**（`<wcs-pointer-lock target="...">`）がDOMから「どの要素を操作するか」を解決し、display とライフサイクルを管理
- **Binding Contract**（`static wcBindable`）が観測可能な `active` / `error` / `errorInfo` / `supported` プロパティと `requestPointerLock`/`exitPointerLock` コマンドを宣言

## 用途が限定的なノード — 使う前に必ず読んでください

他の大半の wcstack IO ノードと異なり、`<wcs-pointer-lock>` は本プロジェクトの主眼である**宣言的な SPA UI 構築**を主たる対象としていません。Pointer Lock API の実際の用途はほぼ排他的に、マウスの**相対移動量**（`movementX`/`movementY`）を必要とする**ゲームや canvas/WebGL 描画 UI**（FPS視点操作、お絵描きツールのパン操作等）に限られます。こうした利用者は多くの場合すでに命令的な `requestAnimationFrame` ループを回しており、動画プレイヤーが `<wcs-fullscreen>` を使う場合ほど、入力を宣言的なバインディング層経由にする動機は強くありません。

このノードは「ロックのON/OFFを切り替える宣言的なスイッチ」（例: command-token プロトコル経由の「マウスルック有効化」ボタン）が欲しい場合に使ってください。`movementX`/`movementY` の取得源としては使えません（後述）。

## `movementX`/`movementY` はスコープ外（v1）

ポインタロック中に発火する `mousemove` イベントは `movementX`/`movementY`（相対移動量）を持ちますが、**本Coreは現時点のいかなるバージョンでもこれを公開しません。** これらは高頻度データ（環境によっては毎秒数百イベントに達しうる）であり、本プロトコルが前提とする同値ガード付きの宣言的 `properties` モデルに馴染みません。そのまま `wc-bindable` に流すと、バインドされた state を毎フレーム単位の更新で溢れさせるリスクがあります。

将来のバージョンで追加する場合の設計意図（`docs/pointer-lock-tag-design.md` §3 参照）は、明示的な opt-in の背後に置き、`@wcstack/debounce`/`@wcstack/throttle` と組み合わせてレート制限することです。これにより、opt-in していないインスタンスには「無制限のファイアホースを流さない」という性質を保てます。現時点で生の `movementX`/`movementY` が必要な場合は、本ノードの `active` state と並行して、自前の命令的コードで `mousemove` を直接読んでください。

## `target` 属性がロック対象を決める

`@wcstack/fullscreen` と同様、この Shell は**自分自身をロックしません** — `target` 属性で指し示した**参照先の要素**を操作する非表示の制御タグであり、`@wcstack/intersection` と同じ3モード解決を使います:

| `target`         | 操作対象                  | `display`   |
|------------------|--------------------------|-------------|
| 省略             | 先頭の子要素              | `contents`  |
| `"#selector"`    | 一致した要素               | `none`      |
| `"self"`         | 自分自身                  | `block`     |

## インストール

```bash
npm install @wcstack/pointer-lock
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/pointer-lock/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["lockPointer", "unlockPointer"],
      locked: false,
    };
  </script>
</wcs-state>

<canvas id="scene" width="640" height="480"></canvas>
<wcs-pointer-lock target="#scene"
  data-wcs="active: locked; command.requestPointerLock: $command.lockPointer; command.exitPointerLock: $command.unlockPointer">
</wcs-pointer-lock>

<button data-wcs="onclick: $command.lockPointer">マウスルックを有効化</button>
<button data-wcs="hidden: locked|not; onclick: $command.unlockPointer">解除</button>
```

ボタンは`<wcs-pointer-lock>`に直接触れません。クリックが`lockPointer`/`unlockPointer`コマンドトークンを発行し、`<wcs-pointer-lock>`が`command.requestPointerLock: $command.lockPointer` / `command.exitPointerLock: $command.unlockPointer`でそれを購読します（[command-tokenプロトコル](../state/) — commandメソッドを持つ要素が*購読者*であり、発行者ではありません）。

バインドするstateパスは事前にすべて宣言する必要があります — ここでは`locked: false`。未宣言パスをバインドすると初期化時に例外になります。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ（`locked|not`）で行います — パスはプレフィックス演算子をサポートしません。

`requestPointerLock()` は **user gesture 文脈を必須とします** — 後述。

## user gesture 制約

`Element.requestPointerLock()` はuser gesture文脈（同期的なクリックハンドラ等）の外から呼ばれると `NotAllowedError` で reject します。本ノードは自らgestureを生成できません。**実際のuser gesture内から`requestPointerLock`を呼ぶ責務は呼び出し元にあります。** command-token プロトコル（`<wcs-pointer-lock>`上の`command.requestPointerLock: $command.<token>`、ボタンの`onclick: $command.<token>`が発行する）を配線してください — `setTimeout`内や`.then()`チェーンの奥から呼ぶとgesture文脈を失い呼び出しがrejectされますが、例外は伝播しません（never-throw、`error`に格納されます）。

### イベントで届く拒否（`pointerlockerror`）

4.25 から。断られた要求の知らせ方は、ブラウザによって違います:

- **Chromium と WebKit** は `requestPointerLock()` から promise を返し、それを reject します。その reject が、ブラウザ自身の理由とともに `error` になります — `allow-pointer-lock` の無い sandbox の `<iframe>` では `SecurityError`、WebKit の `WrongDocumentError`（`"Pointer lock requires the window to have focus."`）など。
- **Firefox** は `requestPointerLock()` から何も返しません。拒否がページに届くのは、document の `pointerlockerror` イベントだけです。`<wcs-pointer-lock>` は接続されている間これを聞き（ブラウザが持つ名前が `webkitpointerlockerror` ならそちらを聞き）、promise を返さなかった呼び出しでこの要素が出した要求に対して発火したとき、`error` を `NotAllowedError` の `DOMException` — `"The browser refused the pointer lock request."`、`errorInfo.code` は `not-allowed`、`recoverable: true` — にします。イベントは理由を運ばない（Firefox はコンソールに書きます）ので、ブラウザが何を理由に断ったとしても、メッセージはそれ以上を言いません。

そのため Firefox では、エラーはコマンドの promise が決着した**後**に届きます。`await el.requestPointerLock(); el.error` は、そこではまだ `null` です。`await` の直後に読むのではなく、`error` / `errorInfo` をバインドしてください。4.24 までは、Firefox では何も報告されませんでした。`error` は `null` のままで、ページは何も言えませんでした。

promise を返した呼び出しの要求には、その promise だけが答えます — Chromium と WebKit も同じ拒否について `pointerlockerror` を発火し、WebKit は promise を reject する前に発火することがあります — ので、1 つの拒否を 2 回報告することはありません。イベントは誰の要求が失敗したかを言いません。この要素の要求が答えを待っていないときのイベントは別のインスタンスのもので、無視します。

## 観測可能プロパティ（出力）

| プロパティ  | イベント                                | 説明 |
| ----------- | -------------------------------------- | ------------ |
| `active`    | `wcs-pointer-lock:change`             | `document.pointerLockElement` がこのインスタンスの解決済み target と一致していれば `true`、それ以外は `false`。4.25 から、要素が文書の外にある間も `false`（[要素が文書を離れるとき](#要素が文書を離れるとき)参照）。 |
| `error`     | `wcs-pointer-lock:error`              | 直近の失敗、または `null`。次のいずれか: rejectされたPromise（gesture外呼び出しなら`NotAllowedError`等）、プラットフォームAPI非対応なら`{ message: "Pointer Lock API is not supported." }`、`target`が要素へ未解決なら`{ message: "Pointer Lock target could not be resolved." }`。直近の呼び出しが成功済み・まだ何も失敗していない場合は`null`。4.25 から、ブラウザがイベントでしか知らせない拒否 — Firefox — は `NotAllowedError` の `DOMException`（`"The browser refused the pointer lock request."`）になる（上記参照）。 |
| `errorInfo` | `wcs-pointer-lock:error-info-changed` | `error` から導出される追加のシリアライズ可能な失敗タクソノミ `{ code, phase, recoverable, message }`、または `null`。下記参照。 |
| `supported` | `wcs-pointer-lock:supported-changed`  | 4.25 から。ブラウザに Pointer Lock API があれば `true`、無ければ `false`。イベントの `detail` は boolean そのもの。下記参照。 |

`error` と `errorInfo` は **どちらも観測可能な event-backed の `wcBindable` property** です。（`error` はかつて独自イベントを持たない命令的 getter でしたが、現在はそうではありません。）wc-bindable バインディングコアが request/exit の失敗をリアクティブに配信するようになったため、コマンドが settle するたびに `element.error` をポーリングするのではなく `data-wcs` / `bind()` でバインドできます。`error` の **値の形状は不変** で、`errorInfo` は追加のシリアライズ可能な分類です。

### `errorInfo` タクソノミ

`errorInfo` は各失敗を安定した `{ code, phase, recoverable, message }` に写します:

| `code`               | `phase`   | `recoverable` | 条件 |
| -------------------- | --------- | ------------- | ----- |
| `capability-missing` | `probe`   | `false`       | Pointer Lock API 非対応（標準名・レガシー名のどちらも存在しない） |
| `invalid-argument`   | `start`   | `false`       | `target` が要素へ未解決 |
| `not-allowed`        | `execute` | `true`        | `NotAllowedError` / `TypeError` — user gesture 外での呼び出し。実際の gesture 内で再試行すれば成功しうる。4.25 から、`pointerlockerror` イベントで届いた拒否（Firefox）もすべてここ。理由は分からない |
| `pointer-lock-error` | `execute` | `false`       | その他の caught 例外 |

安定した `code` 値は `WCS_POINTER_LOCK_ERROR_CODE` として export されます。共有の `WcsIoErrorInfo` / `WcsIoErrorPhase` 型も本パッケージから再 export されます。

### `supported` — このページに pointer lock があるか

4.25 から。`supported` は、ブラウザに Pointer Lock API があるときに `true` です: 要素に `requestPointerLock()`（または接頭辞付きの `webkitRequestPointerLock()`）がある場合です。それ以外は `false` です — たとえば iPhone の Safari。

要求が通ることも、マウスがつながっていることも言いません。要求にはやはり user gesture が要り、sandbox の `<iframe>` には `allow-pointer-lock` が要ります。pointer lock を扱う Permissions-Policy は無いので、要素が前もって聞けるものはありません。そうしたフレームは `true` を報告し、要求は断られます（`error`）。

値は聞かれるたびにブラウザから読みます（キャッシュしません）。だからバインディングは、付いた時点で正しい値を得ます。要素は接続されたとき、最後に発火した値と違えば `wcs-pointer-lock:supported-changed` も発火します（最初は `false` なので、API のあるブラウザでは `true` が 1 回届きます）。ボタンは、使えるところでだけ出します:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["lockPointer"],
      lockSupported: false,
    };
  </script>
</wcs-state>

<canvas id="scene" width="640" height="480"></canvas>
<wcs-pointer-lock target="#scene" data-wcs="supported: lockSupported; command.requestPointerLock: $command.lockPointer"></wcs-pointer-lock>
<button data-wcs="hidden: lockSupported|not; onclick: $command.lockPointer">マウスルックを有効化</button>
```

## コマンド

| コマンド              | Async | 説明 |
| --------------------- | ----- | ------------ |
| `requestPointerLock`  | あり  | `target`を解決し、それに対して`requestPointerLock()`を呼びます。never-throw: 失敗（targetが未解決、gesture不在の`NotAllowedError`、非対応API等）は例外でなく `error` に格納されます。 |
| `exitPointerLock`     | **無し** | `document.exitPointerLock()` を呼びます。**同期API** — `@wcstack/fullscreen`の`exitFullscreen()`（Promiseベース）と異なり、`exitPointerLock()`は`void`を返します。何もロックされていない、またはAPI非対応時はsilent no-opです。 |

## 属性 / 入力

| 属性      | 説明 |
| --------- | ------------ |
| `target`  | ロック対象の要素を指すセレクタ（または`"self"`）。上記「`target`属性がロック対象を決める」を参照。省略時は先頭の子要素。 |

**`null` と `undefined`。** 属性に対応する入力 `target` は、`null` を「クリア」として扱います。属性を外し、`target` は既定値（先頭の子要素）に戻ります。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらも文字列 `"null"` / `"undefined"` として書くことはなく、何にも一致しないセレクタになってすべての要求が失敗することもありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

## `:state()` による CSS スタイリング

`<wcs-pointer-lock>` は `active` 出力を
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `active` | `wcs-pointer-lock:change` が `true` で発火（`false` でクリア） |

```css
wcs-pointer-lock:state(active) ~ .crosshair { display: block; }
wcs-pointer-lock:state(active) ~ .crosshair { display: none; } /* デフォルト */
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。`error` / `errorInfo` は `:state()` には**反映していません**。
これらは観測可能な `wcBindable` property ですが（上記「観測可能プロパティ」参照）、失敗オブジェクトは
真偽値の CSS ステートではないため、`:state()` に配線されるのは `active` のみです。
`error` / `errorInfo` は `data-wcs` / `bind()` で観測してください。`supported` も
反映しません。バインドしてください（`supported: lockSupported`）。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-pointer-lock>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-pointer-lock:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["active"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-active` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-pointer-lock target="#scene" debug-states></wcs-pointer-lock>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 複数インスタンス — 「documentがロック中か」ではなくインスタンスごとに`active`を見る

`document.pointerLockElement` はdocument全体で単一の値しか持ちません（同時にロックできる要素は高々1つ）。複数の`<wcs-pointer-lock>`インスタンス（例: `target="#a"`と`target="#b"`）が同時に存在する場合、各インスタンスは`document.pointerLockElement`を**自分自身の**解決済みtargetと比較します（単に「documentがロック中か」ではありません）。`#a`をロックすると、`target="#a"`のインスタンスは`active: true`、`target="#b"`のインスタンスは`active: false`を報告します — document全体では何か（`#a`）がロックされているにもかかわらずです。

## 要素が文書を離れるとき

4.25 から。`<wcs-pointer-lock>` が document を聞いているのは、接続されている間だけです。`active` が `true` の間に切断されると — `if:` の枝が消える、`@wcstack/router` がルートの本文を取り外す — `active: false` を `wcs-pointer-lock:change` イベントとともに公開します。バインドした state のパスも `:state(active)` もそれに従います。文書の外にある要素は、その値をもう保証できないからです。ロック自体は**解きません**。再び接続されると本当の値を読み直し、target がまだロックされていれば `active` はイベントとともに `true` に戻ります。そのため、移動された（取り外して入れ直された）要素は `false`、`true` の順に報告します。4.24 までは切断しても `active` がそのまま残り、ロックが解けた後も state は `true` を示し続けていました。

ロックをどうするかはブラウザが決めます。**ロックされている要素が文書から取り除かれると、ブラウザはロックを解きます。** ルートの本文の中にある target はルートとともに去り、ロックもそこで終わります。ナビゲーションをまたいでポインタをロックしたままにするには、target — とその `<wcs-pointer-lock>` — をルーターの外、残り続けるレイアウトの側に置きます（[router README — ルートの本文はどこに置くか](../router/README.ja.md#ルートの本文はどこに置くか)）。target だけを外に置き `<wcs-pointer-lock>` をルートの中に置いた場合、ロックは続きますが、`active` はそのルートを離れている間 `false` で、戻ると `true` に戻ります。

## ベンダープレフィックス

一部の古いWebKit実装は標準名の代わりに`webkitRequestPointerLock`/`webkitExitPointerLock`/`webkitPointerLockElement`と、`webkitpointerlockchange`/`webkitpointerlockerror`イベントを公開します。API解決は**呼び出し時**（キャッシュしない）に行われ、標準名を優先し、無ければレガシー名にフォールバックします — これにより非対応環境（どちらの名前も存在しない）を正しく検出でき、テストがAPIを自由にinstall/removeできます。

## 注意・制限

- **user gesture が必須。** 上記参照 — プラットフォームの制約であり、本ノードで回避する手段はありません。
- **Firefox では、拒否はコマンドが決着した後にイベントで届く。** `await` の後に読むのではなく `error` をバインドしてください — 上記「イベントで届く拒否」参照。
- **`exitPointerLock()`は同期API**、`@wcstack/fullscreen`のPromiseベースの`exitFullscreen()`とは異なります。単独の`_gen`世代ガードは持ちません（非同期の`requestPointerLock()`のみがガードを必要とします）。それでも非準拠実装が例外を投げないよう防御的に`try/catch`で包んでいます。
- **`movementX`/`movementY`はv1ではスコープ外。** 上記参照。
- **autoTriggerなし。** `requestPointerLock()`はuser gesture文脈を必要とするため、主な起動経路は`data-*target`のクリックショートカットではなくcommand-tokenプロトコル（`<wcs-pointer-lock>`上の`command.requestPointerLock: $command.<token>`）です。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true`を宣言し`connectedCallbackPromise`を公開します。`observe()`が同期的なため、このpromiseは常に即座にsettleします。

## ヘッドレス利用（`PointerLockCore`）

CoreはDOM非依存（Pointer Lockプラットフォーム APIの呼び出しを除く）で、`@wc-bindable/core`の`bind()`と直接使えます:

```typescript
import { PointerLockCore } from "@wcstack/pointer-lock";

const lock = new PointerLockCore();
lock.addEventListener("wcs-pointer-lock:change", (e) => {
  console.log((e as CustomEvent).detail); // boolean —新しい active 値そのもの
});

const canvas = document.querySelector("#scene")!;
lock.observe(canvas);              // document の pointerlockchange を購読し、canvas に対して自己判定
await lock.requestPointerLock(canvas); // user gesture 内から呼ぶ必要がある
console.log(lock.active, lock.error);

// 後始末:
lock.exitPointerLock();  // 同期的
lock.dispose();          // document のリスナーを外す
```

4.25 から、`dispose()` は `active` が `true` だったとき `active: false` を公開し（dispose した Core はもう document を聞いていません）、次の `observe(element)` が読み直します。`lock.supported` と、`observe()` が発火する `wcs-pointer-lock:supported-changed` イベントは、ブラウザに API があるかを伝えます。Firefox では、`lock.error` は `requestPointerLock()` が resolve した後に、document の `pointerlockerror` イベントで立ちます。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## アクセシビリティ

**WCAG 2.1.2 No Keyboard Trap（キーボードトラップなし）**: Esc でロックが必ず解除されることはブラウザが保証する — このキーを別用途に奪ってはならない。ただし、ユーザーが知らない保証付き脱出口は半分しか脱出口ではない: ロックが掛かる*前*に抜け方を伝え、アプリ内の出口（`exitPointerLock` コマンドを配線した可視のコントロール）も用意すること。ロック中の説明はポインタ操作なしで読める状態を保つ。

## ライセンス

MIT
