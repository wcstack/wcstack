# 依存ウォークの訪問順序契約

Status: **実装済み** — `src/dependency/topologicalRank.ts` / `src/dependency/walkDependency.ts`
Date: 2026-08-03
Related: docs/list-replacement-dependency-scaling.md（同じウォークの展開範囲の設計）

## 1. 不変条件

> **依存ウォークが state の値を読む時点で、その値の入力に当たるパスはすべて
> dirty 化済みでなければならない。**

`walkDependency` は「無効化する」だけの走査ではない。`list` → `list.*` を展開する
には行数と listIndex が要るため、**ウォークの途中でリスト実体を読む**
（`_collectDependencies` の静的子展開と `_walkExpandWildcard`）。読み取りは
getter を評価しうるので、その時点でグラフの無効化が中途半端だと、getter は
古い入力で値を確定させてしまう。

## 2. 破れると何が起きるか

ダイヤモンド依存（共通の源を持つ兄弟 getter 2 本が合流する形）で顕在化する。

```js
month → offset  ─┐
      → lastDate ┴→ weekCount → weeks（for: の対象）
```

DFS だと `offset` の枝を先に降りて `weeks` に到達し、`lastDate` がまだ clean
（＝旧値）のまま `weekCount` / `weeks` を評価して clean としてキャッシュに書き戻す。
その後 `lastDate` の枝が `weekCount` を dirty にし直しても、`weeks` は既に
`visited` なので callback が再度走らず、**古い値が apply 段階まで生き残る**。

観測される症状は 2 つ:

- computed なリストが **1 更新ぶん遅れて**描画される（行数が前回の値のまま）
- 長さが変わらない**並べ替え**で、行 getter が前のリスト由来の値を表示し続ける
  （行数は正しいので気づきにくい）

稀な形ではない。ランダム依存グラフ 300 個の差分テストで、この契約が無い実装は
**263 個で不一致**になった（`__tests__/integration.dependencyOrderFuzz.test.ts`）。

## 3. どう保証しているか

パス単位の **rank（到達可能部分グラフ上の最長経路長）** を先に求め、rank の昇順に
バケットで訪問する。rank は `staticDependency` / `dynamicDependency` だけから
決まり、**値を一切読まない**。

rank の定義から、辺 (u → v) が存在すれば必ず `rank(u) < rank(v)`。したがって
バケット `r` を処理する時点で rank < r のパスは全て訪問（dirty 化）済みであり、
同じバケット内のパス同士は互いに先行関係を持たない。これが §1 の不変条件そのもの。

- **循環**: 入次数が 0 に落ちないパスには正しい評価順が存在しない。確定済みの
  最大 rank の次にまとめ、打ち切りは従来どおり `visited` が担う。Kahn 緩和の
  途中で付いた暫定 rank は確定扱いにしない（確定パスとの前後関係を誤って
  表してしまうため）。
- **深さ上限**: `MAX_DEPENDENCY_DEPTH` は DFS 深さではなく rank で判定する。
- **キャッシュしない**: rank のメモ化は実測で差が出なかったため持たない。
  持たせるとグローバル可変状態と「依存マップの変更は `_addDependency` 経由のみ」
  という暗黙の不変条件を抱えることになる。

## 4. 変更するときの注意

- ウォークに**値を読むステップを足すときは、それが rank 順で守られているか**を
  確認する。`_collectDependencies` の外（例えば callback 側）で値を読むと、
  この契約の外に出る。
- 依存辺の種類を増やす場合、`topologicalRank.ts` の到達可能グラフ構築が
  その辺も辿ることを確認する。辿らない辺があると順序保証が効かない。
- 「無効化の途中で確定させない」だけの対処（読み取り結果をキャッシュに
  書き戻さない等）は**不十分**。展開する行集合そのものが古い値から決まるため、
  同じ差分テストで 300 個中 27 個が残る。

## 5. テスト

| ファイル | 何を固定するか |
| --- | --- |
| `__tests__/dependency.topologicalRank.test.ts` | rank 契約（直列・不揃いダイヤ・static/dynamic 併用・重複辺・未到達・自己ループ・循環・深さ上限） |
| `__tests__/integration.dependencyOrderFuzz.test.ts` | ランダム DAG を素の JS の期待値と突合（既定 50 seed、`DIFF_SEEDS` で増やせる） |
| `__tests__/integration.diamondListStale.test.ts` | カレンダー形の兄弟 getter ダイヤ・並べ替え・1 バッチ複数 set・リスト getter の評価回数 |
| `__tests__/integration.diamondDiscriminator.test.ts` | 腕の長さが不揃いなダイヤ（BFS レベル単位の整合では通らない形。1 本はリスト展開を跨ぐ） |
