# 規模の検証の結果

- happy-dom: 2026-10-06T16:02:03.813Z
- Chromium: 2026-10-06T16:02:22.416Z（index.esm.js（packages/state の src から build。4.0.0-rc.5 + 規模の修正））

読み方（docs/state-engine-rewrite/scale-verification.ja.md §1・§4）:

- 判定は、仕事の回数と DOM の変更の数（happy-dom）、表の大きさ（有界性）、軸ごとの結果（限界・正しさ）で行う。回数を数える軸では、時間の伸びは警告に留める。
- 「PASS（時間は要確認）」は、回数の判定は通り、時間の伸びの指数 k だけが目安（1.25）を超えたもの。happy-dom の DOM 操作の費用で、同じ軸の Chromium の k と比べて読む。
- k は「費用 ∝ 規模^k」の指数（規模 3 段の log-log の傾き）。0 前後は規模に依らない、1 前後は比例。
- 回数は最も小さい規模の値。局所性の軸と、回数を「一定」とした軸は、どの規模でも同じ値だった。
- 時間は書き込みと drain の時間の、中ほど半分の平均。Chromium のページはクロスオリジン分離（時計の刻み 5 µs）。

## 局所性

| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |
|---|---|---|---|---|---|---|---|---|
| L1 | root のキーとバインディングが N 個: 1 個への書き込み | PASS / PASS | 100 → 10000 | 19.1 µs → 12.5 µs | -0.09 | 5.8 µs → 3.8 µs | -0.09 | 回数（100）: enqueue 1, applyBinding 1, forSubtree 3 |
| L2 | root の一覧が L 個: 一覧と無関係なスカラーへの書き込み | PASS / PASS | 10 → 1000 | 16.5 µs → 8.9 µs | -0.13 | 5.0 µs → 13.1 µs | 0.21 | 回数（10）: enqueue 1, applyBinding 1, forSubtree 3 |
| L3a | N 行の一覧: 行と無関係な書き込み | PASS / PASS | 100 → 10000 | 8.3 µs → 5.3 µs | -0.10 | 8.1 µs → 5.6 µs | -0.08 | 回数（100）: enqueue 1, applyBinding 1, forSubtree 3 |
| L3b | N 行の一覧: 1 行の 1 フィールドへの書き込み | PASS / PASS | 100 → 10000 | 6.5 µs → 3.9 µs | -0.11 | 4.4 µs → 4.2 µs | -0.01 | 回数（100）: enqueue 1, applyBinding 1, forSubtree 1 |
| L4 | 無関係な root の getter が G 個: 1 個の getter が読む値への書き込み | PASS / PASS | 10 → 1000 | 6.6 µs → 6.7 µs | 0.00 | 5.0 µs → 4.5 µs | -0.02 | 回数（10）: enqueue 1, applyBinding 1, evalGetter 1, visitGetter 1, forSubtree 5 |
| L5 | 入れ子の一覧（外 √N × 内 √N 行）: 葉の 1 フィールドへの書き込み | PASS / PASS | 100 → 10000 | 5.3 µs → 4.4 µs | -0.03 | 5.0 µs → 3.3 µs | -0.08 | 回数（100）: enqueue 1, applyBinding 1, forSubtree 1 |
| L6 | ボリューム（<wcs-state mount>）が V 個: 1 つのボリュームの値への書き込み | PASS / PASS | 5 → 200 | 8.5 µs → 6.4 µs | -0.07 | 5.1 µs → 5.8 µs | 0.03 | 回数（5）: enqueue 1, applyBinding 1, forSubtree 3 |
| L7 | bind-component の部品が C 個: 1 つの部品の値への書き込み | PASS / PASS | 10 → 500 | 2.7 µs → 4.2 µs | 0.12 | 3.6 µs → 4.5 µs | 0.06 | 回数（10）: enqueue 1, applyBinding 1, forSubtree 3 |
| L8 | 選択の $eq を読む N 行: 選択の書き込み（前と今の行だけ） | PASS / PASS | 100 → 10000 | 21.3 µs → 9.3 µs | -0.18 | 11.1 µs → 5.0 µs | -0.17 | 回数（100）: enqueue 2, applyBinding 2, evalGetter 2, forSubtree 5 |

## 線形性

| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |
|---|---|---|---|---|---|---|---|---|
| N1 | root のバインディングが N 個: 初回のマウント | PASS / PASS | 1000 → 16000 | 7.24 ms → 121 ms | 1.02 | 3.33 ms → 48.58 ms | 0.97 |  |
| N2a | N 行の一覧: 作成（空から N 行） | PASS / PASS | 1000 → 16000 | 18.90 ms → 492 ms | 1.18 | 1.41 ms → 22.80 ms | 1.00 | 回数（1000）: forSubtree 12 |
| N2b | N 行の一覧: 全行の置き換え（新しいオブジェクト） | PASS（時間は要確認） / PASS | 1000 → 16000 | 22.74 ms → 761 ms | 1.27 | 2.09 ms → 35.10 ms | 1.02 | 回数（1000）: forSubtree 12, rowRemoved 1000 |
| N2c | N 行の一覧: 全削除 | PASS（時間は要確認） / PASS | 1000 → 16000 | 3.78 ms → 414 ms | 1.69 | 281.7 µs → 4.39 ms | 0.99 | 回数（1000）: forSubtree 12, rowRemoved 1000 |
| N2d | N 行の一覧: 末尾への N/10 行の追加 | PASS / PASS | 1000 → 16000 | 3.86 ms → 80.23 ms | 1.09 | 195.0 µs → 2.46 ms | 0.91 | 回数（1000）: forSubtree 12 |
| N2e | N 行の一覧: 逆順 | PASS / PASS | 1000 → 16000 | 18.41 ms → 585 ms | 1.25 | 888.3 µs → 15.89 ms | 1.04 | 回数（1000）: forSubtree 12, indexChanged 1000 |
| N2f | N 行の一覧: 2 行の入れ替え（2 番目と最後から 2 番目） | PASS / PASS | 1000 → 16000 | 265.4 µs → 1.32 ms | 0.58 | 96.7 µs → 1.02 ms | 0.85 | 回数（1000）: forSubtree 12, indexChanged 2 |
| N2g | N 行の一覧: 中ほどの 1 行の削除 | PASS / PASS | 1000 → 16000 | 110.0 µs → 637.3 µs | 0.63 | 66.7 µs → 393.3 µs | 0.64 | 回数（1000）: forSubtree 12, rowRemoved 1, indexChanged 499 |
| N3 | 0/1 の盤面（平らな一覧、N セル）: 先頭と末尾近くの 2 セルの変更 | PASS / PASS | 10000 → 90000 | 1.00 ms → 5.85 ms | 0.78 | 415.0 µs → 3.70 ms | 0.99 | 回数（10000）: forSubtree 6, rowRemoved 2 |
| N4 | 1 つの値を読む root の getter が F 個: その値への書き込み | PASS / PASS | 10 → 1000 | 24.8 µs → 3.90 ms | 1.10 | 26.0 µs → 699.0 µs | 0.72 | 回数（10）: enqueue 10, applyBinding 10, evalGetter 10, visitGetter 10, forSubtree 23 |
| N5 | getter の連鎖が D 段: 根元への書き込み | PASS / PASS | 10 → 120 | 14.1 µs → 74.0 µs | 0.68 | 13.0 µs → 30.6 µs | 0.33 | 回数（10）: enqueue 1, applyBinding 1, evalGetter 11, visitGetter 11, forSubtree 25 |
| N6 | 全行の getter が読む root の値（$eq なし、N 行）: その値への書き込み | PASS / PASS | 100 → 10000 | 62.3 µs → 2.05 ms | 0.76 | 46.0 µs → 1.39 ms | 0.74 | 回数（100）: enqueue 100, applyBinding 100, evalGetter 100, visitGetter 100, forSubtree 103 |
| N8 | $getAll で N 行を集める getter: 1 行の値への書き込み | PASS / PASS | 100 → 10000 | 14.0 µs → 175.9 µs | 0.55 | 11.2 µs → 179.6 µs | 0.60 | 回数（100）: enqueue 1, applyBinding 1, evalGetter 1, visitGetter 1, forSubtree 3 |

## 有界性

| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |
|---|---|---|---|---|---|---|---|---|
| B1 | root の getter が読む動的なキー（dict.<id>）: id を替え続ける | PASS / PASS | 1000 → 4000 | - | - | - | - | 表: patterns 4, sources 2, rootBindings 1, rows 0（一定）<br>ヒープ/回（happy-dom）: -27 B<br>ヒープ/回（Chromium）: 95 B |
| B2 | コードから書く動的なキー（log.<id>）: 書き続ける（100 件ごとに空にする） | PASS / PASS | 1000 → 4000 | - | - | - | - | 表: patterns 2, sources 0, rootBindings 1, rows 0（一定）<br>ヒープ/回（happy-dom）: -38 B<br>ヒープ/回（Chromium）: 59 B |
| B3 | 1,000 行の一覧: 新しいオブジェクトで置き換え続ける | PASS / PASS | 50 → 200 | - | - | - | - | 表: patterns 4, sources 0, rootBindings 0, rows 1000（一定）<br>ヒープ/回（happy-dom）: 44 B<br>ヒープ/回（Chromium）: 195 B |
| B4 | if: の出し入れ（100 行の一覧を含む部分木）: 出し入れし続ける | PASS / PASS | 100 → 400 | - | - | - | - | 表: patterns 6, sources 0, rootBindings 2, rows 100（一定）<br>ヒープ/回（happy-dom）: 134 B<br>ヒープ/回（Chromium）: 75 B |
| B5 | bind-component の部品を if: で出し入れし続ける | PASS / PASS | 100 → 400 | - | - | - | - | 表: patterns 1, sources 0, rootBindings 1, rows 0（一定）<br>ヒープ/回（happy-dom）: 723 B<br>ヒープ/回（Chromium）: 258 B |
| B6 | ページの差し替え（<wcs-state> ごと 200 行のページを作り直す） | PASS / PASS | 20 → 80 | - | - | - | - | ヒープ/回（happy-dom）: -249 B<br>ヒープ/回（Chromium）: -623 B |

## 限界

| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |
|---|---|---|---|---|---|---|---|---|
| X1 | getter の連鎖の上限（128 段の入れ子） | PASS / PASS | - | - | - | - | - | {"d":126,"text":"126","errors":0,"first":"","overflow":false} {"d":127,"text":"127","errors":0,"first":"","overflow":false} {"d":128,"text":"","errors":1,"first":"[@wcstack/state] binding \"prop: g128\" failed to apply. Error: [@wcstack/state] [wcs/getter-depth-exceeded] \"g0\"","overflow":false} {"d":200,"text":"","errors":1,"first":"[@wcstack/state] binding \"prop: g200\" failed to apply. Error: [@wcstack/state] [wcs/getter-depth-exceeded] \"g72\"","overflow":false} |
| X2 | 一覧の入れ子の深さ（1 段 1 行）: 描画と葉への書き込み | PASS / PASS | - | - | - | - | - | {"d":8,"ok":true,"ms":0.15629999998782296,"errors":0,"overflow":false} {"d":32,"ok":true,"ms":0.07639999999082647,"errors":0,"overflow":false} {"d":100,"ok":true,"ms":0.14900000000488944,"errors":0,"overflow":false} |
| X3 | 自己再帰の部品の細長い木（state: . の連鎖）: 描画と葉への書き込み | PASS / PASS | - | - | - | - | - | {"d":10,"ok":true,"mountMs":144.4701999999961,"ms":1.4043999999994412,"errors":0,"overflow":false} {"d":50,"ok":true,"mountMs":815.3631999999925,"ms":4.3972000000067055,"errors":0,"overflow":false} {"d":150,"ok":true,"mountMs":2607.5315999999875,"ms":21.653100000010454,"errors":0,"overflow":false} |

## 正しさ

| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |
|---|---|---|---|---|---|---|---|---|
| C1a | 種を固定したランダムな操作 2000 回（100 行）: DOM が参照モデルと一致 | PASS / PASS | - | - | - | - | - | {"n":100,"ops":2000,"mismatches":0,"rowsAtEnd":165} |
| C1b | 種を固定したランダムな操作 500 回（1000 行）: DOM が参照モデルと一致 | PASS / PASS | - | - | - | - | - | {"n":1000,"ops":500,"mismatches":0,"rowsAtEnd":1034} |

合計: 66 / 66 が PASS。
