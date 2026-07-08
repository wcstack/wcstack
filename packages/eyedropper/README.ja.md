# @wcstack/eyedropper

`@wcstack/eyedropper` は wcstack エコシステム向けのヘッドレスな EyeDropper API コンポーネントです。

視覚的な UI ウィジェットではありません。
`new EyeDropper().open()`（ブラウザのネイティブなスポイトカーソル）をリアクティブな state に変えるので、「画面上の色を拾う」ボタンを、命令的な `addEventListener`/`try...catch` の配線無しに宣言的に組み立てられます。

`@wcstack/state` と組み合わせると、`<wcs-eyedropper>` はパス契約で直接バインドできます:

- **command サーフェス**: `open()` — `command.open:` / `$command.<name>` で起動、`abort()` — `command.abort:` / `$command.<name>` で起動
- **出力 state サーフェス**: `value`（拾った色）、`loading`、`error`、`cancelled`

`@wcstack/eyedropper` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`EyedropperCore`）が `new EyeDropper().open(options)` を包む
- **Shell**（`<wcs-eyedropper>`）がその state を DOM ライフサイクルと command-token プロトコルに接続する
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` と `open`/`abort` コマンドを宣言する

## なぜ存在するか — `@wcstack/share` と同じアーキタイプに `abort` を足したもの

`<wcs-eyedropper>` は [`@wcstack/share`](https://www.npmjs.com/package/@wcstack/share) とアーキテクチャを共有しています。`FetchCore._doFetch` の簡約版（`docs/eyedropper-tag-design.md`、`docs/web-share-tag-design.md` §2 を参照）を土台とした、状態が薄い command 専用ノードです — 単一 `_gen` 世代ガード、同値ガード付き private setter、never-throw な try/catch。

意図的な違いが1つあります。**`EyeDropper.open()` は `{signal}` という `AbortSignal` オプションを受け付けます**（`navigator.share()` には無い機能です）。これにより呼び出し元は進行中の色選択を中断する実在のプラットフォーム機構を得られるため、この Core は `FetchCore`（`packages/fetch/src/core/FetchCore.ts`）から `AbortController`/`abort()` を復元しています。ローカルに保持した controller への identity チェックも含み、これにより素早い `abort()` → `open()` の連打でも、古い controller が新しい呼び出しの controller を誤って null 化することがありません。

ユーザーが <kbd>Escape</kbd> でピッカーを閉じた場合も、呼び出し元が `abort()` を呼んだ場合も、どちらも同じ `AbortError` で `open()` が reject され、どちらも `cancelled` に着地します。両者を区別する必要はありません — どちらも「選択は完了しなかった」という意味だからです。

## Chromium 限定・デスクトップ向け

2026年時点で、EyeDropper API は Chromium 系ブラウザ（Chrome、Edge、Opera 等）にのみ実装されています — Firefox と Safari は未対応です。画面上の任意ピクセルを拾うという操作は、タッチ文脈でも本質的に意味を持ちません（指先での精密なピクセル単位のポインティングは困難で、モバイル版 Chrome にもこの API の実装がありません）。UI は **デスクトップ限定の漸進的強化機能**として設計してください — API が普遍的に使えると仮定せず、初回利用時に即座に `error` が発火したら「色を拾う」ボタンを隠す（あるいは `<input type="color">` のフォールバックを提供する）形にしてください。

## インストール

```bash
npm install @wcstack/eyedropper
```

## クイックスタート

### 1. カラーピッカーボタン

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/eyedropper/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["open"],
      pickColor() {
        this.$command.open.emit();
      },
    };
  </script>
</wcs-state>

<wcs-eyedropper data-wcs="command.open: $command.open"></wcs-eyedropper>

<button id="pick-button" data-wcs="onclick: pickColor">色を拾う</button>
```

### 2. 拾った色の反映とキャンセル

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["open", "abort"],
      pickedColor: null,
      picking: false,
      pickError: null,
      // 最初の選択が成功するまで pickedColor は null のままなので、hex 値は
      // null 安全な computed getter 経由でバインドする（pickedColor.sRGBHex
      // という生パスをバインドすると、選択前に null の中を辿ってしまう）。
      get pickedHex() {
        return this.pickedColor?.sRGBHex ?? "";
      },
      pickColor() {
        this.$command.open.emit();
      },
      cancelPick() {
        this.$command.abort.emit();
      },
    };
  </script>
</wcs-state>

<wcs-eyedropper
  data-wcs="command.open: $command.open; command.abort: $command.abort; value: pickedColor; loading: picking; error: pickError"
></wcs-eyedropper>

<button data-wcs="onclick: pickColor; disabled: picking">
  色を拾う
</button>
<button data-wcs="onclick: cancelPick; hidden: picking|not">キャンセル</button>

<div data-wcs="style.backgroundColor: pickedHex"></div>
<p data-wcs="hidden: pickError|falsy">何か問題が発生しました。</p>
```

### 3. 非対応ブラウザではボタンを隠す

`<wcs-eyedropper>` は専用の `supported` フラグを持ちません — `typeof EyeDropper` を直接確認するか、単に `open()` を試して即座の `error` に反応させてください:

```html
<script type="module">
  const supported = typeof EyeDropper !== "undefined";
  // #pick-button は例1の「色を拾う」ボタン。
  document.querySelector("#pick-button").hidden = !supported;
  // 非対応のモバイル/Firefox/Safari では <input type="color"> のフォールバックを提供する。
</script>
```

## 観測可能プロパティ（出力）

| プロパティ   | イベント                            | 説明 |
| ----------- | ----------------------------------- | ---- |
| `value`     | `wcs-eyedropper:complete`           | プラットフォーム自身の戻り値オブジェクト `{ sRGBHex: string }` をそのまま使用（合成不要。`@wcstack/share` の `value` が呼び出し元の入力をエコーバックするのとは異なる）。成功した選択が一度も無ければ `null`。 |
| `loading`   | `wcs-eyedropper:loading-changed`    | スポイトカーソルが有効な間（`open()` 呼び出しが進行中）は `true`。 |
| `error`     | `wcs-eyedropper:error`              | 真のプラットフォーム障害（ピッカーがキャンセルされた場合を除く全て）。まだ失敗が無い場合、または次の `open()` 呼び出しでリセットされた後は `null`。 |
| `cancelled` | `wcs-eyedropper:cancelled-changed`  | 選択が完了しなかった場合に `true` — ユーザーが Escape を押した場合と、呼び出し元が `abort()` を呼んだ場合の両方。どちらも同じ `AbortError` として現れ、区別されない。 |

`cancelled` と `error` はどちらも、次の `open()` 呼び出しの **開始時** にリセットされる（`false` / `null`）ため、前回の呼び出しの古い結果が次回の結果に残り続けることはありません。

## コマンド

| コマンド | 非同期 | 説明 |
| ------- | ----- | ---- |
| `open`  | あり  | `new EyeDropper().open({ signal })` を呼び出す。**引数は無し** — `{signal}` オプションは Core 内部の `AbortController` から供給され、command-token 経由で渡されることはない。 |
| `abort` | なし  | 進行中の `open()` 呼び出しがあれば中断する（無ければ no-op）。保留中の `open()` を `AbortError` で reject させ、`cancelled` に着地させる。 |

## 属性 / 入力

**無し。** `open()` は呼び出しごとの設定を持たない — あらかじめ要素に貼っておく設定値がありません。

## 注意・制限

- **Chromium 限定・デスクトップ向け。** 上記参照。2026年時点で Firefox と Safari は `EyeDropper` を実装しておらず、意味のあるタッチ入力の等価物もありません。
- **`abort()` は進行中の `open()` を中断する。** ユーザーが Escape を押した場合も、呼び出し元が `abort()` を呼んだ場合も、同じ `cancelled` という結果に解決される — 両者を区別する方法は無く、その必要もない。
- **同時に開けるピッカーはプラットフォーム全体で1つ。** 仕様の `InvalidStateError` は大域排他 — 別の eye dropper が既に開いている場合（2つ目の `<wcs-eyedropper>` インスタンスや別タブ）、`open()` はこのエラーで reject され、`cancelled` ではなく `error` に着地する。単一インスタンス内では発生しない — 新しい `open()` は先に前回の進行中の選択を中断するため。
- **素早い `abort()` → `open()` の連打でも `AbortController` が混線しない。** 新しい `open()` 呼び出しは前回の進行中の呼び出しを中断し、新しい `AbortController` を発行する。前回呼び出しの後始末は、自身がまだ所有しているフィールドのみをクリアする（`FetchCore` の identity チェックと同型）。
- **対応判定。** 専用の `supported` フラグは持たない。`open()` は呼び出し時に `typeof EyeDropper === "function"` を確認し、無ければ即座に `error` を設定する（非同期処理を開始しないため `_gen` は進めず、`new EyeDropper()` も構築されない）。
- **`_gen` 世代ガード。** `dispose()` 後（例: ピッカーが有効な間の高速切断）に解決した `open()` 呼び出しは stale であり、破棄済みの要素へ状態を書き込まない。
- **`autoTrigger` を持たない。** `@wcstack/share` と同様、`open()` は実際のユーザー操作の文脈内から呼び出す必要がある。クリックハンドラを直接 `$command.open.emit()` に配線すること。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開する。非同期 probe が無いため、常に即座に settle する。
- **同値ガード。** `value`/`loading`/`error`/`cancelled` の setter は値が実際に変化したときのみ発火する。

## `:state()` による CSS スタイリング

`<wcs-eyedropper>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-eyedropper:loading-changed` が `true` で発火（`false` でクリア） |
| `cancelled` | `wcs-eyedropper:cancelled-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-eyedropper:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-eyedropper:state(loading) ~ .cursor-hint { display: block; }

form:has(wcs-eyedropper:state(cancelled)) .cancelled-banner { display: block; }
form:has(wcs-eyedropper:state(error)) .error-banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-eyedropper>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-eyedropper:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-cancelled` /
  `data-wcs-state-error` 属性にミラーします。Elements パネルを開いておけば、
  トグルのたびにハイライトされます:

  ```html
  <wcs-eyedropper debug-states></wcs-eyedropper>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`EyedropperCore`）

Core は DOM 非依存で、`@wc-bindable/core` の `bind()` と直接使えます:

```typescript
import { EyedropperCore } from "@wcstack/eyedropper";

const eyedropper = new EyedropperCore();
eyedropper.addEventListener("wcs-eyedropper:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // { sRGBHex: "#aabbcc" }
});
eyedropper.addEventListener("wcs-eyedropper:cancelled-changed", (e) => {
  console.log("cancelled:", (e as CustomEvent).detail);
});

const result = await eyedropper.open();

// 進行中の選択を中断する:
eyedropper.abort();
```

## ライセンス

MIT
