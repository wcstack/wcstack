# `$stream` — 非同期プロデューサーを畳み込んでリアクティブプロパティにする

## これは何か

次の状態定義を見てください。

```javascript
export default {
  draft: "",     // 入力中の文（入力欄が持つ）
  prompt: null,  // 尋ねた文 —— stream が読むキー（null: まだ何も尋ねていない）

  ask() { this.prompt = this.draft; },

  $stream: {
    tokens: {
      args:    (state) => state.prompt,
      source:  (prompt, signal) => llmStream(prompt, signal),
      fold:    (acc, chunk) => acc + chunk,
      initial: "",
    },
  },
};
```

```html
<input data-wcs="value: draft">
<button data-wcs="onclick: ask">Ask</button>
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>
<p data-wcs="textContent: $streamError.tokens"></p>
```

`$stream` は状態オブジェクト上の宣言マップです — `$commandTokens`・`$eventTokens`・`$on` と同じ系統に属します。各エントリは**非同期プロデューサー**（async iterable / async generator / `ReadableStream`）を単一の**リアクティブプロパティ**に接続します。プロデューサーが産出する各チャンクは `fold` を通り、畳み込み結果が `state.tokens` の新しい値になります — 通常の更新サイクルを流れるため、バインディング・computed getter・`$watch`・`$renderedCallback` のすべてが他のプロパティと同じように反応します。

入力欄が書くのは `draft` で、`ask` がそれを `args` の読むキー `prompt` に写します: stream は `args` の読むものが変わるたびに restart するので、入力欄を `prompt` そのものに束ねると、1 文字打つたびに応答が abort され、新しいリクエストが送られます。4.33（未リリース）から、`prompt: null` は何かを尋ねるまで stream を起動させません（[起動と停止](#起動と停止)）。4.32 までは、読み込み時に `source` が `null` で呼ばれます。

`$stream` は `$watch` とともに `temporal` アドオンに属します。`@wcstack/state` と `/auto` には含まれています。`/core` のページは `@wcstack/state/features/temporal` を入れてください。入れずに `$stream` を宣言した状態は `[wcs/feature-not-installed]` で失敗します。概要は README の [Stream](../README.ja.md#streamstream) 節、`$stream`・`$watch`・パス getter の使い分けは [時間を扱う機構の選び方](../README.ja.md#時間を扱う機構の選び方) を参照してください。

`$stream` が意図的に**やらないこと**が 2 つあります:

- **汎用ストリームパイプラインではありません**。オペレーターも tee も transform もなく、「消費して、畳んで、代入する」だけです。
- **backpressure を保持しません**。需要はプロデューサーに逆流しません。これは明示的な非目標であり、重要な帰結が 1 つあります: [fold は有界でなければなりません](#有界-foldmust)。

---

## 宣言リファレンス

### `$stream` マップ

`$stream` の各キーはフラットなプロパティ名、各値は stream 定義です。

```javascript
export default {
  $stream: {
    // フル形: LLM トークンストリームを累積
    tokens: {
      args:    (state) => state.prompt,                   // 依存はここでのみ捕捉される
      source:  (prompt, signal) => llmStream(prompt, signal),
      fold:    (acc, chunk) => acc + chunk,               // reduce（累積）
      initial: "",                                        // fold 指定時は必須
    },

    // 最小形: fold 省略 = latest（最新チャンクで置換）、
    // args 省略 = 一度だけ起動して restart しない
    ticker: {
      source: (_args, signal) => priceStream(signal),
    },
  },
};
```

### 各フィールドの契約

| フィールド | 型 | 必須 | 契約 |
|---|---|---|---|
| `source` | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<同>` | ✔ | **`AbortSignal` を必ず尊重すること**（協調キャンセル契約）。restart・破棄はこの signal で駆動されます — signal を無視する source は確実にキャンセルできません。`ReadableStream` はこの契約を自動的に満たします: getReader を持つものは（native に async-iterable でも）常に `getReader()` 経路で消費され（仕様上 `iterator.return()` は pending `next()` の後ろに直列化されるため、parked read を強制解放できるのは `reader.cancel()` のみ）、abort 時に runtime が reader を cancel してストリームの `cancel()` コールバックまで届けます。これが効くのは `source` がストリームを返した後です。その前に `source` が待つもの —— 応答がまだ来ていない `fetch` —— を止めるには、`source` が `signal` を渡す必要があります（`fetch(url, { signal })`）。渡さないと、restart や停止の後もそのリクエストは走り続け、サーバーは誰も読まない応答を返します。それ以外の async iterable では、abort 時に runtime が iterator の `return()` を呼びます。signal を無視して `await` で止まっている generator は外から解放できません。プロデューサーの `Promise` を返しても構いません。それ以外の戻り値は `TypeError` となり error 状態に現れます。 |
| `args` | `(state) => any` | — | **同期・純粋関数**。読み取り専用の state ビューを受け取り、ここで読んだパスすべてが依存として捕捉されます（[依存駆動 restart](#依存駆動-restart) 参照）。省略時は依存なし — 一度起動したら restart しません。戻り値はそのまま `source` の第 1 引数になります（複数値はオブジェクト/配列で束ねる）。`Promise` を返すとエラーです。4.33（未リリース）から、`null` は「実行しない」の意味です: stream は起動せず、実行中なら止まって、畳み込んだ値を保ちます（[起動と停止](#起動と停止)）。`undefined` は他の値と同じく渡されます。`args` が状態から読んだオブジェクト（`state.request`）は、状態自身のオブジェクトのまま `source` に届きます —— proxy でも写しでもありません: 読む・シリアライズする・ワーカーに post する（状態の値は素のデータで、structured clone が写せます）のは構いませんが、その場で書き換えないでください —— 束ねたものに何も知らせずに状態を変えることになります。 |
| `fold` | `(acc, chunk) => next` | — | **同期関数**。省略時は latest（チャンクで値を置換）。**新しい値を返すこと** — `acc` の in-place 変異は非サポートです（[新しい値を返す](#新しい値を返すin-place-変異の禁止) 参照）。fold が throw すると stream は error 状態になり、プロデューサーは abort されます。 |
| `initial` | any | fold 指定時 ✔ | 初期値。起動・restart のたびにプロパティの値はこれにリセットされます（`args` が `null` を返して止めたときは値を保ちます —— 4.33（未リリース）から）。 |

### バリデーション

宣言の違反は、状態を取り込む時点でエラーになります。初回の読み込みでは `<wcs-state>` が初期化に失敗し（エラーは `console.error` で報告され、`connectedCallbackPromise` がそのエラーで reject されます）、`setInitialState()` による再セットでは throw して元の状態が残ります:

- `$stream` は stream 名から定義へのマップとなるオブジェクトであること。
- 各エントリ名は**フラットなプロパティ名**であること: 空文字でない・`.` を含まない・`*` を含まない・`$` で始まらない（予約名前空間）。
- エントリ名は `Object.prototype` の継承名（`__proto__`・`constructor`・`toString`・`hasOwnProperty` など）でないこと。これらはランタイムの own プロパティ前提を破ります（特に `__proto__` は起動時に state の prototype を差し替えてしまいます）。なおオブジェクトリテラルの `__proto__:` キーは prototype 指定構文で own key にならないため、そのようなエントリはエラーにならず黙って無視されます。
- エントリ名は state に宣言済みの getter / setter と衝突しないこと。
- エントリ名は**メソッド**（関数値のプロパティ。own・プロトタイプ鎖上のいずれも）と衝突しないこと。判定は property descriptor で行うので getter は評価されません。検査が無いと、そのメソッドは起動時の `initial` リセットで無言に上書きされ、失敗は宣言から遠い場所（どこかの getter・`$watch`・command の中）で `not a function` として現れます。検査は状態オブジェクトをその時点の姿のまま読みます: 関数値の `initial` や関数を返す `fold` は動きますが、runtime がそのプロパティに関数を書き込んだ後で**同じ**オブジェクトを再セットすると衝突になります — 再セットには新しいオブジェクトを渡してください。
- 各エントリはオブジェクト（`{ args?, source, fold?, initial? }`）であること。
- `source` は関数であること。`fold` は（あれば）関数であること。`fold` があるのに `initial` が無ければエラー（reduce にはシード値が必要）。
- `args` は（あれば）関数であること。
- 3.x の名前 `$streams` は削除されました: `diagnostics` アドオンが入っていれば（`@wcstack/state`・`/auto`）、宣言すると `[wcs/declaration-alias] $streams was removed: write $stream.`（`#1601`）を throw します。入っていなければ、その宣言は無視されます。

起動 / restart 時（`args` 評価時）に検出される違反:

- `args` が `Promise` を返した（同期契約違反）。
- `args` が stream 自身 — `<name>` / `$streamStatus.<name>` / `$streamError.<name>` — を読んだ（自己依存は自分の書き込みで永遠に restart し続けるため）。
- `args` がワイルドカードを含むパスを読んだ（`$getAll` 経由も同様）— ワイルドカード依存は現時点でスコープ外です。

違反（および `args` が投げたユーザー例外）の現れ方は経路によって異なります:

- **eager 起動**（connect 時・接続中の state 再セット時）— エラーはそのまま送出されます（loud fail）: connect 時は `$connectedCallback` 内の例外と同じ扱い（`… $connectedCallback failed.` と報告され、`connectedCallbackPromise` がそのエラーで reject される）、再セット時は `setInitialState()` が throw します。
- **依存駆動 restart** — 送出されません: エラーは `$streamStatus.<name> = "error"` / `$streamError.<name>` に正規化され、他の entry の restart は継続します。前回成功した run で捕捉した依存は保持されるため、その依存への書き込みで再試行・回復できます。

### 値プロパティ

宣言を読む時点で、`state[name]` が未定義なら `initial`（fold 無しの場合は `undefined`）を持つ通常のデータプロパティとして実体化されます。これにより、stream が起動する前の初期レンダ — そして SSR 出力 — に `initial` が表示されます。

同名プロパティをユーザー側で先に宣言しても構いません（`defineState` での型付けに有用）が、**stream の起動時に値は `initial` で上書きされます**。起動後のプロパティは stream ランタイムの所有物です: ユーザーコードからの代入は禁止されませんが、動作は未定義です — 次の fold は代入後の値の上に畳みます。4.33（未リリース）から、diagnostics アドオンが stream ごとに 1 回それを言います（`[wcs/stream-value-written]`）。書き込みでは stream も、その裏のリクエストも止まりません: 止めるには `args` が `null` を返すようにしてください。畳み込んだ値は保たれます（[起動と停止](#起動と停止)）。

起動・restart のたびの `initial` へのリセットは通常の書き込みです: 値が変わるとき（`initial` がオブジェクトや配列なら常に）バインディングと値への `$watch` に届きます。

restart を跨いで累積したい場合は、累積値を普通のキーとして持ち、stream の値のパスに付けた `$watch` ハンドラから書き込んでください。リセットは初期値を書き戻す `$watch` ハンドラで表せます。stream 自身の値は restart のたびに `initial` へ戻ります。

---

## コンパニオン名前空間: `$streamStatus` / `$streamError`

すべての stream は読み取り専用のコンパニオンパスを 2 つ持ちます:

- `$streamStatus.<name>` — `"idle" | "active" | "done" | "error"`
- `$streamError.<name>` — 直近のエラー（無ければ `null`）

| status | 意味 |
|---|---|
| `idle` | 宣言済みだが動いていない（接続前、または切断後。4.33（未リリース）からは `args` が `null` を返している間も） |
| `active` | 現在の run がチャンクを消費中 |
| `done` | プロデューサーが正常終端した |
| `error` | run が失敗した（source の throw / reject、fold の throw、iterable でない戻り値、または restart 時の `args` の失敗） |

セマンティクス:

- **読み取り専用**。どちらの名前空間への代入（two-way binding 経由を含む）も `"$streamStatus.<name>" is read-only (the stream runtime owns it).` を送出します — 代入する値が現在値と同じでも送出します（読み取り専用の検査は same-value ガードより先に行われます）。
- `$streamError.<name>` は起動・restart のたびに `null` にリセットされます。`args` が `null` になったときも同じです（4.33（未リリース）から）。
- error 時、**値プロパティは直前の fold 結果を保持**します — リセットされません。`initial` へのリセットは次の（再）起動時です。
- `$stream` に未宣言の名前の読みは `undefined` です（throw しない。`$command` 名前空間と同じ寛容規約）。

他のパスと同じようにバインドできます:

```html
<button data-wcs="disabled: $streamStatus.tokens|eq(active)">Ask</button>
<p data-wcs="class.error: $streamStatus.tokens|eq(error); textContent: $streamError.tokens"></p>
```

computed getter からも読めます — 依存が登録される **dotted ブラケット形**を使ってください:

```javascript
get isStreaming() {
  return this["$streamStatus.tokens"] === "active";   // ✅ 追跡される — status 変化で再計算
  // this.$streamStatus.tokens                        // ⚠️ 値は読めるが依存は登録されない
}
```

観測保証:

- 中間 status の観測は保証されません。同一の更新バッチに畳まれた遷移（例: 同一 tick 内の `active → done`）は最終値しか描画されないことがあります — 他のバインディング更新と同じ契約です。
- stream の値とコンパニオンパスは、`<name>` / `$streamStatus.<name>` / `$streamError.<name>` として通常のバインディング更新に参加します。
- `$renderedCallback` は **binding 駆動**です: その `paths` には、その drain で live DOM binding が実際に適用されたパスだけが載ります。`$stream` エントリを宣言しただけでは、`$renderedCallback` はその値やコンパニオンを購読しません。
- 描画せずに stream へ反応するには、その**値のパス**に `$watch` を宣言します。`$watch` は state-only（headless）な購読で、バインドの有無に関わらず発火します。`prev` は `$watch` の規則どおりです: stream が primitive を書いたときはバッチ開始時の値、オブジェクトを書いたとき（配列を組み立てる fold）は `undefined` です。予約名前空間（`$streamStatus.<name>` / `$streamError.<name>`）は watch できません（watch パスは `$` で始められない）。完了 *status* が必要な場合は、UI にバインドするか、getter で読むか、終端条件を値そのものに畳み込んでください。

---

## 依存駆動 restart

`args` の中で読んだパスはすべて依存として捕捉されます — computed getter の依存追跡と同じく自動です。捕捉された依存が変化すると、その更新バッチの終わり（`$watch` ハンドラの後）に stream が restart します:

1. 現在の run が **abort** されます（`source` に渡された `AbortSignal` 経由）。
2. 値プロパティが **`initial` にリセット**されます。
3. `args` が**再評価**されます（依存は run ごとに再捕捉 — 条件分岐で読むパスが変わっても正しく追従します）。
4. 新しい args 値と新しい signal で `source` が呼ばれます。

これは **switchMap セマンティクス**です: 最新の依存状態が常に勝ち、陳腐化した run は競合させず打ち切られます。abort された run からは、以後何も state に届きません: その run がまだ産出するチャンク、終端、エラーはすべて捨てられ、値・`$streamStatus`・`$streamError` は新しい run のものになります。

```javascript
$stream: {
  tokens: {
    args:   (state) => state.prompt,     // ← state.prompt への書き込みで旧 run が abort され新 run が始まる
    source: (prompt, signal) => llmStream(prompt, signal),
    fold:   (acc, chunk) => acc + chunk,
    initial: "",
  },
},
```

詳細:

- **coalesce** — 同一の更新バッチ内の複数の依存書き込みは、restart ちょうど **1 回**に畳まれます。
- **status は不問** — `done` や `error` の stream も依存の書き込みで restart します。これが再試行の形です: 自動再接続は無く、再試行 = 依存を叩き直すこと。
- **restart は変化駆動** — `args` に届いた変化は、`args` が結果として同じ値を返しても stream を restart させます。ただし同値の primitive の書き込みは same-value ガードで何にも届く前に捨てられます。出来事だけで restart させる命令はありません: 「同じ引数でもう一度」は、追加の依存（世代カウンタなど）の変化として表すか、状態の宣言を差し替えて表してください。
- **computed 経由の依存も有効** — `args` が getter を読む場合、その getter 自身の依存元の変化で restart します。
- **stream 間の連鎖は正当** — stream B の `args` が stream A の値や `$streamStatus.A` を読んでも構いません。A のチャンク到着（や status 遷移）が B を restart させ、switchMap が自然に連鎖します。
- **`args` / getter 内での名前空間読みの正規形**は dotted ブラケット形 `state["$streamStatus.a"]` です。チェーン形 `state.$streamStatus.a` は値は返しますが依存を**登録しません** — 連鎖が無音で切れます。
- **自己依存はエラー** — `args` が自分の `<name>` / `$streamStatus.<name>` / `$streamError.<name>` を読むのは違反です（自分の書き込みで永遠に restart するため）。経路ごとの現れ方は[バリデーション](#バリデーション)を参照。
- **restart は書き込み連鎖の上限に数えられる** — restart の書き込み（`initial` へのリセット、status）は、その `args` に届いた書き込みの連鎖を引き継ぎます。`$watch` ハンドラが延ばすのと同じ連鎖です。32 段より深い restart は行われず、連鎖は打ち切られて `console.error`（`$watch handlers / $stream restarts kept writing for 32 batches; the chain is cut (nothing is rolled back).`）で 1 回報告されます。次にその入力が変化すれば restart します。run が起動したタスクの中で後から書くもの —— source が産出した値、`done` / `error` の status —— も同じ連鎖を引き継ぎ、それが起こす `$watch` ハンドラも連鎖の続きになります: stream の値を見る `$watch` が `args` の読むものを進める形は、source がすぐに産出すると（メモリから yield する async generator、`start` で enqueue する `ReadableStream`）、ページを固まらせずに 16 周ほどで打ち切られます。後のタスクで届いた値は新しく連鎖を始めます。連鎖の規則は README の [Watch](../README.ja.md#watchwatch) 節を参照してください。
- **相互サイクルは MUST NOT** — A の `args` が B の値を読み、B の `args` が A の値を読む形は、宣言時には拒否されません。source が run の（再）起動と同じタスクの中で産出する場合、その値は run の連鎖に数えられ、上の上限でサイクルが打ち切られます。値が後のタスクで届く場合（ネットワーク応答、メッセージ、タイマー）は周回ごとに連鎖が新しく始まり、2 つの stream は互いを永遠に restart させ続けます。回避はユーザーの責務です。

---

## 起動と停止

4.33（未リリース）から、`args` が `null` を返すことは「実行しない」の意味です:

- `args` が `null` を返している間、stream は起動しません: `$streamStatus.<name>` は `idle` のまま、`source` は呼ばれず、値は `initial` のままです。
- 後から `args` が `null` になると、実行中の run は abort され、値は**畳み込んだものを保ちます** —— `initial` にはリセットされません。`$streamStatus.<name>` は（`active`・`done`・`error` のどれからでも）`idle` に、`$streamError.<name>` は `null` に戻ります。
- 次に `null` でない値が返ると、restart と同じく run が始まります: `initial` から、その値で `source` を呼びます。
- これは `null` だけです: `undefined` は他の値と同じで、`source(undefined, signal)` が呼ばれます。`args` の無いエントリは、これまでどおり一度だけ起動します。

4.32 までは `source` が `null` でも呼ばれます: まだ尋ねることの無い stream は空のストリームを返し（何も尋ねないうちから `done` を読みます）、応答を残したまま止めるには、値を自分のキーに写す `$watch` が要ります。

ですから、利用者が送り、止めることもできるリクエストは、キー 1 つで表せます:

```javascript
export default {
  draft: "",
  request: null,                                   // null: 尋ねることが無い —— stream は idle

  send() { this.request = { question: this.draft }; },
  stop() { this.request = null; },                 // run を abort する。届いた分の応答は残る

  $stream: {
    answer: {
      args:    (state) => state.request,
      source:  async (request, signal) => {
        const res = await fetch("/api/answer", { method: "POST", body: JSON.stringify(request), signal });
        return res.body.pipeThrough(new TextDecoderStream());
      },
      fold:    (acc, text) => acc + text,
      initial: "",
    },
  },
};
```

```html
<textarea data-wcs="value: draft"></textarea>
<button data-wcs="onclick: send">Send</button>
<button data-wcs="onclick: stop; disabled: $streamStatus.answer|ne(active)">Stop</button>
<pre data-wcs="textContent: answer"></pre>
```

`send` は毎回新しいオブジェクトを書くので、同じ質問をもう一度送っても新しい run が始まります（同じ文字列なら same-value ガードで捨てられます）。`stop` の後の `$streamStatus.answer` は `idle` で、止めた応答と終わった応答（`done`）を見分けられます。

---

## 規範と footgun

### 有界 fold（MUST）

backpressure は放棄されています: 需要はプロデューサーに逆流せず、貪欲な source を減速させるものは何もありません。無限 / 長寿命ストリームで生のチャンクを全部累積すると、無制限のメモリリークになります。

**有界な fold を使ってください** — latest・カウント・last-N ウィンドウ・逐次集計:

```javascript
// ✅ 直近 100 件 — 有界
fold: (acc, line) => [...acc.slice(-99), line],

// ✅ 逐次集計 — 有界
fold: (acc, sample) => ({ count: acc.count + 1, max: Math.max(acc.max, sample) }),

// ❌ 無限ストリームでの生累積 — 無制限
fold: (acc, chunk) => [...acc, chunk],
```

生の累積（LLM トークンの例のような）は**有限ストリーム限定**です。

### 新しい値を返す（in-place 変異の禁止）

`fold` は新しい値を返さなければなりません。`acc` の in-place 変異は same-value ガードとリスト差分の両方を無効化します:

```javascript
// ❌ 非サポート — 同一の配列参照のままでは差分もガードも変化を検出できない
fold: (acc, chunk) => { acc.push(chunk); return acc; },

// ✅ 毎回新しい配列（同時に有界でもある）
fold: (acc, chunk) => [...acc.slice(-99), chunk],
```

4.33（未リリース）から、fold が累積値を変えたまま返すと —— 長さの変わった配列、size の変わった `Map` / `Set`、エントリの変わったオブジェクト —— diagnostics アドオンが stream ごとに 1 回それを言います（`[wcs/stream-fold-in-place]`）。見るのは最初の 50 チャンクです。チャンクを読み飛ばして累積値を変えずに返すのは言いません。

### チャンク反映の粒度

- `fold` は**各チャンクに正確に 1 回**適用されます — 取りこぼしも重複もありません。
- DOM 反映は updater の microtask バッチに従います。async iterator 経由のチャンクは各々別の microtask で届くため、実際には**チャンクごとに 1 drain**（DOM flush 1 回・`$renderedCallback` 1 回）になります。flush レートはチャンク到着レートに有界です。
- 畳み込んだ値が現在値と同値の primitive のとき — latest fold なら同値の primitive チャンクが続いたとき — は same-value ガードで**丸ごとスキップ**されます: バインディング更新も `$watch` も `$renderedCallback` エントリもありません。
- **組み込みの間引き機構はありません**。プロデューサーが DOM に対して饒舌すぎる場合は、プロデューサー側・fold 内・または下流の `wcs-debounce` / `wcs-throttle` で間引いてください。

### stream を一覧の行に描く

`for:` は行を参照で見分けます（[ループ](../README.ja.md#ループ-for)）。stream の値から一覧を組み立てる getter —— `get turns() { return [...this.saved, { ...this.live, text: this.answer }]; }` —— は、チャンクのたびに流れている行の新しいオブジェクトを返すので、その行の要素は中身ごと、トークンのたびに壊されて作り直されます（継ぎ目アプリ counter-assist: 91 トークンで 94 行を作り、コンソールには何も出ません）。行は状態の一覧に持ち、stream の値への `$watch` から、その行へパスで書いてください:

```javascript
$watch: {
  answer(text) {
    this[`turns.${this.turns.length - 1}.tail`] = text;   // パスで書く: 行は要素を保つ
  },
},
```

getter には `$listKeys` も効きません: `$listKeys` が行を保つのはそのパスに配列が代入されたときで、getter の一覧は代入されないからです（4.33（未リリース）から、list-keys アドオンがそれを言います: `[wcs/list-keys-getter]`）。

---

## ライフサイクル

```
(宣言)──parse──▶ idle ──start(connect)──▶ active ──正常終端──▶ done
                  ▲                        │  │
                  │                        │  └──throw/reject──▶ error
                  └──disconnect(abort)─────┤
                                           └──依存変化──▶ (abort → リセット → 再起動) active
```

- **eager 起動** — stream は `<wcs-state>` 要素の接続時、`$connectedCallback` の**完了後**に起動します（`args` がそこで仕込んだ初期値を読めるように）。まだすることの無い stream は起動しません: 4.33（未リリース）から、`args` が `null` を返すエントリは、別の値を返すまで `idle` のままで、もう一度 `null` にすると畳み込んだ値を保って止まります（[起動と停止](#起動と停止)）。
- **切断** — 全 stream が abort され、status は `idle` に戻ります。宣言は保持されます。
- **再接続** — `$connectedCallback` が再び実行された後、stream は **`initial` から**再起動します。「切断前の続きから」はありません。
- **状態オブジェクトの再セット**（初期化済みの要素への `setInitialState()`）— 旧 run は abort され、新しい状態には何も書き込まずに止まります。新しい宣言が読まれ、すべてのバインディングが新しい状態に適用し直され（新しい宣言に無くなった stream へのバインディングは `undefined` を読みます）、その後（接続中なら）新しい stream が起動します。二重起動はありません。
- **SSR** — 宣言は読まれ値プロパティは `initial` で実体化されますが、stream は**起動しません**。サーバー出力には `initial` が乗ります。`enable-ssr` ページのクライアント側では通常どおり起動します — stream はシリアライズ可能な状態ではなく、ランタイムの副作用だからです。

`$stream` 宣言が動く場所:

- **ルートの `<wcs-state>`** — 上のとおり動きます。stream はその要素の接続状態とともに生き、死にます。
- **volume**（`<wcs-state mount="…">`）— 拒否します: volume は接ぎ木されず、`console.error` が `$stream is not run in a volume — declare it on the root state.` と報告します。stream はルートの状態に宣言してください。
- **マウントされたコンポーネント**（`bind-component` で `state: …`）— 無視し、ルートの状態を指す `wcs/mount-dollar-declaration` 警告を 1 回出します。
- **DCC** — 定義の `<wcs-state>`（`data-wc-definition` ホストの中）はタグを定義するだけで、何も動かしません。各インスタンス内の `<wcs-state>` は通常のルートなので、stream はインスタンスごとに独立して起動・停止します。stream 名は DCC クラスのメンバーになり、`$bindables` に挙げられます。値が変わるたびに変更イベントが出ます。

---

## コンソールが言うこと

stream の失敗が届くのは `$streamError.<name>` だけで、それも `$streamStatus.<name>` も見せないページは、何も言わずに失敗していました。4.33（未リリース）から、`diagnostics` アドオン（`@wcstack/state` と `/auto` に含まれる）が stream ごとに 1 回警告します:

- `[wcs/stream-error-unobserved]` — stream が失敗し、`$streamError.<name>` も `$streamStatus.<name>` も、どのバインディングも getter も読んでいない。ページを離れる間は言いません。
- `[wcs/stream-source-shape]` — `source` が async iterable も `ReadableStream` も返さなかった: `Response`（その `body` を返す）、`undefined`（`return` の書き忘れ）。失敗を読んでいても言います: どの run もすぐに失敗するからです。
- `[wcs/stream-fold-in-place]` — fold が累積値をその場で変えて返した（[新しい値を返す](#新しい値を返すin-place-変異の禁止)）。
- `[wcs/stream-value-written]` — ページが実行中の stream の値を書いた（[値プロパティ](#値プロパティ)）。

README の [Stream](../README.ja.md#streamstream) 節に、ほかの規範と並べて載せています。

---

## スコープ外（第 1 段）

以下は明示的に非サポートです:

1. stream 名へのワイルドカード / ドット付きパス、および `args` 内でのワイルドカード読み（いずれもエラー）。
2. async な `fold`。
3. Observable（`subscribe` 型）source — async iterable への変換はユーザー責務。
4. 自動再接続 — 再試行 = 依存の叩き直し。
5. `lazy` オプション。まだすることの無い stream は、代わりに `args` から `null` を返します（4.33（未リリース）から。[起動と停止](#起動と停止)）。
6. バインディング / 構造ブロック単位の stream 生存期間 — stream は `<wcs-state>` 要素の接続状態とともに生き、死にます。
7. backpressure の保持（第 1 段の欠落ではなく恒久的な非目標）。

---

## 使用例

### LLM トークンの累積

有限のトークンストリームを文字列に累積します。入力欄が書くのは `draft` で、**Ask** がそれを `args` の読むキー `prompt` に写すので、次の質問を打っても応答には触りません —— 入力欄を `prompt` そのものに束ねると、1 文字ごとに応答を abort してリクエストを送ります。

```javascript
export default {
  draft: "",
  prompt: null,   // null: まだ何も尋ねていない。実行しない（4.33（未リリース）から）

  ask() { this.prompt = this.draft; },

  $stream: {
    answer: {
      args:    (state) => state.prompt,
      source:  (prompt, signal) => llmStream(prompt, signal),  // signal を尊重する async generator
      fold:    (acc, token) => acc + token,
      initial: "",
    },
  },

  get isStreaming() {
    return this["$streamStatus.answer"] === "active";
  },
};
```

```html
<input type="text" data-wcs="value: draft">
<button data-wcs="onclick: ask; disabled: isStreaming">Ask</button>
<pre data-wcs="textContent: answer"></pre>
<p data-wcs="textContent: $streamError.answer"></p>
```

### 最新値ティッカー

無限の価格フィードです。latest fold（既定）は常に値を 1 つだけ保持します — 構造的に有界です。`args` が無いため、一度起動して切断まで走り続けます。

```javascript
export default {
  $stream: {
    price: {
      source: (_args, signal) => priceStream(signal),  // 無限だが latest fold により有界
    },
  },
};
```

```html
<span data-wcs="textContent: price"></span>
<span data-wcs="textContent: $streamStatus.price"></span>
```

### fetch レスポンスボディのストリーミング

`response.body` は `ReadableStream` です。`TextDecoderStream` を通すとテキストチャンクになります。`signal` を `fetch` に渡すことでキャンセルが協調的になります — `url` を変更するとボディ受信中でもリクエストが abort され、新しいリクエストが始まります。渡さなくても、読み始めたボディは cancel されますが、応答が届く前の restart では古いリクエストが走り続けます。

```javascript
export default {
  url: "/api/report",

  $stream: {
    body: {
      args: (state) => state.url,
      source: async (url, signal) => {
        const res = await fetch(url, { signal });
        return res.body.pipeThrough(new TextDecoderStream());
      },
      fold:    (acc, text) => acc + text,
      initial: "",
    },
  },
};
```

```html
<pre data-wcs="textContent: body"></pre>
<p data-wcs="textContent: $streamStatus.body"></p>
```

イベント API（`EventSource`・`WebSocket`・DOM イベント）は、`start` で enqueue し `cancel` で資源を解放する `ReadableStream` に包んでください — 書き方は README の [Stream](../README.ja.md#streamstream) 節にあります。

---

## まとめ

| 概念 | 説明 |
|---|---|
| `$stream` | 宣言マップ: 非同期プロデューサー → fold → リアクティブプロパティ（`temporal` アドオン） |
| `source(args, signal)` | プロデューサーを返す。`AbortSignal` の尊重は MUST |
| `args(state)` | 同期の依存捕捉。ここでの読みが restart を駆動する。`null` = 実行しない（4.33（未リリース）から） |
| `fold(acc, chunk)` | 同期・新しい値を返す。既定は latest |
| `initial` | シード値。（再）起動のたびに値はこれにリセット |
| `$streamStatus.<name>` | `idle` / `active` / `done` / `error` — 読み取り専用 |
| `$streamError.<name>` | 直近のエラーまたは `null`。（再）起動で `null` にリセット |
| restart | 依存変化 → abort → `initial` リセット → 新 run（switchMap）。abort された run のチャンク・終端・エラーは捨てられる |
| 有界 fold | 無限ストリームでは MUST — backpressure は保持されない |
| ライフサイクル | `$connectedCallback` 後に eager 起動（`args` が `null` を返す間は起動しない） / 切断で abort / 再接続は `initial` から / SSR では起動しない / ルートの状態でだけ動く |
