# 設計評議会: `@wcstack/state` を根本から作り直すなら

- **状態**: 議論集約（2026-06-27）。**結論は「単一の再設計案」ではなく「2つの決定ゲートで構成された判断フレームワーク」**。最有力の暫定結論は **「作り直さない（現行 state への no-regret 加点 + signals 併存の規範化）」**。再設計を選ぶには、本書の **Gate 0 → Gate 1** を順に突破する挙証が要る。
- **手法**: AI マルチエージェント評議会（11エージェント・4フェーズ）。発散→横断審査→反論→統合。フレーミングはオープン（方向を事前固定せず4派を競わせた）。
- **対象読者**: state の将来方針を決める意思決定者。本書は「作り直すか否か」の判断材料であって、着手指示書ではない。
- **関連**: [[signals-state-design]]（signals 併存案・async 一級化の既存到達点）、[[state-stream-type-design]]（async fold / 依存駆動 cancel-restart）、[[timing-and-firing-contract]]（タイミング契約）、[[reactivity-protocol]] / [[command-token-protocol]] / [[event-token-protocol]]（死守すべきプロトコルの壁）。

---

## 0. 問いと、その罠

問い: **「`@wcstack/state` を根本から作り直すなら、どういう仕様がふさわしいか」**。

罠: 既存の [[signals-state-design]] は冒頭で「signals は state を**置き換えない**、別系統の新設」と立場を固定している。本問いはその固定を意図的に再オープンする。よって議論の出発点で必ず割れる**メタ論点**がある —— 「作り直す」とは **(a)** 同思想（HTML宣言的DSL+パスアドレッシング+proxy自動深追跡）でクリーン再実装か、**(b)** signals コアへ統合か、**(c)** 第三の新設計か。本評議会はこの対立を**内部に抱えたまま競わせる**構成を採った。

---

## 1. 評議会の構成

| フェーズ | エージェント | 役割 |
|---|---|---|
| **Phase 0 診断** | 現状解剖官 / 痛点監査官 / 制約・互換調査官 | 全派の共有前提を事実で固定（空中戦の防止） |
| **Phase 1 提案** | 保守再構築派(A) / signals統合派(B) / 標準純化派(C) / DX宣言性派(D) | 思想が対立する4派の独立草案 |
| **Phase 2 横断審査** | 非同期ライフサイクル審 / 性能審 / 先行技術調査(web) | 各提案を単一軸で貫通採点 |
| **Phase 3 反論→統合** | 悪魔の代弁者（レッドチーム） / 統合（本書） | 全案を kill し、帰無仮説を steelman |

収束判定は「合意した優先順位への追跡可能性」（architecture-review 観点）。「正解」は存在せず、決定が優先順位までトレース可能かを問う。

---

## 2. Phase 0 — 共有ブリーフ（確定事実）

### 2-1. 解剖（現状解剖官）

- src 約 **10,300 行**。`proxy/`+`dependency/` = 1,577行（**15%**）。パス層（`address`+`bindTextParser`+`binding`+`bindings`+`list`）= 2,149行（**21%**）。宣言層まで含めると約 **45%**。
- **proxy 自体は薄い委譲層**。重量は `address` のパス意味論 + `walkDependency` の動的ワイルドカード展開に宿る。[[signals-state-design]] §0「重いのは proxy でなくパス層」は**規模面で裏付け**。
- **精密化（重要）**: `proxy ⇄ dependency ⇄ list` は**コード上分離不能**。`setByAddress` の `finally` が「無条件 enqueue + `walkDependency`」を同居させ、`walkDependency` が `createListDiff` を読み出して動的展開する。§0 の「proxy+dependency だけ差し替え」という切断線は実態より理想化されている。
- 最高密度の複雑性は **`dependency/walkDependency.ts`（250行）**。set のたびに走るホットパス。state の「賢さ」と「重さ」の両方の正体。

### 2-2. 痛点（痛点監査官）

- **最大負債 = 構造的限界**: 「最新値スナップショット + 文字列パス + proxy自動深追跡」モデルが **async × ライフサイクルの掛け算を一級市民として表現できない**。`undefined`-write・spread順序・タイミング契約は「async/外部入力が state の同期的世界観に侵入した接合部で噴き出した同根の症状」。
- 行動証拠: プロジェクト自身が `$streams`（最難問）を proxy core に実装せず **signals の `streamResource` で先に確定**した。
- **作り直しで消えるのは付随的負債のみ**: #3 タイミング契約の暗黙性 / #4 同値・ループガード不在 / #9 初期化≠初回適用 / #10 command-token 無規範。**最大の #1（async）は反応性エンジンを変えても残る**。

### 2-3. 制約（制約・互換調査官）

- **state の TS import 消費者はゼロ**。examples も他23パッケージも vscode-wcs も state を import していない。
- 自由度は3層: **(1) 完全自由**（コード内部・TS公開API・コメント内部表現＝全焼可）、**(2) 移行措置付き**（`$xxx`ヘルパ・予約ライフサイクル名・希少フィルタ・ロード属性・宣言形式）、**(3) 死守の壁**。
- 死守の壁は2種: **構文の壁**（`data-wcs` / `<wcs-state>` / DSL区切り `: # @ | ;` / `<template>`構造 / パス `.`・`*`・`$1` / mustache / inner-script 生ESM）と**プロトコルの壁**（wc-bindable manifest + command/event-token の振る舞い契約＝23パッケージ + signals 共有の**与件**）。
- **最大の地雷 = ③buildless**。inner-script の生ESM（Blob URL `import()`）は死守。型安全は `defineState` 恒等関数 + 型注釈（ランタイム0・トランスパイル不要）で。
- 指針: **「裏（実装・内部表現・TS API）は全焼させてよい。表（HTML構文）とプロトコル契約は1ミリも動かすな」**。
- 隠れコスト: vscode-wcs が state の構文・型を**手で二重実装**している（要ペアコミット規律 or 構造的解決）。

---

## 3. Phase 1 — 4派の草案（要約）

| 派 | 核心思想（一言） | 反応性モデル | async の扱い | 自認する最大の弱点 |
|---|---|---|---|---|
| **A 保守再構築** | state は state のまま内部を全焼 | proxy/パス/walkDependency を温存し3層整流（GraphCore / ListReconciler / Scheduler）。`createListDiff` の commit を set時に前倒し | コアに混ぜず IOノード/seam に隔離継続。state は同期宣言層に徹する | #1 を解かない。「async を解くべきと優先順位づけられたら負ける」。構文凍結ゆえ実体は大規模リファクタ |
| **B signals統合** | 反応性エンジンは二度書くな | proxy+dependency+list を捨て signals コアへ。パスを「cell グラフへの座標系」に降格、wildcard を For 境界の静的マーカーに、walkDependency 消滅 | owner/resource/streamResource を相続（最大の戦果） | 自動深追跡の橋渡し（shallowReactive + 構造cell reconcile）が新規最難・最大不確実性。ブリッジ層バグが表(DOM)に出る |
| **C 標準純化** | 標準に最大委譲＋未来標準には空席 seam | TC39形 cell（自前互換・案C）。proxy の動的依存登録を初期化時の静的コンパイルへ移す | AbortSignal を cancel の標準語彙に一級化（`.any()`/`.timeout()`） | 反応性・テンプレの2標準が今使えず、「委譲」の実体は「標準形の自前実装」（スローガンと実装の乖離） |
| **D DX宣言性** | state の本体は DSL とその開発体験 | 反応性は作り直さず他派の基盤に乗る | 解かない（明言） | observability は治療でなく診断。#1 を1mmも解かない。単独完結しない |

各派の詳細草案・一次資料引用は評議会ログ（本書の元データ）に格納。

---

## 4. Phase 2 — 横断審査（核心の緊張）

### 4-1. 非同期・ライフサイクル軸 → 序列 **B > C > A > D**

- 4派は**直交する4責務にきれいに分離**する: **B = 置き場所を確定**（resource/streamResource/owner＝async 複雑性を実際に解いた唯一の資産）/ **C = 配線を健全化**（AbortSignal で cancel を wire 上に可視化）/ **A = ライフサイクル相に固定**（statePhase + 「コアは Promise を知らない純同期」防衛線）/ **D = 観測可能化**（wcs:ready / 更新理由トレース）。
- **どの派も単独では消せない真の硬い核 = 「proxy computed の async 寿命拡張（パス依存駆動の switchMap）」一点**。B を採っても新規に解くべき残課題。
- レンズ: 「複雑性は削除できない、置き場所を選べるだけ」（[[signals-state-design]] §3-4）。

### 4-2. 性能軸 → 序列 **A > C ≈ D > B**（async軸と真逆）

- **「fine-grained は常に速い」は wcstack の負荷で不成立**。fine-grained が確実に勝つのは高頻度小更新のみ、しかも**勝因は同値ガードで、coarse のまま再現可能**。
- 深いネスト×大量要素では **cell-per-field が爆発し、パス依存グラフ（要素数で増えない）が構造的に有利**。B が最も下振れリスク大。
- **唯一のコンセンサス勝ち筋 = 同値ガード。だがこれは唯一の破壊的変更**（Object.is の参照同値で in-place mutation を取りこぼす / 同値時副作用の契約変更）。
- 具申: **「同値ガード単独効果を coarse のまま先に測れ。fine-grained と差が出なければ cell 化投資は不要」**。

### 4-3. 先行技術（web 調査）

- **反応性（signals / fine-grained / no-VDOM）は業界完全収束**（Solid / Vue Vapor / Svelte5 runes / Angular signals）。**反応コアの独自再発明は車輪の再発明**。借りるべき（理想は TC39 Signals 形）。
- **だが4社全てがビルド必須**（Solid の no-build パスすら公式に「劣化・大ランタイム・手動ラップ」の二級市民）。**「buildless 一級 × HTML-DSL × Custom Elements × signals級 fine-grained」を同時に満たすライブラリは存在しない＝誰も埋めていない空白**。これが state の正当な差別化軸。
- **wcstack の価値は signal コアではなく、data-DSL 結合層 + list diff + async 結合**だと全調査が裏付け。
- htm の `.value` 有無で挙動が分岐する**二重メンタルモデルは反面教師**。data-wcs の「同じ書き方で常に fine-grained」は守るべき強み。
- HTML-DSL の型安全ツーリングは **Volar.js の Virtual Code + 双方向 CodeMapping** が確立基盤で、**buildless と矛盾しない**（仮想ファイルはエディタ/型チェック時のメモリ生成のみ）。vscode-wcs はこれに載せ替え可能。Alpine.js = 仮想コード層を持たず「ハイライト止まり」の反面教師。

---

## 5. Phase 3 — レッドチームの判定（反論）

### 5-1. 各派への kill shot

- **A**: 凍結すべき仕様（タイミング癒着）が**暗黙で明文化されていない**ため、golden で pin し切れない。これは「作り直し」でなく **oracle 不在の書き直し（rewrite-in-place with no oracle）**。最も保守的に見えて検証不能性において最も危険。
- **B**: proxy を捨てると言いながら、`obj.a.b.c` / `a.*.c` を保つために proxy を **shallowReactive + 構造cell reconcile で作り直す**自家撞着。**自動深追跡という負債を消したのでなく、より証明されていない場所（自前 reconcile）に移設しただけ**。
- **C**: 「標準に委ねる」の実体が「標準が将来こう来ると予想した形の自前実装」。**未来の標準は違う形で来るのが歴史の常**で、そのとき seam ごと作り直し。「標準純化」が最も実現していないスローガン。
- **D**: #1 を設計上一切触らない＝**評議会の問い「再設計するなら」を「再設計しない」にすり替える**。主案としては問いに答えていない一点で失格（ただし帰無仮説の構成要素としては必須）。

### 5-2. 「良いとこ取り統合」への攻撃（フランケンシュタイン論証）

非同期審の美しい4分割（B=resource + C=AbortSignal + A=ライフサイクル + D=観測）は、**役割の名前空間では直交するが、実装の基盤層で矛盾する**。**A は walkDependency を温存し、B はそれを消滅させる** —— 同じ部品の相反する処置。よって現実解は2つしかない:

1. 基盤に **B** を選び A からは「相固定＋同期コア防衛線」だけ借りる → **A の名札を貼った B**（A 派は採用されたと思わない）。
2. 基盤に **A** を選び async を resource に隔離する → **A の自認構成そのもの**（＝現状の二系統併存の追認）。

**4分割は「設計の分割」でなく「論文の章立て」**。一つの coherent な設計には「どちらの反応コアを基盤に置くか」という**排他選択**が先にあり、それを決めた瞬間に片側は「採用」でなく「吸収 or 隣置」に変わる。

### 5-3. 帰無仮説の steelman 「作り直すな」

作り直しが回収すべき価値は、**3つとも作り直さずに回収可能**:

1. **性能**: 唯一の勝ち筋（同値ガード）は現行 set トラップに Object.is を1枚入れるだけ。cell 化不要。
2. **async**: 最大の #1 はどの案でも残り、かつ既に signals 併存（streamResource）で答えの道が出ている。state を作り直して取り込むのは「出した答えを捨ててより高コストで同じ場所に着地」。
3. **DX/ツーリング**: vscode-wcs 二重実装は **Volar 載せ替え**で解消、state コアに触れない。

作り直しでしか得られない価値は「反応コアの一新」だが、それは**業界が車輪と断じた領域**。よって**挙証責任は作り直す側にある** —— 「同値ガード + signals併存 + Volar の3点セットでは届かない、作り直しでしか得られない便益」を具体的に1つ示せなければ、帰無仮説が勝つ。

### 5-4. 真の分岐点（the one true fork）

> **`data-wcs` の自動深追跡（`obj.a.b.c` / `a.*.c`）を、引き続き「書いた瞬間に張られる動的依存」として持つか、「初期化時に確定する静的バインド」に降格するか。**

- **動的のまま** → proxy 深追跡が要る → 勝者集合は **{A, 現状維持}**。B/C は土台から不成立。
- **静的に降格** → cell 座標系 / 静的コンパイルが成立 → **{B, C}** が初めて土俵に乗る。walkDependency が消え、async の cell 寿命管理が議論可能になる。

性能審（深ネストはパス依存グラフ有利 vs cell爆発）・非同期審（cell 寿命でしか switchMap 寿命を語れない）・互換審（`obj.a.b` 体験と inner-script `this`）・buildless審（静的コンパイル＝ビルドの忍び込み）は**全てこの1点の従属変数**。

---

## 6. 統合 — 3層に分解し、2つの決定ゲートに畳む

評議会の最大の発見は、**問いが3つの独立な層に分解でき、そのうち2層は争点ですらない**こと。「state を作り直すか」という一枚岩の問いは、層を分けた瞬間に解像度が上がる。

```
┌─ 層3: DX / ツーリング / 観測  …… no-regret（どちらに転んでも足す）
│    同値ガード* / wcs:ready / 更新理由トレース / Volar載せ替え / 単一正本manifest
├─ 層2: async × ライフサイクル  …… 既に決着（seam 隔離・signals と共有）
│    resource / streamResource(B由来) + AbortSignal語彙(C由来)
│    + 純同期コア防衛線(A由来) を IOノード/resource seam に凝縮。state コアは作り直さない
└─ 層1: 反応性コア  …… ここだけが唯一の真の再設計論点（the one true fork）
     動的深追跡を保つ{A,現状} か / 静的降格して{B,C} か
```

- **層2（async）は state を作り直す理由にならない**。複雑性の置き場所は「IOノード/resource seam」と既に決まっており（[[signals-state-design]] §3-4・[[state-stream-type-design]] §8）、state コアは「Promise を知らない純同期」のままでよい。B の resource・C の AbortSignal・A の純同期防衛線は**矛盾せず**、これは「state の再設計」でなく「**seam の規範化**（IOノードに外部 AbortSignal 受け口を足す等）」として signals と共有実装にする。
- **層3（DX）も state コアを作り直す理由にならない**。Volar 載せ替え・manifest 一本化・wcs:ready・同値ガードは現行コアの上に足せる。
- **残るのは層1だけ**。そして層1は **the one true fork** に一意に従属する。

### 決定ゲート

#### Gate 0 — 挙証責任（帰無仮説の反証）★ 最初に通す

**安い実験と no-regret 加点を先に実施し、それで目標に届くかを測る。**

1. **同値ガードの単独効果を coarse のまま計測**（性能審の具申）。現行 proxy core の set に `Object.is` 比較を1枚 + `createListDiff` の commit を set時前倒し。高頻度小更新・大規模リスト・深ネストでベンチ。
   - ⚠ 同値ガードは**唯一の破壊的変更**。値型のみガード／参照型（配列・オブジェクト）は素通し、の線引きを規範化（in-place mutation 取りこぼし防止）。同値時の `updatedCallback` / bindable event dispatch を期待するコードへの影響を互換審。
2. **no-regret 加点**を現行 state に足す: `wcs:ready` ライフサイクルイベント（#9）/ 更新理由トレース（dev-mode・#3/#4 の可観測化）/ command-token 引数の規範文書化（#10・コード変更不要）。
3. **async は signals 併存に委ねる**（layer2）。IOノードに外部 AbortSignal 受け口を足し、resource/streamResource を共有規範に昇格。
4. **vscode-wcs を Volar.js Virtual Code 方式へ載せ替え**、`@wcstack/state/syntax` 純パーサと単一正本 manifest で二重実装を構造的に解消。

**判定**: ここまでで性能・DX・async の目標に届くなら → **作り直しは不要。評議会の成果物は「加点リスト + signals 併存の規範化」**。
**Gate 0 を超える条件**: 「この最小路線では届かない、作り直しでしか得られない便益」を具体的に1つ示せること。

#### Gate 1 — the one true fork（Gate 0 を超えた場合のみ）

層1の単一決断を**先に**倒す: **自動深追跡を動的のまま持つか、静的に降格するか**。

- **動的を選ぶ → A 路線**（同思想クリーン再実装）。ただし着手前に **#3 タイミング契約を明文化**して oracle を作る（レッドチームの kill shot への回答＝「暗黙契約を先に成文化し characterization test を張ってから3層整流」）。これで A の「検証不能性」が解ける。成果は GraphCore / ListReconciler / Scheduler の3層と付随負債の一掃。
- **静的を選ぶ → B/C 路線**。着手前に **PoC ゲート**: shallowReactive で `obj.a.b` 体験 + `a.*.c` wildcard + inner-script の `this` 互換が**本当に保てるか**を最小実装で実証（signals PoC が「IOノードがアダプタ一枚で刺さるか」を実証したのと同型の不確実性潰し）。深ネストの cell 爆発を性能審の仮説2で測る。通れば B（signals コア統合）or C（TC39形 cell + 標準 seam）。

---

## 7. ADR（この評議会で確定したこと）

- **ADR-1**: 「state を作り直すか」は一枚岩の問いではない。**3層（反応性コア / async / DX）に分解**し、async と DX は **no-regret 層**として作り直しの争点から外す。〔層分解により決定〕
- **ADR-2**: **async（最大負債 #1）は state コアを作り直す理由にならない**。複雑性の置き場所は IOノード/resource seam と既に決着しており、signals と共有実装にする。state コアは純同期を保つ。〔Phase 0 行動証拠 + 非同期審 + レッドチーム§5-3〕
- **ADR-3**: **反応コアの独自再発明は車輪の再発明**。再設計するとしても反応性の新規性は価値の源泉ではない。価値は data-DSL 結合層・list diff・async 結合、および **buildless 一級という誰も埋めていない空白**にある。〔先行技術審〕
- **ADR-4**: **挙証責任は作り直す側にある（Gate 0）**。同値ガード + signals併存 + Volar の最小路線で届かない便益を1つ示せなければ、成果物は「加点 + 併存の規範化」。〔レッドチーム§5-3〕
- **ADR-5**: 作り直しを選ぶ場合の**唯一の先決問題は the one true fork**（動的深追跡 vs 静的降格・Gate 1）。これを決めずに「3層整流」「良いとこ取り統合」を論じるのは無効。〔レッドチーム§5-2/§5-4〕
- **ADR-6**: **「良いとこ取り統合」は禁句**。B と A は基盤で排他。統合に見えるものは「片方の吸収 or 隣置」であり、多くの場合「二系統併存の言い換え」。〔レッドチーム§5-2〕
- **ADR-7**: **同値ガードは唯一の no-regret 勝ち筋であり、唯一の破壊的変更**。値型のみガード・参照型素通しの線引きを規範化し、導入時は互換審を要する。〔性能審〕
- **不変条件（全分岐共通）**: 構文の壁・プロトコルの壁は1ミリも動かさない。ライブ stream ハンドルを binding 境界に出さない（[[state-stream-type-design]] §7）。buildless（inner-script 生ESM）を脅かす選択肢（polyfill 必須・transpile 必須・manifest のランタイム露出）は赤信号。

---

## 8. 推奨（評議会の暫定結論）

1. **まず Gate 0 を実施する**。安い実験（同値ガード単独効果のベンチ）と no-regret 加点（wcs:ready / トレース / Volar 載せ替え / signals 併存規範化）を先に回す。これは作り直しの是非に関わらず純便益がプラス。
2. **その結果を持って Gate 0 の挙証に答える**。最小路線で届かない便益が出てこなければ、**作り直さない**のが正直なコストに従う結論。
3. **挙証に答えられた場合のみ Gate 1（the one true fork）を明示的に倒してから**、A 路線（着手前にタイミング契約成文化）か B/C 路線（着手前に shallowReactive PoC ゲート）かを選ぶ。

> 評議会の白眉: 「state を作り直す」最大の動機と目された **async** が、最も作り直す理由にならない層だった。最大負債は反応性エンジンの差し替えでは消えず、その置き場所は既に signals 併存で答えが出ている。残る真の論点は反応コアの深追跡を動的に保つか静的に降格するかの一点に収斂し、それすら「まず安い加点で届かないことを証明してから」という挙証責任の下にある。

---

## 9. Gate 0 実測結果（Step 1・2026-06-27）

性能審の仮説1「同値ガードの単独効果を coarse のまま測れ。fine-grained と差が出なければ cell 化投資は不要」を**実コードで実測**した。

**実装**: `packages/state/src/_bench.ts`（実験フラグ + カウンタ・既定OFF・非破壊）+ `setByAddress.ts` 冒頭に同値ガード（primitive 限定・`Object.is` 比較・参照型は素通し）。実マウント（`<wcs-state>` + 300行リスト + getter 依存 `doubled` / `items.*.tax`）で OFF/ON を**交互計測**（JIT 順序バイアス除去・M=20,000・median of 7）。計測は `__tests__/bench.gate0.test.ts`。

| プロファイル | OFF(ms) | ON(ms) | Δ% | 効果 |
|---|---|---|---|---|
| 同値スカラ（count=7 ×M） | 6.4 | 1.6 | **−74%** | 大勝（140k skips） |
| 値変更スカラ（count=i ×M） | 5.9 | 7.1 | **+14〜21%** | overhead（old 値読み出し・140k proceeds） |
| 同値リスト（wildcard price 同値） | 0.25 | 0.08 | **−65%** | 勝ち（210 skips） |
| 値変更リスト（wildcard price 変更） | ~0.2 | ~0.2 | 測定分解能以下（sub-ms・符号が揺れる） | 不定 |

**破壊的変更の実害**: 全 **1,457 テストを強制 ON** で回し、**契約破壊ゼロ**。失敗は2件のみで、両方とも `getByAddress` の呼び出し回数に依存した swap カバレッジテストのモック筋書きズレ（ガードが old 値読み出しで1回呼び足したため）であり、「同値でも伝播する」契約の破壊ではない。

**判定（仮説1への回答）**:

1. **同値ガードは coarse な現行 proxy core の上で、同値ワークロードに −65〜74% の確実な勝ちをもたらす。fine-grained（cell 化）は不要** —— 仮説1を実証的に支持。high-frequency の勝因は粒度ではなく同値短絡であり、作り直さず現行コアに足せる。
2. **ただし無条件 no-regret ではない**。値変更ワークロードに **+14〜21% のオーバーヘッド**（毎 set の old 値読み出しコスト）。損益分岐は**同値書き込み比率 ≈16〜20%**（スカラ実測から算出）。それ未満では純損。
3. **ADR-7 を精密化**: 「同値ガードは唯一の no-regret 勝ち筋」→「**同値書き込みが書き込み全体の ≈16〜20% を超えるワークロードでのみ純正。下回れば old 値読み出しが純オーバーヘッド**」。実 wcstack ワークロード（fetch 応答の再代入・双方向バインドのエコー・spread 再適用・broadcast/storage 同期）が分岐点を超えるかが**経験的な問い**として残る。
4. **正直な限界**: ガードは同値時に `updatedCallback` / DCC bindable イベントの発火も飛ばす。テストスイートはこの契約を**1件も検証していない**ため、ゼロ破壊は「安全の証明」ではなく「スイートの被覆ギャップ」。examples・双方向エコー・DCC の実コンパチ監査は別途必要（ADR-7 の互換審の範囲）。
5. **list commit 前倒しは Gate 0 の「安い実験」の範囲外**として A 路線詳細仕様（Step 3）へ送る。理由: hot-path の lastListValue commit 意味論を変える構造変更で回帰リスクがあり、本ベンチではリスト系は既に sub-ms（二重 diff は本プロファイルの支配的コストでない。効果が出るのは「同一 tick で同一リストへ多重 set」する負荷で、別途切り出して測るべき）。

> Gate 0 の結論: **同値ガードは「条件付き no-regret」**。同値書き込みが約16〜20%を超える実ワークロードがあるなら現行コアに足す価値があり、その確認（実 example でのプロファイル）が次の安い一歩。fine-grained への投資はこの一歩では正当化されない。

## 10. the one true fork 決着（Step 2・2026-06-27）

Gate 0 の実測を弾薬に、互換審・性能審を**深掘りで**もう一巡し、fork を決着させた。**両者が独立に同じ結論に収束**した。

### 性能審（深掘り）判定: {A, 現状}（確信度85%）

Gate 0 後に「静的cell でしか取れず動的proxy+同値ガードでは取れない性能利得」を実コードで4点裁定:

| 候補 | 裁定 |
|---|---|
| ① computed 同値短絡（getter出力が同値なら下流停止） | **Aでも取れる**。現状未実装の真の欠落だが、cache 前値で `Object.is` 比較し walkDependency callback で伝播打ち切りを挟むだけ（現行アーキ無改造）。cell 必須でない |
| ② 兄弟スキップ / For-LIS | **coarse で既達**（`walkDependency` は変更行の listIndex のみ展開、`createListDiff` が change/add/delete 分類で未変更行は触らない）。LIS 上積みは「巨大リスト中間並べ替え」専用で wcstack に標的なし |
| ③ 深ネスト×大量要素 | **静的cell の構造的不利**。依存グラフはパス種別数で一定（要素数で増えない）、cell-per-field は要素数×フィールドで線形爆発 |
| ④ old 値読み直し不要 | **cell 専用の唯一の利点**。cell は前値保持で同値判定に追加読み出し不要 → 同値ガードの +14〜21% overhead が構造的にゼロ、損益分岐 16-20%→0%。だが効果は数%オーダーで ③ の損失を上回らない |

→ **性能だけでは静的降格を正当化できない。{A, 現状}。** 最大費用対効果は「同値ガード（set側）＋ computed 同値短絡（①・getter側）を現行 A コアに足す」。

### 互換審（深掘り）判定: {A, 現状}（確信度85-90%）

静的降格が**構文の壁を壊さずに可能か**を src/tests/README/examples で検証。**不可能**と確定。動的でしか正しく出せない意味論が3点、全層で実在:

1. **差分条件 getter**: `examples/state-search` の `statusText`、`state-camera-record-upload` の `camStatus`/`uploadText`、`state-cross-tab-todo` の `activityText` 等、分岐で異なるパスを読む getter が常用。動的トレースは実行時に通った経路だけ依存登録（`checkDependency.ts`）。静的化は over-subscription（getter 過剰実行＝観測可能な意味論差）か分岐解析を強いる。
2. **多段ワイルドカード依存**: `regions.*.prefectures.*.cities.*.density`（README 規範例・3段）の宛先は**通知時の配列内容**でしか決まらない（`walkDependency.ts` の listDiff 展開、テストで3段保証）。初期化時の静的座標では宛先確定不能。
3. **任意深度 `this.a.b.c`**: proxy 透過が前提。cell+shallowReactive 再現は MobX 罠（中間ノード丸ごと差し替え・配列同一性・動的キー）を再演し、かつ軽量化動機を失う。`docs/signals-state-design.md` §5-4 が自ら「cell に自動深追跡は無い・深追跡したいなら state を使え」と棲み分けを宣言済み。

→ **B/C（signals統合/標準純化）は `data-wcs` の置換先になれない。別系統の併存としてのみ成立**（signals doc §0/§6「置換しない・客が違う」と整合）。

### fork 決着

> **the one true fork は「動的深追跡を維持」に決着 → 勝者集合 {A, 現状}。** 性能・互換の両軸が独立に同じ結論。**B/C は state の作り直し先ではなく、signals という別系統の併存として既に正しく位置づけられている**（本評議会は signals 廃止を含意しない。両系統併存は維持）。

残るサブ分岐 **「A 本格再構築 vs 現状+加点」** は Gate 0 の挙証責任に従う:
- 性能の勝ち（同値ガード・computed 同値短絡）は**現状コアに足せる加点**で、本格再構築を要しない。
- A 本格再構築の正当化は**性能でなく構造**に絞られる: proxy⇄dependency⇄list の癒着（`setByAddress` finally の2責務同居・list commit タイミングずれ）の解消と、同期宣言層の完成（付随負債 #3/#4/#9/#10）。
- → 詳細は **Step 3: A 路線詳細仕様**（`docs/state-redesign-route-a.md`）で、no-regret 加点から構造再構築までを段階化。

### ADR 追加

- **ADR-8**: the one true fork は**動的深追跡維持に決着**。静的降格（cell/B/C）は `data-wcs` の構文の壁（差分条件 getter・多段ワイルドカード宛先・任意深度 this）を壊すため、state の置換先になれない。〔互換審・性能審の独立収束〕
- **ADR-9（Gate 0 由来）**: 同値ガードは**条件付き no-regret**（同値書き込み比率 ≈16-20% が損益分岐）。fine-grained 不要で high-frequency の勝ちは coarse proxy 上で取れる。〔Gate 0 実測〕
- **ADR-10**: ~~**computed 同値短絡**は現行 A コアで実装可能な未実装の改善であり、同値ガードと並ぶ no-regret 加点候補。~~ → **ADR-10（改訂・§11 実証で更新）**: computed 同値短絡は **per-set eager 実装では純損**（microtask coalescing を破壊）。**no-regret な A1 加点ではなく、flush 境界スケジューリング＝A4（Scheduler 層・三色/トポロジカル）の項目に格下げ**。安価な A1 の勝ちは A1-1 同値ガードのみに確定。〔§11 実測〕

## 11. A1-2 computed 同値短絡の実装・実測（Step 3 後続・2026-06-27）

route-a の「次の安い一歩」（A1-2 を実装し coarse proxy の上限を確定）を実コードで検証。

- **実装**: `walkDependency` に eager 短絡（getter 依存を pop 時に再計算→`Object.is` 同値なら部分木を枝刈り）をフラグ背後（`_bench.ts` `computedShortCircuit`・既定OFF）でプロトタイプ。計測 `__tests__/bench.a1-2.test.ts`。
- **実測（深いチェーン `n→tens→label→caption`・n+=1 ×20000）**: 短絡は **9/10 を枝刈り（prune 12.6万回）したのに +44〜51% 遅い（純損）**。
- **根本原因**: wcstack の **microtask coalescing**（`updater` の `queueMicrotask` + 絶対アドレス Set 重複排除 + 遅延 pull）が、M 回 set の下流再計算を**flush あたり1回に畳んでいる**。baseline の walk は getter を実行せずダーティ化のみ。eager 短絡は**プルーン判定のため毎 set で getter を再計算**し coalescing を破壊。枝刈りで省いた下流は baseline で既に1回に畳まれており、**節約ゼロ・eager コストだけ純増**。
- **正当性**: 線形チェーン・ダイヤモンド probe の最終 DOM 値は短絡 ON でも正しい。フル 1461 テストはフラグ OFF で全緑（フラグ ON 時の失敗15件は walkDependency 白箱モックの `getterPaths` 欠落で、`?.` 防御済み・アプリ挙動のグリッチではない）。
- **含意**: 性能審の「walk callback に挟むだけ」を**実証的に反証**。① を A で取るには flush 境界のスケジューラ刷新（A4・三色/トポロジカル＝cell の構造的優位）が要る。**「coarse proxy が安価に取れる上限」は事実上 A1-1 同値ガードだけ**に確定。cell の専有利得①は実在するが coalescing に食われ実効が小さく、**fork 判定 {A, 現状} を覆さず、むしろ「将来 B/C へ乗り換える必要があるか」を一段と『否』に寄せる**。

## 付録: 一次資料の所在（横断審査で確認）

## 付録: 一次資料の所在（横断審査で確認）

- 癒着の核: `packages/state/src/proxy/methods/setByAddress.ts`（finally に enqueue + walk 同居）
- 複雑性の核: `packages/state/src/dependency/walkDependency.ts`（250行・set毎ホットパス・wildcard展開 + listDiff 読み出し）
- 二重diff の根拠: `packages/state/src/apply/applyChangeFromBindings.ts`（lastListValue commit が apply 末尾） vs `walkDependency.ts`（set時に古い lastValue で `createListDiff`）
- 無条件 enqueue（#4 の所在）: `packages/state/src/updater/updater.ts`
- 初期化≠初回適用（#9）: `packages/state/src/waitForStateInitialize.ts` vs `packages/state/src/buildBindings.ts` / `components/State.ts`
- vscode-wcs 二重実装: `packages/vscode-wcs/src/language/preamble.ts`（型手写し）/ `src/service/completionData.ts`（フィルタ手リスト）/ `src/service/bindingValidator.ts`（DSL独立パーサ）
- 死守のプロトコル: `packages/state/src/token/Token.ts` / `apply/applyChangeToCommand.ts` / `event/eventTokenHandler.ts`
