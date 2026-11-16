# @wcstack/contacts

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/contacts` は wcstack エコシステム向けのヘッドレスな Contact Picker コンポーネントです。

視覚的な UI ウィジェットではありません。`navigator.contacts.select(properties, options)` を宣言的コマンド+観測可能stateに変える**非同期プリミティブノード**で、Web Share APIに対する`@wcstack/share`と同じ形をしています。

`@wcstack/state` と組み合わせると、`<wcs-contacts>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `select(properties, options)`の引数は呼び出しごと
- **出力 state サーフェス**: `value`、`loading`、`error`、`cancelled`、そして 4.25（未リリース）から `supported`

## なぜ存在するか — Android Chrome限定、unsupportedが常態

Contact Picker APIは**Android Chromeでのみ**動作します。デスクトップブラウザ（およびiOS Safari）は`navigator.contacts`を一切持ちません。このノードは補助的なショートカットとして設計し、常に手入力の代替手段を用意してください。

> **2つの位置引数、プロトコル変更不要。** `select(properties, options)`はバッチ3で初めて2引数を取るcommandです。command-tokenの引数素通しは引数の個数を特別扱いしないため、無改造でそのまま動作します（`docs/contact-picker-tag-design.md` §2参照）。

> **`multiple: false`（既定）でも戻り値は配列。** 単一選択でも1要素の配列になり、連絡先の各メンバーもまた配列です——バインドする前に[結果の形](#結果の形)を読んでください。

## インストール

```bash
npm install @wcstack/contacts
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/contacts/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["select"],
      picked: null,     // 要素の出力: 最初は null、その後は直近に選んだ連絡先
      canPick: false,
      pickError: null,
      // 連絡先の各メンバーは配列なので、名前は getter を通して読む
      get pickedName() {
        return this.picked?.[0]?.name?.[0] ?? "";
      },
      pickContact() {
        this.$command.select.emit(["name", "tel"], { multiple: false });
      },
    };
  </script>
</wcs-state>

<wcs-contacts
  data-wcs="command.select: $command.select; value: picked; supported: canPick; error: pickError"
></wcs-contacts>

<button data-wcs="hidden: canPick|not; onclick: pickContact">連絡先を選択</button>
<p data-wcs="textContent: pickedName"></p>
<p data-wcs="hidden: pickError|falsy">連絡先ピッカーを開けませんでした。</p>
```

この例には、欠かせないものが 3 つあります:

- **`$commandTokens: ["select"]`** が、`pickContact()` が emit し要素が購読するトークンを宣言します。これが無いと、ページは `[wcs/token-undeclared]` で失敗します。
- **`pickedName` は getter です。** `picked` は最初に選ぶまで `null` で、連絡先の `name` は配列で、その配列は空のこともあります。`?.` と既定値を持つ getter なら、それぞれの場合に何を出すかを 1 か所で言えます。`picked.0.name.0` のようなパスをマークアップに書くより、こちらを使ってください。
- **`supported`**（4.25（未リリース）から）が、ピッカーを使えないところ — ほとんどのブラウザ — でボタンを隠します。隣に普通の入力欄を残してください。

## 結果の形

`value` は連絡先の配列で、利用者が選んだ連絡先 1 件につきオブジェクトが 1 つです。各連絡先は `properties` に挙げたメンバーだけを持ち、**どのメンバーも配列**です — 1 人の連絡先は電話番号を複数持つことも、1 つも持たないこともあります:

```js
// select(["name", "tel", "email"], { multiple: true })
[
  { name: ["山田 花子"], tel: ["090-1234-5678", "03-1234-5678"], email: [] },
  { name: ["Taro Sato"], tel: [], email: ["taro@example.com"] },
]
```

つまり `contact.name` は `["山田 花子"]` であって、`"山田 花子"` ではありません。`name[0]` を取り、それが無いこと（`name: []`）も想定してください。

**`value` は出力です — 自分で持ち続けるリストに束縛しないでください。** 束縛が張られると、要素の値がそのパスの中身を置き換えます: 最初に選ぶまでは `null`、その後は**直近に**選んだ連絡先だけです。`value` に束縛した `guests` リストは、読み込み時に `null` になり、選ぶたびに置き換わります。`value` は専用のパスに束縛し、そこから自分のメンバーを作ってください:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["select"],
      picked: null,
      guests: [],       // 自分のリスト: { name, tel } — 配列ではなく文字列
      $watch: {
        picked(contacts) {
          if (!contacts) return;
          this.guests = [
            ...this.guests,
            ...contacts.map((c) => ({ name: c.name?.[0] ?? "", tel: c.tel?.[0] ?? "" })),
          ];
        },
      },
      addGuests() {
        this.$command.select.emit(["name", "tel"], { multiple: true });
      },
    };
  </script>
</wcs-state>

<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>

<button data-wcs="onclick: addGuests">連絡先から追加</button>
<ul>
  <template data-wcs="for: guests">
    <li><span data-wcs="textContent: .name"></span> <span data-wcs="textContent: .tel"></span></li>
  </template>
</ul>
```

## 観測可能プロパティ（出力）

| プロパティ  | イベント                        | 説明 |
| ----------- | -------------------------------- | ---- |
| `value`     | `wcs-contacts:complete`           | 選択された連絡先の配列（`multiple: false`でも常に配列。空にはならない）、成功前は`null`。[結果の形](#結果の形)を参照。4.25（未リリース）から、選ばずに閉じたピッカーは`value`をそのままにします。 |
| `loading`   | `wcs-contacts:loading-changed`    | ピッカーダイアログが開いている間`true`。 |
| `error`     | `wcs-contacts:error`              | 真のプラットフォーム失敗（`select()`が投げた`DOMException`/`Error`）、または unsupported 経路ではプレーンオブジェクト`{ message: "Contact Picker API is not supported in this browser." }`、無ければ`null`。 |
| `cancelled` | `wcs-contacts:cancelled-changed`  | ユーザーが誰も選ばずにピッカーを閉じたら`true`（`error`とは分離）。次の`select()`の開始時に`false`へ戻ります。下記参照。 |
| `errorInfo` | `wcs-contacts:error-info-changed` | serializable な失敗 taxonomy（安定 `code` / `phase` / `recoverable`）、または `null`。追加的で `error` の shape は不変。`code` は unsupported なら `capability-missing`、真の失敗なら `select-failed`。 |
| `supported` | `wcs-contacts:supported-changed`  | 4.25（未リリース）から。このページで Contact Picker を使えるなら`true`。下記参照。 |

**`cancelled` — 閉じられたピッカー。** Contact Picker の仕様は、閉じられたピッカーにエラーを与えません: `select()` は**空のリストで resolve します**。4.25（未リリース）から、`<wcs-contacts>` はその空のリストをキャンセルとして読みます: `cancelled` が `true` になり、`value` は元のまま、`wcs-contacts:complete` は流れず、`select()` は `null` で resolve します。4.24 までは、仕様に無い `AbortError` の reject を待っていたため、`cancelled` が `true` になることはなく、ピッカーを閉じると `value: []` が直前の選択を上書きしていました。（ブラウザが `AbortError` で reject することがあれば、それも引き続き `cancelled` にします。）

**`supported`**（4.25（未リリース）から）は、`navigator.contacts.select` が関数で、**かつ**ページが最上位（`window.top === window`）のときに `true` です: 仕様は `<iframe>` の中の文書にピッカーを許しません。値は読まれるたびにブラウザから読むので、束縛は張られた時点で正しい値を受け取ります。要素は接続されたときにも、最後に流した値（初期値は `false`）と違っていれば `wcs-contacts:supported-changed`（`detail` は boolean）を流します。利用者が誰かを選ぶことは**言いません**。この端末がどの `properties` を出せるかも言いません（`address` と `icon` はどこにでもあるわけではありません）。

**並行制御。** 連絡先ピッカーはシステムに1つのモーダル面なので、`<wcs-contacts>` は共有
io-core lane を `exhaust` policy で用いる: 1つの `select()` が進行中の間、2回目の呼び出しは
冪等な **no-op**（2つ目のピッカーを開かず `null` を返す）となり、進行中の呼び出しの結果を
汚さない。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `select` | はい   | `select(properties, options?)` — `properties`は`"name"`/`"email"`/`"tel"`/`"address"`/`"icon"`の配列、`options.multiple`既定`false`。never-throw: ユーザーキャンセルは`cancelled`、それ以外の失敗は`error`へ。`abort`コマンドは無し（Contact Picker APIはAbortSignalを受け付けない）。 |

**失敗が意味すること。** `select()` の reject は 3 通りで、どれも `error`（ブラウザの `DOMException` / `TypeError`）に入り、`errorInfo.code` は `"select-failed"` です:

| `error.name` | 原因 |
| ------------ | ---- |
| `InvalidStateError` | ページが最上位ではない — `<iframe>` の中で動いている（そこでは `supported` が `false`）。または、ピッカーがすでに出ている（別の `<wcs-contacts>`）、ブラウザがピッカーを開けなかった。 |
| `SecurityError` | ユーザー操作が無い: `select()` がタップやクリックから呼ばれていない（タイマー、ページの読み込み、後で解決した promise）。 |
| `TypeError` | `properties` が空、またはこのブラウザが出せないプロパティを挙げている — あるいは、そもそも名前の配列ではない。 |

> **`select` はボタンに直結せず、state のメソッドを通して配線してください。** `<button data-wcs="onclick: $command.select">` は DOM イベントを第 1 引数にしてトークンを emit するので、要素は `select(event)` として呼ばれます — ブラウザは `Event` をプロパティのリストとして受け付けず、`TypeError` で拒否します。このコマンドが取るのはデータです。クイックスタートの `pickContact()` のように、メソッドから emit してください（`this.$command.select.emit(["name", "tel"])`）。

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

- **Android Chrome限定。** unsupportedを例外ケースでなく既定として扱ってください: `supported`（4.25（未リリース）から）を束縛し、`true` のところでだけピッカーを出します。
- **非対応のブラウザ。** `navigator.contacts.select` が関数でない状態で `select()` を呼ぶと、即座に `error` がプレーンオブジェクト `{ message: "Contact Picker API is not supported in this browser." }`（`errorInfo.code: "capability-missing"`）になり `null` で解決します — 非同期処理を開始しないため、この呼び出しは operation lane に入りません。この形は実失敗（`error` に `DOMException`/`Error` が入る）とは異なるため、unsupported 経路で `error instanceof Error` や `error.name` を前提にしないでください。API のあるブラウザの `<iframe>` の中では、`supported` は `false` ですが、`select()` はそのままブラウザに聞き、ブラウザが `InvalidStateError`（`select-failed`）で答えます。
- **`getProperties()`はv1スコープ外**（対応フィールドの非同期事前確認、`docs/contact-picker-tag-design.md` §4参照）。
- `@wcstack/share`/`@wcstack/eyedropper`とアーキタイプを共有: 呼び出しは共有 io-core の operation lane を通る（ここでは`exhaust` — ピッカーは同時に1つ。`dispose()`は進行中の呼び出しを無効にするので、遅れて届いた完了は何も書かない）、never-throw、AbortController無し。

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

4.25（未リリース）から、`core.supported` はいつでも読めます。`core.observe()` は、最後に流した値と違っていれば `wcs-contacts:supported-changed` を流します。利用者が閉じた `select()` は、`core.cancelled` を立てて `null` で resolve します。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## ライセンス

MIT
