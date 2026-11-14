# フォーム

**English**: [forms.md](./forms.md)

ほとんどがフォームのページ — 申込、記入票、ウィザード — は、一覧やダッシュボードには無いものに出会います: IME で変換する文字、打った文字を整形する欄、ブラウザが埋める欄、reset ボタン、動く入力の行、自作の部品。この案内は、それぞれに `@wcstack/state` が何をし、ページに何が残るかをまとめます。継ぎ目アプリ `ekiden-entry`（日本語のチーム参加申込のウィザード、[seam-apps.ja.md](./seam-apps.ja.md)）から書きました。版の数字は、その振る舞いが始まる版です。

## 何が起きて、どうするか

| フォームで | 起きること | すること |
|---|---|---|
| IME で変換中の欄に state が書く（正規化する setter、別のタブの下書き） | 4.22 までは、書き込みが変換を切り、文字がもう一度打たれた（`やまだ` → `ヤヤマヤマダヤマダ`）。4.23 から、書き込みは変換の終わりを待つ（`forms` add-on）。 | 何もしない。正規化は setter で。キャレットは[打った文字を変える欄](#打った文字を変える欄)。 |
| Enter で変換を確定する | `keydown` は、ほかの Enter と同じにページのハンドラに届く: 単語の途中でフォームが送られ、ウィザードが進む。 | 変換中のキーは無視する: [変換中の Enter](#変換中の-enter)。 |
| 双方向の欄に出力フィルタ（`value: code\|upper`） | 1 打鍵ごとに欄が書き直される: キャレットが末尾に飛び、state は整形済みの文字を受け取る。 | 書かない。setter で整形するか、整形した文字は別の要素に出す。4.23 から lint が知らせる（`wcs/two-way-output-filter`）。 |
| 数を打つ（`value: count`） | 要素が書くのは文字列: `count + 1` は `"51"`。 | `valueAsNumber: count`、または入力フィルタ `value\|number: count`。4.23 から lint が知らせる（`wcs/number-written-as-string`）。 |
| ブラウザやパスワード管理が欄を埋める | `input` と `change` が出れば、打ったのと同じ。`change` だけ、またはイベントなしだと、4.22 までは state に届かなかった。4.23 から、`change` のときと、`submit` のハンドラが走る前に届く。 | 何もしない。イベントなしの値も読まれるよう、`<form>` の `submit` のハンドラから送る。 |
| `<button type="reset">`、`form.reset()` | 4.22 までは、欄が空になり、state は全部持ったままだった。4.23 から、state が reset 後の値になる。 | 何もしない。既定値がマークアップのものでないなら、メソッドで state を戻す。 |
| 入力の行が動く（並べ替え、↑ / ↓） | 同じ行のオブジェクトを動かせば、行の要素が持つものは行に付いていく。値を書き移すと、位置に残る。 | オブジェクトを並べ替える。[入力の行](#入力の行)。 |
| 行の radio が同じ `name` | ブラウザは全部の行を 1 つのグループにする: ページ全体で 1 つしか選ばれない。 | 行ごとの name。4.23 から lint が知らせる（`wcs/radio-name-shared`）。 |
| 自作のフォーム部品 | 片方向に宣言するか、宣言が無いと、何も知らせずにデータを失う。 | `value` を `properties` と `inputs` の両方に: [自作のフォーム部品](#自作のフォーム部品)。 |

## IME で変換する文字

日本語・中国語・韓国語は 2 段で打ちます: キーが読み（`やまだ`）を作り、変換がそれを文字（`山田`）にします。`compositionstart` から `compositionend` までの間、欄は確定していない文字を持ち、1 段ごとに `isComposing` が true の `input` イベントが出ます。

**双方向バインディングは 1 段ごとに state に書きます。** 文字数の表示や検索にはそれが要りますが、そのパスの getter や `$watch` は、途中の文字で走ることになります。確定した文字だけを見たいコードは、イベントを見ます: `oninput:` のハンドラで `if (e.isComposing) return;` とし、確定した文字は `oncompositionend:` で扱います（Chromium は最後の `input` を `compositionend` の前に出します。順序に頼らないこと）。

**state は、変換中の欄には書きません。** 4.23 から、欄の `value` に書く束縛は `compositionstart` から預かられ、`compositionend` の後で、そのときの state の値が当たります。だから、setter で打った文字を正規化できます:

```js
export default {
  kanaRaw: "",
  get kana() { return this.kanaRaw; },
  // ひらがな → カタカナ。変換を確定すると、欄に結果が出る
  set kana(v) { this.kanaRaw = String(v).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); },
};
```

```html
<input data-wcs="value: kana">
```

変換中のほかからの書き込み — 別のタブの下書き、検索で引いた住所 — も預かります。利用者が打ち続ければ、state に残るのは利用者の文字です。何も打たずに確定すれば、預かった値が出ます。

本物の変換を試験で動かせるのは Chromium だけです（CDP の `Input.imeSetComposition` と `Input.insertText`）。Firefox と WebKit にはその口が無く、happy-dom には IME がありません — そこでは `compositionstart` / `compositionend` を自分で出します。

### 変換中の Enter

Enter は変換を確定し、ページには `keydown` が届きます。無視します:

```js
onKey(e) {
  // 229: Safari は確定の Enter を compositionend の後に出す。isComposing はもう false
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  this.next();
}
```

自分で書いた `keydown` のハンドラの話です（Enter で「次へ」に進むウィザード、Enter で送るチャット）。

### フリガナの欄

読みは、変換の前にキーが作ったものです。まだ仮名である間は `compositionupdate` の `data` にあり、変換すると消えます — 欄の値は `山田` で、そこから `やまだ` に戻せるコードはありません。

```html
<input data-wcs="value: name; oncompositionupdate: reading; oncompositionend: readingEnd">
<input data-wcs="value: kana">
```

```js
export default {
  name: "", kana: "", _reading: "",
  reading(e) { if (/^[ぁ-ゖァ-ヺー]+$/.test(e.data)) this._reading = e.data; },
  readingEnd() {
    this.kana += this._reading.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    this._reading = "";
  },
};
```

貼り付けた文字と、IME を切って打った文字には読みがありません。欄は利用者に任せます。

## 打った文字を変える欄

ハイフンの入る電話番号、郵便番号、半角にする全角の数字。

- **setter で正規化します**（上のとおり）。state が持つのは整えた値で、欄には getter の値が出ます。
- **キャレットは末尾に行きます。** 書き込みが欄の文字を変えると、そうなります — スクリプトから `value` を書いたときのブラウザの規則です。末尾を打つ欄（1 回打つ電話番号）なら困りません。途中を直す欄では、確定のときに書き戻します: `value#onchange: phone` は `change` を聞くので、整形はフォーカスを外したときに起き、失うキャレットがありません。
- **打ちながら整形し、キャレットも保つなら**、欄を引き取ります: 片方向に束ね、キャレットも置くハンドラから書きます。

  ```html
  <input data-wcs="value#ro: phone; oninput: typePhone">
  ```

  ```js
  typePhone(e) {
    if (e.isComposing) return;
    const el = e.target;
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
    this.phoneDigits = el.value.replace(/\D/g, "");
    const text = this.phone;              // getter の整形した文字
    el.value = text;
    let i = 0;
    for (let seen = 0; i < text.length && seen < digitsBefore; i++) if (/\d/.test(text[i])) seen++;
    el.setSelectionRange(i, i);
  }
  ```

- **出力フィルタは使いません。** `value: price|locale` は、1 打鍵ごとに state の値を整形して欄に書きます。戻ってくるのは整形済みの文字で、次にフィルタがそれで失敗します。整形した値は別の要素に出します（`{{ price|locale }}`）。
- **入力フィルタが変えるのは、入る向きだけです。** `value|trim: name` は、state に前後を削った文字を渡し、欄は打ったままにします — 氏名の途中の空白は打てます。

取り消し（Ctrl+Z）が覚えているのは、利用者自身の編集です: スクリプトの書き込みは、ブラウザの履歴に入りません。打っている間に書き直される欄は、粗くしか戻らないか、まったく戻りません。検索が入れた値も戻りません。`change` で整形すれば、打っている間の取り消しは効きます。取り消しは `input` を出すので、state は戻った値に付いていきます。

## 数

要素の `value` は文字列です。数に束ねると、最初の編集で数が文字列になり、`+` は連結になります。

```html
<input type="number" data-wcs="valueAsNumber: count">   <!-- number・range・日付と時刻の type -->
<input data-wcs="value|number: count">                  <!-- どの欄でも: 入力フィルタ -->
<select data-wcs="value|int: size">…</select>
```

空にした欄: `valueAsNumber:` は `NaN` になります（state はその `NaN` を書き戻し、ブラウザは解釈できない値だと報告します）。`value|number:` は `0` になります。「未入力」をゼロと区別したいなら、文字のまま持ち（`value: countText`）、getter で変換します。

## 利用者が打たなかった値

- **自動入力。** ブラウザは `input` と `change` を出します — state には、打ったのと同じに届きます。パスワード管理や拡張機能には `change` だけ出すものがあり、イベントなしで値を入れるものもあります。4.23 から `forms` add-on が、`change` のときと、フォームの `submit` のハンドラが走る前（そのフォームの欄ごとに）に state に知らせます。イベントなしで入った値が分かるのは、送るときです。それより前ではありません: submit でない「次へ」のボタンは、前のままの state を読みます。ステップのボタンは、フォームの submit ボタンにします。
- **ブラウザに要るものを渡します**: 欄ごとの `name` と `autocomplete` のトークン（`autocomplete="family-name"`・`"tel"`・`"postal-code"`）を、`<form>` の中に。
- **reset** は、コントロールをマークアップの既定値 — `value=""`、`checked` と `selected` の属性 — に戻し、4.23 から state が付いていきます。マークアップでどれも `checked` でない radio のグループには、書く値がありません: state は値を持ったままで、radio にはその値がもう一度出ます。フォームの既定値がマークアップでなく state にあるなら、メソッド（`clear() { this.entry = emptyEntry(); }`）と普通のボタンを書きます。
- **state でなくページを読む**（`new FormData(form)`）と、そのときページにあるコントロールしか見えません — 描いていないステップは入りません。申込は state です。それを送ります。

## 入力の行

行に欄があり（メンバー、明細）、並べ替えたり動かしたりできるリスト。

- **オブジェクトを動かします。** 同じオブジェクトで `this.runners = [b, a, ...rest]` とすれば、それぞれの行の要素が動きます: フォーカス、開いた `<details>`、選んだファイル、変換中の文字は、行に付いていきます（`moveBefore()` のある Chromium 133 以降と Firefox 144 以降。Safari は行を入れ直すので、フォーカスのある欄がフォーカスを失います — `element.focus()` で戻します）。
- **値を入れ替えません。** 2 行目の欄の値を 1 行目に書き、その逆も書くと、要素が持つもの — フォーカス、開いた節、ファイル — は位置に残り、別の人の名前の隣に来ます。
- **新しいオブジェクトは、新しい行です。** JSON から作り直したリスト（下書きの読み直し）は、`$listKeys` がどれがどれかを言うキーを名指さない限り、全部の行を作り直します。
- **行の radio には、行ごとの name が要ります** — 無いと、ブラウザは全部の行を 1 つのグループにします。束ねます: `attr.name: .sexGroup` と `get "runners.*.sexGroup"() { return "sex-" + this[".id"]; }`。`name` が無くても `radio:` は radio を選択に合わせますが、矢印キーで radio の間を動けません。
- **サーバーの誤りは、行の番号でなく行の id で持ちます。** `errors.runners[3]` は、並べ替えの後では別の人を指します。`errorsById[runner.id]` は行に付いていきます。リストの隣に持つほかのものも同じです。
- **行の中のアップロードと fetch。** 動く行の中の `<wcs-upload>` と `<wcs-fetch>`: 4.23 から、ブラウザが行を `moveBefore()` で動かすとき（Chromium・Firefox）、要求は続きます。行を取り出して入れ直すところ（Safari）では、要素は切断され、要求は中断されます — どの切断でも同じです。行の要求が進んでいる間は、並べ替えないか、I/O の要素を動かないリストに置いて、行を id で指します。

## ステップ

- **ステップは、隠さずに描きます。** ページに置いたまま隠したステップは、`required` の欄をフォームに残します: 利用者に見えない欄のためにブラウザが送信を断り（Chromium は `An invalid form control … is not focusable` と書きます）、何も起きません。ステップは `if:` の枝かルートに置き、申込の全体は、最後に送る前に state で検査します。
- **フォーカスは、ステップができてから。** 次のステップの欄は、ステップを変える更新の中では、まだページにありません。同じ息で出したフォーカスのコマンドは失われます（`[wcs/command-token-unbound]`）。`$renderedCallback` から出すか、ステップごとにルートがあるなら、ルーターの `path` が変わったときに出します。
- **サーバーの 422 が別のステップの欄を指すとき**: 誤りを欄ごとに state に持ち、誤りのある最初のステップへ移り、ステップが描かれてからその欄にフォーカスします。

## 自作のフォーム部品

フォーム関連カスタム要素（`static formAssociated = true`、`attachInternals()`）は、wcstack があっても無くても、ネイティブのコントロールと同じにフォームに加わります。束ねるには:

```js
class MidoriStepper extends HTMLElement {
  static formAssociated = true;
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "midori-stepper:change" }],   // 要素 → state
    inputs: [{ name: "value" }],                                        // state → 要素
  };
  #internals = this.attachInternals();
  #value = 0;
  get value() { return this.#value; }
  set value(v) { this.#set(Number(v) || 0); }               // state やスクリプトから: イベントなし
  #set(v) { this.#value = v; this.#internals.setFormValue(String(v)); this.#render(); }
  #changed(v) {                                              // 利用者から: 知らせる
    this.#set(v);
    this.dispatchEvent(new CustomEvent("midori-stepper:change", { detail: v, bubbles: true }));
  }
  formResetCallback() { this.#changed(0); }                  // reset は、state がしたのでない変更
  formDisabledCallback(disabled) { this.toggleAttribute("aria-disabled", disabled); }
  formStateRestoreCallback(state) { this.#changed(Number(state) || 0); }
  #render() { /* 値を描く */ }
}
```

- **`value` を両方の並びに。** `properties` にだけあると、state は部品に書かず、部品の最初の値が state の値を置き換えます — 保存した下書きが、ページを読み込んだときに消えます。`inputs` にだけあるか、宣言が無いと、利用者の入力は state に届きません。4.23 から `diagnostics` add-on がどちらも知らせます（`[wcs/form-control-one-way]`）。別のファイルのクラスは、lint には見えません。
- **利用者の変更・reset・復元で、イベントを出します** — state がしたのでない変更すべてで。state が今書いた値を持って setter から出たイベントは、その書き込みの戻りと分かるので無視されます。そこで出しても害はありませんが、要りません。
- **入力ごとに setter を。** state はプロパティに書きます。値を属性からしか読まない部品は、`Cannot set property value … which has only a getter` で失敗します。
- **`<fieldset disabled>` と `form.reset()`** は、`formDisabledCallback` と `formResetCallback` を通して部品に届きます。state はそれらを呼びません。

## 送る

state が持つものを、`submit` のハンドラから送ります:

```html
<form data-wcs="onsubmit: send">…</form>
<wcs-fetch url="/api/entries" method="POST" manual data-wcs="body: payload; trigger: sending; error: sendError"></wcs-fetch>
```

```js
send(e) {
  e.preventDefault();
  this.payload = { ...this.entry };      // 毎回、新しいオブジェクト
  this.sending = true;                   // body の後に当たる: 束縛は書いた順に当たる
}
```

- **`body` が先、`trigger` が後** — `data-wcs` でも、メソッドでも。コマンド（`command.fetch: $command.post`）はその場で走り、同じ更新の束縛が当たるより前です: それが始める要求は、要素が前から持っていた本文を運びます。
- **`<wcs-fetch>` は `body` を 1 回だけ使います**: 要求の後には持っていません。同じ文字列をもう一度書いても、state にとっては変更でないので書かれず、再送は本文なしで出ます。新しいオブジェクトを書きます（上のとおり）— それは必ず変更です。4.23 から `<wcs-fetch>` が、本文のあった要求の後で `POST`・`PUT`・`PATCH` が本文なしで出るときに警告します（`[wcs/fetch-body-gone]`）。
