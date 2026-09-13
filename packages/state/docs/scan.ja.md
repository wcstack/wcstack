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
| `from` | `string` | `on` と排他で 1 つ | state パス。ワイルドカード可（行ごとに畳む）。`$` 始まり・`@`・空セグメント・getter・getter の配下・自分の出力とその子孫は不可。 |
| `on` | `string` | `from` と排他で 1 つ | `$eventTokens` に宣言したイベントトークン名。 |
| `initial` | any | ✔ | 実体化の種と `resetOn` の戻り先。`undefined` を明示してもよい。 |
| `fold` | function | ✔ | [fold の契約](#fold-の契約)。 |
| `resetOn` | `string[]` | — | [resetOn](#reseton)。 |

### fold の引数

| source | 引数 |
|---|---|
| `from` | `(acc, cur, prev, ...indexes)` — `cur` はそのバッチの確定値、`prev` はバッチ開始時点の値（スカラのときだけ意味を持つ。`$watch` と同じ台帳）、`indexes` はワイルドカードのときの行の添字 |
| `on` | `(acc, event, ...indexes)` — `event` は要素が dispatch したイベント、`indexes` は要素のループ文脈の添字 |

### 宣言時の検査（raise）

次の違反は `_state` のセット時に `[wcs/scan-declaration-invalid]` / `[wcs/scan-source-computed]` で raise します。検査は宣言の値だけを読むので、throw した再セットは要素を旧世代のまま残します。

- `$scan` がオブジェクトでない。エントリがオブジェクトでない。
- 出力名が空・`.` / `*` を含む・`$` 始まり・`Object.prototype` の継承名。getter・setter・`$streams` 名と衝突する。
- `from` と `on` がどちらも無い、または両方ある。`on` が `$eventTokens` に無い。
- `from` のパスの形が壊れている。`from` が getter かその配下（`wcs/scan-source-computed`）。`from` が自分の出力かその子孫。
- `initial` が無い。`fold` が関数でない。
- `resetOn` が文字列の配列でない。要素がワイルドカード・getter（`wcs/scan-source-computed`）・自分の `from` かその配下・いずれかの scan 出力（またはその子孫）。
- scan 同士が `from` の根を辿って循環する（`a` の `from` が `b` の出力、`b` の `from` が `a` の出力、…）。

---

## 発火

### `from` — 変化の scan

- **発火点**は updater の drain の終わりです。バッチに載った絶対アドレス 1 つにつき fold を 1 回呼びます。
- **同じ job 内の複数の書き込み**は 1 回に畳まれます（`cur` は最後の値、`prev` はバッチ開始時点の値）。1 件ずつ畳みたい出来事は `on` で受けてください。
- **ワイルドカードの `from`** は行ごとに畳みます。同じバッチに複数の行が載ったら、添字の昇順に `acc` を連鎖させ、出力へは最後に 1 回だけ書きます。行のアドレスが載るには、そのリストが `for` で描画されているか `$listKeys` が宣言されている必要があります（`$watch` と同じ条件）。
- **同値の primitive の書き込み**は same-value guard がバッチに載せないので、実質「変化したとき」だけ畳みます。`config.sameValueGuard` を切った構成はサポートしません。
- **親オブジェクトの丸ごと書き**（`state.user = { … }`）でも子の `from`（`user.name`）が載ります。このとき `prev` は `undefined` です。
- **要素の出力プロパティ**（`message` など）を `from` にすると、バインド確立時の初期同期も 1 回の書き込みとして畳みます。要素の出来事は `on` で受けてください。
- **別の scan の出力を `from` にする**と、その出力を着地した値のまま、着地 1 回につき 1 回畳みます（宣言順に依りません）。drain は全 scan の次の値を先に決めてから書くので、この drain で scan が書いた値は、それを読む scan には次のバッチで届きます。

機構間の順序は固定です。

| 順序 | 機構 |
|---|---|
| 1 | `$updatedCallback`（バインディング適用の内側） |
| 2 | `$scan`（`from` / `resetOn`） |
| 3 | `$watch` |
| 4 | `$streams` の依存駆動 restart |

`<wcs-view-transition>` が `state` を受け付けている間は、バインディング適用がフレームへ移るので `$scan` → `$watch` → `$streams` restart → `$updatedCallback` になります（[timing-and-firing-contract.ja.md](../../../docs/timing-and-firing-contract.ja.md) §4.3）。

scan の書き込みは次のバッチに乗ります。そのため、出力を見る `$watch` は次のバッチで発火し、`prev` は常に `undefined` です（`$watch` ハンドラの書き込みを別の `$watch` で見たときと同じ）。

### `on` — 出来事の scan

- `on` の scan はイベントトークンの subscriber です。要素がイベントを dispatch すると、その場で同期に fold して書きます。
- **イベント 1 回につき fold 1 回**です。同じ task に 2 回 dispatch されたら 2 回畳みます。
- 同じトークンの **`$on` ハンドラより先**に呼ばれます。`$on` ハンドラは畳んだ後の出力を読めます。
- 要素が `for` の中にあれば、ループ文脈の添字が `indexes` に渡ります。

### `$streams` との交差

- **restart が勝ちます。** `from` の根が `$streams` 名で、同じバッチにその stream の restart 依存が載っていたら畳みません。着地した chunk は、同じ drain で abort される run のものだからです（[streams.ja.md](./streams.ja.md) の「同一 drain に chunk と restart トリガが同居したら restart が勝つ」と同じ規則）。
- **自己ループは raise します。** `from` の根が `$streams` 名である scan について、その stream の `args` が scan 出力から依存グラフで辿れるパス（出力そのもの・出力から導出した getter）を読むと、起動と restart のたびに `[wcs/scan-feedback-loop]` を raise します。起動時は例外がそのまま出て、依存駆動 restart では `$streamError.<name>` に正規化されます。

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
- **throw と Promise の戻り値**はコンソールと DevTools（`state:watch-error`・`phase: "fold"`・`path: "$scan.<出力名>"`）に報告し、書き込みません。他の scan・`$watch`・`$streams` restart・同じトークンの `$on` は続行します。

### 着地ごとに 1 回（ページごとではない）

runtime が保証するのは「着地 1 回につき fold 1 回」です。同じページが 2 回着地する経路はあります。

- `done` になったページを `retryNonce` などで再実行した。
- 状態要素を DOM から外して付け直し、stream が現在の `page` で再起動した。

ページごとに 1 回にしたいなら、fold に冪等キーを持たせてください（冒頭の例の `pages`）。

### getter を畳まない

getter は入力のどれかが変わるたびに再評価されます。getter を source にすると、畳むのは出来事ではなく再評価の回数になり、他の依存の変化で同じ値を二重に積みます。宣言時の検査は `from` / `resetOn` とその祖先パスの getter を拒否します。接ぎ木（ボリュームのアクセサ登録）で宣言の後に getter になった `from` は、発火時に 1 回だけ `[wcs/scan-source-computed]` を報告してその scan を止めます。

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
  - **`on` の scan** は書き込みの時点から reset を見ます。書き込みより後に来たイベント — 同じジョブの後続や、その書き込みを binding に適用する最中に要素が同期に dispatch したもの — は `initial` から畳みます。間にイベントが無ければ、drain の終わりに `initial` へ戻します。
- 出力が既に `initial` と同一参照なら書き込みません。
- 戻すのは**出力だけ**です。協調するカーソル（`page` など）は戻しません。カーソルも巻き戻す必要があるなら、それは `$watch` などの副作用として書いてください。
- 発火はアドレス駆動で、値は比較しません（`$streams` の `args` と同じ）。primitive は same-value guard により実質変化したときだけ載ります。オブジェクトのパスは同じ内容の再代入でも reset します。状態要素が切断されている間の書き込みは reset しません。
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
| `_state` のセット | 宣言を検査し、出力が無ければ `initial` で実体化する。既に値があれば保持する（同じオブジェクトの再セット・SSR ハイドレーションで累積を失わない）。 |
| 接続 | `from` / `resetOn` を持つ scan は drain の発火対象に載る。`on` の scan はセット時に購読済み。 |
| 切断 | `from` / `resetOn` は発火しなくなる（registry は保持）。切断中の出来事は畳まない。出力は保持する。 |
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
