# @wcstack/fullscreen

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/fullscreen` は wcstack エコシステム向けのヘッドレスな Fullscreen API コンポーネントです。

視覚的な UI ウィジェットではありません。
**制御ノード**です。大半の wcstack IO ノードは自分自身を操作対象としますが、`<wcs-fullscreen>` は `@wcstack/intersection` が自分自身ではなく参照先の要素を観測するのと同じように、`target` で指し示した**参照先の要素**に対して `requestFullscreen()` / `exitFullscreen()` を実行します。

`@wcstack/state` と組み合わせると、`<wcs-fullscreen>` はパス契約で直接バインドできます:

- **入力サーフェス**: `target`（操作対象の要素。下記参照）
- **出力 state サーフェス**: `active`、`error`、`errorInfo`、`supported`
- **コマンド**: `requestFullscreen()`、`exitFullscreen()`

`@wcstack/fullscreen` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`FullscreenCore`）が Fullscreen API を操作し、`document` の `fullscreenchange` イベントを追従
- **Shell**（`<wcs-fullscreen target="...">`）が `target` を DOM 要素へ解決し、Core の state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `active` / `error` / `errorInfo` / `supported` プロパティと `requestFullscreen`/`exitFullscreen` コマンドを宣言

## なぜ存在するか — 操作対象は「タグ自身」ではなく「参照先」

`Element.requestFullscreen()` はfullscreen化したい要素（画像・動画・カードUIなど）に対するメソッドであり、`<wcs-fullscreen>` 自身に対するものではありません。そのため本タグは非表示の制御要素（`display` はターゲット解決モードに応じて決まります — 下表参照）として存在し、`<wcs-intersect>` と全く同じ規則で `target` 属性を介して別の要素を指し示します:

| `target`             | 操作対象                  | display     | 典型的な用途                |
| --------------------- | -------------------------- | ------------ | ---------------------------- |
| 省略                  | 最初の子要素                | `contents`   | ギャラリー画像/動画をラップ  |
| `"#hero"` / セレクタ | マッチした要素              | `none`       | 離れた要素を指し示す          |
| `"self"`              | 自分自身                    | `block`      | ラッパー自体をfullscreen化   |

## インストール

```bash
npm install @wcstack/fullscreen
```

## クイックスタート

### 1. ボタンクリックで画像をfullscreen化

```html
<script type="module" src="https://esm.run/@wcstack/fullscreen/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen"],
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" data-wcs="command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button data-wcs="onclick: $command.goFullscreen">Fullscreen</button>
```

ボタンは `<wcs-fullscreen>` を直接操作しません。クリックで `goFullscreen` コマンドトークンをemitし、`<wcs-fullscreen>` は `command.requestFullscreen: $command.goFullscreen` でそのトークンを購読します（[command-tokenプロトコル](../state/) — コマンドメソッドを持つ要素側が購読者、emitする側はボタン）。

### 2. 動画をラップし、fullscreen中のみ終了ボタンを表示

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["exitFs"],
      isFullscreen: false,
    };
  </script>
</wcs-state>

<wcs-fullscreen data-wcs="active: isFullscreen; command.exitFullscreen: $command.exitFs">
  <video src="/movie.mp4" controls></video>
</wcs-fullscreen>
<button data-wcs="hidden: isFullscreen|not; onclick: $command.exitFs">終了</button>
```

バインドする state パスは事前宣言が必須です（ここでは `isFullscreen: false`。未宣言パスへのバインドは初期化時に throw します）。`data-wcs` のパスでの否定は先頭 `!` ではなく `|not` フィルタで行います（`isFullscreen|not`）— パス構文に前置演算子は存在しません。

## 観測可能プロパティ（出力）

| プロパティ | イベント                | 説明 |
| ----------- | ------------------------ | ---- |
| `active`    | `wcs-fullscreen:change`  | `document.fullscreenElement` が**このインスタンスが解決したtarget**と一致している間 `true`、それ以外は `false`。4.25 から、要素が文書の外にある間も `false`（[要素が文書を離れるとき](#要素が文書を離れるとき)参照）。 |
| `error`     | `wcs-fullscreen:error` | 直近の失敗: rejectされたPromise（gesture外呼び出しなら `TypeError` 等）、プラットフォームAPI非対応なら `{ message: "Fullscreen API is not supported." }`、`target` が要素へ未解決なら `{ message: "Fullscreen target could not be resolved." }`。直近の呼び出しが成功済み・まだ何も失敗していない場合は `null`。4.25 から、ブラウザがイベントでしか知らせない拒否は `NotAllowedError` の `DOMException`（`"The browser refused the fullscreen request."`）になる（「注意・制限」参照）。 |
| `errorInfo` | `wcs-fullscreen:error-info-changed` | `error` から導出した serializable な失敗 taxonomy（`WcsIoErrorInfo`: 安定 `code` / `phase` / `recoverable`）、または `null`。additive で `error` の値の形は不変。 |
| `supported` | `wcs-fullscreen:supported-changed` | 4.25 から。このページで要素の fullscreen を使えるなら `true`、使えないなら `false`（iPhone、Permissions-Policy が禁じたフレーム）。イベントの `detail` は boolean そのもの。下記参照。 |

### `supported` — このページで fullscreen を使えるか

4.25 から。`supported` は、このページで要素の fullscreen を使えるときに `true` です: 文書が有効と答え（`document.fullscreenEnabled`、または接頭辞付きの `webkitFullscreenEnabled`）、要素に `requestFullscreen()`（または `webkitRequestFullscreen()`）があり、Permissions-Policy が切っていない — サーバーの `Permissions-Policy: fullscreen=()` ヘッダーも、`allow="fullscreen"`（または `allowfullscreen`）の無いクロスオリジンの `<iframe>` も無い — 場合です。それ以外は、理由が何であれ `false` です。**iPhone（iOS の Safari）には要素の fullscreen が無いので、そこでは `supported` は `false` です**（iPad にはあります）。

要求が通ることまでは言いません。要求には user gesture が要り、利用者はいつでも fullscreen を抜けられます。fullscreen は安全なコンテキストを要らないので、素の `http:` のページであることだけでは `false` になりません。

値は聞かれるたびにブラウザから読みます（キャッシュしません）。だからバインディングは、付いた時点で正しい値を得ます。要素は接続されたとき、最後に発火した値と違えば `wcs-fullscreen:supported-changed` も発火します（最初は `false` なので、fullscreen を使えるページでは `true` が 1 回届きます）。ボタンは、使えるところでだけ出します:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen"],
      fsSupported: false,
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" data-wcs="supported: fsSupported; command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button data-wcs="hidden: fsSupported|not; onclick: $command.goFullscreen">Fullscreen</button>
```

ポリシーが禁じたフレームでは、WebKit（Safari）は `supported` を読むたびにコンソールへエラーを 1 つ出します。WebKit にはポリシーに聞く手段が無く、そこで `document.fullscreenEnabled` を読んだことを報告するためです。値（`false`）は正しく、例外も出ません。

## コマンド

| コマンド               | 非同期 | 説明 |
| ----------------------- | ------ | ---- |
| `requestFullscreen()`   | あり  | `target` を解決し、その要素に対して `requestFullscreen()` を呼ぶ。 |
| `exitFullscreen()`      | あり  | `document.exitFullscreen()` を呼ぶ。何もfullscreenでなければ何もせず終了する（silent no-op）。 |

## 属性 / 入力

| 属性      | 説明 |
| ---------- | ---- |
| `target`   | `@wcstack/intersection` の `target` と同じ3モード解決: `"self"`、CSSセレクタ、または省略（最初の子要素）。 |

**`null` と `undefined`。** 属性に対応する入力 `target` は、`null` を「クリア」として扱います。属性を外し、`target` は既定値（最初の子要素）に戻ります。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらも文字列 `"null"` / `"undefined"` として書くことはなく、何にも一致しないセレクタになってすべての要求が失敗することもありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

## `:state()` による CSS スタイリング

`<wcs-fullscreen>` は 1 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `active` | `wcs-fullscreen:change` が `detail.active === true` で発火（`active: false` でクリア） |

`error` / `errorInfo` は observable（各自のイベントで `data-wcs` バインド可 — 上記
「観測可能プロパティ」参照）ですが、`:state()` には反映**しません**: 失敗オブジェクトは
boolean ステートではないため、boolean の `:state()` 反映で表現するものがありません。
`supported` も反映しません。バインドしてください（`supported: fsSupported`）。

```css
wcs-fullscreen:state(active) ~ .exit-hint { display: block; }
wcs-fullscreen:state(active) ~ .exit-hint { display: none; } /* デフォルト */
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-fullscreen>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-fullscreen:not(:defined)` と組み合わせてください。

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
  <wcs-fullscreen target="#hero" debug-states></wcs-fullscreen>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 要素が文書を離れるとき

4.25 から。`<wcs-fullscreen>` が document を聞いているのは、接続されている間だけです。`active` が `true` の間に切断されると — `if:` の枝が消える、`@wcstack/router` がルートの本文を取り外す — `active: false` を `wcs-fullscreen:change` イベントとともに公開します。バインドした state のパスも `:state(active)` もそれに従います。文書の外にある要素は、その値をもう保証できないからです。fullscreen 自体は**抜けません**。再び接続されると本当の値を読み直し、target がまだ fullscreen なら `active` はイベントとともに `true` に戻ります。そのため、移動された（取り外して入れ直された）要素は `false`、`true` の順に報告します。4.24 までは切断しても `active` がそのまま残り、fullscreen が終わった後も state は `true` を示し続けていました。

fullscreen をどうするかはブラウザが決めます。**fullscreen になっている要素が文書から取り除かれると、ブラウザは fullscreen を終わらせます。** ルートの本文の中にある target はルートとともに去り、fullscreen もそこで終わります。ナビゲーションをまたいで fullscreen を続けるには、target — とその `<wcs-fullscreen>` — をルーターの外、残り続けるレイアウトの側に置きます（[router README — ルートの本文はどこに置くか](../router/README.ja.md#ルートの本文はどこに置くか)）。target だけを外に置き `<wcs-fullscreen>` をルートの中に置いた場合、fullscreen は続きますが、`active` はそのルートを離れている間 `false` で、戻ると `true` に戻ります。

## fullscreen の間、画面の向きを固定する

ブラウザのタブでは、画面の向きは document が fullscreen の間しか固定できません（[`<wcs-screen-orientation>`](../screen-orientation/README.ja.md) の `lock()`）。fullscreen はクリックの中で要求し、固定は `active` をバインドしたパスの `$watch` から行います。fullscreen を要求するハンドラの中では固定しないでください。そこでは要求は出ていても fullscreen はまだ有効ではなく、ブラウザは固定を断ります。

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen", "exitFs", "lockOrientation", "unlockOrientation"],
      isFullscreen: false,
      lockError: null,

      enter() {
        this.$command.goFullscreen.emit(); // クリックの中: user gesture
      },

      $watch: {
        isFullscreen(cur) {
          if (cur) this.$command.lockOrientation.emit("landscape"); // fullscreen が有効になった
          else this.$command.unlockOrientation.emit();
        },
      },
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#stage"
  data-wcs="active: isFullscreen; command.requestFullscreen: $command.goFullscreen; command.exitFullscreen: $command.exitFs"></wcs-fullscreen>
<wcs-screen-orientation
  data-wcs="command.lock: $command.lockOrientation; command.unlock: $command.unlockOrientation; error: lockError"></wcs-screen-orientation>

<div id="stage">
  <button data-wcs="onclick: enter; hidden: isFullscreen">全画面（横向き）</button>
  <button data-wcs="onclick: $command.exitFs; hidden: isFullscreen|not">終了</button>
</div>
```

watch は `active` が `true` になったとき — fullscreen が有効な状態で固定を頼みます — と、`false` に戻ったとき — 利用者が Esc や終了ボタンを押した、あるいは（4.25 から）要素が文書を離れた — に走ります。`$watch` は `@wcstack/state` のフルエントリ（`/auto`）に含まれます。向きの固定が無いブラウザ（Safari、デスクトップのブラウザ）では `lockError` がそれを伝え、fullscreen には影響しません。

## 注意・制限

- **iPhone には要素の fullscreen が無い。** iPhone の Safari は要素の fullscreen を実装していません。`supported` は `false` で、要求は `error` で終わります。ボタンは `supported` で隠してください。`<video controls>` には、そこでもシステム自身の全画面ボタンがあります。
- **イベントで届く拒否。** 4.25 から。標準の `requestFullscreen()` は promise を返し、その reject が `error` になります。古い Safari の接頭辞付き API（`webkitRequestFullscreen()`）は何も返しません。拒否がページに届くのは、document の `webkitfullscreenerror` / `fullscreenerror` イベントだけです。`<wcs-fullscreen>` は接続されている間これを聞き、promise を返さなかった呼び出しでこの要素が出した要求に対して発火したとき、`error` を `NotAllowedError` の `DOMException` — `"The browser refused the fullscreen request."`、`errorInfo.code` は `not-allowed` — にします。イベントは理由を運ばないので、メッセージはそれ以上を言いません。届くのはコマンドの promise が決着した後です。`await` の直後に読むのではなく、`error` をバインドしてください。promise を返した呼び出しの要求には promise だけが答えるので、同じ拒否を 2 回報告することはありません。この要素の要求が待っていないときのイベント — 別のインスタンスのもの — は無視します。
- **同じ更新が描画する target。** コマンドは emit した時点で走り、state の描画はその 1 マイクロタスク後です。そのため `this.showPlayer = true; this.$command.goFullscreen.emit();` は、`if:` の枝がまだ文書に入れていない `target` を求めることになり、`error` は `{ message: "Fullscreen target could not be resolved." }` になります。描画の後、`$renderedCallback` から emit してください — `if (paths.includes("showPlayer") && this.showPlayer) this.$command.goFullscreen.emit();`。そこはまだクリックの user activation の中です（[state README — Command Token](../state/README.ja.md#command-tokenメソッドバインディング)）。
- **user gesture制約。** `requestFullscreen()` は実際のuser gesture（クリックハンドラ等）内から同期的に呼ばれた場合のみ成功します。本ノードはgestureを生成できません — command-tokenプロトコル経由（`<wcs-fullscreen>` 側の `command.requestFullscreen: $command.<token>`、ボタン側の `onclick: $command.<token>`）で呼び出す場合は、**起動元のイベント自体**が本物のuser gestureであることを確認してください。`setTimeout` の中やPromiseチェーンの奥深くから呼び出すと、呼び出し方法に関わらず `TypeError`（WHATWG Fullscreen仕様のtransient-activationチェックによる。`NotAllowedError` ではない）でrejectされます — これはブラウザレベルの制約であり、wcstack側で回避する手段はありません。
- **ベンダープレフィックス。** 一部の古いSafariバージョンは `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` / `webkitFullscreenEnabled` / `webkitfullscreenchange` / `webkitfullscreenerror` のみを実装しています。Coreは標準名を優先的にプローブし、**呼び出しの都度**（非キャッシュ）レガシー名にフォールバックするため、両方とも透過的にサポートされます。
- **複数インスタンス。** `document.fullscreenElement` はdocument全体で単一の値です。異なるtargetを指す複数の `<wcs-fullscreen>` インスタンスが存在する場合、`target` が `document.fullscreenElement` と一致するインスタンスのみが `active: true` を報告し、他は正しく `false` を報告します。各インスタンスは内部で**自分自身が解決したtarget**を追跡しており、単純に「何かがfullscreenかどうか」をミラーしているわけではありません。ただし非対称な点に注意: `exitFullscreen()` はインスタンス単位にスコープされて**いません** — document全体に作用する `document.exitFullscreen()` を呼ぶため、どのインスタンスから呼んでも、現在fullscreenの要素（別インスタンスの `target` がfullscreen化した要素であっても）を解除します（silent no-opの判定も同様にdocument全体の「何かがfullscreenか」であり、「自分のtargetがfullscreenか」ではありません）。これはプラットフォームAPI自体の挙動をそのまま反映したものです。
- **`exitFullscreen()` は安全なno-op。** 何もfullscreenでない状態（またはAPI非対応）で呼び出してもエラーなくresolveします — 失敗しうる事前条件チェックではなく、べき等な「fullscreenでないことを保証する」コマンドとして扱われます。
- **`error` / `errorInfo` は observable（バインド可）。** 両者は専用イベント（`wcs-fullscreen:error` / `wcs-fullscreen:error-info-changed`）付きで `static wcBindable.properties` に宣言されているため、バインディング側が request/exit の失敗をリアクティブに観測できます（`data-wcs="error: fsError; errorInfo: fsErrorInfo"`）。もちろんコマンドの Promise settle 後に `element.error` / `element.errorInfo` を命令的に読み取ることもできます。`errorInfo` は `error` から導出した**additive** な serializable 失敗 taxonomy（`WcsIoErrorInfo`: `code` / `phase` / `recoverable`、`error` の値の形は不変）。API 非対応（`"…is not supported."`）→ `capability-missing`（phase `probe`）、`target` 未解決 → `invalid-argument`（phase `start`）、gesture 外拒否（`TypeError` / `NotAllowedError`）→ `not-allowed`（phase `execute`、`recoverable: true` — 実 gesture 内で再試行すれば成功しうる）、その他 → `fullscreen-error`（phase `execute`）。`errorInfo` は `error` と厳密に同期し（成功で `null` にクリア）、`WcsIoErrorInfo` 型と `WCS_FULLSCREEN_ERROR_CODE` 定数は export 済み。
- **`_gen` 世代ガード。** `dispose()` 後（または後続の呼び出しに追い越された後）にsettleした進行中の `requestFullscreen()`/`exitFullscreen()` 呼び出しは、破棄済みの状態を書き換えません。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開しますが、`fullscreenchange` の購読が同期的なため、この promise は常に即座に settle します。

## ヘッドレス利用（`FullscreenCore`）

CoreはDOM依存が `document` と明示的に渡された対象 `Element` のみで、セレクタの解決自体は一切行いません:

```typescript
import { FullscreenCore } from "@wcstack/fullscreen";

const core = new FullscreenCore();
core.addEventListener("wcs-fullscreen:change", (e) => {
  console.log((e as CustomEvent).detail); // { active: true | false }
});

await core.observe();                    // document の fullscreenchange を購読
await core.requestFullscreen(myElement); // user gesture 内から呼ぶ必要がある
console.log(core.active);                // fullscreenchange で確認されると true

await core.exitFullscreen();
core.dispose();                          // document のリスナーを外す
```

4.25 から、`dispose()` は `active` が `true` だったとき `active: false` を公開し（dispose した Core はもう document を聞いていません）、`setTarget(element)` が読み直します — Shell は接続のたびに呼びます。`core.supported` と、`observe()` が発火する `wcs-fullscreen:supported-changed` イベントは、このページで fullscreen を使えるかを伝えます。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## アクセシビリティ

**WCAG 2.1.2 No Keyboard Trap / 2.4.3 Focus Order**: Esc で常に全画面を抜けられる（ブラウザ保証 — このキーを奪わない）が、アプリ内にも `exitFullscreen` コマンドを配線した可視の出口を用意すること（全員がこの慣習を知っているわけではない）。全画面化はナビゲーションなしで画面内容が変わる: フォーカスが全画面要素の中の妥当な場所（最初の操作可能なコントロール、または `tabindex="-1"` を付けた要素自身）へ移ることと、全画面終了時にフォーカスが開いたコントロールへ戻ることを確認する。

## ライセンス

MIT
