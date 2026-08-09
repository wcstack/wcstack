# bind-component の入れ子 `for` — 調査と実装設計案

status: **提案（未着手）**
関連: [ADR-15 §1.7 / §1.8 / §1.9](architecture-hardening/15-state-component-mechanism-consistency.md)、
[packages/state/src/webComponent/README.md](../packages/state/src/webComponent/README.md)

---

## 0. 対象の形

親スコープの `for` の**中に**コンポーネントがあり、そのコンポーネントの子スコープでも `for` を回す形。

```html
<!-- 親スコープ -->
<wcs-state json='{"groups":[
  {"title":"G1","children":[{"name":"a"},{"name":"b"}]},
  {"title":"G2","children":[{"name":"c"}]}
]}'></wcs-state>

<template data-wcs="for: groups">
  <section>
    <h3 data-wcs="textContent: groups.*.title"></h3>
    <my-group data-wcs="state.items: groups.*.children"></my-group>
  </section>
</template>
```

```html
<!-- my-group の shadow -->
<wcs-state bind-component="state"></wcs-state>
<ul><template data-wcs="for: items">
  <li data-wcs="textContent: items.*.name"></li>
</template></ul>
```

ADR-15 §1.8 が成立させたのは「コンポーネントが親の `for` の**外**にいて、子が mapped な配列を回す」形
（規則 `state.items: rows`）。本書はその 1 段外側、**両スコープにループが掛かる形**を扱う。

## 1. 症状（happy-dom 実測）

| 観測点 | 結果 |
|---|---|
| 親スコープの描画（`h3`・コンポーネント要素の生成） | ✅ 2 件とも正常 |
| 子の `State.getBindingsReady(childShadow)` | ❌ **永久に解決しない**（5s タイムアウト） |
| 例外 | `[@wcstack/state] ListIndex not found: groups.*.children.*.name` を子ごとに 1 回、**unhandled rejection** として |
| 子の描画 | ❌ 行が 1 つも出ない |

スタック:

```
getListIndex            proxy/methods/getListIndex.ts:42
get                     proxy/traps/get.ts:162
StateHandler.get        proxy/StateHandler.ts:108
(innerState 越境 read)   webComponent/innerState.ts:79
setLoopContext          proxy/methods/setLoopContext.ts:52
```

失敗の性格が §1.8 の時とは違う点が 1 つある。**例外が `getBindingsReady` を永久に未解決にする**ので、
「エラーを出して止まる」ではなく「無言でハングする」。呼び出し側が `await` していれば、
そこから先の初期化コードが丸ごと動かない。

## 2. 壁の正体

`_outerLoopContext`（[innerState.ts:37-55](../packages/state/src/webComponent/innerState.ts)）が
親スコープの読み書きに使うループ文脈を決めている。候補は 2 つ:

1. `getLoopContextByNode(コンポーネント要素)` — コンポーネント自身が親の `for` の中にいる形（§1.7）
2. `getCrossBoundaryAddress(...)` の listIndex — 子スコープの `for` が回している形（§1.8）

入れ子形では **1 が非 null なので先に返り、それで確定してしまう**。ところが 1 が持つのは
`groups.*` の 1 段（Δ=1）だけで、翻訳後の外側パス `groups.*.children.*.name` は 2 段を要求する。
`getContextListIndex` が `listIndex.at(1)` を引いて `null` → `raiseError`。

分岐順を入れ替えても直らない。候補 2 の listIndex は**子スコープの `for` が作った arity 1 のオブジェクト**で、
親スコープの行チェーン（`groups.*` の listIndex）と繋がっていないからだ。
現に `_outerLoopContext` にも `getOuterRowPathInfo` にも段数一致のガードが入っていて、
両者はここで「合成できない」として弾かれている。

根本は 1 行で言える:

> **1 つの配列オブジェクト（`groups[i].children`）に 2 つの深さが要求されている。**
> 親から見た行は arity 2（`groups.*.children.*`）、子から見た行は arity 1（`items.*`）。
> しかし listIndex 台帳 `listIndexesByList` は**配列オブジェクト同一性の WeakMap** なので、
> 1 つの配列につき 1 組の `IListIndex[]` しか持てない。

そして §1.8 が成立している理由そのものが「親子が**同じ `IListIndex` インスタンスを共有**している」ことなので、
台帳を二重化する方向は取れない（§1.7 で潰した「同じ物の二重表現」と同型の罠に戻る）。

### 現状の空き状況（実測）

```
bases（コンポーネント要素のノードループ文脈）:
  [{ path:'groups.*', len:1, idx:0 }, { path:'groups.*', len:1, idx:1 }]
children 台帳（groups[i].children の listIndexesByList）:
  [null, null]      ← 誰も作っていない = 競合が無い
並べ替え後の base:
  DOM 位置 0 の要素が uuid u2 を指す = listIndex オブジェクトは再利用され .index だけ動く
```

つまり **`groups[i].children` の台帳を作るのは子だけ**であり、子が最初から正しい arity で作れば
親と競合しない。これが以下の設計の前提になる。

## 3. 設計案: base listIndex ＋ 内向き解決の末尾アンカー

### 3.1 中心にある考え

子スコープを「親ループの内側にある、ただのネストしたループ」として扱う。それが事実だからだ。

- mapped な子 state 要素に **base listIndex**（＝ホストコンポーネントの親スコープ行、深さ Δ）を与える
- 子が作る listIndex は**すべて base を親に持つ**。`groups[i].children` の台帳は arity Δ+1 になり、
  これは親が `groups.*.children.*` に対して要求するものと**同一**
- 子スコープ内の「パス上のワイルドカード位置 i」→「チェーン上の段 i」変換を、
  **先頭起点ではなく末尾起点**に書き換える

不変条件は 1 本になる:

> 深さ Δ の state スコープでは、ワイルドカード数 W のパスは長さ **Δ + W** の listIndex チェーンで解決される。
> ワイルドカード位置 i（先頭から 0 始まり）はチェーンの段 **Δ + i** に対応する。

### 3.2 なぜ「末尾アンカー」で Δ が消えるか

`IListIndex.at()` は負値を受け付ける（[createListIndex.ts:127-133](../packages/state/src/list/createListIndex.ts)）。
チェーン長が Δ+W のとき、段 Δ+i は末尾から数えて `i - W` である:

```
at(i)              →  at(i - W)          // W = そのパスのワイルドカード数
listIndexes[Δ+i]      listIndexes[(Δ+W) + (i-W)] = listIndexes[Δ+i]   ✔
```

**Δ=0 では両者はビット同一**。したがって末尾アンカー化は既存スコープに対して意味論を変えない
**純粋なリファクタ**であり、Δ>0 を後から成立させるだけになる。Δ を関数引数として
配管する必要が無いのが最大の利点で、これは spike 段階では見えていなかった点。

前提となるのは「変換を受ける address は `listIndex.length === Δ + pathInfo.wildcardCount` を満たす」
こと。今日の実装ではこれは成り立っている（loopContext はスタック検証で強制、getter address は
`getListIndex()` が W 段ちょうどのチェーンを返す、`for` バインディングのパスはコンテナ側なので
W ＝ 囲むループ段数）。**ただし推論であって計測ではない** — §6 の検証計画で assertion 化する。

### 3.3 base の取得

```ts
// packages/state/src/webComponent/baseListIndex.ts（新規）
export function getBaseListIndex(stateElement: IStateElement): IListIndex | null {
  if (stateElement.hasMappedComponentState !== true) return null;
  const component = stateElement.boundComponent;
  if (component === null) return null;
  return getLoopContextByNode(component)?.listIndex ?? null;
}
```

**キャッシュしない**。行 content はプールで再利用されるので（§1.9）、同じコンポーネント要素が
別の行に付け替わる。要素をキーにした memo は §1.9 で踏んだ罠そのもの。
参照元は既に `_outerLoopContext` が越境 read ごとに同じ walk をしているので、新たなホットパスは増えない。

## 4. 変更点の一覧

### (A) 末尾アンカー化 — Δ=0 で挙動不変、7 箇所

| 箇所 | 現在 | 変更後 |
|---|---|---|
| [getContextListIndex.ts:37](../packages/state/src/proxy/methods/getContextListIndex.ts) | `address.listIndex?.at(index)` | `at(index - address.pathInfo.wildcardCount)` |
| [getListIndexByBindingInfo.ts:28](../packages/state/src/list/getListIndexByBindingInfo.ts) | `at(wildcardLen - 1)` | `at(wildcardLen - 1 - loopContext.pathInfo.wildcardCount)` |
| [getIndexValueByLoopContext.ts:14](../packages/state/src/list/getIndexValueByLoopContext.ts) | `at(indexPos)` | `at(indexPos - loopContext.pathInfo.wildcardCount)` |
| [get.ts:83](../packages/state/src/proxy/traps/get.ts)（`$1` の値読み） | `listIndex.indexes[index]` | 末尾から `index` 番目 |
| [walkDependency.ts:355](../packages/state/src/dependency/walkDependency.ts) | `at(wildcardLen - 1)` | `at(wildcardLen - 1 - address.pathInfo.wildcardCount)` |
| [walkDependency.ts:379](../packages/state/src/dependency/walkDependency.ts) | 同上 | 同上 |
| [checkDependency.ts:33](../packages/state/src/proxy/methods/checkDependency.ts) | `at(level)` × 2 | 各 address 自身の W で末尾アンカー |

`checkDependency` だけは補足が要る。ここは 2 つの address の共有ワイルドカード段を突き合わせて
「他行読み取り」を検出する。Δ>0 で先頭アンカーのままだと**base の段どうしを比較する**ことになり、
両者は常に一致するので**本物の他行読み取りを取りこぼす**（`crossRowListPaths` が立たず
diff-filter 展開が全行フォールバックしない = 無言の更新漏れ）。末尾アンカーで解消する。

### (B) 子スコープの「根っこ」を base にする — 5 箇所

トップレベルのリストを作るときの親 listIndex。今日は `null`。

| 箇所 | 用途 |
|---|---|
| [applyChangeToFor.ts:153](../packages/state/src/apply/applyChangeToFor.ts) | 子の `for: items` の描画 |
| [walkDependency.ts:64](../packages/state/src/dependency/walkDependency.ts)（`_walkExpandWildcard`） | 動的依存のワイルドカード展開 |
| [walkDependency.ts:284](../packages/state/src/dependency/walkDependency.ts) | 静的子展開 |
| [getAll.ts:75](../packages/state/src/proxy/apis/getAll.ts) | `$getAll` |
| [setByAddress.ts:224,226](../packages/state/src/proxy/methods/setByAddress.ts) | リスト代入（`$listKeys` 突合含む） |

いずれも `createListDiff(コンテナ address.listIndex, ...)` の形なので、共通ヘルパで
`address.listIndex ?? getBaseListIndex(stateElement)` に倒す。全箇所で `stateElement` は
context か handler から引ける。

**5 箇所すべてを揃える必要がある。** `createListDiff` は台帳が既にあれば再利用するので
既存行は無事だが、**追加行だけは `createListIndex(parentListIndex, i)` で新規生成される**。
1 箇所でも `null` のままだと、同じ台帳に arity 1 と arity Δ+1 が混在する。

### (C) 境界の段数ガードを Δ 込みにする — 2 箇所

- [innerState.ts `_outerLoopContext`](../packages/state/src/webComponent/innerState.ts):
  **分岐順を入れ替える**。越境アドレス（内側 = より具体的）を先に見て、その listIndex 長が
  外側パスのワイルドカード数と一致すれば採用。しなければ従来どおりノードループ文脈へ。
  Δ 導入後は子の行 listIndex が arity Δ+1 = 外側 W なので、既存の長さ検査がそのまま通る
- [outerListPath.ts `getOuterRowPathInfo`](../packages/state/src/webComponent/outerListPath.ts):
  `outer.wildcardCount !== inner.wildcardCount` の棄却を `outer !== inner + Δ` に緩める。
  [BindingSession.registerAddress:980](../packages/state/src/bindings/BindingSession.ts) が
  親のパターン台帳へ相乗りさせる listIndex は arity Δ+inner = outer になるので、親が要求する鍵と一致する

### (D) ループ文脈スタックの検証 — 1 箇所

[loopContext.ts:40](../packages/state/src/list/loopContext.ts) の
`listIndex.length !== pathInfo.wildcardCount` は Δ>0 で誤検知する。
`LoopContextStack` は state 要素ごとの持ち物（`State._loopContextStack`）なので、
生成時に base 深さの供給元を渡して `!== Δ + wildcardCount` にする。

### (E) Δ をユーザーランドに漏らさない — 4 箇所

**これは正しさではなく契約の問題**。コンポーネントの作者は、自分がリストの中に置かれるかどうかを
知らずに書く。`$1` や `onClick(e, index)` の意味が設置場所で変わってはいけない。

| 箇所 | 現在 | 変更後 |
|---|---|---|
| [event/handler.ts:49](../packages/state/src/event/handler.ts) | `listIndex.indexes` | 先頭 Δ 個を落とす |
| [event/eventTokenHandler.ts:109](../packages/state/src/event/eventTokenHandler.ts) | 同上 | 同上 |
| [proxy/apis/updatedCallback.ts:51](../packages/state/src/proxy/apis/updatedCallback.ts) | 同上 | 同上 |
| [proxy/apis/getAll.ts:50](../packages/state/src/proxy/apis/getAll.ts) | 同上 | 同上 |

Δ は `listIndex.length - loopContext.pathInfo.wildcardCount` で局所的に求まる。

`$resolve(path, indexes)`（[resolve.ts](../packages/state/src/proxy/apis/resolve.ts)）は
段ごとに**台帳の配列位置**で引くので、チェーン段数に依存しない。**変更不要**。
これは偶然ではなく、`$resolve` が「await を跨いでも安全な素の数値配列」で設計されている帰結。

### 変更しないもの

- `listIndexesByList` の構造（配列同一性の WeakMap のまま）
- `crossBoundaryAddress.ts`（既に必要な情報を運んでいる）
- `propagateListPathToOuterState`（Δ に依存しない）
- `IListIndex` の `position` / `varName` / `indexes`（内部表現は真の深さのまま。
  ユーザーランド向けの切り出しは (E) が担う）

規模: **新規 1 ファイル + 既存 15 ファイル**。1 箇所あたりの差分は数行だが、
触るのは全部リスト描画のホットパスである。

## 5. 却下した案

| 案 | 却下理由 |
|---|---|
| **ビューアダプタ** — 越境時だけ arity 2 の listIndex を合成して見せる | listIndex は `Set` / `WeakMap` の鍵として**同一性で**照合される（`changeIndexSet`・`contentByListIndex`・パターン台帳）。合成物は毎回別オブジェクトになるので、§1.7 で潰した「同じ物の二重表現」と同型の欠陥に戻る |
| **台帳のスコープ化** — `listIndexesByList` を state 要素ごとに分ける | §1.8 の成立根拠（親子が同じ `IListIndex` を共有している）が壊れる。既に動いている形を全部作り直すことになる |
| **子に配列のコピーを渡す** | 値の二重化。§1.8 でキャッシュ層を外した判断（正本は親に 1 つ）と正面から衝突する |
| **親に台帳を先に作らせる** | 子は既存台帳を再利用するので初期描画は通るが、子スコープ内の段数変換は結局 Δ が要る。順序依存が増えるだけ |

## 6. リスクと検証計画

### 主リスク

1. **末尾アンカーが Δ=0 で不変である保証**が推論ベース。
   → 対策: 変換 7 箇所に `config.debug` 下の assertion
   `listIndex.length === Δ + pathInfo.wildcardCount` を入れ、**既存の全テストを debug 有効で走らせて
   違反ゼロを確認する**。推論を計測に変える。実装の第一歩をこれにする
2. **(B) の 5 箇所取りこぼし**。混在は初期描画では見えず、**行を追加したときだけ**壊れる。
   → 対策: 「初期描画 → 行追加 → 行削除 → リスト差し替え → 並べ替え」を 1 本のテストで通す
3. **性能**。`getBaseListIndex` は `getLoopContextByNode` の parentNode walk を含む。
   → 対策: `hasMappedComponentState` の早期 return で通常 state のホットパスには載せない
   （§1.8 の `crossBoundaryAddress` と同じ方針）。jsfb ベンチで非回帰確認

### テスト

happy-dom 統合テストを新規に 1 本（`integration.bindComponentNestedFor.test.ts`）:

- 初期描画（2 グループ × 各行）
- 親からの行フィールド書き込み → 子の該当行だけが更新
- 子からの書き戻し → 親 state に届く
- 親のリスト（`groups`）差し替え
- 子のリスト（`groups.*.children`）差し替え
- 並べ替え（親側・子側の両方）
- **shadow を constructor で組む形と connectedCallback で組む形の両方**（§1.9 の教訓）
- Δ=0 の既存形（§1.7 / §1.8 / plain コンポーネント）の非回帰

実ブラウザ e2e を 1 本。`packages/state/dist` はビルド後に `git checkout -- dist/` で戻す。

**判別子は必ず Shadow 内のビュー**（§1.7 の罠）。親スコープの行は親自身のバインディングなので、
子への配送が死んでいても更新される。

## 7. 推奨する進め方

この設計は「正しいが安くはない」。ホットパス 15 ファイルに触る一方、
回避策（ループを親に残して行だけをコンポーネントに渡す）は既に存在し、
README の "Loop with Components" がまさにその形になっている。

段階を分けることを勧める。

- **Phase 0（独立して価値がある・小さい）** — 今の失敗が
  「`getBindingsReady` が永久に未解決」なのを、**その場で分かるエラー**に格上げする。
  `_outerLoopContext` が決められなかった時点で、入れ子形と分かる診断メッセージを出す。
  Phase 1 をやるかどうかに関係なく入れてよい。
  ついでに「バインディング初期化中の例外が ready promise を未解決のまま残す」構造は
  §1.7 / §1.9 と同じ「1 件の失敗が全体を巻き込む」構図なので、別件として起票の価値がある
- **Phase 1** — §6 の assertion だけを入れて全テストを debug で走らせ、
  §3.2 の前提が本当に成り立つかを**測る**。ここで崩れたら設計を見直す（安い撤退点）
- **Phase 2** — (A) 末尾アンカー化だけを単独でマージする。Δ=0 なので**挙動変更ゼロのはず**であり、
  既存テストがそのまま回帰網になる
- **Phase 3** — (B)〜(E) と新規テスト

Phase 1 で前提が崩れた場合は、入れ子形は非対応のまま Phase 0 の診断だけを残すのが妥当。
