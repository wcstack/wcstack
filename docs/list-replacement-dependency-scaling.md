# リスト置換時の依存展開スケーリング問題と diff-filter 展開の設計検討

Status: **実装済み（静的分岐のみ・保守的版）** — §7 実装記録を参照
Date: 2026-07-12
Related: docs/state-redesign-council.md（判断表②の主張の訂正を含む）, docs/async-execution-model.md

## 1. 問題

`this.data = this.data.concat(newRows)` のような**リスト全置換**で、
`walkDependency` の静的ワイルドカード展開（`src/dependency/walkDependency.ts` の
静的子展開ループ）が `listDiff.newIndexes`（**新リストの全行**）をイテレートする。

結果、10,000 行への 1,000 行 append で:

- 依存アドレス 44,001 件（1 + 11,000 `data.*` + 33,000 子）を dirty 化・enqueue
- 未変更 10,000 行の全バインディング（約 30,000 件）が drain で再評価される
  （getter 再実行・キャッシュ再構築を含む。DOM 書き込みは終端の same-value
  ガードで抑止されるが、評価コストは全額発生する）
- 実測: append のコストが**既存行数に比例**する（既存行あたり ~5.7µs）。
  append1kTo1k ≈ 27ms に対し append1kTo10k ≈ 78ms（quick wins 適用前）

`createListDiff` は `addIndexSet` / `changeIndexSet` を計算済みで、
`walkDependency` の `getIndexes()` には "add"/"change" セレクタも既に存在するが、
これらは**動的依存の `_walkExpandWildcard` 分岐でしか使われていない**。
静的子展開は `newIndexes` をハードコードしている。

### 1.1 council doc の記載の訂正

docs/state-redesign-council.md 判断表②の「walkDependency は変更行の listIndex
のみ展開」は、**パス個別書き込み**（`this["data.5.label"] = x` — 葉から開始し
展開なし）の場合のみ正しい。**リスト全置換**では全行展開になる。同じ機構で
`onSelect`（`selectedIndex` → `data.*.selected` の動的エッジ）も O(全行) になる。

## 2. 提案: diff-filter 展開

静的子展開で `newIndexes` の代わりに `addIndexSet ∪ changeIndexSet` のみを
展開する（削除行は unmount 経路が処理する）。

期待効果: append1kTo10k ≈ 66ms（quick wins 後実測）→ 33-38ms 程度。
「append が既存行数に比例する」スケーリング欠陥の根治
（append1kTo1k と append1kTo10k が一致するようになる）。

## 3. 衝突: 行外を読む wildcard getter（隣接項目参照）

diff-filter の正しさは「**未変更行の派生値は、その行のデータだけに依存する**」
という仮定に立つ。この仮定を破る getter が既に存在し得る:

1. **隣接項目参照**（docs の adjacent-item-reference 設計）:
   `get "items.*.diff"() { return this["items.*.value"] - this.$resolve("items.*.value", [this.$1 - 1]); }`
   — 行 i の値が行 i-1 に依存する。行 i-1 だけが変更された場合、
   diff-filter では行 i が再評価されず**古い表示が残る**。
2. **リスト集計への依存**: `get "items.*.share"() { return this["items.*.value"] / this.total; }`
   — `total` が別パスなら動的依存エッジ（`total` → `items.*.share`）が
   全行展開するため現状どおり動く（この経路は diff-filter の対象外なので安全）。
3. **位置依存 getter**: `this.$1`（自行インデックス）を読む getter。
   並べ替えで**行の位置が変わった**場合、その行は `changeIndexSet` に入るため
   diff-filter でも再評価される（安全）。ただし挿入・削除による**後続行の
   インデックスシフト**も changeIndexSet に入る（createListDiff が位置変化を
   記録する）ため、これも安全。

つまり本質的な危険は **1 のケース（明示的な他行参照）だけ**である。

## 4. 設計オプション

### 案 A: 動的依存追跡で「他行参照 getter」を検出し、該当パスのみ全行展開

getter 実行時の `checkDependency` は「どのパスを読んだか」を記録している。
`$resolve` / 明示インデックスで**自行以外の listIndex** を読んだ getter パスを
「cross-row getter」としてマークし、そのパスの静的子展開だけ従来の全行展開に
フォールバックする。マークが無いパスは diff-filter 展開。

- 利点: 既存アプリの挙動を自動で保全。ベンチマーク型の「行内完結」getter は
  全て高速化される。
- 欠点: 「自行以外を読んだ」の判定実装が要る（`$resolve` の listIndexes 引数と
  現在の loopContext の比較）。初回実行まで cross-row と分からない
  （first-run は全行展開で開始し、以後絞る、が安全側）。

### 案 B: 規範で線を引く（cross-row getter を非サポート化）

「wildcard getter は自行と非 wildcard パスのみに依存できる。他行参照の結果は
リスト置換時の再評価保証外」と SPEC に明記し、無条件で diff-filter する。
隣接項目参照ユースケースは「リスト自体を置換する」イディオムで書き直してもらう。

- 利点: 実装最小・予測可能。
- 欠点: 既存の隣接項目参照設計と正面衝突する破壊的変更。SPEC 変更を伴う。

### 案 C: opt-in フラグ（config.listDiffFilteredExpansion）

既定 off で挙動不変。ベンチ・大規模リストのユーザーだけが有効化。

- 利点: リスクゼロで出荷可能。
- 欠点: 既定 off では「スケーリング欠陥」は直らない。フラグは Hyrum 化しやすい。

## 5. 推奨

**案 A を本命**とし、実装順は:

1. `checkDependency` / `$resolve` に cross-row 読み取り検出を追加（計測のみ、挙動不変）
2. 検出結果を使う diff-filter を実装、cross-row パスは全行展開へフォールバック
3. 隣接項目参照の e2e 回帰テスト（検出→フォールバックの実証）を追加してから出荷

案 B の規範追記は案 A 実装後に「cross-row は自動フォールバックにより保証される
（ただし全行展開のコストがかかる）」という**性能規範**として書くのが整合的。

## 7. 実装記録（2026-07-12）

実装したのは**静的分岐のみの保守的版**（案 A の縮小版）:

- `walkDependency` に `options.listExpansion: "full" | "diff"`（既定 "full"）を追加。
  `setByAddress` 経路のみ "diff" を渡す。`$postUpdate` は全行展開のまま。
- "diff" は静的子展開（`list → list.*`）を `addIndexSet ∪ changeIndexSet` に絞る。
  次の場合は全行展開へフォールバック:
  1. **diff に変化が一切見えない再代入**（add / change / delete すべて空。
     同一参照の再代入と、`s.items = [...arr]` のような内容同一コピー再代入の両方）
     — in-place 変異後のリフレッシュイディオムは diff に映らないため全行展開で
     従来挙動を保つ（レビューで検出・修正した取りこぼし: 当初は同一参照のみだった）
  2. **crossRowListPaths に登録されたリスト** — checkDependency が getter 評価中の
     読み取りで「共有ワイルドカード親の listIndex が評価中アドレスと異なる」ことを
     検出して自動登録する（隣接項目参照の自動フォールバック。案 A の検出部）

### 7.0 規範: in-place 変異の反映保証

生配列経由の in-place 変異（`const arr = s.items; arr[0].v = 5`）の DOM 反映が
保証されるのは次の綴りのみ:

- 同一参照の再代入 `s.items = arr`
- 内容同一コピーの再代入 `s.items = [...arr]`（構造変化を伴わないこと）
- `$postUpdate("items")`（常に全行展開）

**変異と構造変化を 1 回の代入に混ぜる**（`arr[0].v = 5; s.items = [...arr, newRow]`）
と、diff は追加行しか検出できず、変異した既存行は再適用されない（診断不能）。
per-path 書き込み（`s["items.0.v"] = 5`）が常に正しいイディオムである。

### 7.1 実装で確定した追加事実: container エッジが行 getter のフィルタを迂回する

行データを読む wildcard getter（`get "rows.*.tax"() { return this["rows.*.v"] * 10 }`）は、
値解決の**親走査**が checkDependency を通るため、`rows → rows.*.tax` /
`rows.* → rows.*.tax` の動的エッジが必ず登録される（実測で確認）。リスト置換時は
この container エッジが `_walkExpandWildcard`（searchType "new" = 全行）で展開される
ため、**行 getter を持つリストでは静的分岐のフィルタが動的エッジ経由で迂回される**
（利得なし・退行なし）。

動的展開側のフィルタは実装**しない**と判断した。`this.items.length` を読む getter
（行値が リスト構造自体に依存）の container エッジと、親走査由来の偶発的エッジが
登録時点で区別できず、フィルタすると前者が stale になるため。

ベンチマーク型のリスト（plain パスの mustache/text バインディング＋スカラーのみを
読む getter）は container エッジを持たないため、フィルタの恩恵を全額受ける。

### 7.2 フォローアップ候補（案 D: 内部走査 read の依存登録除外）

親走査（getByAddress の内部再帰）での checkDependency 呼び出しを除外できれば、
container エッジは「getter が明示的にコンテナを読んだ場合」（$getAll・$resolve・
`this.items` 直読み）だけになり、行 getter にも diff-filter が効くようになる。
依存グラフの形が広く変わるため、着手時は walkDependency 系 23 テスト＋a3 オラクル
＋集計系の統合テストを回帰基盤とすること。

## 8. 補足: 関連する残観察

### 8.1 選択（onSelect）の O(全行) と行フラグイディオム（調査済み・2026-07-12）

`this.selectedIndex = $1` ＋ `get "data.*.selected"() { return this.$1 === this.selectedIndex }`
の形は、動的エッジ `selectedIndex → data.*.selected` が `_walkExpandWildcard` で
**全行**に展開されるため O(全行)（10k 行で実測 ~7.6-8.2ms。1k 行なら ~0.7ms）。
diff-filter は静的展開のみが対象なのでこの経路には効かない。値レベルの依存カット
（同値なら伝播を止める）が必要で、getter→class 適用経路に同値カットは現状
存在しない（唯一の同値カットは applyChangeToProperty の DOM 読み比較）。

**解消はアプリ側イディオムで達成できる**: 選択フラグを行データに持ち、
2 本の葉パス書き込みで排他を維持する（`packages/state/__e2e__/benchmark/select-rowflag.html`）:

```js
onSelect(e, $1) {
  if (this.selectedIndex !== null) this[`data.${this.selectedIndex}.selected`] = false;
  this[`data.${$1}.selected`] = true;
  this.selectedIndex = $1;
}
```

葉パス書き込みは展開ゼロ（walk は葉 seed から辿るものが無い）なので O(2)。
実測: select10k **8.15ms → 0.1ms**（select1k 0.7 → 0.05ms）。
注意点: getter は削除すること（getter-only プロパティへの Reflect.set は黙って
失敗する）、行データに `selected: false` の初期化が必要（class バインディングは
boolean 以外で raiseError）。

**js-framework-benchmark への提出には使わないこと（Issue #800）**: 公式ルールは
「選択状態はアプリレベルで持つ（行ごとのフラグではなく、テーブルにつき 1 つの
参照/id/インデックス）」と定めており、行フラグ方式は "view state on the model"
として結果表に note #800 が付く（エラーではないが減点扱い。理由は「どの
ライブラリでも同じ手で速くなるため、選択伝播の効率という本来の被験対象を
すり抜ける」）。参照実装 vanillajs の行データも `{id, label}` のみ。
**提出実装は本家 index.html（selectedIndex ＋ wildcard getter）を使う** —
公式の select は 1,000 行で実施されるため実測 ~0.7ms で競争力に問題はない。
行フラグ方式は「実アプリでのイディオム」（選択がドメイン状態の一部である
場合は正当なモデリング）および将来のエンジン内 value-cut の効果上限を示す
参考実装として保持する。なお Solid の `createSelector`（選択 id は単一 signal の
まま、メモ化セレクタが変化した 2 行だけを更新）が「ルール準拠のまま O(2)」の
到達点であり、エンジン側でこれに相当するのが上記の値ベース依存カットである。

エンジン側の値ベース依存カットは、command 再発火・two-way クロバー訂正など
「同値でも再適用に意味があるバインディング」の存在により一律には入れられない。
入れるなら葉値バインディング（text/class/attr/style）限定の last-applied 比較だが、
パイプライン前段（アドレス生成・enqueue・getter 再評価）が支配項のため効果は
限定的（見積り 7.6 → 6ms 台）。優先度低。
- clear10k 後のヒープ残留（quick wins 後も ~17MB）はプール（上限 1000）以外の
  保持源がある。ヒープスナップショットのドミネータ解析が必要（未調査）。
  候補: インターンされる address/listIndex/キャッシュエントリのグラフ。
