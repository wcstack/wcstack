# State 次期メジャー 行ランタイムの設計案（草案）

**English**: [state-next-major-runtime-design.md](./state-next-major-runtime-design.md)

起草日: 2026-09-21。状態: **草案。決定ではない。**

[配線設計](./state-next-major-wiring-design.ja.md) §9 が「本設計の外。別文書にする」と外に出した分 — `BindingSession` の二重経路の一本化と、行 record・session 共有・プラン初期描画 — をここで束ねる。配線設計が「core が機能を知らないこと」を扱うのに対し、こちらは **1 行を作って保守する費用**（時間・ヒープ・core のサイズ）を扱う。

対応する決定は[要件](./state-next-major-requirements.ja.md) §6 の **D10**（プラン初期描画は 3.0 の「template plan と行インスタンスの分離」の器で入れる）・**D11**（行 record ＋ session 共有は 3.0）・**D14**（cold 1,000 行は A3 の分母を見直す）と、目標 **A2**（base ＋ DOM で gzip 35 KB 以下）・**A3**（生成・更新の改善）。根拠は[要素技術調査](./state-next-major-tech-survey.ja.md) §10.7・§10.11〜§10.15。

文法・プロトコル（`data-wcs`・wc-bindable・command-token・event-token・transition-runner）は変えない。変えるのは行の内部表現と、`BindingSession` の公開面（内部 API）。

## 1. 現状（計測済み）

1 万行生成 294 ms・warm 1,000 行 16 ms・ヒープ 3.0 KB/行・消去 18〜20 ms は、**サンドボックスで 3 段を積んだときの値**（調査 §10.14）。製品の現在地は消去パッチだけが入った状態で、生成 1 万行 313 ms・warm 1,000 行 22 ms・ヒープ 3.6 KB/行。

| 指標 | 製品（2.6.x 相当） | 3 段のサンドボックス | 出典 |
|---|---:|---:|---|
| 生成 1 万行 | 313 ms | 294 ms | 調査 §10.13・§10.14 |
| warm 1,000 行 | 22 ms | 16 ms | 同 |
| cold 1,000 行 | 53 ms | 50 ms | 調査 §10.15 |
| ヒープ | 3,630 B/行 | 3,033 B/行 | 調査 §10.14 |
| 消去 1 万行 | 18〜20 ms | 18〜20 ms | 調査 §10.12（製品に移植済み） |
| core のサイズ | 42.7 KB gzip（うち `BindingSession` 13.0 KB minify） | — | 配線設計 §8-11・§8-13 |

生成 28 µs/行の内訳（調査 §10.7・§10.11・§10.13）:

| 成分 | µs/行 | 設計で取れる分 |
|---|---:|---|
| 台帳の書き込み（record・観測者台帳・パターン登録） | 8.9 | **≤4**（§10.7 の上限測定。25 項目の record 自体は安い） |
| DOM（複製・ノードパス解決・イベント付与） | 7.8 | cold 側の候補（R5） |
| GC（生成の割り当てが引く若い世代） | 7.2 | 割り当てを減らした分だけ（3 段で 10 → 5.5 ms/1,000 行） |
| コンテンツ生成（`Content`・`createContent`） | 6.4 | 5.0（プラン初期描画の副産物） |
| 初期適用（proxy 読み 7 回・適用 3 回） | 6.0 | **4.2**（プラン初期描画。読み 7 → 4・適用 3 → 1） |
| アドレス生成 | 5.3 | 3.6（同上） |

## 2. 設計原理

1. **template plan と行インスタンスを分ける**（監査 §7 の第 3 項）。行不変の判定・解決結果はテンプレート単位で 1 回だけ作り、行が持つのはノード・値・teardown だけにする。既に `rowPlan` がこの形で、フィルタの実関数（要件 D16）もここへ焼き込んだ。
2. **行の帳簿は「行」に属する。** 束縛ごとの record と session を、行ごと・リストごとへ畳む。ただし**意味論が乗っている台帳は畳まない** — ノード単位の観測者台帳（`interestedSessionsByNode` / `knownBindingsByNode`）は MutationObserver の配送先で、畳むと配送が変わる（調査 §10.7 の b1 変種が測ったのは、その意味論を壊した上限）。
3. **初期描画は proxy を通さない。** 行の下の素の葉は、行オブジェクトを 1 回読んで slot ごとに直接書く。getter・`**`・`$updatedCallback` を持つ state は従来経路に倒す（門は行ごとに 1 回）。
4. **速くする前に、何が遅いかを測った形でしか変えない。** 3 段はいずれもサンドボックスで前後を計測してある。以降の段も同じ手順（前後の第 3 段計数・ヒープ・ベンチ計時）を踏む。
5. **cold と warm を分けて語る。** 監査ベンチの cold 1,000 行は JIT と初回割り当てが支配し、束縛あたりの定数では動かない（調査 §10.15）。A3 の分母は D14 で warm 1,000 行・cold 1 万行・追加・消去に見直した。

## 3. 段階

| 段 | 内容 | 効果（実測） | 出荷 | 公開面 |
|---|---|---|---|---|
| R1 | 消去の割り当て（添字ループ＋親ごとのスキップ件数） | 消去 22〜72 → 18〜20 ms、窓の中の scavenge 0 | **2.6.x（移植済み）** | なし |
| R2 | プラン初期描画 | 読み 7 → 4・適用 3 → 1 回/行、活性化の段 −34%、warm 1,000 行 −34%（§4-1 の実測） | **3.0（実装済み、§4-1）** | `applyValueToBinding` の内部 export |
| R3 | 行 record ＋ session をリストごとに 1 つ | ヒープ −18%（3,616 → 2,953 B/行）、時間は不変（§5-1 の実測） | **3.0（実装済み、§5-1）** | `BindingSession` の中核（`disposeBindings` / `destroyRow` / `isRowSession`、`getRecord` の合成ビュー） |
| R4 | `BindingSession` の二重経路の一本化 | **前提が崩れた**（§6-1）。台帳への出入りだけを共通化して −143 B minify | **3.0（実装済み、§6-1）** | 内部のみ |
| R5 | cold の候補（複製とノードパス解決の T4 形・プールの事前生成） | 未測定（cold 8 ms が対象） | 未定 | `resolveNodePath` の形・opt-in 属性 |

R2 → R3 の順は計測の積み上げ順（§10.13 → §10.14）に合わせる。R4 は R3 が `BindingSession` を触った後に、同じ器で行う。

## 4. R2 プラン初期描画

- **対象の slot**: state パスが行の下の素の葉（どの接頭辞も getter でなく、tail にワイルドカードが無く、event / index 束縛でない）。判定は行ごとに `getterPaths` を引く（再セットで集合が作り直されるためキャッシュしない）。
- **やること**: 行オブジェクトを proxy で 1 回読み（`state[getByAddressSymbol](loopContext)`）、生の値を `applyValueToBinding`（`_applyChange` の DOM 書き込み側だけを切り出した関数）へ slot ごとに渡す。getter の slot は従来どおり `applyChange`。
- **倒す条件**: `$updatedCallback` を持つ state（束縛ごとのアドレス集計が要る）と `**` を持つ state（展開形の getter が `getterPaths` に無い）。
- **壊しやすい点**（試作で実際に落ちた 8 件）: 再帰と `_state` 再セット。前者は展開形の getter、後者は `getterPaths` の作り直し。境界テストを 2 本足す。
- **検証**: 第 3 段計数（読み 7 → 4・適用 3 → 1）、プロファイル（初期適用 6.0 → 4.2 µs/行）、ベンチ計時（warm 1,000 行 19.0 → 17.4、cold は不変）。

### 4-1. R2 の実装記録（2026-09-21、`packages/state`）

試作（調査 §10.13）と同じ形を製品に入れた。新規 `structural/planByContent.ts`（プラン行の逆引き）、`apply/applyChange.ts` の `applyValueToBinding`（内部 export）、`structural/activateContent.ts` の `applyPlanRow`。

- **載せる slot の判定は行不変なので、プランと行パスの組ごとに 1 回**だけ作って `WeakMap<IRowPlan, Map<rowPath, tails>>` に持つ。getter かどうかだけは行ごとに `getterPaths` を引く（再セットで作り直されるため）。
- **試作で落ちた 2 点（再帰・再セット）は最初から入れてあるので、全テスト 3,704 件が一度で通った**。境界テストを 6 件足した（[structural.planRender.test.ts](../packages/state/__tests__/structural.planRender.test.ts): 素の葉と getter の同居・行の更新・入れ子リスト・`**` の state・再セットで getter が入れ替わる形・`$updatedCallback` を持つ state）。
- **実測**（[audit-state-tech-counters.mjs](../scripts/audit-state-tech-counters.mjs) `--content --fixture tracked`、移植前は HEAD のコピーに `--pkg`。各 2 回走らせた標本の中央値。成果物: [-r2-before.json](./research/state-next/runtime-counters-content-tracked-r2-before.json) / [-r2-before-2.json](./research/state-next/runtime-counters-content-tracked-r2-before-2.json) / [-r2-after-1.json](./research/state-next/runtime-counters-content-tracked-r2-after-1.json) / [runtime-counters-content-tracked.json](./research/state-next/runtime-counters-content-tracked.json)）:

| 指標 | 前 | 後 |
|---|---:|---:|
| 読み（回/行） | 7 | **4** |
| 適用（回/行） | 3 | **1** |
| warm 1,000 行（経過、8 標本） | 20.7 ms | **13.6 ms**（−34%） |
| warm 1,000 行（活性化の段） | 14.9 ms | **8.1 ms**（−46%） |
| 生成 1 万行（活性化の段、6 標本） | 150.1 ms | **98.9 ms**（−34%） |
| 生成 1 万行（経過、6 標本） | 353.8 ms | 335.2 ms（−5%。標本は 323〜371 と 285〜362 で重なる） |

- **経過は標本のばらつきに沈む**（この機械では 1 万行の生成が ±30 ms 動く）。確かなのは計数（読み・適用）と、変更が狙った活性化の段。試作の §10.13 が「1 万行 −10%」と出したのは、行 record と消去パッチを積んだサンドボックスでの値で、ここでの −5% と矛盾しない。

## 5. R3 行 record ＋ session をリストごとに 1 つ

- **行 record**: 束縛ごとの 25 項目 record と台帳書き込み 3 種を、行に 1 つの record（slot 配列: phase・flags・address / pattern 登録・teardown）と束縛ごとの session 逆引き 1 回に置き換える。`getRecord` / `shouldApplyState` / `addTeardown` / `disposeBinding` / `dispose` / `destroyRecords` / `rebindAddresses` / `forEachActiveBindingNode` / `getBindingSession` は行 record から答える。
- **session 共有**: `BindingSession` は行 record の Set を持ち、`for` 束縛（そのノード）ごとに 1 つを全行で共有する。content 側の行単位の操作（`unmount` / `unmountInPlace` / `tryDestroy`）は行だけを対象にする `disposeBindings` / `destroyRow` に置き換える。
- **共有 session の deferred 規則**: 定義待ちタスクは「その行のノードに紐づく分は行の解体で取り消し、生きている行が無くなったら全て取り消す」。wholesale の統合テスト 2 件がこの規則を固定する。
- **効果は時間ではなくヒープ**（3,630 → 3,033 B/行）。行ごとの session が持つコレクション 5 個（WeakMap 3・Set 2）＝約 600 B/行が消える。§10.11 の「1.65 KB/行」は過大見積もりで、§10.14 が訂正した。
- **残る 3.0 KB/行**: アドレス・キャッシュ・listIndex・依存台帳・束縛オブジェクトと、モジュール側の台帳（loop context ごとの listIndex キャッシュ、content の台帳）。次に削るならここだが、**まだ帰属が取れていない**（調査 §10.11 の続き）。

### 5-1. R3 の実装記録（2026-09-21、`packages/state`）

試作 2 本（調査 §10.7 の行 record、§10.14 の session 共有）を続けて製品に入れた。両方とも現行のコードにそのまま当たり、型検査と全テストは一度で通った — **ただしカバレッジは通らなかった**。そこが今回いちばんの学びになった。

- **形**: プラン行の帳簿は行に 1 つの record（slot 配列: phase・flags・address / pattern 登録）になり、`for` 束縛（そのノード）ごとの 1 つの `BindingSession` がその行を Set で持つ。content 側の行単位の操作は `disposeBindings` / `destroyRow` に置き換え、`unmountInPlace` / `unmount` は行 session なら行だけを解体する（session ごと dispose すると同じリストの生きている行を巻き込む）。
- **ヒープ**（[audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs)、1 万行、GC 強制後の差分。[heap-per-row-r3.json](./research/state-next/heap-per-row-r3.json) — `shipped` が R3、`proto` が R2・R3 前のビルド。時間は [runtime-counters-content-tracked-r3.json](./research/state-next/runtime-counters-content-tracked-r3.json)）: **3,616 → 2,953 bytes/行（−18%）**。試作の −16% より少し良い。時間は変わらない（計数器の前後で、生成 1 万行・warm 1,000 行・追加・消去のいずれも標本のばらつきの内側）。設計 §2 の「R3 の効果は時間ではなくヒープ」を実測が追認した。
- **カバレッジが落ちた（92.5%）のが本題**。行 record はプラン行を record 経路から外すので、**以前はプラン行が通していた record 側の分岐に誰も来なくなった**。試作はテストが全部緑になった時点で止めていたため、この穴は移植で初めて見えた。直し方は 2 つに分けた:
  - **到達し得ない分岐は削る**: プラン適格性（`compileRowPlan`）はカスタム要素と双方向を弾くので、プラン行は定義待ちも遅延適用も持てない。行 slot の teardown 配列（`addTeardown` の行分岐と `row.teardowns`）はその遅延適用のためだけにあったので落とした。行が全部消えたときの定義待ちの取り消しは**残した** — 統合テスト（wholesale destroy）がその契約を固定しており、削ったら 2 件落ちた。「呼ばれない」と「呼ばれてはいけない」は別物だという確認になった。
  - **残りはテストで通す**: 行 session の統合テスト [bindings.rowSession.test.ts](../packages/state/__tests__/bindings.rowSession.test.ts)（12 件 — 共有・使い回し・部分削除・プール再利用・2 リスト・イベント・切断・再セット・プラン不適格な行）と、白箱の [bindings.rowSession.branches.test.ts](../packages/state/__tests__/bindings.rowSession.branches.test.ts)（12 件 — 未登録の行・権限別の適用・イベント配線の失敗・state ツリー無し・二重登録の回避・張り直し・行を持つ destroyRecords）。既存の [bindings.BindingSession.branches.test.ts](../packages/state/__tests__/bindings.BindingSession.branches.test.ts) にも record 経路の 3 件を足した（プラン行が通らなくなった分の穴埋め）。
- **結果**: 全テスト 3,739 件成功、カバレッジ 99.64 / 98.50 / 100 / 99.81（閾値ちょうど）、lint 0、門は 4 つとも通る。`auto.min.js` 73,968 → 75,137 B gzip、分割 core の閉包 49,148 → 50,324 B（行 record と共有 session のコードの分）。サイズ基準は取り直した。

## 6. R4 `BindingSession` の二重経路の一本化

- **現状**: プラン経路（2.0 KB minify）と汎用経路（4.9 KB minify）が同じことを別の形で行う。core の中で `BindingSession` は 13.0 KB minify（配線設計 §8-11 の帰属）で、単一モジュールとしては最大。
- **狙い**: R3 で行 record が入り、プラン行と非プラン行の帳簿の形が揃うので、そこで 2 本を 1 本にする。見込みは core −2.9 KB minify（配線設計 §5 の表）。
- **前提**: R3 が先。逆順にすると、統合した経路をもう一度組み替えることになる。
- **未決**: 一本化の形（プラン経路に寄せるか、両方を包む第 3 の形か）。R3 の実装後に、`BindingSession` の公開面（内部 API）の実際の差分を見て決める。

### 6-1. R4 の実装記録（2026-09-21、`packages/state`）— 前提が崩れた

R3 の後で「実際の差分を見て一本化の形を決める」（本節の未決）を実行したら、**一本化そのものの前提が成り立たなくなっていた**。

- **測った**: `BindingSession` の minify 15.5 KB を、source map でメソッドごとに帰属させた（`dist/split/chunks/binder.js`）。行経路の専用メソッド（`initializeRow` 493・`activatePlanRows` 570・`registerRowSlot` 346・`unregisterRowSlot` 266・`addKnownRowBinding` 271・`disposeBindings` / `destroyRow` ほか）で約 2.9 KB、record 経路（`start` 759・`attachAfterDefinition` 608・`settleInitialRecord` 558・`runTeardowns` 537・`registerAddress` 523・`addTeardown` 585 ほか）で約 5.8 KB。
- **片方は消せない**: 配線設計 §5 の「−2.9 KB」は、2 本のうち片方を消す見込みだった。だが R2・R3 の後、行経路は**プラン適格な行だけの速い経路**（R2 のプラン初期描画と R3 のヒープ −18% はこの経路に乗っている）で、record 経路は行経路が意図して持たないもの — カスタム要素の定義待ち・双方向・radio / checkbox・token・接続時スナップショット・遅延適用の teardown — を引き受けている。行経路を消せば R2・R3 の効果が消え、record 経路は消せない。**「2 本が同じことを別の形でしている」は R2・R3 の前の話だった。**
- **本当に重複していた所だけを畳んだ**: 台帳への出入り — 登録が 2 か所（`registerRowSlot` / `registerAddress`）、解除が 3 か所（`unregisterRowSlot` / `runTeardowns` / `rebindAddresses`）— を `registerPattern` / `registerAbsoluteAddress` / `unregisterFromLedger` の 3 関数にした。登録した形（アドレスか、パターンの pathInfo ＋ listIndex か）は呼び出し側の器に書く。値の組を返す形にすると行ごとの割り当てが増えるので採らなかった。解除に失敗したとき器を残す（生き返った行が二重登録しない）という従来の順序も保った。
- **結果**: `BindingSession` 15,536 → 15,393 B minify（−143 B）。`auto.min.js` 75,137 → 75,094 B gzip、分割 core の閉包 50,324 → 50,283 B。全テスト 3,739 件成功、カバレッジ 99.64 / 98.50 / 100 / 99.81、門は 4 つとも通る。サイズより、**束縛が台帳へ出入りする経路が 1 か所になった**ことのほうが効く（登録と解除の非対称は、過去の不具合の常連だった）。
- **A2 への帰結**: §5 の表で A2 に残っていた 2 段のうち、R4 はほぼ効かないことが確定した。残るのは診断の dev ビルド化（`pathDiagnostics` 3.6 KB ほか）だけで、core は 42〜43 KB gzip の水準に留まる。§9 に書いたとおり、35 KB はこの構造のままでは届かない。

## 7. R5 cold（監査ベンチの 1,000 行生成）

cold 66 ms の超過 38 ms の内訳は、コンテンツ生成 18・GC 10・暖機 7（調査 §10.15）。3 段で 66 → 58 ms（効いたのは割り当て ＝ GC）。残る候補:

1. **複製とノードパス解決の T4 形**（cold の 8 ms）: 印付き template を 1 回の `querySelectorAll` で引く、`cloneNode` ＋ 事前計算した子添字。調査 §6.1 で 1,000 行あたり ≤2 ms と測っており、**費用対効果は低い**。
2. **プールの事前生成**（opt-in 属性で初回描画の前に N 行分の content を作る）: cold を warm に寄せる最短経路だが、使わない行の生成が無駄になる。D14 は (a)（分母の見直し）を採ったので、これは**やらないことにした訳ではなく、優先度が下がった**。
3. **割り当てのさらなる削減**: 帰属が §10.11 の続きに依存する。

## 8. 検証

1. **挙動**: 既存の全テストが緑（各段はサンドボックスで 3,661 件通過済み。製品では 3,704 件）。R2 は再帰・再セットの境界テスト 2 本、R3 は共有 session の deferred 規則の統合テスト 2 本を追加する。
2. **時間**: [audit-state-tech-counters.mjs](../scripts/audit-state-tech-counters.mjs) の第 3 段計数（生成 1 万行・warm 1,000 行・追加）を前後で。
3. **ヒープ**: [audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs)（1 万行、GC 強制後の差分）。
4. **サイズ**: `scripts/check-state-size.mjs --check`（core エントリの閉包と full / auto）。R4 はここに効く。
5. **性能の回帰**: 監査ベンチの 4 指標（D14 で見直した分母 — warm 1,000 行・cold 1 万行・追加・消去）。

## 9. 決めたこと・決めていないこと

決めた（要件 §6）:

- **D10**: プラン初期描画は 3.0 の「template plan と行インスタンスの分離」の器で入れる。
- **D11**: 行 record ＋ session 共有は 3.0。
- **D14**: cold 1,000 行は A3 の分母を見直す（warm 1,000 行・cold 1 万行・追加・消去）。

決めていない:

- R4 の一本化の形（§6）。R3 の実装後に決める。
- R5 の 3 候補の順序と、プール事前生成の opt-in 属性を作るかどうか。
- 残る 3.0 KB/行 の削減（帰属が先）。
- A2（35 KB）に届かせるかどうか: R4（−2.9 KB minify）と診断の dev ビルド化（−5 KB minify）を積んでも、core は 42.7 KB gzip から 40 KB 前後にしかならない。**35 KB は、この構造のまま（proxy ＋ 依存グラフ ＋ 二重の初期同期）では届かない**という結論を先に書いておく — 届かせるには監査 §7 の「全面新実装」側の判断が要る。
