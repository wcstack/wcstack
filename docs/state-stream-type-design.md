# 設計メモ: state に「stream 型」を追加する案（`$streams` adapter）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と方向性のスナップショット。
- **対象**: `@wcstack/state` の core（reactive proxy / computed / 更新サイクル）への拡張。周辺パッケージのタグと違い、**proxy core に触れる core 拡張**である点に注意。
- **一言で**: 外部の連続フロー（ReadableStream / async iterable / async generator など）を、**畳み込み（fold）して単一の reactive プロパティに適合（adapt）させる**プリミティブを state に足す。汎用 Streams パイプラインではない。
- **前提資産**: computed（getter）、filter pipeline、[[command-token-protocol]] / [[event-token-protocol]]、`$watch`（[[watch-hook-design]]、設計のみ）、spread/fetch で導入した microtask coalesce、wc-bindable protocol。
- **着想の経緯**: 「stream を非同期 IO ノード（タグ）化する」案の検討（`async-tag-candidates` 系の議論）で、stream をタグにすると SSE の退化になり、Streams 固有の backpressure を捨てる結論になった。その mismatch が解けるのは HTML ノード層ではなく **state 層**である、という再フレーミングから本案に至った。

---

## 0. 大前提: なぜ「タグ」ではなく「state」なのか

reactive state は「**最新値のスナップショット**」（値が変わると binding が更新される置換セマンティクス）。
stream は「**順序つき・潜在的に無限・backpressure 付きのフロー**」。

この impedance mismatch を、HTML ノード（`<wcs-stream>`）に押し込むと「チャンクを event 発火に潰す」＝ SSE の一般化に退化し、Streams 固有の旨味（backpressure・composable な piping）を捨てるだけになる。

mismatch が本来解けるのは「**フローを一つの値に畳み込む**」場所、すなわち **state 層**である。畳み込み（fold）は HTML ノードの責務ではなく、状態の責務。よって stream 統合は state core の拡張として設計する。

| | タグ案（`<wcs-stream>`） | **state 拡張案（本案）** |
|---|---|---|
| mismatch の解決 | 解けない（backpressure を捨てた SSE 退化） | **解ける**（fold を state 層に置く） |
| 統一性 | タグが1個増えるだけ | fetch streaming / SSE / async generator まで「ただの source」に一般化 |
| 哲学整合（すべてを状態遷移に） | 中 | **最高**（フロー＝状態遷移の列、そのもの） |
| 前例 | なし | Solid `from` / Svelte custom store / Vue `useObservable` |
| コスト / リスク | 低（隔離されたタグ） | **高（proxy core・依存駆動の cancel/restart）** |

---

## 1. 本質: 「async producer を reactive property に適合させる」

state で stream を扱う＝**外部の連続フローを reactive な単一プロパティに adapt する**こと。これは UI フレームワーク界で確立した形であり、強い前例がある:

- Solid の `from(producer)`（任意の producer → signal）
- Svelte の custom store（`set` を内側から呼ぶ）
- Vue の `useObservable`

**いずれも backpressure は保持していない。**「最新値（または畳み込み結果）を push する」だけ。本案も同様に、backpressure を **UI ではほぼ不要なものとして明示的に放棄する**（§4-3）。これがタグ案で「載らない」と判定した部分を、欲張らず正直に捨てることで成立させる鍵である。

重要な帰結: **畳み込んだ結果は普通の値**になる。新しい「stream 値型」を proxy の値表現に持ち込む必要はなく、filter pipeline・computed・list diff とも競合しない。「stream 型を追加」とは値の新種を足すのではなく、**reactive プロパティの新しい供給源（source declaration）を足す**ことである。

---

## 2. プリミティブの形（草案）

`$commandTokens` / `$eventTokens` / `$on` と並ぶ宣言マップ `$streams` を切る。

```js
$streams: {
  // source: async iterable / ReadableStream / async generator を返す
  tokens: {
    source:  (state, signal) => llmStream(state.prompt, signal),
    fold:    (acc, chunk) => acc + chunk,   // 省略時は latest（置換）
    initial: "",
  },

  // 最小形（fold 省略 = 最新チャンクで置換）
  ticker: {
    source: () => priceStream(),
  },
}
```

- `state.tokens` が reactive プロパティになり、チャンク到着ごとに `fold(acc, chunk)` の結果で更新 → 既存の binding がそのまま追従する。
- `source` は **AbortSignal を第2引数で受け取る**（§4-1 の cancel/restart に必須）。
- 値そのものは通常の reactive 値なので、`data-wcs="text: tokens"` 等でそのまま束縛できる。

> 構文の別案として「computed が async iterable を返したら stream とみなす」案もあるが、暗黙的で「魔法」感が強い。`$commandTokens` 等との一貫性からも**明示的な `$streams` 宣言**を推す。

---

## 3. 公開する状態（コンパニオン）

stream は値だけでなく pending / active / error / complete のライフサイクルを持つ。fetch の `loading` / `error` / `data` と同型のコンパニオン状態を用意する。

- 値: `state.tokens`（fold 結果）
- 状態: `state.tokens` に対する派生（例 `tokens.$status: "idle" | "active" | "done" | "error"`、`tokens.$error`）。
  - 命名・置き場所（サブプロパティ vs 兄弟プロパティ）は未確定。fetch の triad（loading/error/data）と整合させる方向。

---

## 4. 決めるべき論点（重要順）

### 4-1. 依存駆動の cancel / restart（最重要・最難）★

`source` が `state.prompt` のような他の state に依存する場合、prompt が変わったら**古い stream を abort して張り直す**必要がある（RxJS の `switchMap` 相当）。

- computed の依存追跡を **async な寿命に拡張**する話になる。依存が変化したら：
  1. 現行 stream の AbortSignal を発火（古い購読を確実に停止）
  2. `initial` にリセット（または直前値を保持するか＝要決定）
  3. 新しい `source(state, newSignal)` を起動
- ここが本案の make-or-break。purity を欠くと「古いストリームのチャンクが新しい state に混ざる」「abort 漏れでメモリ/接続リーク」が起きる。
- **lazy 起動**（プロパティが最初に観測されたとき開始、computed と同様）か **eager 起動**かも合流論点。lazy を推すが、未観測でも副作用として走らせたいケース（事前接続）との折り合いは要検討。

### 4-2. fold セマンティクス

- **latest（置換）** と **reduce（累積）** の両対応を推奨。
  - latest: ライブ計・最新価格・センサ値。
  - reduce: トークン累積（`acc + chunk`）・イベントログ・配列 push。
- reduce の `initial` は必須。fold は同期関数前提（async fold は再入を複雑化するため第1段では非対応を推奨）。

### 4-3. backpressure 放棄の明文化（規範）

- バッファは「畳み込んだ state そのもの」。**需要信号は逆流しない**（DOM/binding から producer へ「遅いから待て」を伝える手段は持たない）。
- 帰結: **無限ストリームを生配列に push し続けるのは footgun**（メモリ枯渇）。
- 規範として明記する: 「巨大／無限ストリームは latest・count・last-N・ウィンドウ集計など**有界な fold** にせよ。生の全チャンク累積は有限ストリーム限定」。

### 4-4. coalesce（再入・性能）

- 高頻度ストリーム（高速トークン / 60fps センサ）はチャンク毎に更新サイクルを回すと thrash する。
- spread/fetch で導入済みの **microtask coalesce** をここでも効かせ、1 tick 内の複数チャンクを1回の更新に畳む（fold は各チャンクに適用、binding 反映は coalesce）。

### 4-5. error / done の扱い

- source が throw / reject → `$status="error"` ＋ `$error` に格納。値は直前の fold 結果を保持（要決定: リセットしない方向）。
- 自動再接続は**しない**（SSE のネイティブ再接続と違い、汎用 source に再接続概念は無い）。再試行は `state.prompt` 等の依存を叩き直す＝ 4-1 の restart 経路に委ねる。

### 4-6. $watch との双対（境界整理）

- 本案は「**stream → state（inward）**」。外部フローを state に取り込む。
- 逆向き「**state path → stream（outward）**」（state 変化を ReadableStream / async iterable として外へ出す）は [[watch-hook-design]] の領域。
- 両者を別物として整理し、将来「reactive adapter（双方向）」として統一する余地を残す。混ぜると濁る（event-token と $watch を分離した判断と同型）。

### 4-7. source として受ける型

- **async iterable を lingua franca** にする（`for await...of`）。modern ブラウザの ReadableStream は `Symbol.asyncIterator` を持つためそのまま流せる。async generator・自前 iterable も同列。
- Promise（単発）は computed で足りるので対象外。Observable 風（`subscribe`）の取り込みは将来オプション。

---

## 5. 意義の評価

- **タグ案より意義が大きい**。impedance mismatch が解けるのは state 層であり、fold をそこに置くことで「load できない backpressure」を正直に捨てて筋を通せる。
- **統一プリミティブになりうる**: fetch streaming（`response.body`）・SSE・async generator・将来の MediaStreamTrack processor まで「ただの source」に一般化でき、個別 async タグの上位概念になりうる。
- **哲学的に最も整合**: 「フロー＝状態遷移の列」で、wcstack の「すべてを状態遷移に」と全 async 仕事の中で最も噛み合う。
- **ただし blast radius が proxy core**。周辺タグと違い隔離されておらず、特に 4-1（依存駆動 cancel/restart）は computed の async 寿命拡張という難所。要求される設計精度が高い。

---

## 6. 推奨スコープと次段

- **厳格スコープ**: 「汎用 Streams パイプライン / backpressure 保持」ではなく「**async producer を fold して reactive property にする adapter**」に限定する。欲張ると mismatch の壁に逆戻りする。
- **次段の選択肢**:
  1. 本 SPEC を詰める（特に §4-1 cancel/restart と §4-3 有界 fold 規範を確定）。
  2. 最小 PoC（fetch body streaming → reduce で text 累積）を既存 state パッケージ上で 1 本組み、更新サイクル・abort・coalesce の実機挙動を検証してから SPEC を固める。
- いずれにせよ **core 拡張ゆえ SPEC 先行**を推奨。

---

## 7. wc-bindable-protocol における stream の扱い（境界の規約）

§1〜§6 は **state 内部**で外部フローを fold する話（state への供給経路）。本節はその表裏、**state⇄element 境界**（wc-bindable-protocol）で stream をどう扱うかの規約。

### 7-0. 結論: stream サーフェスは追加しない

wc-bindable の3サーフェス（properties / commands / event-token）に **stream 専用の第4サーフェスを足してはならない**。stream は境界で既存3サーフェスに分解される。**ライブな stream ハンドル（ReadableStream 等）が binding 境界を越えること自体を禁じる。**

### 7-1. なぜ stream を新サーフェスにしないか

wc-bindable の境界が運ぶのは「値のスナップショット・イベント通知・メソッド呼び出し」の3つだけ。live ハンドルを流すと protocol の根幹が3つ壊れる:

1. **再評価可能性（idempotency）の崩壊** — binding は再評価できなければならない（[[spread-undefined-writeback]] / spread 冪等化の系譜）。stream は **consumed-once・stateful** で、binding 張り直し時に消費済みストリームを再配達できない。値は再評価で同値を返せるが stream は返せない。**決定的**。
2. **fan-out との非両立** — command-token / property は「1 token → N subscriber」にファンアウトする。ReadableStream は **single-consumer**。1本を複数 binding に配ると壊れる（tee の所有権・cancel 責務が宙に浮く）。
3. **スナップショット不変条件の破壊** — property は「現在の値」を持つ。stream に現在値の概念はなく、§1 のとおり fold して初めて値になる。

### 7-2. データフローとしての分解

| 向き | 何を運ぶ | サーフェス |
|---|---|---|
| element → state | チャンク（1個ずつ） | **event-token**（`message` を per-chunk dispatch）。SSE/ws が実証 |
| state → element | 制御（start/stop/cancel） | **command-token**（`connect`/`close`/`abort`） |
| state → element | 畳み込んだ値 | ただの **property**（要素は stream 由来だと知らなくてよい） |

畳み込む責務は**要素の外**（state 側 `$streams` / `$on`）。要素は内部でストリームを持っていても、**境界に出す前にチャンク＋ライフサイクルへ還元する**（SSE Core が `events` を1つの `message` event-token に集約しているのが実例）。

### 7-3. 「command か stream か」の判定線

既存フラグから自然に導ける:

- **commands は1回だけ return する**（`IWcBindableCommand.async?` ＝ Promise を1つ返す）。
- **時間軸で複数値が届くものは command の戻り値で表せない** → event-token になる。

規範: **一度きりの結果＝command の戻り値 / Promise、繰り返し届くもの＝event-token。** streaming を `async command` の戻り値で表現してはならない。

### 7-4. 例外: 不透明ハンドルを「まるごと」渡す場合

`<video>.srcObject` への MediaStream 委譲など、要素側がリーダ/再生を回すケース。**property にしてはならない**（snapshot でなく 7-1 の3問題を踏む）。代わりに **command-token の引数として透過**する:

```html
<video-host data-wcs="command.attach: $command.setStream">
```
```js
state.$command.setStream.emit(mediaStream)   // emit 引数は要素メソッドへ pass-through
```

これは [[command-token-arguments-proposal]] の「emit 引数は要素メソッドへ pass-through（MUST）」にそのまま乗る。**ハンドルは command の引数として通り、reactive property にはならない。**

### 7-5. protocol への規範文言案

1. wc-bindable に stream 専用サーフェスは設けない。
2. property の値型に live stream（ReadableStream 等）を取ってはならない（再評価可能性・single-consumer・snapshot 不変条件に反する）。
3. 繰り返し届くデータは event-token（per-chunk dispatch）で表す。command の戻り値で multi-emit を表現してはならない。
4. ストリームの制御（start/cancel）は command-token。
5. 不透明ハンドルを要素へ委譲する場合は command-token の引数として透過し、property にしない。
6. フロー→値の畳み込みは state 側（`$streams` / `$on`）の責務。要素は境界に出す前にチャンク＋ライフサイクルへ還元する。

> 一言で: **値は property、ハンドル/オブジェクトは command 引数、繰り返し通知は event-token。stream そのものは property の値型になれない。**

---

## 8. signals 版 `streamResource` による先行検証（2026-06-14）

本案（state core の `$streams`）は proxy core への侵襲が大きく未着手だが、**反応性エンジンを差し替えた姉妹案 `@wcstack/signals`（[[signals-state-design]]）で同一セマンティクスを `streamResource` として PoC 実装し、本案の未確定論点を実機で確定した**。state の proxy と signals の cell は基盤が違うが、**adapter のセマンティクスは同一**＝ signals PoC が本案 `$streams` の実行可能な参照仕様になる。

### 8-1. PoC で確定した共有契約

| 論点 | 本案での状態 | signals PoC での確定 |
|---|---|---|
| §4-1 restart 時の value | 「initial にリセット or 直前値保持＝要決定」 | **initial にリセット**（新しい計算は初期状態から）。予測可能性を優先 |
| §4-5 error 時の value | 「リセットしない方向（要決定）」 | **直前の fold 結果を保持**（error/status のみ更新） |
| §4-2 fold | latest + reduce 両対応推奨 | 両対応。**既定は latest（置換）**、reduce は `initial` 必須 |
| §4-7 source 型 | async iterable を lingua franca | 採用。**ReadableStream は `Symbol.asyncIterator` が無ければ `getReader()` フォールバック**（Safari 等の現実対応） |
| §3 コンパニオン | status/error を fetch triad と整合 | `status: "idle"|"active"|"done"|"error"` + `error` を確定 |
| §4-1 cancel/restart | 最難・switchMap | `source(args, signal)` に AbortSignal を渡し、依存変化で abort→reset→再起動。**stale-drop は `signal.aborted` チェックで全経路（チャンク/完了/throw）** |
| §4-3 backpressure | 放棄を規範化 | 放棄。fold 結果がバッファ＝需要は逆流しない。**有界 fold 推奨を規範として明記** |
| §4-4 coalesce | microtask coalesce | signal の effect スケジューラがそのまま coalesce |

### 8-2. state 側で異なる/追加で要る点

- **宣言の置き場所**: signals は `streamResource(source, {args, fold, initial})` を**命令的**に生成。state は `$streams` **宣言マップ**（§2）で、source が `state` を受ける。論点はパス依存追跡（依存駆動 restart）を proxy の computed 依存に乗せる部分＝ここだけ proxy core 固有で、PoC の effect 版より難所（§4-1 の「computed の async 寿命拡張」は残課題）。
- **値の置き場所**: signals は cell。state は path-addressed な reactive プロパティ＋コンパニオン（`tokens.$status` 等の命名は本案 §3 のまま未確定）。
- **オーナーシップ**: signals は owner ツリー（createRoot/onCleanup）で要素 disconnect 時に stream を abort（実証済み）。state は既存の binding ライフサイクルに同じ「disconnect→abort」を接続する必要がある。

### 8-3. 帰結

§4-1（restart リセット）と §4-5（error 保持）の二つの「要決定」は **確定**（上表）。fold 既定=latest、source=async iterable+getReader、status コンパニオン形も確定。残る本案固有の難所は**パス依存駆動の cancel/restart を proxy computed に乗せる**一点に絞られた。signals PoC のテスト（latest/reduce/initial/restart-reset/stale-drop/error-keep/abort-swallow/getReader/owner-dispose）が本案の受け入れ条件のひな型になる。

---

## 関連

- [[signals-state-design]] — signals 版。`streamResource` が本案 `$streams` の実行可能な参照仕様（§8）。
- [[watch-hook-design]] — 逆向き（state → 監視/stream）の領域。双対として整理。
- [[command-token-protocol]] / [[event-token-protocol]] — state⇄element の pub/sub。stream は「外部 → state」の第3の供給経路。§7 で境界規約を整理。
- [[command-token-arguments-proposal]] — 不透明ハンドルを command 引数で透過する根拠（§7-4）。
- `async-tag-candidates` — 本案の出発点（stream をタグ化する案の却下）。
