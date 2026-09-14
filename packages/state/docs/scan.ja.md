# `$scan` — 時間軸方向の累積を宣言する

## これは何か

```javascript
export default {
  page: 1,

  $streams: {
    pageResult: { args: (s) => s.page, source: loadPage },
  },

  $scan: {
    feed: {
      from: "pageResult",
      initial: { items: [], pages: [] },
      fold: (feed, chunk) => {
        if (chunk?.kind !== "success" || feed.pages.includes(chunk.page)) return feed;
        return { items: feed.items.concat(chunk.items), pages: [...feed.pages, chunk.page] };
      },
    },
  },
};
```

```html
<template data-wcs="for: feed.items"><li data-wcs="textContent: .name"></li></template>
```

`$scan` は状態オブジェクト上の宣言マップです（`$streams`・`$watch` と同じ系統）。各エントリは **source**（state パスかイベントトークン）の出来事を `fold` で畳み、結果を**出力プロパティ**に置きます。

置き場所が必要だった理由は、既存の 2 つの宣言面がどちらもこの値を持てないからです。

- `$streams.fold` は **1 回の run の内側**を畳みます。依存の変化で restart すると値は `initial` へ戻ります。
- `$watch` は**値を所有しません**。ハンドラの中で `this.items = this.items.concat(...)` と書けば積めますが、その値の持ち主・発火の単位・reset の条件はどこにも宣言されません。

`$scan` が意図的に**やらないこと**:

- **汎用のストリーム代数ではありません。** `merge` / `filter` / `debounce` のようなオペレーターは持ちません。1 つの出力に source は 1 つです。
- **getter の再評価を畳みません。** getter を source にする宣言は raise します（[getter を畳まない](#getter-を畳まない)）。
- **backpressure はありません。** 無限の source は有界な値に畳んでください（[有界 fold](#有界-fold)）。

---

## 宣言リファレンス

```javascript
$scan: {
  feed: {
    from: "pageResult",          // state パス（on と排他）
    initial: { items: [] },      // 必須
    fold: (acc, cur, prev) => …, // 必須
    resetOn: ["pageSize"],       // 任意
  },
  log: {
    on: "message",               // $eventTokens に宣言したトークン名（from と排他）
    initial: [],
    fold: (acc, event) => …,
  },
},
```

### 各フィールドの契約

| フィールド | 型 | 必須 | 契約 |
|---|---|---|---|
| `from` | `string` | `on` と排他で 1 つ | state パス。ワイルドカード可（行ごとに畳む）。`$` 始まり・`@`・空セグメント・getter・getter の配下（`$recursion` の `**` getter の展開形 `nodes.*.total` を含む）・getter の無い setter とその配下・自分の出力とその子孫は不可。 |
| `on` | `string` | `from` と排他で 1 つ | `$eventTokens` に宣言したイベントトークン名。 |
| `initial` | any | ✔ | 実体化の種と `resetOn` の戻り先。`undefined` を明示してもよい。plain なデータは出力に置くたびに複製するので、その plain な部分の子パスへ書いても宣言の `initial` は変わらない。plain なデータとは、プロトタイプが `Array.prototype` / `Object.prototype` / `null` で、凍結されておらず、自前のプロパティがすべて列挙できる文字列キーのデータプロパティ（配列は添字と `length` だけ）の配列とオブジェクト。それ以外（getter / setter・Symbol キー・列挙できないプロパティ・配列の追加プロパティ・Array のサブクラス・凍結された値・関数・クラスのインスタンス・`Map` / `Set`・`Date`・DOM ノード）は、`initial` 自身でもその内側でも参照のまま置き、getter は実行しない。参照のまま置いた値の中へ書くと宣言の `initial` も書き換わり、reset でも戻らない。凍結された値へ書くと throw する。累積と reset の対象にする値は plain なデータに保つこと。 |
| `fold` | function | ✔ | [fold の契約](#fold-の契約)。 |
| `resetOn` | `string[]` | — | [resetOn](#reseton)。 |

### fold の引数

| source | 引数 |
|---|---|
| `from` | `(acc, cur, prev, ...indexes)` — `cur` はそのバッチの確定値、`prev` はバッチ開始時点の値（`$watch` と同じ台帳。[`prev` が `undefined` になるとき](#prev-が-undefined-になるとき)）、`indexes` はワイルドカードのときの行の添字 |
| `on` | `(acc, event, ...indexes)` — `event` は要素が dispatch したイベント、`indexes` は要素のループ文脈の添字 |

#### `prev` が `undefined` になるとき

`prev` は、そのパス自身へプリミティブ（`null` を含む）を書いたときに記録され、書く前の値をそのまま持ちます（書く前の値はオブジェクトでもかまいません）。次のときは `undefined` です。

- 書く値が参照型（オブジェクト・配列）のとき、`$postUpdate` 経由の着地、`config.sameValueGuard` をオフにした構成（`$watch` と同じ）。
- パス自身は書かれていないとき: 親オブジェクトの丸ごと書き（`state.user = { … }` で載る `user.name`）や、差し替えたリストの行。
- 前のバッチの drain の最中に書かれたとき: バインディングの適用中（`$updatedCallback` や、バインディングの適用で要素が同期に dispatch したイベントの `$on` ハンドラ）か、`$scan` / `$watch` のリスナーの中（`$watch` ハンドラや、別の scan が書いた出力）。台帳はそのリスナーの終わりに消え、書き込みが載るバッチの drain より前だからです。同じ drain でそのリスナーより後に走るリスナーの書き込み（`$streams` の restart が書く `initial`）は `prev` を持ちます。`from` の scan の出力を `from` にすると、`prev` は常に `undefined` です。`on` の scan はイベントの中で出力を書き、それはバインディングの適用中でなければ drain の外なので、その出力を `from` にした scan は通常の書き込みと同じく `prev` を受けます。

`$streams` の chunk は、プリミティブなら `prev` を持ち、オブジェクトなら `undefined` です。restart が書くプリミティブの `initial` への戻しは、直前の chunk がオブジェクトでも、それを `prev` に持ちます。

### 宣言時の検査（raise）

次の違反は `_state` のセット時に `[wcs/scan-declaration-invalid]` / `[wcs/scan-source-computed]` で raise します。`from` / `resetOn` の `**` は、`$recursion` の有無を問わず `[wcs/recursion-unsupported]` で raise します。検査は宣言の値だけを読むので、throw した再セットは要素を旧世代のまま残します。

- `$scan` がオブジェクトでない。エントリがオブジェクトでない（配列はオブジェクトとみなさない）。
- 出力名が空・`.` / `*` を含む・`$` 始まり・`Object.prototype` の継承名。getter・setter・メソッド（関数値のプロパティ）・`$streams` 名と衝突する。
- `from` と `on` がどちらも無い、または両方ある。`on` が `$eventTokens` に無い。
- `from` のパスの形が壊れている。`from` が getter かその配下（`$recursion` の `**` getter の展開形 — `get "nodes.**.total"()` に対する `nodes.*.total` とその値の内側 — を含む。`wcs/scan-source-computed`）。`from` が getter の無い setter かその配下（読むと常に `undefined`）。`from` が自分の出力かその子孫。
- `initial` が無い。`fold` が関数でない。
- `resetOn` が文字列の配列でない。要素がワイルドカード・getter（`wcs/scan-source-computed`）・自分の `from` かその配下・いずれかの scan 出力（またはその子孫）。
- scan 同士が `from` の根を辿って循環する（`a` の `from` が `b` の出力、`b` の `from` が `a` の出力、…）。

---

## 発火

### `from` — 変化の scan

- **発火点**は updater の drain の終わりです。バッチに載った絶対アドレス 1 つにつき fold を 1 回呼びます。
- **同じ job 内の複数の書き込み**は 1 回に畳まれます（`cur` は最後の値、`prev` はバッチ開始時点の値）。1 件ずつ畳みたい出来事は `on` で受けてください。
- **ワイルドカードの `from`** は行ごとに畳みます。同じバッチに複数の行が載ったら、添字の昇順に `acc` を連鎖させ、出力へは最後に 1 回だけ書きます。行のアドレスが載るには、そのリストが `for` で描画されているか `$listKeys` が宣言されている必要があります（`$watch` と同じ条件）。行の着地は、drain の時点のリストの位置 1 つにつき 1 回に絞ります。位置が無くなった行（同じ job で行を書いてからリストを短くした）は畳まず、同じ位置にいまそこに居る行とリストから外れた行が並んだら、いまそこに居る行だけを畳みます。外れた行のアドレスしか無い位置は、その位置のいまの値を読んで畳みます（[行の着地の既知の穴](#行の着地の既知の穴)）。
- **同値の primitive の書き込み**は same-value guard がバッチに載せないので、実質「変化したとき」だけ畳みます。`config.sameValueGuard` を切った構成はサポートしません。
- **親オブジェクトの丸ごと書き**（`state.user = { … }`）でも子の `from`（`user.name`）が載ります。このとき `prev` は `undefined` です。
- **要素の出力プロパティ**（`message` など）を `from` にすると、バインド確立時の初期同期も 1 回の書き込みとして畳みます。要素の出来事は `on` で受けてください。
- **別の scan の出力を `from` にする**と、その出力を着地した値のまま、着地 1 回につき 1 回畳みます（宣言順に依りません）。drain は全 scan の次の値を先に決めてから書くので、この drain で scan が書いた値は、それを読む scan には次のバッチで届きます。

#### 行の着地の既知の穴

次の 2 つの形では「変わった行 1 つにつき 1 回」になりません。`$watch` の着地も同じです。どちらも `scan.from.test.ts` の `DEFECT(#274)` テストが現状を固定し、[#274](https://github.com/wcstack/wcstack/issues/274) で追います。

- **入れ子のリストを長い配列に置き換える。** 1 行のリストに `state.$resolve("groups.*.items", [0], [a, b])` と書くと、着地するのは位置 `0.0` だけで、`0.1` の行は一度も着地せず畳まれません。書き込みの依存展開が、新しい配列をキャッシュへ確定する前にキャッシュから入れ子のリストを読み、「変化なし」として旧配列の行だけを展開するためです。外側のリストの差し替え（`state.groups = [...]`）では起きません。
- **行を書いた同じ job で、その行をリストの途中から取り除く。** `[a, b, c]` で `b` を書いてから `state.items = [a, c]` とすると、位置 `1` で、変わっていない `c` の値を `b` の `prev` で 1 回畳みます。その位置へ移ってきた行は着地せず、外れた行しか無い位置は、同じ長さの入れ子の置換（旧配列の行で着地する）を落とさないために添字で読んで畳むためです。

機構間の順序は固定です。

| 順序 | 機構 |
|---|---|
| 1 | `$updatedCallback`（バインディング適用の内側） |
| 2 | `$scan`（`from` / `resetOn`）— 畳んで出力を書く |
| 3 | `$watch` |
| 4 | `$streams` の依存駆動 restart |

`<wcs-view-transition>` が `state` を受け付けている間は、バインディング適用がフレームへ移るので `$scan` → `$watch` → `$streams` restart → `$updatedCallback` になります（[timing-and-firing-contract.ja.md](../../../docs/timing-and-firing-contract.ja.md) §4.3）。

scan の書き込みは次のバッチに乗ります。そのため、出力を見る `$watch` は次のバッチで発火し、`prev` はふつう `undefined` です（`$watch` ハンドラの書き込みを別の `$watch` で見たときと同じ）。`$watch` は scan の書き込みの後に走るので、同じ drain の `$watch` ハンドラは畳んだ後の出力を読み、ハンドラが出力へ書いた値はそのまま残ります。

1 つだけ形の違う連鎖があります。出力の着地が drain される前に `from` の source がもう一度書かれる（scan の書き込みの前後を問いません。同じ drain のバインディング適用中の `$updatedCallback` や、そこで同期に dispatch されたイベントの `$on` ハンドラ、同じ drain の `$watch` ハンドラ、次の drain より前に走る microtask が書く）と、出力の着地と source の新しい着地が同じバッチに載ります。そのバッチの scan は `$watch` の発火より前に出力をもう一度書くので、出力を見る `$watch` は `prev` に着地した値を受け、`cur` に 1 段先の値を見て、次のバッチで同じ値でもう一度（`prev` は `undefined`）発火することがあります。オブジェクトの出力は `prev` が常に `undefined` なので、同じ値の 2 回目だけが見えます。バインディングの適用中（scan の書き込みより前）に書かれた形では、fold もバッチの確定値を 2 回受け取ります。途中の値は一度も畳まれないので、合計がずれることがあります。これはバッチの確定値を読む性質（`$watch` も同じ）によるもので、`$scan` 固有ではありません。この連鎖を組むなら、出力を見る `$watch` を同じ値の重複に耐える形（冪等キーや、直前に処理した値との比較）にしてください。ユーザー操作で累積を消すなら、nonce を `resetOn` に読ませてください。

### `on` — 出来事の scan

- `on` の scan はイベントトークンの subscriber です。要素がイベントを dispatch すると、その場で同期に fold して書きます。
- **イベント 1 回につき fold 1 回**です。同じ task に 2 回 dispatch されたら 2 回畳みます。
- 同じトークンの **`$on` ハンドラより先**に呼ばれます。`$on` ハンドラは畳んだ後の出力を読めます。
- 要素が `for` の中にあれば、ループ文脈の添字が `indexes` に渡ります。

### `$streams` との交差

- **restart が勝ちます。** `from` の根が `$streams` 名で、同じバッチにその stream の restart 依存が載っていたら畳みません。着地した chunk は、同じ drain で abort される run のものだからです（[`$streams` の設計書](../../../docs/state-streams-design.md) §3-2 の「同一 drain に chunk と restart トリガが同居したら restart が勝つ」と同じ規則）。
- **自己ループは raise します。** `from` の根が `$streams` 名である scan について、その stream の `args` が scan 出力から辿れるパス（出力そのもの・出力から導出した getter・その出力を畳む別の scan の出力、…）を読むと、起動と restart のたびに `[wcs/scan-feedback-loop]` を raise します。起動時は状態要素の接続の中で stream の開始が throw し、正規化されません。stream は `idle` のまま、`$streamError.<name>` にも書かれず、`connectedCallbackPromise` は解決しません（`args` が自分の stream を読んだときと同じ）。依存駆動 restart では `$streamError.<name>` に正規化されます。

```javascript
// ✗ ページが着地するたびに page が進み、sentinel を経由せずに stream が restart し続ける
get page() { return Math.floor(this.feed.items.length / this.pageSize) + 1; },
$streams: { pageResult: { args: (s) => s.page, source: loadPage } },
$scan: { feed: { from: "pageResult", … } },

// ✓ カーソルは plain property にして、イベントから進める
page: 1,
$on: { sentinelChanged: (state) => { state.page = Math.floor(state.feed.items.length / state.pageSize) + 1; } },
```

---

## fold の契約

- **同期**で、**新しい値を返す**こと。`acc` を in-place で変異させると、same-value guard とリスト差分が変化を検出できません。
- **`this` は渡しません。** 必要な値は source の値に載せてください（例: stream の chunk に `pageSize` を載せる）。
- **`acc` と同一参照を返すと書き込みません。** 何も起きなかった出来事（progress の chunk など）は `return acc` で素通しできます。
- **throw・Promise の戻り値・読めない値**はコンソールと DevTools（`state:watch-error`・`path: "$scan.<出力名>"`。`phase` は読みが `"evaluate"`、fold が `"fold"`、出力の書き込みが `"write"`）に報告し、書き込みません。ワイルドカードの `from` の 1 行が読めないときは、その行だけを飛ばし、同じバッチの残りの行は畳みます。他の scan・`$watch`・`$streams` restart・同じトークンの `$on` は続行します。

### 着地ごとに 1 回（ページごとではない）

runtime が保証するのは「着地 1 回につき fold 1 回」です。同じページが 2 回着地する経路はあります。

- `done` になったページを `retryNonce` などで再実行した。
- 状態要素を DOM から外して付け直し、stream が現在の `page` で再起動した。

ページごとに 1 回にしたいなら、fold に冪等キーを持たせてください（冒頭の例の `pages`）。

### getter を畳まない

getter は入力のどれかが変わるたびに再評価されます。getter を source にすると、畳むのは出来事ではなく再評価の回数になり、他の依存の変化で同じ値を二重に積みます。宣言時の検査は `from` / `resetOn` とその祖先パスの getter を拒否し、`from` に書いた `$recursion` の `**` getter の展開形（`get "nodes.**.total"()` に対する `nodes.*.total` とその値の内側）も拒否します。接ぎ木（ボリュームのアクセサ登録）で宣言の後に getter になった `from` は、発火時に 1 回だけ `[wcs/scan-source-computed]` を報告し、その scan の fold を止めます。`resetOn` は getter を読まないので、reset は引き続き出力を `initial` に戻します。

### 有界 fold

backpressure はありません。無限・長寿命の source を生のまま積むとメモリが無制限に伸びます。

```javascript
fold: (log, event) => [...log.slice(-99), event.detail], // ✓ 直近 100 件
fold: (count) => count + 1,                              // ✓ 件数
fold: (log, event) => [...log, event.detail],            // ✗ 無限の source では無制限
```

---

## resetOn

- `resetOn` のパスのどれかが書かれたら、出力を `initial` に戻します。
  - **`from` の scan** は drain の終わりに戻し、**同じバッチの fold は行いません**（reset が勝つ）。
  - **`on` の scan** は書き込みの時点から reset を見ます。書き込みより後に来たイベント — 同じジョブの後続や、その書き込みを binding に適用する最中に要素が同期に dispatch したもの — は `initial` から畳みます。間にイベントが無ければ、drain の終わりに `initial` へ戻します。保留した reset を使い切るのは、そのイベントの出力の書き込みが通ったときです。fold が throw した・Promise を返した・書き込みが失敗したときは、drain の終わりに `initial` へ戻します。その drain がバッチの scan を発火しない（drain の前に状態要素が切断された・`$watch` の連鎖深さの上限で打ち切られた）ときは、`from` の scan と同じく reset を捨てます。ただし同じ `resetOn` のパスが次のバッチ向けに書き直されていれば、保留はそのバッチの drain が使います。`_state` の再セットをまたいで保留を引き継ぐのは、書き込みがまだキューに残っている場合だけです（新しい宣言の同じ出力名の `on` の scan が、書き込んだパスをまだ `resetOn` に持っていれば引き継ぎます）。その書き込みのバインディング適用中の再セット（`$updatedCallback` や、バインディングの適用中に走る `$on` ハンドラから。その drain の scan より前）、再セットで新しく足した `resetOn` のパス、`from` から `on` への変更では引き継がず、`on` の scan は書き込み済みの値を reset しません（`from` の scan は reset します）。同じ drain のそれより後の再セットでは両者は揃います。`$watch` ハンドラからの再セットは scan の書き込みの後なので両方 reset し、fold からの再セットは両方 reset しません（scan を発火しない drain は reset を捨てる規則）。確実に揃えたいときは、再セットの後で `resetOn` のパスへもう一度書き込んでください（nonce が確実です）。
- 出力が既に `initial` と同じ値なら（plain なデータは中身で、それ以外は同一性で比べる）書き込みません。違えば `initial` の複製を書くので、出力が `initial` の間に plain な部分の子パスへ書いた値（`$watch` ハンドラの注記など）も reset で消えます（参照のまま置いた値の中へ書いた値は消えません。上の `initial` の行を参照）（`$streams` の `initial` は従来どおり参照のまま置きます）。値が変わらない reset は書き込まないので、出力の `$watch` は発火しません。reset のたびに反応したいときは、`resetOn` のパス（nonce）を `$watch` してください。
- 戻すのは**出力だけ**です。協調するカーソル（`page` など）は戻しません。カーソルも巻き戻す必要があるなら、それは `$watch` などの副作用として書いてください。
- 発火はアドレス駆動で、値は比較しません（`$streams` の `args` と同じ）。primitive は same-value guard により実質変化したときだけ載ります。オブジェクトのパスは同じ内容の再代入でも reset します。オブジェクトのパスは、そのオブジェクト自身が書かれたとき（`state.filter = { … }`）だけ reset し、子への書き込み（`state["filter.text"] = "b"`）では reset しません。子の変化で戻したいなら、葉のパスを並べる（`resetOn: ["filter.text", "filter.tag"]`）か nonce を使ってください。状態要素が切断されている間の書き込みは reset しません。
- `resetOn` は `from` の**祖先**にできます。`from: "items.*.qty"` に `resetOn: ["items"]` なら、行の書き込みは畳み、リストを丸ごと差し替えたら作り直します（新しいリストの行は畳みません — reset が勝つ）。`from` の**配下**は raise します。`from` を書くたびに同じバッチに載り、reset が毎回勝つからです。
- ユーザー操作で消したいときは、nonce を `resetOn` に読ませます。

```javascript
clearNonce: 0,
clearLog() { this.clearNonce = this.clearNonce + 1; },
$scan: { log: { on: "message", initial: [], fold: …, resetOn: ["clearNonce"] } },
```

---

## ライフサイクル

| 場面 | 振る舞い |
|---|---|
| `_state` のセット | 宣言を検査し、出力が無ければ `initial` で実体化する（plain な配列とオブジェクトは複製）。既に値があれば保持する（同じオブジェクトの再セット・SSR ハイドレーションで累積を失わない）。fold が関数を返す出力も同じで、実体化・fold・reset がその出力に置いた関数値はメソッド衝突とみなさない（runtime（実体化・fold・reset）が置いていない関数値はすべて raise する。新しいオブジェクトの同名の本物のメソッドや、ハンドラ・メソッド・`$resolve` / `$setAll`・state への直接の書き込みで出力へ書いた関数）。 |
| 接続 | `from` / `resetOn` を持つ scan は drain の発火対象に載る。`on` の scan はセット時に購読済み。 |
| 切断 | `from` / `resetOn` は発火しなくなる（registry は保持）。切断中の出来事は畳まない。出力は保持する。`$watch` ハンドラが要素を切断しても、接続中に着地した分は残る（scan の書き込みは `$watch` の発火より前）。 |
| 再接続 | `from` / `resetOn` は再び発火する。`on` は `$on` と同じく購読が戻らない既知の穴がある（[#273](https://github.com/wcstack/wcstack/issues/273)）。 |
| 新しい宣言での再セット | registry と購読を作り直す。旧宣言の scan は発火しない。宣言が消えたら何も発火しない。 |
| SSR（`inSsr()`） | 宣言の検査と出力の実体化だけを行い、`from` は畳まない。 |
| ボリューム（`mount=`） | 宣言を接ぎ木前に拒否する。 |
| マウントされた `bind-component` | 宣言を実行せず、1 回だけ warn する（ルートに宣言する）。 |

---

## 使い分け

| やりたいこと | 置き場所 |
|---|---|
| 現在の値から計算する（空間軸の導出） | getter（`$getAll(...).reduce` / ワイルドカード getter） |
| 1 回の run の内側を畳む（restart で捨ててよい） | `$streams` の `fold` |
| run・イベントを跨いで積み上げる（時間軸の累積） | `$scan` |
| 変化に反応して副作用を起こす（command の発射・外部への書き込み） | `$watch` / `$on` |

---

## 使用例

### stream のページを feed に積む

`examples/state-intersect-scroll` の形です。ページ単位の run は `$streams`、run を跨ぐ feed は `$scan`、feed が伸びた後の sentinel の再武装は `$watch` が担います。

```javascript
$scan: {
  feed: {
    from: "pageResult",
    initial: { items: [], pages: [], noMore: false },
    fold: (feed, chunk) => {
      if (chunk?.kind !== "success") return feed;
      if (feed.pages.includes(chunk.page)) return feed;
      return {
        items: feed.items.concat(chunk.items),
        pages: [...feed.pages, chunk.page],
        noMore: chunk.items.length < chunk.pageSize,
      };
    },
  },
},
$watch: {
  feed(feed) {
    if (!feed.noMore) this.$command.rearm.emit();
  },
},
```

### SSE のメッセージを直近 N 件だけ残し、接続先が変わったら消す

```javascript
host: "a.example",
$eventTokens: ["message"],
$scan: {
  samples: { on: "message", initial: [], fold: (s, e) => [...s.slice(-19), e.detail.data], resetOn: ["host"] },
  count: { on: "message", initial: 0, fold: (n) => n + 1, resetOn: ["host"] },
},
```

### 送信したリクエストを数える

`loading` は状態のプロパティなので、`from` にすると同値の書き込み（先行リクエストを取り消して次を出した瞬間の true → true）を数えません。出来事として受けます。

```javascript
$eventTokens: ["requestStarted"],
$scan: {
  requestCount: { on: "requestStarted", initial: 0, fold: (n, e) => (e.detail === true ? n + 1 : n) },
},
```

```html
<wcs-fetch data-wcs="eventToken.loading: requestStarted"></wcs-fetch>
```

---

## まとめ

| 概念 | 説明 |
|---|---|
| `$scan` | 宣言マップ: source の出来事 → fold → ランタイム所有の出力 |
| `from` | state パスの変化を drain の終わりに畳む（バッチに載ったアドレス 1 つにつき 1 回） |
| `on` | イベントトークンの出来事を同期に畳む（イベント 1 回につき 1 回・`$on` より先） |
| `fold` | 同期・`this` 無し・新しい値を返す。同一参照なら書かない |
| `initial` | 必須。実体化の種と `resetOn` の戻り先 |
| `resetOn` | 書かれたら出力を `initial` に戻す（`from`: そのバッチの fold は行わない／`on`: 後のイベントは `initial` から畳む） |
| getter | source にしない（宣言時に raise） |
| `$streams` との交差 | restart が勝つ。自分の出力から args を導出すると raise |
| 冪等性 | 着地ごとに 1 回。ページごとに 1 回にするなら fold にキーを持たせる |
| 寿命 | 出力は restart・再接続・同じオブジェクトの再セットを跨いで残る |

設計の決定レコード: [docs/state-scan-design.md](../../../docs/state-scan-design.md)。
