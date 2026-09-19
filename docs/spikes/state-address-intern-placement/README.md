# Spike S — アドレス intern の置き場所の実測（2026-09-19）

[state-address-unification-impl-plan.md](../../state-address-unification-impl-plan.md) §5 の Spike S の記録。設計書 [state-address-unification-design.md](../../state-address-unification-design.md) §5-5 の (a2) / (b) を、素のパスの読み（R1）で実測して G6 を決めるためのもの。**結論は「規則 5 — 着手を止めて設計へ戻す」**（計画書 §5-2 の確定版を機械的に適用。独立した審査 3 名が一致）。数値の読み方と設計への含意は設計書 §5-5 の実測の項に書いた。ここには**再現に要るものだけ**を置く。

## 何を測ったか

`e2e/bench/plain-read.mjs`（[benchmark-read](../../../packages/state/__e2e__/benchmark-read/index.html)）で、state proxy を通した 1 回の読みの ns を 3 つの形で測る — **R1** 素のパス（キャッシュ不可・最も頻繁な読み）・**R2** getter（null 行のキャッシュ命中）・**R3** 行の getter（行のキャッシュ命中）。変種はラウンドごとに順序を回して交互に測り、1 ページ 5 サンプル × 12 ページ、統計量は最小値と p25（[計画書 §4-4](../../state-address-unification-impl-plan.md) の F10）。

## 変種（すべて main `601fda5a` の `packages/state/src` に対する patch）

| 変種 | patch | 何が違うか |
|---|---|---|
| main | — | main そのもの。`main-again` は同じバンドルを別名で入れたもの＝ノイズ床 |
| main-guard | [main-guard.patch](./main-guard.patch) | `createStateAddress` に省略可能な第 3 引数と `if (stateElement != null)` の分岐だけを足す。get trap は 2 引数のままなので分岐は取られない。**a2 / b が足場として抱えるガードの原価**を分離する対照。分岐の中は main の `TreePath`（凍結・フィールド無し）には無い `nullRowAddress` を参照する死にコードで、型検査は通していない |
| main-tp | [main-tp.patch](./main-tp.patch) | main-guard ＋ `TreePath` の引き方の変更だけ（内側を `Map` に・`has`+`get` を `get` 1 回に・凍結をやめて可変フィールド 2 つ）。get trap は変更なし。**統合と無関係に入れられる最適化**を分離する対照 |
| b | [b.patch](./b.patch) | main-tp ＋ get trap が `handler.stateElement` を渡し、素の読みが `WeakMap<要素, Map<pathInfo, TreePath>>` → `TreePath.nullRowAddress` で intern する（設計書 §5-5 の (b)） |
| a2 | [a2.patch](./a2.patch) | b と同じだが外側の表を要素の symbol キーのプロパティに置く（`State` クラスが class field として宣言。設計書 §5-5 の (a2)）。b との差はバンドルで 5 行 |
| a2flat | [a2flat.patch](./a2flat.patch) | a2 ＋ null 行のアドレスを `TreePath` 節点を経由せず、要素直下の第 2 の `Map<pathInfo, address>` から引く。**1 セッション目のあとに足した診断用**で、規則の候補ではない |

a2 と b は別々のエージェントが並行して実装し、3 観点（配置の忠実さ／ホットパスの公平さ／I1・I2 と後方互換）の反証を 2 巡通した。1 巡目はガードの綴りの非対称（`!= null` と `!== undefined && !== null`）で反証され、揃えた。a2・b は scratch コピーで state の全テストを流し、b は 3656 / 3656、a2 は 3655 / 3656（落ちた 1 件は Phase 1 の import 境界の番人 — `State.ts` が `address/TreePath` から symbol を import するため。a2 の仕様に固有で、計測には無関係）。main-guard・main-tp・a2flat は**型検査もテストも通していない**（バンドル差分の目視のみ）。

## 出所

- ビルド: `packages/state/node_modules/.bin/esbuild src/auto.ts --bundle --format=esm`（esbuild 0.27.2・無圧縮）。**リリース物（rollup + terser）ではない**。
- バンドルの sha256（先頭 16 桁）/ バイト数: main `3175840fd179b51f` / 582650・main-guard `fa586062f2487a85` / 587229・main-tp `43413b99c8ef2791` / 583395・b `70eb4295fa8d0675` / 585217・a2 `55e4979dd8931c0c` / 585577・a2flat `9f759bfde528f338` / 583853（サイズ差の大半はモジュールパスのコメント）。
- 実行環境: Chromium 149.0.7827.55（Playwright 1.61.1・headless・スロットル無し）、Node v22.19.0、Windows 11 10.0.26200、Intel Core Ultra 9 275HX（P/E コア混在・24 論理コア）。
- 3 セッションは同一機で連続実行（11:19 / 11:26 / 11:33 UTC）。独立再現ではない。

## 結果

[session-1.json](./session-1.json)（main / main-again / main-guard / a2 / b）・[session-2.json](./session-2.json)（＋ a2flat）・[session-3.json](./session-3.json)（＋ main-tp）。生サンプルは `summary.<変種>.<形>.samplesNs`（60 個・ページごとに 5 個ずつ順に並ぶ）。

R1（ns/読み・main との差・min / p25）:

| 変種 | S1 | S2 | S3 |
|---|---|---|---|
| main（絶対値） | 42.15 / 42.94 | 41.95 / 42.98 | 41.35 / 42.89 |
| main-again（＝床の元） | −0.10 / +0.11 | −0.25 / −0.11 | +1.00 / +0.50 |
| **床**（下限 1%） | **0.42** | **0.42** | **1.00** |
| main-guard | +0.45 / +0.71 | +0.70 / +0.27 | +1.05 / +0.25 |
| main-tp | — | — | +1.10 / +0.15 |
| **b** | **+3.95 / +4.38** | **+3.15 / +4.26** | **+5.20 / +5.08** |
| **a2** | **+3.05 / +4.29** | **+3.10 / +4.10** | **+3.55 / +4.45** |
| a2flat（診断） | — | +0.60 / +1.12 | +1.10 / +1.65 |

main-guard を比較先にしても b は +2.45〜4.15 / +3.67〜4.83、a2 は +2.40〜2.60 / +3.58〜4.20 で床の外。a2flat は min では main-guard と同等（−0.10 / +0.05）だが p25 は +0.85 / +1.40 で床の外。**規則 3・4 は 3 セッションとも不成立、規則 5 が発動**。比較先を main にしても main-guard にしても判定は同じ。

R2 / R3 は、この spike では新しい段を 2 回通る（get trap の intern と、残した lift の `getTreePath`）ので統合設計の値ではない。参考: main-tp 単独で R2 −1.0 / R3 −3.3〜−4.6、a2 系は R2 −2.5〜−4.0 / R3 −7.7〜−10.9、b は R2 で +1.9〜+2.6（min）と悪化。

## 注意（審査と批評の指摘）

- 床は脆い。S3 の 1.00 は main の最初のラウンドに出た 1 サンプル（41.35）の産物で、S1・S2 は 1% の下限が効いている。判定が動かないのは a2 / b の超過が床の 2.5〜12 倍あるから。±1ns の問いはこの床では裁けない。
- 要素を渡す変種はページごとの最小値が離散的なレベルに割れる（a2: 45 / 46.5 / 47〜49 / 52、a2flat: 42.5〜43.5 と 44.3〜46）。main 系は 42〜44 で単峰。min は最良のレベルしか見ない。
- 5 サンプル全部が約 2 倍のページが各セッションに 1〜2 ページある（P/E コア混在機で、レンダラが E コアに載った可能性が高いが未確認）。min には効かず p25 に 5/60 だけ混入する。
- 単一エンジン・単一機・単一パス・単一要素（`count` を 1 要素で 200 万回）。多態時のコスト・Firefox / WebKit・リリース物・アプリ水準（`jsfb-verify`）は未測定。
- 変種は統合設計の実装ではない。get trap だけが要素を渡し、他の呼び出し元は旧 intern のまま（同じ `(pathInfo, null)` に 2 つのアドレスが共存するハイブリッド）。読み取り専用のベンチなので同一性に依存する機構の正しさは検証していない。
