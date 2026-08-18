# 設計: `$watch` — state の headless 変更購読

- **状態**: 論点整理完了・決定済み（2026-08-19）。実装前。§0 の決定レコードが正本。手順は [state-watch-impl-plan.md](./state-watch-impl-plan.md)。
- **対象**: `@wcstack/state` の core 拡張。周辺タグと違い proxy core / updater / 依存グラフに触れる。
- **一言で**: 「**binding を経由せずに state の変更を購読する**」ための宣言マップ。`$updatedCallback` の細粒度版ではなく、`$updatedCallback` が構造的に届かない領域（binding の無い値）を埋めるもの。
- **前提資産**: updater の drain 終了フック（`registerUpdateBatchListener`）、same-value guard、`$streams` の宣言・registry・後始末の作法、`getScopedIndexes`、伝播 context の hop 上限。
- **双対**: [state-stream-type-design.md](./state-stream-type-design.md) §4-6 の「outward（state → 外）」に対応する。stream が inward（外 → state）、watch が state 変化の観測。

---

## 0. 決定レコード

| ゲート | 論点 | 決定 |
|---|---|---|
| **D1** | 何を作るのか | **headless 購読**。`$updatedCallback` は binding 駆動で、live DOM binding が適用されたパスしか載らない。画面に出していない値の変化を state 側で捕まえる手段が現行 API に無い（`packages/state/docs/streams.md` にその穴を明記済み）。パス別ディスパッチと prev は同梱するが、存在理由は headless。 |
| **D2** | 発火点 | **updater の drain 終了フック**（`registerUpdateBatchListener`）。`$streams` の依存駆動 restart と同じ土俵。結果として **`$watch` は `$updatedCallback` より後**に走る（§3-2）。 |
| **D3** | prev の意味論 | **バッチ開始時点の値（first-write-wins）**、**スカラ限定**。参照型では `undefined`（§4）。 |
| **D4** | 同値・occurrence | **`$watch` は独自の発火条件を持たない**。「updater のバッチに載ったアドレス」をそのまま発火する。`cur !== prev` の判定は watch 側では行わない（§4-2）。 |
| **D5** | computed（getter） | **opt-in で eager 化**。watch 対象の getter は宣言時に依存グラフへ登録され、drain 終端で強制評価される。「**watch した getter は lazy でなくなる**」を規範として明記する（§5）。 |
| **D6** | ワイルドカード粒度 | **絶対アドレス単位で per-address 発火**（要素ごとに複数回）。indexes は `getScopedIndexes` に揃える（§6）。 |
| **D7** | 再入・例外 | ハンドラごとに try/catch して `console.error` ＋ devtools に流し、drain と他 watch を巻き添えにしない。再入は **watch 連鎖の深さカウンタ**（既定 32）で打ち切る（§7）。 |
| **D8** | `this` とスコープ | **writable proxy**（`$updatedCallback` と同じ）。**`@stateName` 越境の watch は認めない**（自 state のパスのみ）。 |

---

## 1. 出発点の訂正（実測 2026-08-19）

この設計の初期メモ（2026-06-06）は、以下の 2 点で現在のコードと食い違っている。設計判断がここから反転しているため、先に訂正しておく。

| 初期メモの前提 | 実際 |
|---|---|
| 発火点を新設する必要がある | **既にある**。`packages/state/src/updater/updater.ts:15-42` の `registerUpdateBatchListener` が drain 終端で dedup 済み絶対アドレス Set を配る（同 :164）。`$streams` の依存駆動 restart が実利用中（`stream/streamRuntime.ts:187`）。 |
| 旧値はどこにも保持していない | **primitive は既に読まれている**。same-value guard が `Object.is` 比較のため書き込み直前の値を読み（`proxy/methods/setByAddress.ts:307-316` / :357-364）、devtools sink へ `oldValue` として渡している（同 :320-328）。参照型だけが未取得。 |
| `$watch` を先、`$updatedCallback` を後に実行 | **逆になる**。`$updatedCallback` は binding 適用ループの内側（`apply/applyChangeFromBindings.ts:97-101`）、drain リスナー通知はその外側（`updater.ts:164`）。D2 を採る以上 watch は後。 |
| `cur !== prev` の発火判定を新規に実装 | 既定構成では**ほぼ自動で成立している**。同値 primitive 書き込みは enqueue 自体がスキップされる。ゆえに D4（判定を持たない）。 |

---

## 2. 宣言構文

`$streams` / `$commandTokens` / `$eventTokens` / `$listKeys` と並ぶ宣言マップ `$watch` を予約する。

```js
export default {
  isLoading: false,
  items: [],
  get total() { return this.items.reduce((a, x) => a + x.price, 0); },

  $watch: {
    // スカラ: 立ち上がり検出は cur/prev をユーザーが比較する
    isLoading(cur, prev) {
      if (cur === true && prev === false) { this.startedAt = Date.now(); }
    },

    // ワイルドカード: 行ごとに 1 回、indexes は自スコープ分だけ
    "items.*.price"(cur, prev, index) {
      this.priceLog = `#${index}: ${prev} → ${cur}`;
    },

    // computed: この宣言によって total は eager になる（§5）
    total(cur, prev) { /* ... */ },
  },
}
```

### 2-1. シグネチャ

```
function (cur, prev, ...indexes): void
```

- `this` は **writable な state proxy**（D8）。ハンドラ内の書き込みは通常の書き込みとして次のバッチに乗る。
- `indexes` はそのパスのワイルドカード分だけ、`getScopedIndexes(listIndex, wildcardCount)`（`list/wildcardLevel.ts:50-57`）が返す列を展開して渡す。**bind-component の子スコープに置かれても意味が変わらない**（Δ 段は境界の内側に閉じる）既存規約に合わせる。
- 戻り値は無視する。**`await` しない**（command-token の引数素通し規範と同じ姿勢）。async 関数を書いた場合、その中の書き込みは別のバッチになる。

### 2-2. バリデーション（`processWatchDeclaration` にて `raiseError`）

`$streams` の `processStreamsDeclaration`（`stream/processStreamsDeclaration.ts:42-119`）を雛形にするが、**キーがパスである**点だけ異なる。

- `$watch` はオブジェクトであること。各値は関数であること。
- キーは自 state のパス文字列。**`@stateName` を含む越境指定はエラー**（D8）。
- `.` / `*` は**許可する**（`$streams` と違い watch は本質的にパス）。`getPathInfo` で解析できること。
- `*` を含む場合、ワイルドカード段数は `MAX_WILDCARD_DEPTH` 以内。
- 空文字・`$` 始まり（予約名前空間）・`Object.prototype` の継承名（`__proto__` / `constructor` 等）はエラー。理由は `$streams` §1-2 と同じ。
- setter として宣言済みのパスとの衝突は**許可**する（setter 経由の書き込みも通常の write なので watch できる）。getter との衝突も許可（§5 の eager 化が適用される）。

---

## 3. 発火モデル

### 3-1. 経路

1. 書き込み → `setByAddress` → `notifyWrite` → `updater.enqueueAbsoluteAddress` ＋ `walkDependency` で依存アドレスも enqueue
2. microtask で `_applyChange` → binding 適用 → `$updatedCallback`（binding 駆動）
3. `notifyUpdateBatchListeners(new Set(contextByAbsoluteAddress.keys()))`（`updater.ts:164`）
4. **watch の drain リスナーがここで走る**。バッチのアドレス集合と、宣言された watch パスの照合を行い、hit したハンドラを呼ぶ

バッチに載るのは binding の有無に関係ないアドレス全部なので、3 の時点で headless 購読は成立する。**ただし §8 の依存グラフ登録が前提**。

### 3-2. 実行順序（規範）

順序は 3 つの層に分かれる。**どの層も「決まっている」か「利用者が宣言で決められる」かのどちらかで、暗黙の順序に依存させない。**

**層 1 — 機構間（固定。利用者の選択肢は無い）**

1 バッチにつき **`$updatedCallback` → `$watch` → `$streams` の依存駆動 restart**。

- `$updatedCallback` が先なのは構造的必然（binding 適用ループの内側で呼ばれる。`applyChangeFromBindings.ts:97-101`）。watch を先にするには同ファイルの改造が要るが、**改造しない**。`$updatedCallback` は「DOM に何が適用されたか」の要約、watch は「state で何が変わったか」の通知であり、DOM 適用済みを前提に副作用を書けるほうが両者の性格に合う
- `$watch` が stream restart より先なのは、watch ハンドラの書き込みが同じバッチの restart 判定に影響しないようにするため（watch → restart の一方向）
- **担保は import 順ではなく優先度で行う**。`registerUpdateBatchListener(listener, priority)` に priority を追加し、`WATCH_LISTENER_PRIORITY < STREAM_LISTENER_PRIORITY` を定数で固定する。モジュールの import 順に順序が乗っていると、無関係な import 整理で静かに壊れる

**層 2 — watch ハンドラ間（`$watch` の宣言順。利用者が制御できる）**

同一バッチで複数の watch が hit した場合、**`$watch` オブジェクトのキーの宣言順**に呼ぶ（`Object.keys` の順）。enqueue 順ではない。

利用者が順序に意思を持てる唯一の層なので、ここを宣言順にする。「B より先に A を走らせたい」は宣言を並べ替えれば済み、それ以外に順序を指定する構文は用意しない。

**層 3 — 同一 watch パスの複数行（index 昇順）**

ワイルドカードパスが複数行で hit した場合、**indexes の辞書順（多段なら外側の段から昇順）**に呼ぶ。enqueue 順は書き込みの都合で決まるため「保証しない」としてしまうと、利用者は結局実装を読むことになる。昇順に固定する。

### 3-3. 順序規約の要約

| 層 | 順序 | 利用者の制御 |
|---|---|---|
| 機構間 | `$updatedCallback` → `$watch` → stream restart | 不可（固定） |
| watch ハンドラ間 | `$watch` の宣言順 | **宣言を並べ替える** |
| 同一パスの行間 | indexes 昇順 | 不可（固定） |

### 3-4. 中間値は観測できない

同一 tick 内の `a → b → c` は 1 バッチに畳まれ、watch は `cur = c` / `prev = a` を 1 回だけ受ける。これは binding 更新・`$streams` の status 遷移と同じ既存契約であり、watch だけ例外にはしない。

---

## 4. prev の意味論

### 4-1. 基準時点とスカラ限定（D3）

- `prev` = **そのバッチで最初にそのアドレスへ書き込む直前の値**（first-write-wins）。`cur` = drain 時点の確定値。
- 旧値台帳は `Map<IAbsoluteStateAddress, unknown>`。**バッチ内で最初の 1 回だけ**記録し、drain 後にクリアする。
- **参照型（object / array）では `prev` は `undefined`**。理由は 2 つあり、どちらも回避不能:
  - same-value guard は参照型を素通しするため旧値を読んでいない。読むと in-place 変異取りこぼし防止の設計に追加コストが乗る。
  - 読んだとしても in-place 変異では `prev === cur`（同一参照）で差分にならない。
- したがって `prev` が意味を持つのは **スカラ（primitive / null）だけ**。ドキュメントにこの限定を明記する。「参照型でも一応何か渡す」は誤誘導なので `undefined` に倒す。
- 実装は same-value guard が読んだ旧値を再利用し、**watch のために追加の `getByAddress` はしない**（実装計画 A-4）。その帰結として **`config.sameValueGuard = false` のときも `prev` は `undefined`** になる。guard OFF は実質デバッグ用途であり、prev のために別経路の読みを増やすほうが害が大きい。

### 4-2. 発火条件を持たない（D4）

`$watch` は `cur !== prev` を判定しない。「updater のバッチに載ったアドレス」をそのまま発火する。これにより既存の 3 つの契約と自動的に整合する:

| 経路 | 挙動 | watch |
|---|---|---|
| 通常の primitive 書き込み・同値 | same-value guard が enqueue ごとスキップ | 発火しない（＝実質 `cur !== prev` 発火） |
| `config.sameValueGuard = false` | 同値でも enqueue | 発火する（`cur === prev`） |
| occurrence（`semantics: "event"`、`proxy/occurrenceWrite.ts`） | ガードを 1 回だけ飛ばして必ず enqueue | **発火する**（同じ payload の再発生を落とさない既存の意図を保つ） |
| `$postUpdate`（in-place 変異の通知、`proxy/apis/postUpdate.ts`） | set トラップを通らず enqueue | 発火する。`prev` は `undefined`（旧値が存在しない） |
| `$streamStatus.*` / `$streamError.*` の通知 | 同上 | 同上 |

もし watch 側に `cur !== prev` 判定を置くと、**occurrence の「同値でも取りこぼさない」という意図的な設計を静かに壊す**。発火粒度のつまみは `config.sameValueGuard` 一本に保つ。

立ち上がり検出（`cur === true && prev === false`）はユーザーコードで書く。宣言例（§2）がそのまま idiom。

---

## 5. computed（getter）— watch すると eager になる（D5）

### 5-1. 現状

computed は lazy。書き込みは `dirtyCacheEntryByAbsoluteStateAddress` で dirty を立てるだけ（`cache/cacheEntryByAbsoluteStateAddress.ts:23-30`）で、読まれるまで再計算されない。しかも **cache entry が無い（一度も読まれていない）getter は dirty すら記録されない**（同 :26-29 の `if (cacheEntry)`）。加えて getter の依存（dynamicDependency）は**評価時に張られる**ので、一度も評価されていない getter は依存グラフにも載っていない。

### 5-2. 決定

`$watch` に getter のパスを宣言した場合:

1. 宣言時にそのパスを依存グラフへ登録する（§8）
2. drain 終端で、そのバッチに hit したら **強制評価**して `cur` を得る
3. `prev` は前回評価値のスナップショット台帳（`Map<IAbsoluteStateAddress, unknown>`、stateElement 寿命）から取る。初回は `undefined`

**「watch 対象の getter は lazy でなくなる」ことを規範として README / SPEC に明記する。** 副作用は 3 つ: (a) 画面に出していなくても毎バッチ評価される、(b) getter 内の例外が watch 経由で表面化する、(c) 評価のたびに依存が再登録される。これらは「opt-in で eager 化した」の当然の帰結であり、隠さない。

重い getter を watch するのは利用者の判断。ドキュメントで「重い computed の watch は評価コストが毎バッチ乗る」と警告する。

---

## 6. ワイルドカード（D6）

### 6-1. per-address 発火

バッチには listIndex 込みの絶対アドレスが載っているので、`items.*.price` の watch は**変化した行ごとに 1 回ずつ**呼ぶ。`$updatedCallback` の `indexesListByPath`（1 パスにつき indexes の配列を集約）とは形が違う ── watch はパス別ディスパッチが存在理由なので、集約せず素朴に per-address で呼ぶほうが用途に合う。

呼び出し順序は **indexes 昇順**（§3-2 層 3）。enqueue 順ではない。

### 6-2. 粒度は「書き込みの分解」に従う

同じ利用者操作でも、宣言の有無で watch の発火は変わる。これは watch の挙動ではなく**書き込みがどのアドレスに分解されるか**の差である。表で明記する:

| 操作 | `$listKeys` 宣言 | 書き込みの分解 | `items` の watch | `items.*.price` の watch |
|---|---|---|---|---|
| `state.items = [...]` | なし | 配列 1 write | 発火（`prev` は参照型なので `undefined`） | 依存展開で載った行のみ発火（`prev` は `undefined` になりうる） |
| `state.items = [...]` | あり | キー突合 → 変化フィールドごとの per-path write（`setByAddress.ts:231-250`） | 発火 | **変化した行だけ**発火し、`prev` はスカラとして正しく取れる |
| `state.items[0].price = 9` | — | 葉 1 write | 発火しない | 行 0 で発火 |

`$listKeys` を宣言したほうが watch の粒度と `prev` の質が上がる、という関係になる。これは既存の設計（キー付きリストは行の同一性を保つ）の自然な帰結なので、そのまま文書化する。

---

## 7. 再入と例外（D7）

### 7-1. 例外

ハンドラごとに try/catch し、`console.error` ＋ devtools sink に流して次のハンドラへ進む。**drain を壊さない**（`updater.ts:38-42` は「リスナーの throw は握りつぶさない」契約なので、watch リスナーの側で閉じる必要がある。`$streams` が entry ごとに try/catch して error 正規化しているのと同型）。

`$connectedCallback` / `$updatedCallback` が loud fail なのとは意図的に異なる。理由: watch は 1 バッチで N 個走り、しかも他機能（streams restart）と同じフックを共有するため、1 つのユーザー例外が無関係な機能を止めるのは割に合わない。

### 7-2. 再入ループ

watch ハンドラ内の書き込みは新しい microtask バッチを作るため、`MAX_PROPAGATION_HOPS`（32、`propagation/propagation.ts:62-84`）のガードが効かない。A↔B の相互 watch で無限ループになる。

`$streams` は自己依存を宣言時に `raiseError` で静的検出しているが、**watch は書き込み先が動的なので同じ手は使えない**。よって実行時に倒す:

- watch runtime が「watch 起点の連鎖深さ」を持つ。watch ハンドラ実行中に立てたフラグ下で enqueue されたバッチは深さ +1 として drain される
- 深さが **32**（`MAX_PROPAGATION_HOPS` と同値。定数は共有せず `MAX_WATCH_CHAIN_DEPTH` として別に置く）を超えたら、そのバッチの watch 発火を打ち切り `console.error` で該当パスを報告する
- 打ち切るのは watch の発火のみ。**値と binding 適用は巻き戻さない**（hop 上限超過時の quarantine と同じ姿勢、`updater.ts:112-127`）

---

## 8. 依存グラフ登録（実装必須・見落としやすい）

**`$watch` 宣言時に、対象パスを依存グラフへ登録しなければ headless 購読は成立しない。**

`setPathInfo`（`components/State.ts:686-710`）は `BindingSession`（`bindings/BindingSession.ts:1018`）からしか呼ばれない。つまり静的依存グラフに載るのは **DOM にバインドされたパスだけ**。`items` への配列代入で `items.*.price` が enqueue されるのは、そのパスがバインドされて親子チェーンが張られているからであって、watch を宣言しただけでは `walkDependency` はそのパスを知らない。

これは PR#157（`getMovedRowExpansionPaths` が `$1` 依存 getter を取りこぼしていた欠陥）と同じ根っこ ── **「静的依存グラフはバインドされたパスしか持たない」**。

対処: `processWatchDeclaration` で、各 watch パスについて `setPathInfo` 相当（親 → 子の `addStaticDependency` チェーン生成）を行う。`bindingType` は `for` ではないので `listPaths` / `elementPaths` は汚さない。getter パスの場合は §5 の eager 化と合わせて、初回評価で dynamicDependency も張られる。

**副作用**: 依存グラフが増えるぶん、`walkDependency` の展開量が増える（バインドされていないパスまで enqueue される）。これは headless 購読の対価であり、宣言した watch パスの分だけに閉じる。

---

## 9. スコープと寿命

`$streams` と同型にする:

- registry は `WeakMap<IStateElement, Map<path, handler>>`
- `_state` 再 set のたびに `processWatchDeclaration` で作り直す。旧宣言のパスの旧値台帳・スナップショット台帳は prune する（`stream/lastNotified.ts` の `pruneLastNotified` と同じ理由）
- `disconnectedCallback` で登録解除。切断済み stateElement のハンドラは呼ばない（drain リスナー側で active 判定）
- watch を 1 つも宣言していないアプリで drain に配列・イテレータ割り当てを発生させない（`restartStreamsOnUpdateBatch` の冒頭 early return と同型）
- **越境しない**（D8）: `@stateName` 付きのアドレスは自 state のハンドラに一切マッチさせない。バッチには他 state のアドレスも載りうるので、`absolutePathInfo.stateName` で弾く

---

## 10. 性能

- **未宣言時ゼロコスト**: `stateElement.watchPaths === null` の分岐 1 個（`$listKeys` の契約と同じ）。drain リスナー側も active 集合が空なら即 return
- **旧値キャプチャは watch 宣言パスのみ**: 全書き込みに課金しない。判定は `PathInfo` のインスタンス同一性で O(1)。ただし対象は `setByAddressCore` の fast path（親を 1 回だけ解決するホットパス、`setByAddress.ts:296-346`）なので、分岐追加のコストは実測すること
- **照合方向**: バッチ（大）を回すのではなく、宣言済み watch パス（小）を回して `batch.has(absAddress)` で引く。`restartStreamsOnUpdateBatch` の `depAddresses` 側を回す判断と同じ。ワイルドカードパスは絶対アドレスが行ごとに異なるため、パス単位の逆引き台帳（`Map<absolutePathInfo, handler>`）を持ち、バッチ側を回して `absolutePathInfo` で引く形に切り替える

---

## 11. 追随先

- `manifest.ts` の `reservedStateApi`（:110-121）に `$watch` を追加 → **vscode-wcs の validator は state の「ビルド済み dist」を消費する**ため、壊れるのが増減の瞬間ではなく次の build 時（CI マトリクス外）。追随先は stateAnalyzer / preamble / `packages/lint`
- `packages/state/README.md` / `README.ja.md` と `packages/state/docs/streams.md`（:144）／ `streams.ja` 相当の **「現行 API に state-only な `$watch` / `$effects` はない」という明示記述を更新**
- `docs/state-stream-type-design.md` §4-6（inward / outward の双対）から本文書へリンク
- SPEC・`wcstack/wcstack-skill`（別リポジトリ）の references
- devtools protocol に `watch:fired` を足すか（第 2 フェーズ判断）
- SSR / hydrater で watch を走らせるか ── **第 1 段では走らせない**。副作用の二重実行を避ける

---

## 12. 第 2 フェーズ送り / 非スコープ

- 参照型の構造差分（`prev` を意味あるものにする）── in-place 変異の設計と衝突するため、やるなら別案件
- `@stateName` 越境 watch（D8 で明示的に不採用）
- 動的な watch 登録 / 解除 API（宣言のみ。`$on` と同じ姿勢）
- `$effects`（依存を自動追跡する副作用）── watch はパス明示。自動追跡は別機構であり、混ぜない
- watch の非同期完了待ち（`await` しない規範を第 1 段で固定する）
