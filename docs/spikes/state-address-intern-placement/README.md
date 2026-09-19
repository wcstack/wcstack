# Spike S — アドレス intern の置き場所の実測（2026-09-19）

[state-address-unification-impl-plan.md](../../state-address-unification-impl-plan.md) §5 の Spike S の記録。設計書 [state-address-unification-design.md](../../state-address-unification-design.md) §5-5 の (a2) / (b) を、素のパスの読み（R1）で実測して G6 を決めるためのもの。**結論は「規則 5 — 着手を止めて設計へ戻す」**（計画書 §5-2 の確定版を機械的に適用。独立した審査 3 名が一致）。 続く**追試 E1**（後半）も不成立。数値の読み方と設計への含意は設計書 §5-5 の実測の項に書いた。ここには**再現に要るものだけ**を置く。

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

---

# 追試 E1 — 足場なしの flat 形（2026-09-19）

設計書 §11 の選択肢 A（著者決定）。Spike S で分かった主因（素の読みが `TreePath` 節点を経由する固定費）を外した形が P1 を満たすかを、同じ規則で測る。**結論は「不成立」** — 2 セッションとも p25 が床の外（判定は下の表・独立審査は設計書 §5-7）。

## 変種（main `a98608d6` — `packages/state/src` は `601fda5a` と同一 — に対する patch）

| 変種 | patch | 何が違うか |
|---|---|---|
| main | — | main そのもの。`main-again`・`main-third` は同じバンドルを別名で入れた A/A（3 名） |
| main-tp | [e1-main-tp.patch](./e1-main-tp.patch) | `TreePath` の引き方の変更だけ（内側 `Map`・`get` 1 回・凍結なし・`rowAddresses` フィールド）。**前回の main-tp と違いガードを含まない**。素の読みには触れない |
| **flat** | [e1-flat.patch](./e1-flat.patch) ＋ [e1-flat-tests.patch](./e1-flat-tests.patch) | 足場なし: get trap は常に `handler.stateElement` を渡し、`createElementAddress(要素, pathInfo, listIndex)` は単一経路でガード無し。null 行は要素の **symbol キーの class field**（`State` の最初のフィールド・`IStateElement` の必須メンバ）の `Map<pathInfo, address>` から 1 回で引く。行は `TreePath.rowAddresses`。symbol は `address/elementSlots.ts` に置き、`State.ts` が `address/TreePath` を import しないようにした（Phase 1 の番人を通す）。他の呼び出し元は旧 intern のまま（Spike S と同じハイブリッド） |
| flat-str（診断） | [e1-flat-str.patch](./e1-flat-str.patch) | flat の表を symbol ではなく文字列名の public フィールド `nullRowAddresses` に置く。「symbol キーの keyed load が原因か」を切り分ける |
| flat-wm（診断） | [e1-flat-wm.patch](./e1-flat-wm.patch) | flat の表をモジュール側の `WeakMap<要素, Map<pathInfo, address>>` に置く（(b) 型の flat） |

flat はエージェントが実装し、3 観点（仕様との一致／統合設計の素の読みとの忠実さ／I1・I2 とテストの健全性）の反証で refuted なし。scratch コピーで state の全テスト 304 / 3656 が緑（モック 4 ファイルに新しいフィールドを足しただけ — `e1-flat-tests.patch`）。flat-str・flat-wm は型検査のみ。バンドルの実体差分: flat − main-tp ＝ symbol の宣言・`createElementAddress`・trap の 1 呼び出し・`State` の class field。

## 出所

同じ esbuild（0.27.2・無圧縮）・同じ Chromium 149.0.7827.55・同じ開発機。sha256（先頭 16 桁）/ バイト: main `3175840fd179b51f` / 582650（Spike S と同一）・main-tp `5c7a00c1a861edc1` / 582623・flat `54eb195dad088839` / 583675・flat-str `ee413c1334184eaf` / 583563・flat-wm `c11fc0b2e6ed55e6` / 583880。

## 結果（R1・ns/読み・main との差・min / p25）

[e1-session-1.json](./e1-session-1.json)・[e1-session-2.json](./e1-session-2.json)（事前登録の 2 セッション・24 ページ × 5 サンプル）・[e1-session-3-diag.json](./e1-session-3-diag.json)（診断・規則の対象外）。

| 変種 | S1 | S2 | S3（診断） |
|---|---|---|---|
| main（絶対値） | 41.60 / 42.95 | 41.65 / 43.19 | 41.50 / 43.05 |
| main-again | +0.50 / +0.10 | +0.55 / −0.20 | +0.25 / −0.11 |
| main-third | +0.45 / +0.09 | +0.10 / −0.10 | +0.40 / +0.34 |
| **床**（A/A 2 組の最大・下限 1%） | **0.50** | **0.55** | **0.42** |
| main-tp | −0.05 / −0.30 | +0.35 / −0.09 | +0.05 / −0.11 |
| **flat** | **+0.60 / +1.70** | **+0.30 / +1.44** | +0.45 / +0.80 |
| flat-str | — | — | +0.60 / +1.31 |
| flat-wm | — | — | +2.90 / +2.45 |

flat − main-tp: S1 **+0.65 / +2.00**、S2 **−0.05 / +1.53**、S3 +0.40 / +0.91。**min は床の縁（S2 では床以内）、p25 は 3 セッションとも床の外**。規則（両統計量・両セッション）は不成立。main を比較先にしても同じ。

ページ最小値（S3）: main は 24 ページ中 19、main-tp は 17 が 43.5ns 以下。flat は 10、flat-str は 7、flat-wm は **0**。要素が持つ表は最良ページでは main と同等だが、6 割前後のページで +1〜2ns のレベルに固定される。文字列名にしても変わらない（symbol キーが原因ではない）。要素キーの WeakMap は全ページで +2.5〜3ns（決定的）。

R2 / R3（参考・この形では新しい段を 2 回通らない — flat の trap は null 行で `TreePath` を引かず、lift は残る）: main-tp が R2 −1.2〜1.6 / R3 −3.2〜5.1、flat が R2 −2.6〜2.7 / R3 −3.9〜4.1。

---

# main-tp の単独着地（2026-09-20）

案 A を閉じたあと（設計書 §12）、`getTreePath` の引き方の変更だけを統合と切り離して着地させる。spike の main-tp との差: `rowAddresses` フィールドは付けず、`Object.freeze` は残す（spike で外したのは可変フィールドのため）。つまり変更は「内側の表を `WeakMap` から `Map` に」「各段を `has`+`get` から `get` 1 回に」の 2 点だけ。

**検証**（PR の本体）: tsc・全テスト 304 / 3656・カバレッジ不変（99.62 / 98.78 / 100 / 99.78）・lint・GC spec 4 / 4（branch の esbuild バンドル）。

**読み（同一セッション・main × 3 名の A/A・24 ページ × 5 サンプル・main との差・min / p25）**:

| 形式 | R1 素のパス | R2 getter | R3 行の getter | A/A の揺れ（R1） |
|---|---|---|---|---|
| esbuild 無圧縮（[tp-esbuild.json](./tp-esbuild.json)） | −0.05 / −0.31 | −1.50 / −1.02 | −4.90 / −3.74 | ±0.25 / ±0.16 |
| **rollup + terser（配布形式・[tp-release.json](./tp-release.json)）** | **−0.05 / +0.09** | **−3.70 / −2.64** | **−3.75 / −4.65** | ±0.2 / ±0.15 |

R1 はこの関数を通らないので中立（A/A の揺れの中）。R2・R3 は 5 セッション（Spike S の S3・E1 の 3 本・ここ）で一貫して改善。配布形式のほうが R2 の改善が大きい。

**リスト（`jsfb-verify`・配布形式・main と交互に 5 回ずつ・中央値 ms）**: create1k 41.85 → 40.35、update10k 12.6 → 12.5、swap1k 0.9 → 1.0、remove1k 2.95 → 2.75、append1kTo10k 59.75 → 62.1、clear10k 68.7 → 67.7 — いずれも main 同士の実行間の揺れの中（append は main が 49〜62、tp が 57〜65）。`replace1k` だけは 14〜16ms と 24〜26ms の 2 モードを実行内で行き来し、5 回では tp に高いモードが偏った（37/50 対 7/50）ので、replace だけを 8 ページ × 12 サンプルで main・tp・main-again の 3 者交互に測り直した: 高いモードの比率は main 59/96・tp 50/96・main-again 38/96、最小値は 13.5 / 13.7 / 13.1。**同じバンドルどうしの差（main と main-again）が main と tp の差より大きい**ので、モードは環境（同一プロセス内で持続する状態）の性質であって変更の影響ではない。keyed の判定（`isKeyed`・`swapTrAdded=2`）は全実行で同一。
