# リスト置換時の依存展開スケーリング問題と diff-filter 展開の設計検討

Status: 設計検討（未実装）
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

## 6. 補足: 関連する残観察

- `onSelect` の O(全行) は動的エッジ（`_walkExpandWildcard`）経由なので本提案の
  対象外。同じ diff-filter の考え方を適用するには「selectedIndex の変化で
  .selected が変わる行は旧選択行と新選択行の 2 行だけ」という値レベルの知識が
  必要で、これは別問題（値ベースの依存カット）。
- clear10k 後のヒープ残留（quick wins 後も ~17MB）はプール（上限 1000）以外の
  保持源がある。ヒープスナップショットのドミネータ解析が必要（未調査）。
  候補: インターンされる address/listIndex/キャッシュエントリのグラフ。
