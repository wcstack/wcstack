# 設計: オーバーレイ getter の公開（D10 の開放）— 自己再帰構造の派生を台帳に解かせる

- **状態**: 2026-09-07 起草。[state-mount-design.md](./state-mount-design.md) の **D10（親スコープからコンポーネント getter を読む形は v2.0 ではしない）** を 2.x で開く設計。**X2 / X3 は同日に著者が決定、公開 accessor の実装は `221ae223` でコミット済み**（branch `feat/state-overlay-export`）。本書はレビュー修正を反映（§10・§11）。制限＝X4 のキャッシュ命中時の曖昧検出、X7 の ready 待機、X8 の記録単位の完全掃除。未実施＝P4-3（静的 lint / vscode-wcs の機能追随）・P4-4（example）・P4-5（skill）。性能の計測範囲と未確認項目は §7。
- **動機**: 自己再帰コンポーネント（木）の**描画・私有状態は v2 で成立する**が、**深さに依らない派生（`total = value + Σ children.total`）は閉じない**（§0-2 の実測）。パスは `*` の個数が固定の正規言語なので再帰を表現できず、再帰は DOM（自分自身をマウントするコンポーネント）に置くしかない。そのとき各段の式を 1 段に閉じるには「親が子オーバーレイの getter を読める」規則が要る。
- **一文**: **ツリーに無いキーの読みは、その位置にマウントされたコンポーネントの getter で答える。ツリーにあるキーはツリーが勝つ。私有キーとメソッドは見せない。**
- **関係する既存設計**: [state-mount-design.md](./state-mount-design.md) D10 / D20 / §5-3 / §8（本書で改稿する箇所）、[state-mount-impl-plan.md](./state-mount-impl-plan.md) §3-0-1（オーバーレイ実装の記録）、[state-bind-component-nested-for-design.md](./state-bind-component-nested-for-design.md) §8.4（数値添字パスの診断）。

---

## 0. 事実（2026-09-07・main `de487346`・happy-dom プローブ）

### 0-1. 自己マウントの成立

```html
<!-- tree-node のテンプレート。自分自身を for の行に置く -->
<wcs-state bind-component="state"></wcs-state>
<span data-wcs="textContent: label"></span>
<span data-wcs="textContent: total"></span>
<ul><template data-wcs="for: children">
  <li><tree-node data-wcs="state: ."></tree-node></li>
</template></ul>
<!-- ホスト --> <tree-node data-wcs="state: root"></tree-node>
```

| 観点 | 結果 |
|---|---|
| 深さ 3 の描画（`root` → `children.*` → `children.*.children.*`） | 成立。各段の絶対アドレスは `root.children.*.children.*.…` と伸び、段ごとに独立したマウント記録（`#m<id>`）になる |
| 私有キー `open: false` | 段ごと・行ごとに独立（1 段だけ true にしても他段に漏れない） |
| 終了条件 | `children` が空 → `for` が 0 行 → 展開が止まる |
| 罠（テスト環境） | happy-dom は `<template>` 内容のパース時にも constructor を走らせる。shadow 構築を constructor に置くと `<tree-node>` が自分を無限に生成して RangeError。connectedCallback で組めば通る（実ブラウザではテンプレート内容は inert なので不要） |

### 0-2. 派生が閉じない（3 形の実測）

初期木: root(1) → a(10) → a1(100)、root → b(20)。葉 a1 を 100→200 に書いた後の各段の `total`。

| getter の書き方 | 初期値 | 葉更新後 | 理由 |
|---|---|---|---|
| 生オブジェクトを JS で再帰（`this.children[i].children…`） | 131 / 110 / 100 | **131 / 110** / 200 | 依存は `children` コンテナだけ。in-place 変異規範（深い書き込みは祖先に伝わらない）により祖先が再評価されない |
| 数値添字パス `this["children.0.children.0.value"]` | throw | — | ワイルドカードマウント下では文脈 `*` ＋明示添字 ＝ `partial` → `Partial wildcard type is not supported yet`（[getListIndex.ts](../packages/state/src/proxy/methods/getListIndex.ts)） |
| `this.$getAll("children.*.value")` | 正しい | 131 / **210** / 200 | 1 段下には依存が張られる。2 段下（孫）は届かない ＝ 深さ固定 |
| **本命** `value + Σ $getAll("children.*.total")` | **不可** | — | 子の `total` は `root.children.*.#m<id>.total` に載り、親の `root.children.*.total` はマーカー無し → ツリーの未存在パス（D10 / D20 の帰結） |

**結論**: 再帰的 fold を台帳が解く経路は無い。開けるべきは 4 行目。

### 0-3. 現状で取れる表現（本設計を入れなくても成立するもの）

- **平坦化**（inode 表）: `nodes.*` フラット配列 ＋ `parentId` / `childIds`。派生は `$getAll("nodes.*.value")` 全件 fold（依存は全件・深さ無関係）。描画は入れ子のまま並存
- **派生のデータ化**: `total` を値として持ち、葉の変更時に `$updatedCallback` かイベントで祖先へ書き戻す（`du` のキャッシュ）。単一台帳なので書き戻しは 1 段ずつ確実に届く

どちらも「コンポーネントが自分の派生を自分で書く」形にならない。本設計はそこを埋める。

---

## 1. 論点と決定表

| # | 論点 | 決定・実装範囲 | 状態 |
|---|---|---|---|
| **X1** | **優先順位** — ツリーにキーがあり、かつマウントされたコンポーネントに同名 getter があるとき、親はどちらを読むか | **ツリーが勝つ**。公開 getter は「ツリーの未存在キー」の読みだけに掛かる。理由: (a) コンポーネントのリリースで getter を 1 個足してもホストのバインドが無言で変わらない（[state-mount-design.md](./state-mount-design.md) R1 批判の再発防止）(b) ホットパス不変 — 命中する読みは今日の経路そのまま、索引照会は**未存在キーの経路**（今日 `undefined`＋warn を返している経路）にだけ足す（D20 の「最長接頭辞照会をあらゆる読みに掛けない」を維持）。衝突（prototype を含む同名ツリーキーあり）は記録登録時に warn 1 回。静的 lint は P4-3 の未実施項目 | 実装済み |
| **X2** | **公開する面** — getter だけか、私有キー・メソッドも含むか | **getter（＋setter のある accessor）のみ**。公開パスのワイルドカード数が `record.delta` と同じものに限定する。内部ワイルドカード accessor は内部でのみ利用し、索引・エイリアス辺・診断抑止に登録しない。私有キーは D20 の語義どおり私有のまま、メソッドは command-token の領分。理由: 私有キーを見せると「行の UI 状態」がツリーの語彙に混ざり、`$updatedCallback` から `#` を漏らさない規範（impl 注記 2026-09-05）と矛盾する | **決定（2026-09-07・著者）: getter のみ** |
| **X3** | **暗黙か明示か** — 全 getter を自動公開するか、`$exports: ["total"]` を宣言させるか | **暗黙（X2 の階数条件を満たす accessor）**。理由: R1 と同じ「新しい宣言を増やさない」、X1 によりツリーを隠せないので公開範囲の広さが既存を壊さない、lint が「未使用 export」を問題にする必要が無い。反論: 内部ヘルパ getter が外から見える。対策: 見せたくない getter は `#`…は不可（パス文法）なので**慣習（`_` 接頭辞）＋ lint の任意規則**に留める | **決定（2026-09-07・著者）: 暗黙** |
| **X4** | **インスタンス解決** — `P.k`（listIndex L）の読みに対し、どのマウント記録の getter を評価するか | 索引 `(stateElement, P, k) → Set<WeakRef<記録>>` を登録時に作り、読み時に**記録のホスト要素のループ文脈 listIndex が L と同一**の記録を選ぶ。候補 0 → 今日どおり `undefined`。候補 1 → 評価。候補 ≥2 → **raiseError**（同一インスタンスに同名 getter を持つコンポーネントが 2 つ ＝ bind mount の曖昧。設定ミスとして loud）。行が N 個なら候補は N 記録なので、`listIndex → 記録` の検証付きキャッシュ（記録の現在の loopContext が一致することを確認して使う・不一致なら再走査）でキャッシュ命中時の走査を省く（プール再利用で要素↔listIndex が変わるため無検証のキャッシュは不可）。**曖昧検出は候補走査時のみ**。キャッシュ命中後に別の候補が追加・再接続された場合は検出しないことがある。初回の N 行解決は O(N²) になりうるため、全体の償却 O(1) は保証しない | 実装済み（検出範囲に制限） |
| **X5** | **依存と無効化** — 子の `#m7.total` が dirty になったとき、親の `total`（`root.children.*.total` を読んだ）まで届くか | 登録時に**エイリアス辺** `P.#m<id>.k → P.k` を dynamicDependency に張る（walkDependency は getterPaths に関係なく map を辿る。マーカーはワイルドカードを増やさないので listIndex は 1:1）。親の getter は通常の checkDependency で `P.k` への辺を持つので、葉 → `#m7.total` → `P.k` → 親 getter と流れる。**マーカー付きパスは getter キャッシュ、公開パス `P.k` は getterPaths に載せない**。ただし `P.k` にワイルドカードがあれば通常の行キャッシュに載る。整合はエイリアス辺と公開 accessor 書き込み時の dirty 化で保ち、setter の代入値はキャッシュしない（例外時も同じ） | 実装済み |
| **X6** | **遅延登録と切断** — 親の getter は子コンポーネントが登録される前に評価される（初回 bind は DOM 順・子は upgrade 後の非同期） | 登録時と `$disconnectedCallback` 時に、公開 getter ごとに `P.k`（インスタンスの listIndex）へ **`$postUpdate` 相当**（enqueue ＋ walkDependency で依存者を dirty）を打つ。`notifyExports` からループ文脈付き `$postUpdate` を呼ぶ。親 state が切断済み、または行のループ文脈が消失済みなら省略し、その他の例外は伝播する。帰結: 初回は途中値（子が未登録の段は `undefined`）が見えてから収束する — ボリュームの D22 と同じ性質。**親の式は `undefined` を許容して書く**（`(x ?? 0)`）ことを README に明記 | 実装済み |
| **X7** | **診断** — 子登録前の未存在パス warn | binding 宣言の検査結果を pending に積み、登録時に公開パスの pending を消す。残りは **1 マクロタスク後（`setTimeout(0)`）**に 1 回 warn。`getBindingsReady` 解決とは連動しない。autoloader の import / define が遅れる場合は初回の偽陽性警告がありうる。README に明記。watch 宣言は即時報告のまま | 実装済み（ready 待機は未実装） |
| **X8** | **台帳の寿命** — 恒久破棄後の回収 | 索引は WeakRef。回収済みの holder は `resolveExport` の候補走査時に遅延 prune する。`cleanupCollectedMountRecord` は従来のマーカー表・getterPaths のみを掃除し、公開索引のキーや空 slot、エイリアス辺、`exportedPathsByStateElement` は個別回収しない。後者の文字列台帳は親 state の寿命まで残る（親の回収後は WeakMap / 親所有 map とともに回収可能）。記録ごとの完全掃除は未実装 | 実装済み（遅延 prune のみ） |
| **X9** | **書き込み** — 親が `P.k` に書いたとき | 今日の規則「ツリーに作る」をそのまま適用すると、以後ツリーが勝ち（X1）getter を無言で隠す。**未存在キーへの書き込みで索引に `(P, k)` があれば**: setter あり → setter を評価（コンポーネント内の set と同じ経路・untrack）、getter のみ → raiseError（overlay.ts の既存文面と同じ）。索引照会は setByAddress の「生オブジェクトにキーが無い」分岐にだけ足す | 実装済み |
| **X10** | **`in` / `has`** | 親 proxy の `has` は生オブジェクトの `Reflect.has` のまま（公開 getter は `in` で偽）。非目標として README に明記。理由: 親の has を規則の存在で答えさせると hasMounts 時の全 `in` にコストが乗る | 非目標 |
| **X11** | **循環** — A（`a` にマウント）の getter が `b.x` を読み、B（`b`）の getter が `a.y` を読む形 | 今日の getter 循環と同じ扱い（Phase 0 で既存のガードの有無を確認: pushAddress の再入検出があればそれ、無ければ RangeError を「設定ミス」として文書化） | 確認 |
| **X12** | **数値添字パスの `partial`** | 本設計の範囲外。X5 が入れば再帰派生に数値添字は要らない。別 issue として残す | 範囲外 |
| **X13** | **SSR** | スナップショットはデータのみで公開 getter の値は含まれない。hydrate 後にクライアントで評価される（素の getter と同じ）。server パッケージがマウント配下の getter を描画するかは Phase 3 の記録で確認 | 確認 |
| **X14** | **バージョニング** | **minor**。追加機能で、変わる挙動は「`undefined`＋warn だった読みが値を返す」だけ。X9 の raise は「無言でツリーに作って getter を隠す」形の loud 化 | 提案 |

---

## 2. 意味論

### 2-1. 読み（親スコープ、または任意のスコープからのツリー読み）

`getByAddress(P.k, L)` で生オブジェクト `P` に `k` が無いとき（今日 `undefined` を返す分岐）:

1. `stateElement.hasMounts !== true` → `undefined`（今日どおり・boolean 1 個で抜ける・D18）
2. 公開索引 `exportIndex.get(P)?.get(k)` が無い → `undefined`（X7 の pending に積む）
3. 候補記録のうち、ホスト要素のループ文脈 listIndex が `L` と一致するものを選ぶ（X4）。0 件 → `undefined`。2 件以上 → raiseError（候補走査時のみ。検証付きキャッシュ命中時の制限は X4）
4. 1 件 → その記録のアクセサを **`P.#m<id>.k` のアドレスで**評価する。`createOverlayValue(record, P.#m<id>, receiver, handler)` で得た proxy に対する `Reflect.get(proxy, k)` と等価（pushAddress は overlay.ts の既存経路が行う）。返り値は素の getter と同じく値（`this` は chroot なので中の読みは記録の翻訳を通る）

**規則の位置**: 「ツリーの未存在キー」の分岐だけ。`P` 自体が無い（親が居ない）ときはこれまでどおり親を辿る／`undefined` で、公開索引は見ない（`P` はマウントパスなので存在するはず。無ければマウント自体が成立していない）。

### 2-2. 依存

- 親 getter が `P.k` を読む → 通常の checkDependency で `P.k → 親 getter` の動的辺（今日と同じ）
- 記録登録時に `P.#m<id>.k → P.k` の動的辺（X5）。walkDependency は `#m<id>.k` が dirty になれば `P.k` の同 listIndex を dirty にし、その依存者（親 getter・`P.k` を直接読むバインディング）へ流す
- キャッシュ: `P.#m<id>.k` は今日どおり getter キャッシュ（getterPaths に載っている）。`P.k` は getterPaths に**載せない**。ワイルドカードを含む公開パスは行キャッシュに載り、エイリアス辺と公開書き込み後の dirty 化が整合を担う

### 2-3. 登録・切断（X6）

- 初期化時の `registerExports` 後: `notifyExports` から公開パスごとに `$postUpdate(P.k)`。`L` は記録のホスト要素のループ文脈を `setLoopContextSymbol` で設定する
- `$disconnectedCallback` 経路（callMountLifecycleCallback の呼び出し元）: 同じアドレスへ同じ postUpdate。親 state が切断済み、または listIndex が既に無い（行ごと消えた）場合は打たない（`$getAll` が回らないので不要）
- 再初期化（同一要素・同一記録の再登録）でも打つ（値が変わっている可能性がある）

### 2-4. 書き込み（X9）

`setByAddress(P.k, L, v)` で生オブジェクト `P` に `k` が無いとき:

1. `hasMounts !== true` または索引に無い → 今日どおりツリーに作る
2. 候補解決（2-1 の 3 と同じ）。1 件で setter あり → overlay.ts の set 経路（pushAddress ＋ untrack で作者の setter を評価）。getter のみ → raiseError（既存文面「the accessor has no setter」を流用）。2 件以上 → raiseError（X4 の制限あり）
3. 公開 accessor に dispatch した書き込みは、成功・例外にかかわらず公開アドレスを dirty にする。代入値で公開キャッシュを固定しない

### 2-5. 診断（X7）

| 状況 | 反応 |
|---|---|
| `P.k` に公開 getter があり、ツリーにも `P.k` がある | 記録登録時に `console.warn` 1 回（タグ × キー、prototype のキーも含む。静的 lint は未実施）。読みはツリー（X1） |
| 同一インスタンスに同名 getter の記録が 2 つ | 候補走査時に raiseError（X4 のキャッシュ命中時は再走査しない） |
| 子未登録のまま次のマクロタスクに到達 | pending を 1 回 warn（今日の未存在パス warn と同文面） |
| 公開 getter のみの `P.k` に書く | raiseError（setter なし）／ setter 評価（あり） |
| 親から `P.k`（私有キー）を読む | `undefined`（X2 — 今日どおり。pending → warn） |

---

## 3. 実装アーキテクチャ

### 3-1. 当初の変更計画（packages/state）

以下は着手前の分割案。実装では索引を `exportIndex.ts` に分離し、公開評価は overlay proxy の `Reflect.get/set`、通知は既存 `$postUpdate` を使う。ready 待機・記録単位の完全掃除は未実装。現在の仕様は §1・§2、対応ファイルは §10 を参照。

| ファイル | 変更 |
|---|---|
| `webComponent/mount.ts` | (a) `IMountRecord` に `exportedSuffixesByMarkerParent`（既存 `accessorBySuffixByMarkerParent` から getter のみ抽出した読み専用ビュー）(b) 公開索引 `exportIndexByStateElement: WeakMap<IStateElement, Map<markerParentPath, Map<suffix, Set<WeakRef<IMountRecord>>>>>` と `registerExport` / `resolveExport(stateElement, P, k, listIndex)`（X4 の検証付きキャッシュ込み）(c) `registerMountRecord` でエイリアス辺の登録（`parentStateElement.addDynamicDependency(P.#m.k, P.k)`）と索引登録、held に回収情報を追加 (d) 衝突 warn（X1） |
| `webComponent/overlay.ts` | 公開評価の入口 `readExportedAccessor(record, markerParentPath, listIndex, key, receiver, handler)` / `writeExportedAccessor(...)`。中身は既存 `OverlayValueHandler` の get / set のアクセサ分岐をそのまま呼ぶ（proxy を経由せず直接呼べる形に切り出す） |
| `proxy/methods/getByAddress.ts` | 「親はあるが子キーが無い」分岐（`Reflect.get` が undefined を返す直前）に `hasMounts` ゲート → `resolveExport` → `readExportedAccessor`。命中分岐は無改造 |
| `proxy/methods/setByAddress.ts` | 同じ位置に X9 |
| `proxy/apis/postUpdate.ts` | 本体を `postUpdateAddress(stateElement, address, receiver)` に切り出し（`$postUpdate` はそれを呼ぶ薄い殻に） |
| `webComponent/mountScope.ts` | 登録直後の postUpdate 打鍵（2-3） |
| `webComponent/mount.ts` `callMountLifecycleCallback` の呼び出し元 | 切断時の postUpdate 打鍵（2-3） |
| `pathDiagnostics.ts` | pending 台帳（X7）と `getBindingsReady` での flush |
| `devtools/bridge.ts` | `overlays()` に公開 getter の一覧（`exports: string[]`）を足す |

### 3-2. 触らないもの（不変条件）

- `hasMounts === false` の state は分岐 1 個で抜ける（D18・jsfb ゲート不変）
- マーカー終端 dispatch（`#` で終わるパス）と私有データ表（D20 / D21）は無改造
- 台帳は 1 本・アドレスは絶対・橋渡し無し（state-mount-design の一文）。本設計は**同じ台帳に辺を 1 本足す**だけ
- `signals` パッケージ・`wcstack/auto` バンドル構成に波及しない

---

## 4. 実装計画

### 4-0. 全体方針

- **順序は「読み → 依存 → 遅延登録 → 書き込み → 診断 → ツール」**。§0-2 の失敗形（葉更新後に祖先が 110 / 131 のまま）を **Phase 0 で `it.fails` として固定**し、Phase 2 で緑にする。`it.fails` は非同期 throw を固定できない（[ADR-15 §1.11](./architecture-hardening/15-state-component-mechanism-consistency.ja.md) の罠）ので、同期の値比較で書く
- 各 Phase は独立 PR（1 PR ≒ 1 スライス）。dist はビルドしたら戻してからコミット
- 共通 DoD: state 単体テスト全緑・カバレッジ閾値維持・jsfb-verify / memory-profile の plain 指標 ±2%・lint 緑・**vscode-wcs のビルド**（state の dist を消費するので CI マトリクス外 — #183 同型）

### 4-1. Phase 0 — 契約固定・確認（docs・tests・計測）

| # | タスク | 出力 |
|---|---|---|
| P0-1 | 本書 §1 の X2 / X3 を著者が決める | §1 の状態列を「決定」に |
| P0-2 | §0-1 のプローブを正式テストにする: `__tests__/integration.mountExport.test.ts`（自己再帰 `tree-node`・深さ 3・connectedCallback 構築）。描画・私有独立・**葉更新後の祖先 total を `it.fails`** | テスト |
| P0-3 | 非再帰の最小ケースも同ファイルに: 静的マウント `<user-card data-wcs="state: session.user">` の `display` getter を親テンプレートの `text: session.user.display` で読む（`it.fails`）／行マウント `state: .` の getter を親の `$getAll("users.*.display")` で読む（`it.fails`） | テスト |
| P0-4 | X11: pushAddress の再入（getter 循環）に既存ガードがあるか確認。無ければ「RangeError＝設定ミス」を §2-5 に追記 | 本書更新 |
| P0-5 | X13: server パッケージがマウント配下の getter を描画するかを Phase 3 の記録（impl-plan §3-0-1 / ssr 受け入れ S）で確認 | 本書更新 |
| P0-6 | ベースライン計測: jsfb-verify / memory-profile（plain）＋ 新規 `e2e/bench/tree-derivation.mjs`（深さ 5・分岐 3・葉更新 100 回の wall-clock。今は「祖先が更新されない」ので値は参考） | 数字を §7 に |

### 4-2. Phase 1 — 読み（索引・dispatch）

| # | タスク |
|---|---|
| P1-1 | mount.ts: 公開索引と `registerExport` / `resolveExport`（X4・検証付きキャッシュ）・記録破棄時の回収（X8） |
| P1-2 | overlay.ts: `readExportedAccessor` の切り出し（OverlayValueHandler.get のアクセサ分岐を関数化・proxy 経由と同じ pushAddress/popAddress） |
| P1-3 | getByAddress.ts: 未存在キー分岐に dispatch（`hasMounts` ゲート → 索引 → 評価）。命中分岐は差分ゼロであることをレビューで確認 |
| P1-4 | X1 衝突 warn（登録時・タグ × キーで 1 回）＋ 候補 ≥2 の raiseError |
| P1-5 | テスト: P0-3 の静的・行ケースを緑に。曖昧 2 記録の raise。ツリー優先（同名キーあり → ツリー値・warn 1 回）。`hasMounts === false` の state で未存在パスが今日どおり `undefined` |

### 4-3. Phase 2 — 依存・遅延登録・切断

| # | タスク |
|---|---|
| P2-1 | 登録時のエイリアス辺 `P.#m<id>.k → P.k`（X5）。`P.k` を getterPaths に載せないことをテストで固定。静的公開パスは非 cacheable、行公開パスは cacheable なので、正規化 setter 後の dirty 化もテストする |
| P2-2 | postUpdate.ts の本体切り出し `postUpdateAddress`。mountScope.ts の登録直後と切断経路で打鍵（X6） |
| P2-3 | テスト: P0-2 の自己再帰 `it.fails` を緑に（葉 200 → a 210 → root 231）。子の後付け（`children` に push → 新しい段が生え、親 total が収束）。行の swap（listIndex と一緒に記録が動き、親 total 不変）。`if` で子を落とす → 親 total が再評価 |
| P2-4 | 初回収束の性質をテストで固定: 子未登録の初回評価は `undefined` を含む → README の「`?? 0` で書く」根拠 |
| P2-5 | 計測: P0-6 のベンチを再実行。深さ 5・分岐 3（364 ノード）で葉更新 1 回あたりの再評価数が**経路長（深さ）に比例**し、全ノード再評価にならないことを確認 |

### 4-4. Phase 3 — 書き込み・診断・devtools

| # | タスク |
|---|---|
| P3-1 | setByAddress.ts の X9（setter あり → 評価／無し → raise／曖昧 → raise）＋テスト |
| P3-2 | pathDiagnostics の pending 台帳と `getBindingsReady` での flush（X7）＋テスト（子未登録のまま ready → warn 1 回／登録された → warn 無し） |
| P3-3 | devtools `overlays()` に `exports` を追加＋ [devtools-hook-protocol.md](./devtools-hook-protocol.md) 追補 |

### 4-5. Phase 4 — ドキュメント・ツール・examples・skill

| # | タスク |
|---|---|
| P4-1 | [state-mount-design.md](./state-mount-design.md): 冒頭の不変条件文（「スコープの外からは見えない」→ 私有キーのみ）・D10 を「2.x で開放（本書）」・§5-3 オーバーレイ表の段落・§8 非目標の 1 行目を削除 |
| P4-2 | `packages/state/README.md` / `README.ja.md`: マウント節に「公開 getter」小節（一文・優先順位・`undefined` 許容・`in` は偽・曖昧は raise）と自己再帰コンポーネントの例（§0-1 のマークアップ） |
| P4-3 | `@wcstack/lint` / `vscode-wcs`: (a) 親スコープの `P.k` が「未知パス」診断に掛かる場合、`state: P` ホストの子コンポーネントの getter 名で抑止（wcs-schema がタグ→state 形を持っている範囲で）(b) X1 衝突の静的検出（任意）。**vscode-wcs は state の dist 消費なのでビルド確認必須** |
| P4-4 | examples: `packages/state/examples/state-tree`（自己再帰のファイルツリー／組織図・`total` 集計・折りたたみ私有キー） |
| P4-5 | wcstack-skill の references 追随（マウント節に公開 getter・再帰コンポーネントの型） |
| P4-6 | リリースノート下書き（minor・X14）を本書 §8 に |

---

## 5. 受け入れマトリクス（E — Export）

| # | 形 | 期待 | Phase |
|---|---|---|---|
| E1 | 静的マウント `state: session.user` の getter `display` を親の `text: session.user.display` で読む | 値が出る。`session.user.name` 変更で再描画 | 1 / 2 |
| E2 | 行マウント `state: .` の getter を親の `$getAll("users.*.display")` で読む | 行ごとの値。行の swap で追従 | 1 / 2 |
| E3 | 自己再帰 `tree-node`・深さ 3・`total = value + Σ $getAll("children.*.total")` | 初期 131/110/20/100。葉 100→200 で 231/210/20/200 | 2 |
| E4 | E3 で `children` に 1 件 push | 新しい段が生え、親・祖先の total が収束 | 2 |
| E5 | E3 で `if` により子を 1 つ落とす | 祖先の total が再評価される | 2 |
| E6 | ツリーに `session.user.display` キーもある | ツリー値が勝つ。登録時 warn 1 回 | 1 |
| E7 | 同一パスに `display` getter を持つ別コンポーネントを 2 つマウント | 読みで raiseError（文面に両タグ名） | 1 |
| E8 | 私有キー `editing` を親から読む | `undefined`・次のマクロタスクで warn 1 回（X2 / X7） | 3 |
| E9 | 子未登録の初回評価 | `undefined` を含む。登録により収束。同一マクロタスク内に登録すれば warn 無し（X7） | 2 / 3 |
| E10 | 静的・行マウントの公開 `P.k` に書く | getter のみなら raiseError。setter ありなら正規化後の getter 値を親の即時読み・行バインド・子バインドが返す。失敗した書き込みも代入値をキャッシュしない | 3 |
| E11 | `hasMounts === false` の state で未存在パス読み | 今日どおり `undefined`＋warn。分岐追加ゼロ | 1 |
| E12 | jsfb-verify / memory-profile の plain 指標 | ±2% | 2 |
| E13 | 恒久破棄した行コンポーネント | 回収済み holder の遅延 prune は単体テスト済み。索引キー・エイリアス辺・診断台帳の個別回収は未実装（X8） | 1（完全回収は未達） |
| E14 | SSR hydrate 後の E1 | クライアントで値が出る（スナップショットに getter 値は無い） | 0 で確認 / 3 |

## 6. リスク

| リスク | 対策 |
|---|---|
| 未存在キー経路に索引照会を足すことで、**未存在パスを大量に読む形**（`if` の存在判定など）が遅くなる | `hasMounts` ゲートの後ろ、かつ索引の**第 1 段（マーカー親パス）で Map 1 回**で抜ける。E11 でマウント無しを固定 |
| X4 の候補走査が行数 N に比例し、`$getAll` で O(N²) | 検証付き `listIndex → 記録` キャッシュは命中時の再走査を省く。初回・キャッシュ無効時の全行解決は O(N²) になりうる。再評価数の計測だけでは索引走査時間の上限は証明できない |
| 初回の途中値が UI に見える（子未登録） | 仕様として明記（D22 と同じ性質）。`?? 0` の慣習。アニメーションが要るなら `<wcs-defined>` でゲート |
| エイリアス辺により walkDependency の到達範囲が増え、**行 1 件の更新で全行が再評価**される | 辺は同 listIndex の 1:1。crossRow 判定（checkDependency）は親 getter が `$getAll` で全行を読むので**全行展開になる**のは今日の `$getAll` と同じ。P2-5 で「経路長比例」を確認し、超えれば `$getAll` の diff-filter 経路を検討 |
| lint / vscode-wcs が親スコープの `P.k` を未知パスと誤診 | P4-3。wcs-schema がタグ→state 形を持つ範囲でしか静的に解けないことを明記 |
| 「私有キーは見えない・getter は見える」で D20 の一文が二つに割れる | P4-1 で不変条件文を書き換える。語彙は「私有（private）」と「公開 getter（exported accessor）」に固定 |

## 7. 計測（2026-09-07 レビュー時）

実ブラウザはローカル headless Chromium、CPU throttle 1。既存 `e2e/bench/jsfb-verify.mjs` と `memory-profile.mjs` を各 1 回実行した。比較元は `de487346` のコミット済み dist（`221ae223` でも同一）、比較先はレビュー修正後の `npm run build`。**比較元をソースから同条件で再ビルドしていないため、機能差だけを分離した比較ではない**。生データと条件は [state-overlay-export-review.json](../e2e/bench/results/state-overlay-export-review.json)。

| 指標 | コミット済み dist | レビュー修正後 |
|---|---|---|
| jsfb create1k / replace1k / clear10k（中央値 ms） | 38.00 / 17.90 / 103.90 | 39.25 / 39.85 / 98.35 |
| memory ready / run1k / replace5（中央値 MB、各 3 サンプル） | 0.99 / 5.61 / 6.17 | 1.00 / 5.61 / 6.30 |
| memory update5 / create10k / clear10k（中央値 MB） | 5.86 / 35.02 / 13.14 | 5.87 / 35.02 / 13.14 |
| jsfb keyed classification（swap / run / remove） | すべて true | すべて true |

**E12 の ±2% 条件は確認できていない**。とくに replace1k に大きな差がある。ビルド条件を揃えた比較と反復測定が必要で、性能劣化なしとは記載しない。この plain ベンチは公開索引の O(N²) 懸念も検証しない。

P2-5 は `integration.mountExport.test.ts` で happy-dom 上の再評価数を別途計測した（深さ＝根から葉までの辺数、分岐 3）。単発の葉更新で深さ 2 / 3 / 5 の getter 呼び出しはそれぞれ **5 / 7 / 11 回**、再評価された異なるノードは **3 / 4 / 6 個**で、すべて葉から根の経路上だった。13 / 40 / 364 ノードの各木で葉を 100 回更新し、各回の根の値、再評価ノードの集合、呼び出し数の上限 `2 × (深さ + 1)` を回帰テストで検証する。これは getter 再評価数の検証であり、候補走査回数や初回 `$getAll` の時間計算量の保証ではない。

未計測: 実ブラウザでの tree-derivation（深さ 5・分岐 3・葉更新 100 回）の wall-clock、行数を変えた初回・キャッシュ無効時の索引走査時間。

## 8. リリースノート下書き（minor）

- **マウントされたコンポーネントの getter が親スコープから読める**ようになった（`text: users.*.display` / `$getAll("children.*.total")`）。ツリーに同名キーがあればツリーが勝つ（登録時に warn）。私有キーとメソッドは従来どおり見えない
- これにより**自己再帰コンポーネント**（木）の派生を各段 1 段の式で書ける: `get total() { return this.value + this.$getAll("children.*.total").reduce((a, b) => a + (b ?? 0), 0); }`
- 挙動変化: 未存在パスの読みが `undefined`＋warn だった箇所のうち、その位置に getter を持つコンポーネントがマウントされていれば値を返す。getter のみのキーへの親からの書き込みは throw（従来はツリーにキーを作って getter を無言で隠していた）
- binding の未存在パス warn は 1 マクロタスク後にまとめて 1 回（従来はバインド時即時）。autoloader の遅延 define では登録前の警告が出る場合がある

## 9. 見積り

| Phase | スライス数 | 備考 |
|---|---|---|
| 0 | 2 | テスト固定＋確認 2 件＋ベンチ |
| 1 | 2 | 索引・dispatch・warn |
| 2 | 2 | 辺・postUpdate 切り出し・収束テスト・ベンチ |
| 3 | 2 | 書き込み・診断・devtools |
| 4 | 2 | docs 英日・lint/vscode-wcs・example・skill |
| 計 | **10** | v2 マウント本体（31 スライス）の 1/3。着地は 2.2.0 想定（2.1.x の未リリース分の次） |

---

## 10. 実装記録（2026-09-07・branch `feat/state-overlay-export`・レビュー修正反映）

| 項目 | 実装 |
|---|---|
| 索引・解決・通知・衝突 warn | 新設 `packages/state/src/webComponent/exportIndex.ts`（`registerExports` / `resolveExport` / `notifyExports` / `warnShadowedExports`）。索引は `(親 state element, P, k) → {WeakRef<記録>, entry}` の集合、行キャッシュは `listIndex → holder` の検証付き（X4） |
| 記録 | `IMountRecord.exports: Map<公開パス, IExportEntry>`（`markerTerminalPath` ＝ overlay の「マーカー親」＝ `users.*.#m7`・`suffix`・`markerPath`・`exportedPath`） |
| 読み dispatch | `getByAddress.ts` の「親はあるが子キーが無い」分岐にだけ（`hasMounts` → 索引 → `readExportedAccessor`）。命中経路は差分ゼロ |
| 書き込み dispatch | `setByAddress.ts` の **fast path**（親がオブジェクトの未存在キー）にだけ。`_setByAddress` 側の分岐は到達不能で削除 |
| 公開評価 | `overlay.ts` の `readExportedAccessor` / `writeExportedAccessor` ＝ `createOverlayValue(P.#m<id>, listIndex)` に対する `Reflect.get / set`。getter 依存辺・キャッシュはマーカー側に載る。行の公開パスにも通常キャッシュがあり、公開書き込み時には dirty にする |
| エイリアス辺 | `registerExports` で `addDynamicDependency(P.#m<id>.k, P.k)`。`P.k` は getterPaths に載せない |
| 遅延登録・切断 | `mountScope.ts` の初期化直後（登録・再初期化）と `remountScopeBindings`、`State.ts` のマウント切断で `notifyExports`（ループ文脈付き `$postUpdate`）。インスタンス階数の公開パスのみ（内部ワイルドカード accessor は公開しない） |
| 診断（X7） | `pathDiagnostics.ts`: `binding` 起点の未存在報告を **1 マクロタスク遅延**（`deferReport` → `setTimeout 0` → `flushDeferredPathReports`）。`markExportedPath` が pending を消す。`watch` 起点は即時のまま。既存の同期 unit テスト 3 件は flush 呼び出しを追加 |
| devtools | `overlays()` に `exports: string[]` |
| テスト | `integration.mountExport.test.ts` 18 件＋`webComponent.exportIndex.test.ts` 13 件。行 setter・内部ワイルドカード非公開・親オブジェクト消失・prototype 衝突・通知例外と切断・深さ比例の再評価を検証。全体検証結果は §11 |
| ドキュメント | X1〜X9 の実装範囲と制限を更新。`packages/state/README.md` / `README.ja.md` に内部ワイルドカード非公開・autoloader 初回警告・曖昧検出範囲を追記。devtools-hook-protocol 英日版に `exports` と旧 v2 runtime 向け fallback を追補 |

実装で確定した事実:

- overlay.ts の「マーカー親パス」はマーカーで**終わる**パス（`users.*.#m7`）。手前（`users.*`）を渡すと accessor 逆引きに掛からず、ツリー読みに落ちて `ListIndex not found` になる（最初の配線で踏んだ）
- `setByAddress` の未存在キー書き込みは `setByAddressCore` の fast path で完結し、`_setByAddress` の親ウォーク分岐には来ない（X9 の dispatch は fast path 側だけでよい）
- `$getAll("children.*.total")` は行ごとの `getByAddress` に落ちるので、行マウントの公開 getter は listIndex の同一性（`getLoopContextByNode(component).listIndex` とその祖先鎖）で解ける。E3〜E5（深さ 3・後付け・削除）は追加の機構なしで緑
- 計測: plain jsfb / memory と happy-dom の getter 再評価数は §7。実ブラウザの tree-derivation wall-clock と公開索引の走査時間は未計測。

## 11. レビュー指摘への対応

| 指摘 | 判定・対応 |
|---|---|
| 行 setter の公開キャッシュが代入値に固定される | 正しい。修正前のテストで `ZED` / `zed!` の不一致を再現。公開 dispatch を `finally` に伝え、代入値の保存をせず dirty 化。setter が無い例外時も同じ。親の即時読み・`$getAll`・親子 DOM を検証 |
| 内部ワイルドカード getter が解決できず警告も消える | 正しい。修正前に warn 0 件を再現。推奨の最小案を採用し、`wildcardCount !== record.delta` を登録から除外。内部での利用を維持し、親の未解決警告が 1 回出ることを検証。delta 0 / 1 の登録対象と辺も検証 |
| 親 `P` が無くても索引を引く | 正しい。null / undefined なら dispatch 前に return し、§2-1 と一致させた。「害は無い」とは限らず、従来は消えた親に対して定数 getter が値を返すことも可能だった |
| prototype のキーが衝突 warn の対象外 | 正しい。読みと同じ `in Object(parentValue)` に統一。prototype getter を評価せずに衝突を警告するテストを追加 |
| devtools `exports` の契約追補漏れ | 正しい。英日プロトコル文書を更新 |
| X7 が ready 待機ではなく setTimeout 0 | 正しい。今回の遅延方式を維持し、英日 README と本書に autoloader の初回偽陽性を明記。ready 待機を実装済みとはしない |
| notifyExports の catch が広い | 正しい。ただし推奨の行文脈ガードだけでは不十分。親 state 全体の切断でも `State rootNode is not available` が発生したため、親が切断済みの場合も通知を省略。その他の例外は伝播 |
| X8 の台帳掃除が設計と違う | 正しい。X8・E13 に遅延 prune のみであること、残る台帳と寿命を記載。完全回収は未実装として保持 |
| キャッシュ命中時は曖昧検出が効かない | 正しい。X4 と英日 README に候補走査時だけの検出であることを明記 |
| 性能未計測 | 正しい。plain の実ブラウザ比較と深さ別の getter 再評価数を追加。±2% 条件と索引走査時間は未確認（§7） |
| 状態列・未コミット見出し・誤字 | 正しい。実装範囲・制限・コミット状態を更新し、mountScope の該当コメントを修正 |

検証結果: state 全体 **275 ファイル・2761 テスト成功**。カバレッジは statements / branches / functions / lines = **99.55 / 98.53 / 100 / 99.74%** で閾値内。state の lint・build、vscode-wcs の build も成功。ビルド時には循環依存と `inlineSources` の警告が出る。生成した dist はリポジトリ規約に従い変更に含めない。blocking 2 件は回帰テスト付きで解消したが、E12 の性能ゲート達成はこの検証からは宣言しない。
