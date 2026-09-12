# 設計検討: 再帰のパス表現

- **状態**: **Phase A（成立条件の実測）完了**（2026-09-09）。ゲートは全て推奨で採択済み。実装は [state-recursive-path-impl-plan.md](./state-recursive-path-impl-plan.md) が進行の正本で、本書は設計判断と実測の記録。
- **Phase A で本書に入った訂正**: §7-2 の cold start（`$setAll` は throw しない）／描画なしでの台帳世代分裂（読みは成立・**書きは成立しない**）／共有配列の別名化（D12 新設）／停止の実効上限は 128（§6-3）。
- **対象**: `@wcstack/state` のパス語彙と、その 3 つの消費者（getter / [`$getAll`](../packages/state/src/proxy/apis/getAll.ts) / [`$setAll`](../packages/state/src/proxy/apis/setAll.ts)）。
- **一言で**: 再帰は**依存グラフの問題ではなく記法の問題**。深さ方向の縮約エッジは既に実装済みで、手で展開した再帰形は今日そのまま動く（§3 の実測）。足りないのは「無限個の静的パスの族」を 1 つの宣言で表す語彙だけ。
- **問い（依頼の原文）**: 再帰のパス表現は可能か。可能なら `$getAll` / `$setAll` / getter で利用できるか。

---

## 0. 決定ゲート（全て推奨で採択済み — 実装は [実装計画](./state-recursive-path-impl-plan.md) が正本）

| ゲート | 論点 | 推奨（採択） |
|---|---|---|
| **D1** | そもそも作るか | 作るなら**同型再帰のみ**。子孫検索（XPath `//` 相当）は採らない（§2-3）。 |
| **D2** | `**` をどの層に置くか | **オーサリング層の記号に留める**。`PathInfo` には展開済みの具体パスしか降ろさない（§2-1）。 |
| **D3** | 再帰点の指定 | **宣言必須**（`$recursion`）。推論しない（§6-1）。 |
| **D4** | `**` の意味論 | `**` は**再帰深さを表す変数**で、束縛は文脈から決まる。getter キーの `**` はその評価深さに束縛。API 引数の `**` は**現行の `$getAll` 省略時規則をそのまま継ぐ** — 添字省略なら文脈の深さに束縛、`[]` なら全深さの合併（§6-2）。 |
| **D5** | 展開のタイミング | **遅延・データ駆動**。実データの深さぶんだけ実体化する（§6-3）。 |
| **D6** | getter での利用 | **可**。本命の用途（§7-1）。 |
| **D7** | `$getAll` での利用 | **省略形（文脈束縛）と `[]`（全深さ合併）の 2 形のみ**。部分接頭辞は `**` に対して定義できないので throw（§7-2）。 |
| **D8** | `$setAll` での利用 | **ブロードキャストのみ**。`{ spread: true }` は禁止、mapper は別シグネチャが要る（§7-3）。 |
| **D9** | `$resolve` での利用 | **不可**。ragged な添字タプルを通さない（§8）。 |
| **D10** | 展開物の寿命 | 未決。台帳（WeakMap）は自己回収されるが、**intern したパスと生やしたアクセサは永続**。木が浅くなっても残る（§7-2・§10）。 |
| **D11** | 展開の停止保証 | 実効上限は **128 段**（`pushAddress` の `MAX_LOOP_DEPTH`。Phase A 実測）。ただし現行の診断が「循環の可能性」という**誤告発**になるので文面の分岐が要る。上限超過は **throw**（集計を黙って打ち切らない）が既存の作法と一致（§6-3・§10）。 |
| **D12** | 共有配列の扱い | 拒否する。条件は「DAG」ではなく**同じ配列インスタンスが 2 つ以上の親から到達可能**。検出は**走査そのもの**で行う（§7-2 の訂正注記。台帳の親で見る旧案は誤り）。循環は同じ述語で捕まる。 |

---

## 1. 出発点

木構造（`Node = { value, children: Node[] }`）を state に置くと、深さが動的になる。現行のパスは深さを文字列に焼き付けるので、

- 深さ 3 のツリーには `nodes.*.children.*.children.*.value` と書く
- 深さが 1 段増えるたびに、パスも getter もテンプレートも 1 セット増える

という O(最大深さ) の記述量になる。「1 本の記法で任意深さを指す」ことができるのかが問い。

---

## 2. 現行のパス表現が再帰を持てない理由

### 2-1. 静的 arity に全機構が依存している

パスは `a.b.*.c` の静的文字列で、[`PathInfo`](../packages/state/src/address/PathInfo.ts) が文字列 intern してインスタンス同一性を依存グラフ・アドレス比較・キャッシュのキーにしている。ここで `wildcardCount` が**静的に確定していること**が、次の 4 つを同時に決めている。

| 依存箇所 | 何を `wildcardCount` から決めているか |
|---|---|
| [`wildcardLevel.ts`](../packages/state/src/list/wildcardLevel.ts) | ListIndex チェーンの長さ（`Δ + W`）と、位置→段の変換 |
| [`define.ts`](../packages/state/src/define.ts) | `$1..$n` の本数（`MAX_WILDCARD_DEPTH = 128` で先に全部作ってある） |
| [`resolve.ts`](../packages/state/src/proxy/apis/resolve.ts) | 添字本数の**厳密一致**検査 |
| [`wildcardIndexes.ts`](../packages/state/src/proxy/apis/wildcardIndexes.ts) | 走査の段数（`wildcardParentPathInfos` 配列の長さ） |

深さ不定の `**` を `PathInfo` に持ち込むと、この 4 つが同時に壊れる。**`**` を `wildcardCount` に混ぜる実装は取り得ない**、というのが最初の制約。

### 2-2. テンプレートの相対記法は parse 時に静的展開される

`for` の中の `.field` 記法は、[`expandShorthandPaths.ts`](../packages/state/src/structural/expandShorthandPaths.ts) が**バインド解析の時点で絶対パスへ書き換える**。実行時に「今いる深さ」で解決しているわけではない。したがって「同じテンプレートを深さ違いで使い回す」ことも現行経路では起きない。再帰テンプレートを入れるなら、深さごとのプレフィックス書き換えが新たに要る。

### 2-3. 区別すべき 2 つの「再帰」

| | 内容 | 判定 |
|---|---|---|
| **(A) 同型再帰** | `Node = { value, children: Node[] }`。深さは動的だが**形は同じ** | 静的解析と両立する。検討対象はこちら |
| **(B) 子孫検索** | XPath `//` 相当。異種構造を横断して「どこかにある x」 | **採らない** |

(B) は「パスが契約」という前提そのものを壊す。マッチが非決定的になり arity も不定になるうえ、vscode-wcs のパス検証と lint がパスを state 実体と突合できなくなる（`wcs/*` 診断が全滅する）。異質さを保つための設計原則の側から見ても、(B) は「HTML に検索言語を持ち込む」ことになり、data-wcs は配線であって DSL ではない、という線を越える。

---

## 3. 実測 — 機構は既に再帰形を扱えている

### 3-1. 手動アンロールのプローブ

深さ 3 のツリーに対し、**同じ getter 本体を深さ分だけ展開して**割り当てた（`nodes.*.total` / `nodes.*.children.*.total` / `nodes.*.children.*.children.*.total` と、ルート集計 `grandTotal`）。

```
初期:        lv1 = [110, 20]   lv0 = [131, 2]   grandTotal = 133
最深（深さ 2）の葉に $resolve で 500 を書く
更新後:      lv1 = [510, 20]   lv0 = [531, 2]   grandTotal = 533   ✓
```

深さ 2 の葉への書き込みが、深さ 1 → 深さ 0 → ルート集計まで正しく伝播した。再現コードは §11 に置く。

### 3-2. なぜ動くか — 深い側→浅い側の縮約エッジは実装済み

集計 getter の依存は「深いパス → 浅いパス」という**縮約方向**のエッジになる。これは [`walkDependency.ts`](../packages/state/src/dependency/walkDependency.ts) の動的依存展開が既に扱っている。

`nodes.*.children.*.total → nodes.*.total` の場合:

1. [`calcWildcardLen`](../packages/state/src/address/calcWildcardLen.ts) が `wildcardPathSet` の積を取る → 共有は `nodes.*` の 1 段
2. `depPathInfo.wildcardCount - wildcardLen = 1 - 1 = 0` なので `expandable = false`
3. 非展開分岐で `listIndexAtWildcard(chain, 0, 2)` → **親行の ListIndex に縮む**

つまり「子の集計が変わったら親の集計を dirty にする」は、パスさえ具体的なら**今日そのまま成立する**。キャッシュの dirty 化も `dirtyCacheEntryByAbsoluteStateAddress` がアドレス単位で行うので、深さごとに独立して効く。

**この節が本検討の中心的な発見**である。再帰は依存グラフの拡張を要求しない。要求するのは「無限個の具体パスをどう生成し、どう宣言するか」だけ。

---

## 4. 実測 — 現状の 2 つのワナ

「手で展開する」を推奨手順にできない理由。どちらも**黙って壊れる**。

### 4-1. getter 内の JS 再帰は stale になる

生オブジェクトを JS の再帰関数で畳むと、依存として登録されるのはリスト本体（`nodes`）だけ。深い葉にパス経由で書いても集計は更新されない。

```
初期 13 → 深い葉に 500 を書く → 13 のまま（！）
        → s.nodes = [...s.nodes] でリスト参照を触ると 503
```

`walkDependency` は書き込みアドレスから**下流**（source → dependents）へ辿る。静的エッジは親→子の向きなので、子への書き込みが `nodes` まで遡ることはない。エラーも警告も出ない。

### 4-2. 展開深さ < データ深さ は NaN になる

深さ 1 までしか getter を展開していない state に深さ 2 のデータを入れると、未定義の getter パスが素の undefined 解決になり、`undefined` を足した結果が `NaN`、表示は空文字になった。ここも throw しない（getByAddress の「親が居ないパスの読みは undefined」という寛容規約の帰結）。

作者が「データが将来どこまで深くなるか」を事前に知っていないと正しく書けない、ということ。逆に言えば、**遅延展開をエンジンが持てば §4-1 と §4-2 の両方が消える**。

---

## 5. 実測 — 今日できること: 自己参照コンポーネント

### 5-1. 成立する形

描画の再帰だけなら、**同一タグの自己参照で任意深さが今日成立する**。

```html
<!-- <rec-node> の shadow -->
<wcs-state bind-component="state"></wcs-state>
<span data-wcs="textContent: node.label"></span>
<template data-wcs="for: node.children">
  <rec-node data-wcs="state.node: node.children.*"></rec-node>
</template>
```

深さ 3 のツリーが `root / a / a1 / b` と正しく描画された。各段のスコープ内では `node.children.*` の 1 段しか使わないので、**パスが深さに依存しない**のが要点。`bind-component` の多段接ぎ木が成立することは [`integration.bindComponentDepthN.test.ts`](../packages/state/__tests__/integration.bindComponentDepthN.test.ts) が別途担保している（あちらは深さごとに別タグ、こちらは同一タグ）。

### 5-2. 2 つの前提条件

| 条件 | 理由 |
|---|---|
| コンポーネントの初期 `state` は `{}` にする | 既定値がマッピングを隠す（v2 D19）。既定値を持たせると親からの配送が届かず、子の表示が空になる。プローブで実際に踏んだ |
| shadow は `connectedCallback` で組む | constructor で `innerHTML` を入れると、`<template>` の中身を upgrade する実装（happy-dom がそう）でコンストラクタが無限再帰する。実ブラウザは template content が inert なので通るが、環境依存の地雷になる |

### 5-3. これで解けないこと

**部分木の集計は自己参照コンポーネントでは書けない。** 子スコープは親のサブツリーへの接ぎ木であって、深さ横断の getter を置く口がない。したがって「木の描画」と「木の集計」は別々の解を要求する — 前者は今日解けており、後者が §6 以降の対象。

---

## 6. 記法案 — `$recursion` と `**`

### 6-1. 再帰点は宣言する

推論せず、宣言させる。

```js
$recursion = { "nodes.*": "children.*" };   // アンカー : 自己相似な相対サブパス
```

これで無限の族が定義される。

```
k=0   nodes.*
k=1   nodes.*.children.*
k=2   nodes.*.children.*.children.*
...
```

参照する側は `**` を使う。

```
nodes.**          族の合併（= 任意深さのノード）
nodes.**.total    各深さの同名 getter
```

宣言必須にする理由は 3 つ。①静的解析（vscode-wcs のパス検証・lint）が「どのパスが合法か」を列挙できる、②`**` の展開が有限のアンカー集合に閉じるので暴走しない、③子孫検索（§2-3 の (B)）へ滑り落ちない。

### 6-2. 束縛と合併の書き分けは既存規則の継承

`**` は**再帰深さを表す変数**で、束縛されるか合併されるかは文脈が決める。これは新しい規則ではなく、**現行の `*` が既に持っている書き分けをそのまま継ぐ**。

| 文脈 | `*` の意味（現行） | `**` の意味（案） |
|---|---|---|
| getter のキー | 呼び出し文脈の ListIndex に**束縛**される | その getter が評価されている**深さに束縛**される |
| getter 本体でのパス読み | 文脈に**束縛** | 評価深さに**束縛** |
| `$getAll(path)`（添字**省略**） | 文脈の添字を接頭辞に敷く（整合最長接頭辞） | 評価深さに**束縛**。展開されるのは `**` より後ろのワイルドカードだけ |
| `$getAll(path, [])`（**明示**） | マッチする全アドレスの**合併** | 全深さの**合併** |
| `$getAll(path, [i, …])`（部分接頭辞） | 前方一致で絞り込む | **定義できない** → throw（§7-2） |

この書き分けは机上の案ではなく、実装済みの挙動そのものである。[`getAll.ts`](../packages/state/src/proxy/apis/getAll.ts) の省略時既定は「path と文脈が共有するワイルドカード連鎖のぶんだけ文脈の添字を接頭辞に敷く」で、`[]` を明示したときだけ全展開になる。§3 のプローブでも、行 getter の中の `$getAll("nodes.*.children.*.total")`（省略）は現在行に束縛され、ルート集計の `$getAll("nodes.*.total", [])`（明示）は全行合併になっていた。

**この書き分けを落とすと集計が二重計上になる。** `$getAll("nodes.**.children.*.total")` を無条件に「全深さの合併」と読むと、孫の total が「子の total の内訳」としても「合併の要素」としても数えられる。**省略形が評価深さに束縛されることが、再帰集計が正しく畳まれる条件そのもの**であり、`**` の意味論をここで曖昧にしてはならない。

### 6-3. 実装の足場は既にある

| 必要なもの | 既存フック |
|---|---|
| 深さ k のアクセサ実体化 | [`State.defineTreeAccessor`](../packages/state/src/components/State.ts)（quoted-path アクセサ用。`getterPaths` / `setterPaths` / `setPathInfo` まで面倒を見る） |
| 依存エッジの登録 | getter 実行時の `addDynamicDependency`。深さごとに自然に生える |
| 循環しないこと | 深さ k と k−1 は**別のパス文字列**なので自己ループにならない。`topologicalRank` も lint の `wcs/getter-cycle` も無傷 |
| 展開のトリガ | ①`for` が深さ k+1 のコンテンツを実体化するとき ②`$getAll` がデータを降りるとき。どちらも既にリスト実体を読んでいる経路 |
| 終端（データが有限なら） | リストが空なら `$getAll` が `[]` を返して自然に止まる（§3 の実測で確認） |
| 終端（それ以外） | **既存フックは無い**。展開器に上限検査を新設する必要がある（下記） |

**エンジンが見るのは常に展開済みの具体パス**（`nodes.*.children.*.total`）であり、`**` は宣言・getter キー・テンプレート・API 引数にしか現れない。これが D2 の意味。

**停止の実効上限は 3 つあり、値が違う（D11・Phase A 実測）。**

| 上限 | 実効値 | 何が止めるか |
|---|---|---|
| ワイルドカード段数 | **無し** | `MAX_WILDCARD_DEPTH = 128` は [`define.ts`](../packages/state/src/define.ts) が `$1..$n` の名前表を作るための定数にすぎず、`PathInfo` も走査も止めない（`"a" + ".*".repeat(129)` は受理され `wildcardCount = 129`）。1000 段の `PathInfo` も 3000 段の走査も通り、壊れ方は V8 の素の `RangeError`（3000〜4000 段） |
| getter の評価スタック | **ちょうど 128 段** | [`StateHandler`](../packages/state/src/proxy/StateHandler.ts) の `pushAddress`（`MAX_LOOP_DEPTH`）。129 段目で throw する |
| 依存グラフの深さ | 1000 | [`topologicalRank.ts`](../packages/state/src/dependency/topologicalRank.ts) の `MAX_DEPENDENCY_DEPTH`。木の深さと 1:1 なので 128 より先に踏むことはない |

したがって **cold な top-down 評価はちょうど 128 段まで成立し、129 段で throw する** — これが再帰集計の実効上限。ただし 2 つの落とし穴がある。

- **診断が誤告発になる。** 循環が一切ない直線の木でも文面は `Possible circular dependency between path getters:` になる。`_describeAddressCycle()` は末尾 8 段を並べるだけで**重複の有無を見ていない**。深さ超過と循環を分けるには「末尾に重複パスがあるか」で分岐し、重複が無ければアンカー・深さ・対象パスを名指しする別文面（`wcs/recursion-depth-exceeded` 相当）にする必要がある。実装計画 §1-3 の「アンカー・深さ・対象パスを含む診断で throw」は、展開器の上限を 128 未満に置かない限り**展開器だけでは満たせない**（先に `StateHandler` がこの文面で落ちる）。
- **`$129` が無言で undefined になる。** `INDEX_BY_INDEX_NAME` は `$1..$128` しか持たず、`traps/get.ts` は表引きに失敗すると通常のプロパティ解決へ落ちる。`$128` は正しく 0 を返すので、境界のすぐ外側だけが診断ゼロで壊れる。→ **修理済み**（Phase A' の E3・`[wcs/index-param-range]` で throw する。実装計画 §3-2）。

（余談だが実測で分かったこと: 最深から浅い順に温める bottom-up 評価は 128 の壁を越える — キャッシュヒットが `pushAddress` を通らないため深さ 400 まで通った。ただし葉を 1 つ書き換えると次の読みで再び 128 で落ちるので、逃げ道にはならない。）


超過時の扱いは **throw** が妥当。集計を途中で打ち切ると**誤った合計を黙って返す**ことになり、§4 の 2 つのワナと同じ失敗の形になる。既存の作法とも一致していて、依存グラフ側の上限 `MAX_DEPENDENCY_DEPTH = 1000` は [`topologicalRank.ts`](../packages/state/src/dependency/topologicalRank.ts) で超過時に「循環参照の可能性」として throw する。展開器の上限もこれに倣い、**アンカーと深さを名指しする診断**にする。実装で使うコードは `wcs/getter-depth-exceeded`（Phase A' で新設）— 再帰専用ではなく「深い getter 連鎖」一般に出る診断なので、`recursion-` を冠さない。循環側は `wcs/getter-cycle` で、判定はスタック全体のアドレス同一性による（末尾のパス文字列の重複では、周期の長い輪を取り逃がし、同じパスを別の行で読む正当な再帰を誤告発する）。

---

## 7. API 別の可否

### 7-1. getter — **可**（本命）

§4 の 2 つのワナが実需そのもの。`total = 自分の値 + 子の total の合計` を宣言的に書けるのは、この機能でしか得られない。深さごとの実体化さえエンジンが持てば、依存追跡・キャッシュ・伝播はすべて既存機構に乗る（§3-2 が根拠）。

```js
// 案
get "nodes.**.total"() {
  return this["nodes.**.value"] +
         this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
}
```

2 つの `**` はどちらも**この getter が評価されている深さに束縛される**（§6-2）。`nodes.**.value` は「自分の深さの value」、`$getAll("nodes.**.children.*.total")` は添字**省略**形なので「自分に束縛された深さの、直下の子の total」であって、全深さの合併ではない。深さ k の getter は深さ k+1 の getter だけを読むので、グラフは深さでレイヤ分けされた DAG になり、孫は子の total の内側で一度だけ数えられる。

同じパスを合併で読みたいときは `[]` を明示する。両者は別の操作で、書き分けは `*` と同じ規則に従う。

```js
// 全深さの合併（ルートに置く集計）
get treeTotal() {
  return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
}
```

**`$getAll("nodes.**.children.*.total", [])` は書いてはいけない形。** 合併なので孫以下が二重に数えられる。この取り違えは静的に検出できる（`**` を含むパスへの `[]` 明示が、`**` に束縛された getter の内側にある）ので、lint 規則の候補になる。

### 7-2. `$getAll` — **条件付きで可**

走査は一般化できる。[`collectWildcardIndexes`](../packages/state/src/proxy/apis/wildcardIndexes.ts) は `wildcardParentPathInfos` 配列を深さ優先で降りるだけなので、「固定長の配列」を「データが尽きるまで伸びる不動点走査」に置き換えられる。順序（深さ優先・添字昇順）も保てる。

壊れるのは**合併形（`[]` 明示）だけ**で、2 つある。

1. **添字タプルの arity が結果ごとに変わる。** 現行の正本の性質「戻りタプル長 = `wildcardCount` で、そのまま `$resolve` に渡せる」が `**` の合併では成立しない（長さ 2 と 4 が同じ呼びに混ざる）。`$getAll` は値の配列しか返さないので読み自体は成立するが、**往復（`$getAll` → `$resolve`）の保証は失われる**。
2. **部分接頭辞 `[i, …]` の意味が定義できない。** `**` のどの深さの何段目を指すのか言えない。

省略形は影響を受けない。§6-2 の通り `**` が評価深さに束縛され、残るワイルドカードの本数は静的に決まるので、arity も往復も現行のまま保たれる。

→ 許すのは **省略形（文脈束縛）と `[]`（全深さ合併）の 2 形だけ**。部分接頭辞は `indexArityMessage` と同じ形の診断で throw する。合併形に上限を与えたい場合は `{ maxDepth }` のようなオプションを足す（D11 の上限とは別物 — こちらは意図的な絞り込み）。

**ListIndex 台帳は `for` に依存しない（実測）。** [`collectWildcardIndexes`](../packages/state/src/proxy/apis/wildcardIndexes.ts) はワイルドカード階層ごとに `createListDiff` を呼び、[`createListDiff.ts`](../packages/state/src/list/createListDiff.ts) が `setListIndexesByList` で台帳（リスト値を弱参照キーにした `WeakMap`）へ登録する。したがって `for` バインドがまったく無いページでも、`$getAll` を撃てば台帳ができ、続く `$resolve` / `$setAll` も成功する。

```
for バインドなし・初期状態から:
  $getAll("nodes.*.children.*.value", []) = [10, 11, 20]
  $resolve("nodes.*.children.*.value", [0, 1]) = 11        ← 成功
  $setAll("nodes.*.children.*.value", [], 99) = 3 件書き込み ← 成功
```

throw するのは**走査を一度も経ていないリストにいきなり `$resolve` を撃った場合**だけ。[`getListIndexByIndexes`](../packages/state/src/proxy/methods/getListIndexByIndexes.ts) は台帳を**引くだけで作らない**ためで、`$resolve` は第 1 相（走査）を持たない唯一の API である。この cold start は `**` とは無関係の既存の性質。

> **訂正（Phase A 実測・2026-09-09）**: 本節は以前 `$setAll` も throw 側に数えていたが誤りだった。`$setAll` は第 1 相で `collectWildcardIndexes` を回すので cold でも成功する（上のコード片が正しく、本文が間違っていた）。ただし**接頭辞で絞った `$setAll(path, [0], v)` は降りなかった枝を cold のまま残す** — 直後に `$resolve(path, [1, 0])` を撃つと `ListIndexes not found: nodes.*.children` で落ちる。温度は state 単位ではなく**ワイルドカード段単位**である。

**ただし「読み」に限る（Phase A 実測）。** 走査 API が台帳を作るのは事実だが、それは**読みが台帳を作る**という話でしかない。`for` バインドの無いリストに**構造書き込み**（並べ替え・先頭追加・末尾以外の削除・親リスト再代入）を加えると、集計は恒久的に stale になるか `ListIndexes not found` で恒久的に throw する。

原因は差分基準の持ち主にある。[`walkDependency`](../packages/state/src/dependency/walkDependency.ts) が読む基準 `lastListValueByAbsoluteStateAddress` を**書き込むのは描画経路だけ**（`applyChangeFromBindings` / `BindingSession` / `hydrateBindings` の 3 箇所）。`for` が無いと基準が永久に空のまま残り、[`createListDiff`](../packages/state/src/list/createListDiff.ts) の `oldList.length === 0` 分岐に落ちて**新しい配列に新しい ListIndex を鋳造**する。子リストの台帳は古い親 ListIndex を指したまま残るので、親子の連鎖が切れる。

| 観測 | 実測値 |
|---|---|
| 壊れるのは**ルートリストだけ** | ネストしたリスト（`nodes.*.children`）は `for` が無くても構造変更に追従する |
| `for` は 1 本でよい | `for: nodes` だけ置いて children をまったく描画しなくても、深い階層まで正しく動く |
| 失敗の形は 2 つ | 無言 stale（並べ替え・追加）と恒久 throw（末尾以外の削除）。分岐するのは削除位置だけ |
| リフレッシュイディオムが効かない | in-place `push` の後に `[...arr]` で再代入しても回復しない（基準が同じ配列なので `isSameList` が真になる） |
| getter を挟まなければ健全 | getter がまったく無い同形の state では headless でも `$getAll` / `$resolve` が正しい。旧世代が漏れるのは**getter に文脈として渡される ListIndex** の経路だけ |

つまり **§7-2 の「描画していない深さに `$getAll` が届く」は読みについては正しく、書きを含めた運用については成立しない**。実装計画が到達点に掲げる「描画していない木でも動く」は、差分基準を描画経路から切り離す既存機構の修正を前提にする（実装計画 §3-1 の E1）。

**同じ配列インスタンスの共有は無言で誤る（Phase A 実測）。** 台帳 [`listIndexesByList`](../packages/state/src/list/listIndexesByList.ts) はリスト**配列の identity** だけをキーにしていて親を持たない。同じ `children` 配列に 2 つの親から到達できると、`createListDiff` の `oldList.length === 0` 分岐が既存台帳を無条件に再利用するため、ListIndex の親が**先に走査した親に固定**される。行 getter が親の値を読むと別名化した値を返し（実測 `[109,109]`、正しくは `[109,209]`）、`$setAll` の mapper 形は**二重適用**される。循環データはその特殊ケースで、`wcs/wildcard-rank` という無関係な文面で落ちる。**追記（#256）**: この別名化は「1 本の配列に 1 組の行」という設計の帰結なので残している —— 親ごとに私有の行集合にすると、同じスロットに 2 本の絶対アドレスができ、片方へ書いた値がもう片方から永久に見えなくなる（実測で却下）。#256 が直したのは**陳腐化**の側（行オブジェクトを作り直す置換で、行がぶら下がる親が退役する形）だけで、そこは行の identity を保ったまま生きた親へ付け替える（親が生き返ったら元へ戻す）。

拒否すべき最小条件は「DAG」ではなく **「同じ配列インスタンスが 2 つ以上の (親 ListIndex, 深さ) から到達可能であること」**。検出は `createListDiff` の戻り値に対する参照比較 1 回で足りる（`diff.newIndexes[0].parentListIndex !== listIndex` なら共有）。ノードオブジェクトの共有は、その `children` が空なら完全に正しく動くので拒否不要。

> **訂正（Phase E 実装・2026-09-10）**: 上の「参照比較 1 回」は誤りだった。台帳（`listIndexesByList`）はリスト配列の identity だけをキーにしていて親を持たないので、行オブジェクトを作り直すふつうのイミュータブル更新（`nodes.map(n => ({...n}))` は `children` を参照ごと引き継ぐ）で親が入れ替わっただけの正当な木を「共有」と誤認する。実装は**走査そのもの**で判定する —— 1 回の走査の中で同じ配列インスタンスに 2 度到達したら共有（祖先の経路上なら循環）で、台帳の親は見ない（実装計画 §5・`recursion/walk.ts`）。

**再帰で新しく増えるのは台帳の寿命ではなく、展開物の寿命**（D10）。台帳と差分基準（`lastValueByListAddress`）はどちらも `WeakMap` で、キーであるリスト値やアドレスが死ねば一緒に回収されるので、深さが増えても性質は同じ。一方 `**` の展開が生む 2 つは回収されない。

| 展開物 | 寿命 |
|---|---|
| intern した `PathInfo` | [`PathInfo.ts`](../packages/state/src/address/PathInfo.ts) の `_cache` は素の `Map` で、tooling 用の口以外からはクリアされない（インスタンス同一性が依存グラフの前提なので、ランタイムでのクリアは禁止されている） |
| `defineTreeAccessor` で生やしたアクセサ | state オブジェクト上のプロパティとして残り、`getterPaths` にも残る |

つまり**一度深くなった木が浅く戻っても、その深さのパスとアクセサは残り続ける**。実用上は「一度でも到達した最大深さ」ぶんのメモリで頭打ちになるので致命的ではない見込みだが、上限（D11）を持たない実装だと単調増加になる。ここが実装上いちばん詰めるべき点。

### 7-3. `$setAll` — **ブロードキャストのみ**

2 相構成（アドレス全確定 → まとめて書く）自体は `**` と相性が良い。第 1 相で木を降りきってから書けるので、「走査中の書き込みが ListIndex 集合を動かす」問題は起きない。壊れるのは引数の側。

| 形 | `**` での可否 | 理由 |
|---|---|---|
| ブロードキャスト `$setAll("nodes.**.selected", [], false)` | **可** | 素直に定義できる唯一の形 |
| mapper `(current, ...indexes)` | 要別シグネチャ | ragged な添字が可変長で来る。深さを渡すなら `(current, indexes[])` のような形が要る |
| `{ spread: true }` | **禁止すべき** | 順序自体は決定的に定義できるが、木に 1 次元配列を配るのは作者が走査順を知らないと使えず実用にならない |

`indexes` 引数は必須・明示というのが `$setAll` の現行規約（[state-set-all-design](./state-set-all-design.md) の D4）で、これは「`for` の中で `[]` と書いたら現在行ではなく全行を意味する」＝**書き込み API に暗黙の文脈依存を持たせない**という決定に基づく。`**` に対してもこの決定を継ぐなら、書き込み側は `$getAll` と違って**省略形（文脈束縛）を持たず、`[]` だけ**になる。「`**` を含むパスでは `[]` 以外を渡したら throw」が妥当。

読み（省略形あり）と書き（`[]` のみ）で形が非対称になるが、これは `**` が持ち込む非対称ではなく、既存の D4 がそう決めているという話。§6-2 の書き分け表は読み側の規則である。

### 7-4. その他の消費者

| 消費者 | 影響 |
|---|---|
| `for` テンプレート | 再帰テンプレートを許すなら、§2-2 の静的展開を「深さごとのプレフィックス書き換え」に一般化する必要がある。許さないなら §5 の自己参照コンポーネントが引き続き唯一の描画手段 |
| `$watch` | `**` パスの購読は「全深さの合併」で定義できるが、通知が来たときにどの深さのどのアドレスかを渡す手段が要る |
| `$resolve` | **対象外**（D9）。ragged タプルを通さない |
| SSR スナップショット | 展開済みパスをどこまでスナップショットに含めるか。遅延展開なので「サーバー側の展開深さ = クライアント側の展開深さ」を保証する必要がある |
| devtools | 台帳表示が深さごとに増える |

---

## 8. やらないこと

| 却下する案 | 理由 |
|---|---|
| `**` を `PathInfo.wildcardCount` に混ぜる | §2-1 の 4 点が同時に壊れる |
| `$1..$n` を可変長にする | 添字名は `MAX_WILDCARD_DEPTH` ぶん先に作られた定数表。可変長にすると「`$2` が黙って `$1` を返す」類の事故を防いでいるガードが機能しなくなる |
| `$resolve` に ragged な添字タプルを通す | 厳密一致検査は「本数の取り違えが黙って部分集合を返す」欠陥を潰すために入れた（v2）。緩めると同じ穴が開く |
| 宣言なしの子孫検索（`**` を XPath `//` にする） | §2-3 の (B)。静的解析が死ぬ |
| 「手で深さ分展開してください」を推奨手順にする | §4-2 の通り、展開不足が黙って NaN になる |

---

## 9. 影響範囲と規模感

| 領域 | 作業 |
|---|---|
| パス展開器 | **新設**。`$recursion` 宣言 → 深さ k の具体パス生成 |
| `collectWildcardIndexes` | 固定段数の走査 → 不動点走査への一般化 |
| `State.defineTreeAccessor` / `setPathInfo` | バインド確立後の遅延登録が安全かの検証（依存グラフは追記のみで成長する前提があるので相性は良いはず） |
| ListIndex 台帳 | 描画していない深さの台帳の生成と寿命（D10） |
| `for` テンプレート | 再帰テンプレートを入れる場合のみ（§7-4） |
| vscode-wcs | パス検証・`wcs/*` 診断・`$recursion` 宣言のバリデータ |
| SSR / devtools | 展開深さの受け渡し、台帳表示 |

**[mount](./state-mount-design.md) と同程度の規模**とみる。core の中心（依存グラフ・updater）には触らずに済む見込みだが、パス生成という一番下の層に手を入れるので影響の幅は広い。

---

## 10. 未決だった論点（記録）

> **すべて決着済み**（2026-09-10）。決定は [実装計画 §1](./state-recursive-path-impl-plan.md)（範囲と契約）が正本で、ここは検討時点の論点をそのまま残す: 1 → D10（一度でも到達した深さぶんで頭打ち・再セットで世代ごと回収）、2 → D11（128 段・throw）、3 → 単一自己再帰のみ、4 → `$depth` は入れない、5 → 深さ優先・行きがけ順、6 → 描画は自己参照コンポーネント、7 → `examples/recursive-tree/`。

1. **D10（展開物の寿命）** — 台帳は `WeakMap` なので自己回収されるが、intern した `PathInfo` と `defineTreeAccessor` で生やしたアクセサは残り続ける（§7-2）。「一度でも到達した最大深さ」で頭打ちになる想定でよいか、回収の口が要るかを決める。
2. **D11（上限と超過時の扱い）** — 展開器の深さ上限をいくつにするか、超過を throw にするか。集計を黙って打ち切ると誤った値を返すので throw が妥当と見ているが、`$getAll` の合併形での「途中まで返す」需要があるかは確認する。循環データ（`node.children` に自分自身）の検出をここに含めるかも同じ論点。
3. **`$recursion` の宣言形** — アンカーが複数ある場合（相互再帰: `a.*` の子が `b.*`、`b.*` の子が `a.*`）を許すか。許すと展開が積になるので、初版は**単一自己再帰のみ**が妥当か。
4. **深さの露出** — getter の中で「今の深さ」を読む手段（`$depth` 相当）が要るか。パンくずや階層インデントの実需はありそう。
5. **`$getAll` の順序規範** — 深さ優先の**行きがけ順**（親が先）を規範にするか。集計は帰りがけ順が自然だが、`$setAll` との順序一致（現行の規範）を保つなら 1 つに決める必要がある。
6. **描画側を入れるか** — §5 の自己参照コンポーネントで描画は解けている。再帰テンプレート（§7-4）まで踏み込むかは別判断でよい。計算だけ先に入れる案もある。
7. **実需の確認** — 現時点で本リポジトリに木構造のデモ・テストは無い（`children` を使うテストは mount / bind-component の入れ子確認のみ）。入れるなら先にツリーの examples を 1 本書き、どこが書きにくいかを実測してから決めるのが順当。

---

## 11. プローブの再現手順

> **Phase A 以降は恒久テストが正本**: `packages/state/__tests__/integration.recursionPrerequisites.test.ts`（依存している正しい挙動）と `packages/state/__tests__/integration.recursionKnownDefects.test.ts`（今日は誤っている挙動の性格づけ）。以下は本書を書いた時点の使い捨てプローブの記録で、上の 2 本に吸収済み。

本検討の初期の実測は使い捨てのテストで取った（コミットしていない）。再現する場合は `packages/state/__tests__/` に置いて `npx vitest run <file>` で走る。

**共通のマウントヘルパ**（既存の統合テストと同じ形。[`integration.diamondListStale.test.ts`](../packages/state/__tests__/integration.diamondListStale.test.ts) を参照）:

```ts
async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`probe-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { shadowRoot, stateEl };
}
// 書き込みは stateEl.createState("writable", (s) => { ... })
```

| プローブ | 内容 | 結果 |
|---|---|---|
| **P1**（§3） | 深さ 3 のツリー。`Object.defineProperty(state, "nodes.*" + ".children.*".repeat(d) + ".total", { get })` を d=0..2 で生成。深さ 2 の葉に `$resolve(..., [0,0,0], 500)` | 深さ 1・深さ 0・`grandTotal` すべて更新 ✓ |
| **P2**（§5） | `<rec-node>` の shadow に自分自身を `for` で入れる。`state` 初期値 `{}`、shadow は `connectedCallback` で構築 | 深さ 3 が `root / a / a1 / b` で描画 ✓ |
| **P3**（§4-1） | `get grandTotal() { return sum(this.nodes); }`（JS 再帰）。深い葉にパス経由で書く | 13 のまま（stale）。`s.nodes = [...s.nodes]` で 503 に復帰 |
| **P4**（§4-2） | 深さ 1 までしか getter を展開せず、深さ 2 のデータを入れる | 表示は空文字（NaN）。throw しない |
| **P5**（§7-2） | `for` バインドを 1 つも置かず、`$getAll("nodes.*.children.*.value", [])` → `$resolve(…, [0,1])` → `$setAll(…, [], 99)` を順に撃つ | `[10,11,20]` → `11` → 3 件書き込み、すべて成功。`$getAll` を経ずに `$resolve` を先に撃った場合だけ `ListIndexes not found: nodes` |
| **P6**（§6-3） | `getPathInfo("a" + ".*".repeat(129))` | 受理され `wildcardCount = 129`。`MAX_WILDCARD_DEPTH = 128` では止まらない |

P3 で `ListIndexes not found: nodes` を踏んだのは、`$getAll` を経ずに `$resolve` を最初に撃ったため（P5 が切り分け）。`for` の有無は関係しない。

---

## 参照

- [`$setAll` 設計](./state-set-all-design.md) — 走査の共有と順序規範。`**` の走査一般化はここに乗る
- [mount 設計](./state-mount-design.md) — パス層に手を入れた直近の前例。規模感の比較対象
- [名前付きワイルドカード添字の検討](./state-named-wildcard-index-design.md) — **未採択**。「パス文字列は正規化キーなのでパス内添字は不可」という同じ制約に当たった記録
- [リスト置換の依存スケーリング](./list-replacement-dependency-scaling.md) §3 — 行外を読む wildcard getter（隣接項目参照）との衝突。深さ方向の再帰は「行外を読む」の一般形なので、同じ検出・フォールバックの論点に当たる
