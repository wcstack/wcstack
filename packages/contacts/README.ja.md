# @wcstack/contacts

`@wcstack/contacts` は wcstack エコシステム向けのヘッドレスな Contact Picker コンポーネントです。

視覚的な UI ウィジェットではありません。`navigator.contacts.select(properties, options)` を宣言的コマンド+観測可能stateに変える**非同期プリミティブノード**で、Web Share APIに対する`@wcstack/share`と同じ形をしています。

`@wcstack/state` と組み合わせると、`<wcs-contacts>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `select(properties, options)`の引数は呼び出しごと
- **出力 state サーフェス**: `value`、`loading`、`error`、`cancelled`

## なぜ存在するか — Android Chrome限定、unsupportedが常態

Contact Picker APIは**Android Chromeでのみ**動作します。デスクトップブラウザ（およびiOS Safari）は`navigator.contacts`を一切持ちません。このノードは補助的なショートカットとして設計し、常に手入力の代替手段を用意してください。

> **2つの位置引数、プロトコル変更不要。** `select(properties, options)`はバッチ3で初めて2引数を取るcommandです。command-tokenの引数素通しは引数の個数を特別扱いしないため、無改造でそのまま動作します（`docs/contact-picker-tag-design.md` §2参照）。

> **`multiple: false`（既定）でも戻り値は配列。** 単一選択でも1要素の配列になります——素のオブジェクトを期待せず`value.0`のようにバインドしてください。

## インストール

```bash
npm install @wcstack/contacts
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/contacts/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      picked: null,
      pickContact() {
        this.$command.select.emit(["name", "tel"], { multiple: false });
      },
    };
  </script>
</wcs-state>

<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>

<button data-wcs="onclick: pickContact">連絡先を選択</button>
<p data-wcs="textContent: picked.0.name.0"></p>
```

## 観測可能プロパティ（出力）

| プロパティ  | イベント                        | 説明 |
| ----------- | -------------------------------- | ---- |
| `value`     | `wcs-contacts:complete`           | 選択された連絡先の配列（`multiple: false`でも常に配列）、成功前は`null`。 |
| `loading`   | `wcs-contacts:loading-changed`    | ピッカーダイアログが開いている間`true`。 |
| `error`     | `wcs-contacts:error`              | 真のプラットフォーム失敗（`select()`が投げた`DOMException`/`Error`）、または unsupported 経路ではプレーンオブジェクト`{ message: "Contact Picker API is not supported in this browser." }`、無ければ`null`。 |
| `cancelled` | `wcs-contacts:cancelled-changed`  | ユーザーがピッカーを閉じたら`true`（`error`とは分離）。 |

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `select` | はい   | `select(properties, options?)` — `properties`は`"name"`/`"email"`/`"tel"`/`"address"`/`"icon"`の配列、`options.multiple`既定`false`。never-throw: ユーザーキャンセルは`cancelled`、それ以外の失敗は`error`へ。`abort`コマンドは無し（Contact Picker APIはAbortSignalを受け付けない）。 |

## 属性 / 入力

**無し。**

## `:state()` による CSS スタイリング

`<wcs-contacts>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-contacts:loading-changed` が `true` で発火（`false` でクリア） |
| `cancelled` | `wcs-contacts:cancelled-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-contacts:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-contacts:state(loading) ~ .spinner { display: block; }
wcs-contacts:state(loading) ~ .spinner { display: none; } /* デフォルト */

form:has(wcs-contacts:state(error)) .banner { display: block; }
form:has(wcs-contacts:state(cancelled)) .hint { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-contacts>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-contacts:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-cancelled` /
  `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-contacts debug-states></wcs-contacts>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **Android Chrome限定。** unsupportedを例外ケースでなく既定として扱ってください。
- **`unsupported` 専用フラグは持たない。** `navigator.contacts.select` が関数でない状態で `select()` を呼ぶと、即座に `error` がプレーンオブジェクト `{ message: "Contact Picker API is not supported in this browser." }` になり `null` で解決します — 非同期処理を開始しないため `_gen` は消費されません。この形は実失敗（`error` に `DOMException`/`Error` が入る）とは異なるため、unsupported 経路で `error instanceof Error` や `error.name` を前提にしないでください。
- **`getProperties()`はv1スコープ外**（対応フィールドの非同期事前確認、`docs/contact-picker-tag-design.md` §4参照）。
- `@wcstack/share`/`@wcstack/eyedropper`とアーキタイプを共有: 単一`_gen`世代ガード、never-throw、AbortController無し。

## ヘッドレス利用（`ContactsCore`）

```typescript
import { ContactsCore } from "@wcstack/contacts";

const core = new ContactsCore();
core.addEventListener("wcs-contacts:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // ContactInfo[]
});

await core.select(["name", "tel"], { multiple: true });
core.dispose();
```

## ライセンス

MIT
