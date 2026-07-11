# `$streams` — 非同期プロデューサーを畳み込んでリアクティブプロパティにする

## これは何か

次の状態定義を見てください。

```javascript
export default {
  prompt: "",

  $streams: {
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
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>
<p data-wcs="textContent: $streamError.tokens"></p>
```

`$streams` は状態オブジェクト上の宣言マップです — `$commandTokens`・`$eventTokens`・`$on` と同じ系統に属します。各エントリは**非同期プロデューサー**（async iterable / async generator / `ReadableStream`）を単一の**リアクティブプロパティ**に接続します。プロデューサーが産出する各チャンクは `fold` を通り、畳み込み結果が `state.tokens` の新しい値になります — 通常の更新サイクルを流れるため、バインディング・computed getter・`$updatedCallback` のすべてが他のプロパティと同じように反応します。

`$streams` が意図的に**やらないこと**が 2 つあります:

- **汎用ストリームパイプラインではありません**。オペレーターも tee も transform もなく、「消費して、畳んで、代入する」だけです。
- **backpressure を保持しません**。需要はプロデューサーに逆流しません。これは明示的な非目標であり、重要な帰結が 1 つあります: [fold は有界でなければなりません](#有界-foldmust)。

---

## 宣言リファレンス

### `$streams` マップ

`$streams` の各キーはフラットなプロパティ名、各値は stream 定義です。

```javascript
export default {
  $streams: {
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
| `source` | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<同>` | ✔ | **`AbortSignal` を必ず尊重すること**（協調キャンセル契約）。restart・破棄はこの signal で駆動されます — signal を無視する source は確実にキャンセルできません。プロデューサーの `Promise` を返しても構いません。`Symbol.asyncIterator` を持たない `ReadableStream` は `getReader()` フォールバックで消費されます。それ以外の戻り値は `TypeError` となり error 状態に現れます。 |
| `args` | `(state) => any` | — | **同期・純粋関数**。読み取り専用の state ビューを受け取り、ここで読んだパスすべてが依存として捕捉されます（[依存駆動 restart](#依存駆動-restart) 参照）。省略時は依存なし — 一度起動したら restart しません。戻り値はそのまま `source` の第 1 引数になります（複数値はオブジェクト/配列で束ねる）。`Promise` を返すとエラーです。 |
| `fold` | `(acc, chunk) => next` | — | **同期関数**。省略時は latest（チャンクで値を置換）。**新しい値を返すこと** — `acc` の in-place 変異は非サポートです（[新しい値を返す](#新しい値を返すin-place-変異の禁止) 参照）。fold が throw すると stream は error 状態になり、プロデューサーは abort されます。 |
| `initial` | any | fold 指定時 ✔ | 初期値。起動・restart のたびにプロパティの値はこれにリセットされます。 |

### バリデーション

状態のセット時（宣言のパース時）に、違反はエラーを送出します:

- `$streams` は stream 名から定義へのマップとなるオブジェクトであること。
- 各エントリ名は**フラットなプロパティ名**であること: 空文字でない・`.` を含まない・`*` を含まない・`$` で始まらない（予約名前空間）。
- エントリ名は `Object.prototype` の継承名（`__proto__`・`constructor`・`toString`・`hasOwnProperty` など）でないこと。これらはランタイムの own プロパティ前提を破ります（特に `__proto__` は起動時に state の prototype を差し替えてしまいます）。なおオブジェクトリテラルの `__proto__:` キーは prototype 指定構文で own key にならないため、そのようなエントリはエラーにならず黙って無視されます。
- エントリ名は state に宣言済みの getter / setter と衝突しないこと。
- 各エントリはオブジェクト（`{ args?, source, fold?, initial? }`）であること。
- `source` は関数であること。`fold` は（あれば）関数であること。`fold` があるのに `initial` が無ければエラー（reduce にはシード値が必要）。
- `args` は（あれば）関数であること。

起動 / restart 時（`args` 評価時）に検出される違反:

- `args` が `Promise` を返した（同期契約違反）。
- `args` が stream 自身 — `<name>` / `$streamStatus.<name>` / `$streamError.<name>` — を読んだ（自己依存は自分の書き込みで永遠に restart し続けるため）。
- `args` がワイルドカードを含むパスを読んだ（`$getAll` 経由も同様）— ワイルドカード依存は現時点でスコープ外です。

違反（および `args` が投げたユーザー例外）の現れ方は経路によって異なります:

- **eager 起動**（connect 時・接続中の state 再セット時）— エラーはそのまま送出されます（loud fail。`$connectedCallback` 内の例外と同じ扱い）。
- **依存駆動 restart** — 送出されません: エラーは `$streamStatus.<name> = "error"` / `$streamError.<name>` に正規化され、他の entry の restart は継続します。前回成功した run で捕捉した依存は保持されるため、その依存への書き込みで再試行・回復できます。

### 値プロパティ

パース時、`state[name]` が未定義なら `initial`（fold 無しの場合は `undefined`）を持つ通常のデータプロパティとして実体化されます。これにより、stream が起動する前の初期レンダ — そして SSR 出力 — に `initial` が表示されます。

同名プロパティをユーザー側で先に宣言しても構いません（`defineState` での型付けに有用）が、**stream の起動時に値は `initial` で上書きされます**。起動後のプロパティは stream ランタイムの所有物です: ユーザーコードからの代入は禁止されませんが、動作は未定義です — 次の fold は代入後の値の上に畳みます。

---

## コンパニオン名前空間: `$streamStatus` / `$streamError`

すべての stream は読み取り専用のコンパニオンパスを 2 つ持ちます:

- `$streamStatus.<name>` — `"idle" | "active" | "done" | "error"`
- `$streamError.<name>` — 直近のエラー（無ければ `null`）

| status | 意味 |
|---|---|
| `idle` | 宣言済みだが動いていない（接続前、または切断後） |
| `active` | 現在の run がチャンクを消費中 |
| `done` | プロデューサーが正常終端した |
| `error` | run が失敗した（source の throw / reject、fold の throw、または iterable でない戻り値） |

セマンティクス:

- **読み取り専用**。どちらの名前空間への代入（two-way binding 経由を含む）もエラーを送出します。既知の許容が 1 つあります: **現在値と同値の primitive（または `null`）値**の代入は throw せず黙って無視されます（same-value ガード — `sameValueGuard`、既定 ON — が書き込み防御より先に短絡するため。オブジェクト値はガード対象外で、たとえば `$streamError` が現在保持している `Error` インスタンスそのものの再代入は throw します。何も壊れず、誤用の診断がガードを通過する書き込みまで遅れるだけです）。
- `$streamError.<name>` は起動・restart のたびに `null` にリセットされます。
- error 時、**値プロパティは直前の fold 結果を保持**します — リセットされません。`initial` へのリセットは次の（再）起動時です。
- `$streams` に未宣言の名前の読みは `undefined` です（throw しない。`$command` 名前空間と同じ寛容規約）。

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
- `$updatedCallback` の paths には `<name>` / `$streamStatus.<name>` / `$streamError.<name>` が通常の更新パスとして載ります。

---

## 依存駆動 restart

`args` の中で読んだパスはすべて依存として捕捉されます — computed getter の依存追跡と同じく自動です。捕捉された依存が変化すると:

1. 現在の run が **abort** されます（`source` に渡された `AbortSignal` 経由）。
2. 値プロパティが **`initial` にリセット**されます。
3. `args` が**再評価**されます（依存は run ごとに再捕捉 — 条件分岐で読むパスが変わっても正しく追従します）。
4. 新しい args 値と新しい signal で `source` が呼ばれます。

これは **switchMap セマンティクス**です: 最新の依存状態が常に勝ち、陳腐化した run は競合させず打ち切られます。

```javascript
$streams: {
  tokens: {
    args:   (state) => state.prompt,     // ← state.prompt への書き込みで旧 run が abort され新 run が始まる
    source: (prompt, signal) => llmStream(prompt, signal),
    fold:   (acc, chunk) => acc + chunk,
    initial: "",
  },
},
```

詳細:

- **coalesce** — 同一 tick 内の複数の依存書き込みは、restart ちょうど **1 回**に畳まれます。
- **status は不問** — `done` や `error` の stream も依存の書き込みで restart します。これが再試行の形です: 自動再接続は無く、再試行 = 依存を叩き直すこと。
- **computed 経由の依存も有効** — `args` が getter を読む場合、その getter 自身の依存元の変化で restart します。
- **stream 間の連鎖は正当** — stream B の `args` が stream A の値や `$streamStatus.A` を読んでも構いません。A のチャンク到着（や status 遷移）が B を restart させ、switchMap が自然に連鎖します。
- **`args` / getter 内での名前空間読みの正規形**は dotted ブラケット形 `state["$streamStatus.a"]` です。チェーン形 `state.$streamStatus.a` は値は返しますが依存を**登録しません** — 連鎖が無音で切れます。
- **自己依存はエラー** — `args` が自分の `<name>` / `$streamStatus.<name>` / `$streamError.<name>` を読むのは違反です（自分の書き込みで永遠に restart するため）。経路ごとの現れ方は[バリデーション](#バリデーション)を参照。
- **相互サイクルは MUST NOT** — A の `args` が B の値を読み、B の `args` が A の値を読むと無限 restart ループになります。自己依存と異なり、サイクルはランタイムで検出**されません**。回避はユーザーの責務です。

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

### チャンク反映の粒度

- `fold` は**各チャンクに正確に 1 回**適用されます — 取りこぼしも重複もありません。
- DOM 反映は updater の microtask バッチに従います。async iterator 経由のチャンクは各々別の microtask で届くため、実際には**チャンクごとに 1 drain**（DOM flush 1 回・`$updatedCallback` 1 回）になります。flush レートはチャンク到着レートに有界です。
- latest fold では、**同値の primitive チャンク**は same-value ガードで丸ごとスキップされます: バインディング更新も `$updatedCallback` エントリもありません。
- **組み込みの間引き機構はありません**。プロデューサーが DOM に対して饒舌すぎる場合は、プロデューサー側・fold 内・または下流の `wcs-debounce` / `wcs-throttle` で間引いてください。

---

## ライフサイクル

```
(宣言)──parse──▶ idle ──start(connect)──▶ active ──正常終端──▶ done
                  ▲                        │  │
                  │                        │  └──throw/reject──▶ error
                  └──disconnect(abort)─────┤
                                           └──依存変化──▶ (abort → リセット → 再起動) active
```

- **eager 起動** — stream は `<wcs-state>` 要素の接続時、`$connectedCallback` の**完了後**に起動します（`args` がそこで仕込んだ初期値を読めるように）。lazy モードはありません。
- **切断** — 全 stream が abort され、status は `idle` に戻ります。宣言は保持されます。
- **再接続** — stream は **`initial` から**再起動します。「切断前の続きから」はありません。既知の制限: 切断中に**同名の別 state 要素**が同じルートに登録された場合、再接続は初回接続の同名重複と同じ「already registered」エラーで失敗します（そもそも同一ルートでの同名重複はエラー条件です）。
- **状態オブジェクトの再セット** — 旧 stream は abort され registry ごと破棄されます。新しい宣言がパースされ、（接続中なら）即座に起動します。二重起動はありません。
- **SSR** — 宣言はパースされ値プロパティは `initial` で実体化されますが、stream は**起動しません**。サーバー出力には `initial` が乗ります。`enable-ssr` ページのクライアント側では通常どおり起動します — stream はシリアライズ可能な状態ではなく、ランタイムの副作用だからです。

---

## スコープ外（第 1 段）

以下は明示的に非サポートです:

1. stream 名へのワイルドカード / ドット付きパス、および `args` 内でのワイルドカード読み（いずれもエラー）。
2. async な `fold`。
3. Observable（`subscribe` 型）source — async iterable への変換はユーザー責務。
4. 自動再接続 — 再試行 = 依存の叩き直し。
5. lazy 起動（将来の `lazy: true` オプションの余地のみ予約。未実装）。
6. バインディング / 構造ブロック単位の stream 生存期間 — stream は `<wcs-state>` 要素の接続状態とともに生き、死にます。
7. DCC **定義要素**（`data-wc-definition` / `_initializeDCC` 経路で初期化される `<wcs-state>`）での `$streams` — 宣言は無視されます。**DCC インスタンス内の `<wcs-state>`** は通常経路を通るため、`$streams` はインスタンスごとに独立して起動・切断されます。
8. backpressure の保持（第 1 段の欠落ではなく恒久的な非目標）。

既知のエッジ: 状態の再セットで stream 宣言が**削除された**場合、その `$streamStatus.<name>` / `$streamError.<name>` のバインディングには削除が通知されず、最後に描画された値が表示され続けます（以後の読みは `undefined` に解決されます）。

---

## 使用例

### LLM トークンの累積

有限のトークンストリームを文字列に累積します。プロンプトを編集すると進行中の応答が abort され、新しい応答が始まります。

```javascript
export default {
  prompt: "",

  $streams: {
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
<input type="text" data-wcs="value: prompt">
<button data-wcs="disabled: isStreaming">Ask</button>
<pre data-wcs="textContent: answer"></pre>
<p data-wcs="textContent: $streamError.answer"></p>
```

### 最新値ティッカー

無限の価格フィードです。latest fold（既定）は常に値を 1 つだけ保持します — 構造的に有界です。`args` が無いため、一度起動して切断まで走り続けます。

```javascript
export default {
  $streams: {
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

`response.body` は `ReadableStream` です。`TextDecoderStream` を通すとテキストチャンクになります。`signal` を `fetch` に渡すことでキャンセルが協調的になります — `url` を変更するとボディ受信中でもリクエストが abort され、新しいリクエストが始まります。

```javascript
export default {
  url: "/api/report",

  $streams: {
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

---

## まとめ

| 概念 | 説明 |
|---|---|
| `$streams` | 宣言マップ: 非同期プロデューサー → fold → リアクティブプロパティ |
| `source(args, signal)` | プロデューサーを返す。`AbortSignal` の尊重は MUST |
| `args(state)` | 同期の依存捕捉。ここでの読みが restart を駆動する |
| `fold(acc, chunk)` | 同期・新しい値を返す。既定は latest |
| `initial` | シード値。（再）起動のたびに値はこれにリセット |
| `$streamStatus.<name>` | `idle` / `active` / `done` / `error` — 読み取り専用 |
| `$streamError.<name>` | 直近のエラーまたは `null`。（再）起動で `null` にリセット |
| restart | 依存変化 → abort → `initial` リセット → 新 run（switchMap） |
| 有界 fold | 無限ストリームでは MUST — backpressure は保持されない |
| ライフサイクル | `$connectedCallback` 後に eager 起動 / 切断で abort / 再接続は `initial` から / SSR では起動しない |
