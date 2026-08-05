# 設計提案: `$on` の実行レーン宣言 — state 側からの lane / retry

- **状態**: **不採用（2026-07-31 決裁）**。理由は §0-1。本書は棄却の理由と、再検討する場合の条件を残すための記録として維持する。実装は行わない。
- **元の位置づけ**: [architecture-hardening/04](./architecture-hardening/04-async-execution-and-wc-bindable.md) 決定ゲート 1 (d)「userland 宣言」を、採否を判断できる粒度まで降ろしたもの。本書は**新しい実行意味論を提案しない** — [async-execution-model.md](./async-execution-model.md) が既に規範化した語彙の**配置**だけを論点にしていた。
- **対象**: `@wcstack/state` の core 拡張。`$on` ハンドラに排他モードと再試行ポリシーを宣言できるようにする案。
- **本書が変えないもの（最重要）**:
  - **プロトコルに一切手を入れない**。wc-bindable / command-token / event-token の語彙・型・構文は不変更（04 冒頭の MUST NOT を継承する）。とりわけ **command-token の「呼び出しを await しない」規範**（[spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md)）は維持する。
  - **既存 `$on` の挙動を変えない**。関数を直に書く現行形は完全に維持され、宣言オブジェクト形は additive な opt-in とする。
- **参照仕様**: 排他モードと再試行の規範は [async-execution-model.md](./async-execution-model.md) §5 / §8。実装済みの実行プリミティブは `io-core/operation-lane.ts`（`scripts/sync-io-core.mjs` が各ノードへ複製配布）。宣言マップを state に増設する手順の先例は [state-streams-design.md](./state-streams-design.md)。

> **後日更新（2026-08-06）**: 本書が題材にした `examples/state-intersect-scroll` の
> 手書き fetch/timer 版は、`$streams` の switchMap 型依存 restart と producer 内の有界 retry を
> 使う形へ refactor された。以下の `pageFetch.loading`、`retryAttempt`、`<wcs-timer>` は
> 不採用案を判断した時点の歴史的記録であり、現行 example の構造ではない。

---

## 0-1. 決裁 — 不採用（2026-07-31）

**棄却の主因は、lane の粒度が wcstack のイディオムと噛み合わないことである。**

lane が直列化するのは **`$on` ハンドラの実行**である。ところが本書 §1 が題材にした `examples/state-intersect-scroll` の実際の並行性は**ノード間**にあり、`pageFetch.loading` という state プロパティを介して仲介されている。

```js
sentinelChanged: (state) => {
  if (state["pageFetch.loading"]) return;   // 守っている相手は「別ノードの実行」
  state.page = state.page + 1;              // ハンドラ自身は同期で即終わる
}
```

このハンドラに `lane: "exhaust"` を宣言しても、ハンドラは同期で即終了するため**自分自身と重なりようがなく no-op になる**。fetch を実行しているのは url バインド経由の auto-fetch であって、ハンドラではない。

つまり lane が意味を持つのは「**ハンドラが自分で非同期処理を所有して await する**」書き方をしたときだけである。ところが wcstack の看板イディオムは逆で、「**ノードが非同期を所有し、state はプロパティを小突くだけ**」である。lane はそこに掴むところがない。

ハンドラ所有に寄せることは技術的には可能である（`state.$command.X.emit()[0]` は subscriber の戻り値＝実際には `Fetch.fetch()` が返す Promise そのもの）。しかしこれを await するイディオムを推奨すると、「**runtime は command を await しない**」という規範の裏口から `emit()` の戻り値を仕様面に昇格させることになり、本書冒頭の「プロトコルに一切手を入れない」という前提が実質的に崩れる。**この案の唯一の正当化根拠（既存語彙の露出であって発明ではない）を壊す代償は払えない。**

### 実測 3 欠陥に照らした効果

| §1-1 の欠陥 | lane 宣言で防げたか |
|---|---|
| デッドロック（失敗時に `rearm` 不発） | **×** エッジの欠落であって並行性の問題ではない |
| 予算外の自己持続リトライ経路（ライブロック） | **△** クラスとしては防げるが、ハンドラ所有に書き換えた場合に限る |
| 予算を起動時に数えた | **○** lane が attempt を数えるので消える |

3 件中まるごと効くのは 1 件。かつ実際の修正はいずれも数行だった。

### その他の棄却理由（従）

- **動機の実例が n=1**。宣言面（`$commandTokens` / `$eventTokens` / `$on` / `$streams` / `$streamStatus` / `$streamError` に `$laneError` が加わる）を増やす判断は、同型の問題が 2 例目に出てからで遅くない。
- **`$on` の同期性という単純さを失う**代償が、得られる保証に見合わない（§3 G1 の制約は loud で安全だが、制約は制約である）。
- **lane の二重化**（ノード内 lane と state lane）の説明責任が恒久的に残る。
- **`interval` を宣言できない**不整合（§3 G4）を毎回説明する必要がある。

### 再検討する条件

次のいずれかが満たされたら本書を再開してよい。

1. 「ハンドラが自分で await する」形の非同期が userland に自然に現れるユースケースが**2 例以上**出てきたとき。
2. 予算外の再試行経路が**別のデモ／アプリでも**再発したとき（＝ n=1 でなくなったとき）。
3. command-token に「完了を観測する」正式な手段が別の理由で入ったとき（そのとき lane の掴みどころが生まれる）。

### 本書から切り出して実施したもの

lane と独立に価値があるものだけを別途実施した（PR 参照）。

- **`$on` / `onXxx:` ハンドラの reject 捕捉**（§3 G1 の実測で判明した unhandled rejection）→ `src/event/captureHandlerRejection.ts`。新しい宣言面は不要。
- **`setLoopContextAsync` の削除**（名前が実装より多くを約束しており、production の呼び出し元も無かった）。

---

## 0. 要旨（不採用となった提案の内容・以下は記録）

wcstack には**排他代数がすでに存在する**。`latest` / `queue` / `exhaust` / `overlap` は §5 で規範化され、`OperationTicket` / CommitGuard / terminal CAS を含む実装が `io-core/operation-lane.ts` にある。再試行も §8 が `max` / `interval` / `resetOn` / `excludeWhen` の 4 要素で規範化済みである。

**欠けているのは代数ではなく、その公開面である。** この語彙が届くのは I/O ノードの内側だけで、ノードを**またぐ**実行（可視性エッジ → fetch → 失敗 → 待つ → 再実行）を組む利用者は、同じ意味論を毎回手書きしている。

本書はその手書きを宣言に置き換える案を扱う。**新語彙の発明ではなく既存語彙の露出**であることが、この案の唯一の正当化根拠であり、同時に受け入れ条件でもある（§9-1）。

---

## 1. 問題 — 手書きの代償は実測されている

`examples/state-intersect-scroll` が現時点で最も込み入った「ノードをまたぐ実行」であり、そこで何が手書きされているかを見ると論点が具体化する。

| 手書きされているもの | 対応する規範 | 正しさの根拠 |
|---|---|---|
| `$on.sentinelChanged` の `!loading` ガード | §5 `exhaust`（実行中は冪等 no-op） | 「microtask が task に先行する」というスケジューラの性質（[timing-and-firing-contract.md](./timing-and-firing-contract.md) §3） |
| `retryAttempt` / `maxRetries` | §8 `max`（有限であること MUST） | 利用者が数え間違えないこと |
| `<wcs-timer manual once>` の起動 | §8 `interval` | — |
| ページ着信での `retryAttempt = 0` | §8 `resetOn` | — |
| `noMore` / `loading` / error 済み の早期 return | §8 `excludeWhen` | — |

### 1-1. 実測された失敗モード

このデモの修正過程で、手書きゆえの欠陥が 3 件見つかった。**いずれも規範違反であり、lane 宣言なら構造的に起こり得なかったものである。**

1. **デッドロック**。失敗応答が `rearm` の手前で早期 return し、observer が再武装されなかった。フィードが空だとスクロール対象が無く、`IntersectionObserver` は可視性の*変化*でしか発火しないため、復帰手段が消える。UI は "Scroll to retry" と表示するが、スクロールする対象が存在しない。
2. **予算外のリトライ経路**（ライブロック）。交差エッジからの「ついでの再試行」が `retryAttempt` を消費しなかった。しかもこの経路は自己持続する — エラー表示行の出現・消滅がレイアウトを変え、センチネルが observer マージンを跨ぎ、それ自体が次のエッジを生む。`e2e/tests/state-intersect-scroll.spec.ts` のリクエスト列で、失敗サイクルあたり 1 回として計測された。
3. **予算の数え方**。起動時に数えると、tick が保留中なのに `retriesExhausted` が真になり、既に飛んでいる再試行の下で「手動 Retry」UI が露出する。発射時に数える必要がある。

**2 が本質的である。** 「すべての再試行経路が予算に載っている」は lane が宣言で保証できる**不変条件**だが、手書きでは経路が増えるたびに人手で守るしかない。1 と 3 は注意深さで避けられるが、2 は経路が後から増えるたびに再発する種類の欠陥である。

### 1-2. 時間軸について（誤診の訂正）

「wcstack には時間を扱う手段がない」というのは誤りである。`<wcs-timer>` / `<wcs-raf>` / `<wcs-debounce>` / `<wcs-throttle>` がノードとして存在し、`delay` は `<wcs-timer manual once>` で今日書ける（`once` は `repeat="1"` の糖衣＝遅延 tick ちょうど 1 回）。上記デモの修正もこれで足りている。

したがって**本書は「時間コンビネータの追加」を提案しない**。提案するのは排他と再試行の宣言だけである。

> 注記（別課題）: [async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 は debounce の利用者責務の例として `notice@x|debounce(1000)` というフィルタ構文を挙げているが、`packages/state/src/filters/builtinFilters.ts` に `debounce` フィルタは存在しない（2026-07-31 確認）。時間整形は現状ノード（`<wcs-debounce>`）だけが提供する。ガイドラインの記述を実態に合わせるか、フィルタを実装するかは本書のスコープ外。

---

## 2. スコープと非目標

### 2-1. スコープ

- `$on` エントリに**排他モード**（§5 の 4 モード）を宣言できるようにすること。
- `$on` エントリに**再試行ポリシー**（§8 の 4 要素）を宣言できるようにすること。
- 宣言が守られていることを診断可能にすること（予算外経路が作れないこと）。

### 2-2. 非目標（明示的スコープ外）

- **プロトコル変更**。§0 のとおり。
- **時間コンビネータの追加**（§1-2）。`delay` / `debounce` / `throttle` はノードの責務のまま。
- **`data-wcs` への構文追加**。`data-wcs` は配線であって DSL ではないという既存方針（`feedback_data_wcs_wiring`）を維持する。本案の宣言面は**すべて JS 側**（`$streams` と同じ位置）に置く。
- **排他モード `parallel`**。§5 のとおり予約語のまま。
- **`$on` 以外への適用**。`onclick:` 等の DOM イベントハンドラ、`$connectedCallback`、`$updatedCallback` は対象外。
- **ノード内 lane の置き換え**。ノードは自分の lane を持ち続ける。本案の lane は**その外側**に重なる（§6-3 の二重化問題を参照）。

---

## 3. 決定ゲート

採否より先にこれらが決まらないと設計に落ちない。**G1 が本体であり、G1 が否なら本案は成立しない。**

### G1. `$on` ハンドラの非同期化を state ローカルの契約に閉じ込められるか

lane は非同期 operation の概念である。同期ハンドラのままでは `latest` / `exhaust` が意味を持つ範囲が「ハンドラの同期実行中」に限られ、`retry` は原理的に表現できない（何を再試行するのか、いつ終わったのかが分からない）。

**現状**: `$on` ハンドラは `eventTokenHandler.ts` が `createStateAsync("writable", async (state) => { state[setLoopContextSymbol](loopContext, () => token.emit(state, event, ...indexes)) })` の中で同期呼び出しし、`Token.emit` は戻り値を配列で返すが**呼び出し側は捨てている**。したがって今日ハンドラが Promise を返すと、それは黙って浮く（floating promise）。

| 案 | 形 | 評価 |
|---|---|---|
| **A. 同期のまま。lane は「ハンドラが起動した command」に掛ける** | runtime が `$command.*.emit()` を横取りして operation とみなす | ✗ **不採用推奨**。command-token は fire-and-forget であり、完了の概念が無い。「いつ settle したか」を runtime が知る手段が無いので `latest` の supersede も `retry` も判定できない。加えて emit の横取りは command-token の意味論に手を入れることになり §0 の MUST NOT に触れる |
| **B. ハンドラが Promise を返すことを認め、state がそれを await する** | `handler: async (state, event) => { ... }` | **採用推奨**。await するのは **state 自身のハンドラ**であって、ハンドラが呼んだ command ではない。command-token の「呼び出しを await しない」規範はそのまま守られる — この区別が G1 の答えの本体 |
| **C. 明示的な完了通知** | `handler` が `done()` を受け取る | ✗ 冗長。B が使えるなら B |

**B の前例と制約（PoC で実測済み — `packages/state/__tests__/poc.asyncOnLoopContext.test.ts`、9 ケース）**:

- **前例あり**: `State._callStateConnectedCallback` が既に `createStateAsync("writable", async (state) => { await state[connectedCallbackSymbol]() })` を実行している。writable proxy スコープ内での await は出荷済みのパターンである。
- **proxy の寿命は問題ない**: `_createState` は毎回 proxy を生成するだけで teardown を持たない（`finally` は空）。await を跨いでも proxy は生きている（PoC「絶対パスの読み書きは await を跨いでも影響を受けない」）。
- **ループコンテキストは await を跨げない**: `setLoopContextSymbol(loopContext, fn)` は**同期スコープ**で push/pop する。`callback()` が Promise を返した時点で `finally` の `popAddress()` / `clearLoopContext()` が走るためである。
  - ⚠ かつて存在した `setLoopContextAsync` はこれを解決しなかった。実体は `await _setLoopContext(...)` で、await する対象は *finally が既に走った後の Promise* だった。名前から期待される「コンテキストを await 跨ぎで保持する」挙動は持たない。production の呼び出し元も無かったため **2026-07-31 に削除済み**（§0-1「本書から切り出して実施したもの」）。同等の機能が必要になったら、名前どおりに動く実装を新規に起こすこと。
- **失敗モードは loud である（重要）**: await 後の `state.$1` は `raiseError("No active state reference to get list index …")` で落ち、wildcard パス `state["items.*.id"]` の読みも、`state["items.*.flag"] = v` の書きも throw する。**黙って別の行を指すことはない**。G1-B のリスク評価はこの一点で大きく下がる — 誤用は実行時に必ず露見する。
- **回避策 (ii) は動作する**: `$resolve(path, indexes, value?)` に `$on` の `listIndexes` 引数を渡せば、await 後でも読み書きできる（PoC で `items.*.flag` への書き込みと読み戻しを確認）。`listIndexes` は素の数値配列なので await を跨いで生き残る。
- **並行実行は安全**: 2 行から同時に発火した async ハンドラが互いの `listIndexes` を汚さないことを確認した（待ち時間を変えて完了順を入れ替えても取り違えなし）。インデックスが proxy 状態ではなく引数で運ばれているため。
- **発火経路はハンドラを await しない**: dispatch もその後のタスク境界も完了を待たず、ハンドラの Promise は `Token.emit` の戻り値配列にしか現れない。当時は `eventTokenHandler` がそれを捨てており、**async ハンドラが reject すると unhandled rejection になっていた**。→ この 1 点は lane と独立に価値があるため切り出して修正済み（`src/event/captureHandlerRejection.ts`。state 名・ハンドラ名付きの `console.error` へ正規化）。「await しない」こと自体は仕様であり変えていない。

**結論**: 選択肢 (i)「async ハンドラでは loop context 依存の解決を禁止」＋ (ii)「`$resolve` + `listIndexes` を回避策とする」の組み合わせで**実用可能**である。(i) は既に runtime が raiseError で強制しており、新たに実装するものは無い。(iii)（loop context を await を跨いで復元する）は不要 — 第 1 段スコープ外のままでよい。

### G2. lane の identity をどう決めるか

| 案 | 評価 |
|---|---|
| token 名 = lane（1 トークン 1 レーン） | 既定にする。理解しやすく、`$eventTokens` の一覧がそのままレーン一覧になる |
| `laneKey` の明示指定で共有可 | 必要。credential の `get()`/`store()` が単一レーンを共有する先例（§4.3）と同型のケースが userland にもある（例: 「読み込み」と「再読み込み」が互いを supersede すべき） |

**推奨**: 既定は token 名、`laneKey` で共有を opt-in。共有時は「コマンド間で supersede が起きる」ことを §4.3 と同じく宣言側に書かせる（診断で warn）。

### G3. `retry.when` の判定入力は何か

一時エラーと恒久エラーの区別（§8）は userland でも必要になる。

- fetch は既に `errorInfo: { code, phase, recoverable, capabilityId }`（`WcsIoErrorInfo`）を additive property として露出しており、`when: (info) => info.recoverable` が書ける。
- ただし **この taxonomy を持つのは現状 fetch のみ**である。

| 案 | 評価 |
|---|---|
| taxonomy を全ノード必須にする | ✗ 大きすぎる。別課題（07 / 09 系）であり本案の前提にすべきでない |
| `when` はハンドラの throw / 戻り値を受け取る | **推奨**。lane が知っているのは「自分が await したハンドラがどう settle したか」だけでよい。ノードのエラー面を読むのは**ハンドラの仕事**であり、`when` はその結果を受け取る |

**推奨**: `when: (reason) => boolean`。`reason` はハンドラが throw した値（または明示的に返した失敗値）。ノード固有の taxonomy に runtime は依存しない。

### G4. 待ち時間をどこから供給するか

`retry.interval` を実現するには時計が要る。

| 案 | 評価 |
|---|---|
| state runtime が `setTimeout` を持つ | ✗ **「時間もノードである」という現行方針を壊す**。ノード体系の外に時間を持ち込むと、`<wcs-timer>` が持つ世代ガード・dispose 連動・SSR 非起動といった規律を state 側に再実装することになる |
| `<wcs-timer>` を内部で使う | ✗ state core が特定パッケージに依存することになる（ゼロ依存・自己完結原則に反する） |
| **`interval` を第 1 段では持たない**（`retry.max` のみ。即時再試行） | **推奨**。待ちが要るケースは `<wcs-timer>` を明示配線する現行イディオムのまま。lane が保証するのは「予算が有限で、すべての経路がそれに載っている」ことであり、これは §1-1 の欠陥 2 と 3 を直接塞ぐ |

**推奨**: 第 1 段は `interval` を宣言語彙に**入れない**。これは §8 との不整合ではなく、§8 の `interval` を「利用者がノードで供給する」と読む立場である。入れる場合の唯一の筋は `retry: { schedule: "$command.armRetry" }` のような**時計への委譲宣言**だが、第 2 段以降とする。

### G5. `exhaust` で落とされた呼び出しは観測できるか

`exhaust` は「実行中は冪等 no-op」だが、UI は「今それは走っている」を出したいことがある。

**推奨**: 第 1 段では観測面を持たない（落ちたことは静か）。理由 — §5 は `exhaust` の無視を「黙殺ではなく冪等」と定義しており、同じ望ましい状態に収束する以上、追加の観測面は要求されない。必要なら `$laneStatus.<name>` を additive に足せる（§5-2）。

---

## 4. 宣言構文（案）

`$on` の値に**オブジェクト形**を追加する。関数形は現行のまま完全互換。

```js
export default {
  $eventTokens: ["sentinelChanged", "pageArrived"],
  $commandTokens: ["refetch"],

  $on: {
    // 現行形（関数）— 一切変わらない
    pageArrived: (state, event) => { /* ... */ },

    // 新形（宣言オブジェクト）
    sentinelChanged: {
      lane: "exhaust",                       // §5 の 4 モード。既定は "overlap"（＝現行挙動）
      retry: {
        max: 3,                              // 有限必須（§8）
        when: (reason) => reason?.recoverable === true,
      },
      handler: async (state, event) => { /* ... */ },
    },
  },
};
```

### 4-1. 各フィールドの契約（案）

| フィールド | 型 | 必須 | 契約 |
|---|---|---|---|
| `handler` | `(state, event, ...listIndexes) => void \| Promise<void>` | ✔ | 引数規約は現行 `$on` と同一。Promise を返す場合、その settle が operation の終端になる（G1-B）。**reject は lane が捕捉し、never-throw で `$laneError` へ**（浮いた rejection を作らない） |
| `lane` | `"latest" \| "queue" \| "exhaust" \| "overlap"` | — | 既定 `"overlap"`。**既定が overlap なのは現行挙動の保存のため**（今の `$on` は何も直列化しない） |
| `laneKey` | `string` | — | 既定は token 名（G2） |
| `retry` | `{ max, when? }` | — | `max` は有限の正整数（MUST）。`when` 省略時は「常に再試行」。`interval` は第 1 段では受理しない（G4） |

### 4-2. バリデーション（`processOnDeclaration` を拡張）

現行の検査（`$eventTokens` に宣言済みであること / 値が関数であること）に加えて:

- 値がオブジェクトの場合、`handler` が関数であること。
- `lane` は 4 モードのいずれかであること。
- `retry.max` は有限の正整数であること（`Infinity` / 0 / 非整数は raiseError）。**§8 の「無限再試行の禁止」を宣言時に強制できるのが本案の主目的の一つ**。
- `retry` があるのに `handler` が同期関数（Promise を返さないことが静的に分かる場合は検出不能なので、実行時に「Promise を返さなかった」なら retry は無意味として `config.debug` 時に warn）。
- `laneKey` の共有が起きる場合、`config.debug` で「supersede が起きうる」旨を通知（G2）。

---

## 5. ランタイムモデル（案）

### 5-1. 再利用できるもの

[state-streams-design.md](./state-streams-design.md) が作った骨格がほぼそのまま使える。

| 要素 | `$streams` での実体 | 本案での対応 |
|---|---|---|
| 宣言パース | `processStreamsDeclaration.ts` | `processOnDeclaration.ts` の拡張 |
| registry | `streamRegistry.ts`（`WeakMap<IStateElement, Map<string, Entry>>`） | `laneRegistry.ts`（同型） |
| ライフサイクル | `_state` 再 set で clear / `disconnectedCallback` で abort | 同型（`clearEventTokenRegistry` と並べる） |
| コンパニオン名前空間 | `$streamStatus` / `$streamError` | `$laneStatus` / `$laneError`（第 2 段。§3 G5） |
| 通知 dedup 台帳 | `lastNotified.ts` | 名前空間を出す場合のみ必要 |

**新規に要るのは lane の写像だけ**である: `OperationLane` を state 側から使えるようにし（`io-core/` の複製配布を `packages/state/src/lane/operationLane.ts` へ拡張）、`begin()` / `canCommit()` / `claimTerminal()` / `finalize()` をハンドラの起動〜settle に対応させる。

### 5-2. 呼び出し経路（案）

`eventTokenHandler.ts` の発火時経路に lane を挟む。

```
element の CustomEvent
  → eventTokenHandler の listener
  → （lane あり）lane.begin()  … exhaust なら null で即 return（冪等 no-op）
  → createStateAsync("writable", async (state) => {
        setLoopContext(...)（同期スコープ・G1 の制約）
        await handler(state, event, ...indexes)
     })
  → settle:
       成功 → lane.claimTerminal(ticket, "success")
       throw → retry.when(reason) && attempt < max なら lane.retry(ticket) で再実行
                そうでなければ claimTerminal(ticket, "error") → $laneError
  → finally: lane.finalize(ticket)
```

`latest` の supersede は `begin()` が epoch を進めることで自動的に効く。**世代ガードは `OperationLane` が持つ**ので、state 側で `_gen` 相当を書かない。

### 5-3. 「すべての経路が予算に載る」不変条件

§1-1 の欠陥 2 を構造的に塞ぐには、**同じ lane に載っていない再試行経路を作れない**ことが要る。`laneKey` が既定で token 名である以上、別 token から同じ command を撃てば予算外経路は依然作れる。

第 1 段では**診断で対処する**: `retry` を宣言した lane が撃っている `$commandTokens` を記録し、同じ command token が別経路から emit されたら `config.debug` で warn する。静的に禁止するのは過剰であり（人間起動の retry ボタンは正当な予算外経路である）、**「予算外経路が存在すること」を可視化できれば §1-1 の 2 は発見可能になる**。

---

## 6. 既存規範との整合

### 6-1. timing-and-firing-contract

本案の狙いの一つは、手書きガードの正しさの根拠を「microtask が task に先行する」から「lane が直列化する」へ移すことである。**移った分だけタイミング契約への依存が減る**が、契約そのものは消えない（§7-1）。採用する場合、タイミング契約に「`$on` lane の発火・直列化の粒度」を 1 節足す（ガイドライン §10 の MUST に従う）。

### 6-2. command-token / event-token

不変更。`$on` は event-token の subscriber であり続け、lane はその subscriber の**呼ばれ方**だけを変える。command-token の emit も await しない（G1-B）。

### 6-3. ノード内 lane との二重化

`<wcs-fetch>` は既に `latest` lane を持つ。`$on` に `lane: "latest"` を宣言すると、**同じ論理操作に 2 枚の lane が重なる**。

- 二重化は害ではない（内側は「fetch の supersede」、外側は「ハンドラの supersede」で粒度が違う）が、**利用者が「どちらが効いたか」を説明できないと混乱する**。
- 規範化すべき線: **ノード内 lane は消さない。state 側 lane は「ハンドラという論理操作」にのみ掛かる**。設計ドキュメントとドキュメントの両方に明記する（MUST）。

### 6-4. sameValueGuard / updater

ハンドラ内の state 書き込みは現行どおり `setByAddress` を通り、coalesce・same-value・`walkDependency` がそのまま乗る。lane はこれに関与しない。

### 6-5. SSR / DCC

- SSR（`inSsr()`）では lane を起動しない（宣言のパースのみ）。`$streams` §7-1 と同型。
- DCC 定義要素の `_initializeDCC` 経路は `$streams` と同じ制限を持つ見込み（要確認）。

---

## 7. 埋まらないもの（正直な線引き）

本案を採っても解けない問題を明示する。**これを曖昧にすると「代数を入れれば宣言的になる」という誤った期待が残る。**

1. **合流性は回復しない。** `$on` が state を書き、drain が binding を更新するという 2 段構造がある限り、「HTML 上のグラフ＝振る舞いの完全な仕様」にはならない。lane が保証するのは*操作の直列化*であって*更新順序*ではない。タイミング契約は引き続き必要である。
2. **`$t` は生えない。** 時間軸の量化子（「直近 5 秒」「過去 N 件」）は依然として有界 fold（`$streams`）で近似するしかなく、空間軸の `$1` / `$2` と対称にはならない。
3. **導出イベントは依然 state を経由する。** 「イベントから（時間を挟んで）別のイベントを作る」には、本案の後もプロパティと DOM ノードを 1 往復する必要がある。これを解くのは lane ではなく、`$streams.source` が event-token を取れるようにする別案である（§9-2 で不採用としたもの）。
4. **予算外経路は静的には禁止できない**（§5-3）。可視化までが第 1 段の到達点。

---

## 8. 段階分割と受け入れ条件

### 8-1. フェーズ

1. **Phase A — 宣言と検証**: `$on` オブジェクト形のパース・バリデーション（§4-2）。`lane` / `retry` は受理するが未配線。既存 `$on` テストが全て通ること（互換性の証明）。
2. **Phase B — lane 配線**: `OperationLane` を state へ複製配布し、`eventTokenHandler` の発火経路に挟む（§5-2）。G1-B の async ハンドラ対応と loop context 制限（G1 (i)）。
3. **Phase C — retry**: `max` / `when` と `lane.retry()` の接続。never-throw 正規化。
4. **Phase D — 診断**: 予算外経路の warn（§5-3）、`laneKey` 共有の warn。
5. **Phase E — 仕上げ**: SPEC / README（ja/en）、タイミング契約への 1 節追加（§6-1）、`examples/state-intersect-scroll` の手書きガードを宣言へ置換（**これが本案の実地検証であり、置換して挙動が変わらないことが受け入れ条件**）、カバレッジ 100/97/100/100。

### 8-2. 受け入れ条件（抜粋）

| # | ケース | 検証点 |
|---|---|---|
| L1 | 関数形 `$on` の完全互換 | 既存テスト無改変で全通過 |
| L2 | `exhaust` | 実行中の 2 回目の emit がハンドラを呼ばない（冪等 no-op） |
| L3 | `latest` | A→B の順で開始し B→A の順で settle しても、A の書き込みが B を巻き戻さない（04 検証条件と同文） |
| L4 | `queue` | 開始順に直列実行される |
| L5 | `retry.max` | 恒久失敗で**ちょうど `1 + max` 回**ハンドラが呼ばれて停止する（§1-1 の 3 の回帰テスト） |
| L6 | `retry.when` | `false` を返すと再試行しない |
| L7 | `max: Infinity` / `0` / 非整数 | 宣言時に raiseError（§8 の MUST を宣言時に強制） |
| L8 | async ハンドラの reject | 浮いた rejection にならず `$laneError` へ正規化 |
| L9 | loop context | `for` 内から発火した async ハンドラの await 後の `$1` / wildcard 解決が raiseError（G1 (i)）／`$resolve` + `listIndexes` は成功する（G1 (ii)）。**`poc.asyncOnLoopContext.test.ts` が既に固定済み** |
| L10 | disconnect | 実行中の operation が torn-down 要素へ書き込まない |
| L11 | `_state` 再 set | 旧 lane が abort され二重配線しない |
| L12 | SSR | `inSsr()` で lane を起動しない |
| L13 | 実地検証 | `state-intersect-scroll` を宣言形へ置換し、既存 e2e 3 本が無改変で通る |

---

## 9. 却下・保留した案

### 9-1. 新しいコンビネータ語彙を state に足す（却下）

`filter` / `gate` / `partition` / `merge` を宣言語彙として足す案。**却下**。

- これらは `$on` の分岐で既に書けており、書き味の問題であって正しさの問題ではない。
- 新語彙の発明は [state-redesign-council.md](./state-redesign-council.md) の「良いとこ取り統合は禁句」に正面から抵触する。
- 本案が正当化されるのは**既存の規範語彙の露出**だからであり、この境界を越えると正当化根拠を失う。

### 9-2. `$streams.source` が event-token を取れるようにする（保留）

`$streams: { items: { from: "pageArrived", fold, initial } }` の形。**第 1 段では採らない**。

- **正しさの利得がゼロ**。§1-1 の欠陥はいずれも accumulate の問題ではなくスケジュールの問題であり、この案では 1 件も塞げない。
- **回帰リスクがある**。push→pull ブリッジは必ず microtask を 1 段挟む。現行の `$on` は DOM イベントリスナ内で同期実行されており、タイミング契約 §3 の「microtask が task に先行する」で成立しているガード群（`!loading` を含む）の前提が動く。
- `args` 変化の restart が `initial` リセットである以上、累積セマンティクスとも噛み合わない。

宣言が短くなる利得は認めるので、**lane が入って手書きガードが減った後に再評価する**。

### 9-3. `data-wcs` に lane 修飾子を足す（却下）

`data-wcs="command.fetch#exhaust: $command.refetch"` の形。`data-wcs` は端点指定と線上変換のみという既存方針（`feedback_data_wcs_wiring`）に抵触する。実行意味論は計算であり、state 側に押し出すべきものである。

---

## 10. 残課題

1. **G1 の決着**。~~PoC を書くべき~~ → **PoC 実施済み**（`packages/state/__tests__/poc.asyncOnLoopContext.test.ts`、9 ケース green）。失敗モードが loud であること・回避策 (ii) が動くこと・並行実行が安全であることを確認したため、**技術的な障害は解消した**。残るのは「B を採るか」という設計判断そのもの（＝この案の採否）だけであり、新たな調査項目は無い。副産物として `setLoopContextAsync` の名前と実装の乖離（§3 G1 の ⚠）が別課題として残る。
2. **`OperationLane` の state への複製配布**。現状 `scripts/sync-io-core.mjs` は I/O ノードの `src/core/` を配布先としている。state は I/O ノードではないため、配布先の一般化かコピー方針の明文化が要る。
3. **`$laneStatus` / `$laneError` を出すか**（G5）。第 1 段では `$laneError` のみ必要（L8 の受け皿）。`$laneStatus` は保留。
4. **他の宣言面への波及**。`onclick:` ハンドラや `$commandTokens` にも同じ需要が出た場合、`$on` だけの拡張が非対称に見える。第 1 段では `$on` に限定し、需要が実証されてから広げる。
5. **DCC 定義要素の扱い**（§6-5）。`$streams` と同じ制限になるかは実装時に確認。

---

## 関連

- [architecture-hardening/04 — 非同期実行と wc-bindable 境界](./architecture-hardening/04-async-execution-and-wc-bindable.md) — 決定ゲート 1。本書はその (d) の具体化
- [async-execution-model.md](./async-execution-model.md) — §5（排他モード）/ §8（再試行）の規範。本書は語彙を一切追加しない
- [async-io-node-guidelines.md](./async-io-node-guidelines.md) — ノード側の骨格規約
- [timing-and-firing-contract.md](./timing-and-firing-contract.md) — 手書きガードの正しさの現在の根拠（§6-1 / §7-1）
- [state-streams-design.md](./state-streams-design.md) — 宣言マップ増設の先例。骨格の大半を再利用できる
- [state-redesign-council.md](./state-redesign-council.md) — no-regret 原則と「良いとこ取り統合は禁句」（§9-1 の根拠）
- `io-core/operation-lane.ts` — 実行プリミティブの実装（実行可能な参照仕様）
- `examples/state-intersect-scroll` + `e2e/tests/state-intersect-scroll.spec.ts` — §1 の refactor 前実測対象。現行 example は `$streams` 実地例
- `packages/state/__tests__/poc.asyncOnLoopContext.test.ts` — G1 の PoC（特性化テスト）。async `$on` ハンドラと loop context の現在の挙動を固定する
