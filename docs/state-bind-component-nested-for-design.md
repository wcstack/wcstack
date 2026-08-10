# bind-component の入れ子 `for` — 調査と実装

status: **実装済み（2026-08-11・未リリース）**
関連: [ADR-15 §1.7 / §1.8 / §1.9 / §1.10](architecture-hardening/15-state-component-mechanism-consistency.md)、
[packages/state/src/webComponent/README.md](../packages/state/src/webComponent/README.md)

本書は調査 → 設計 → 実装の記録。設計の前提が**計測で確認された**こと、および
実装中に**別件として発見した課題**（§8）が要点。

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
W ＝ 囲むループ段数）。ただしこれは推論だったので、**実装の第一歩として計測した**。

**計測結果（2026-08-11）**: `listIndexAtWildcard` に「新旧両方を計算して食い違いを報告する」
一時プローブを仕込み、全 2168 テストを走らせた。**実経路での食い違いはゼロ**。
検出された 2 件はどちらも合成入力で、内訳は次のとおり。

1. **1 段ループの中で `$2` を読む**（範囲外要求）。先頭起点では `at(1)` が
   チェーン長を超えて null → raiseError だったが、末尾起点では `at(1-1)=at(0)` に化けて
   **黙って `$1` を返してしまう**。これは本物の意味論差なので、`listIndexAtWildcard` に
   `wildcardPos >= wildcardCount` の範囲ガードを明示的に持たせた。**このガードは必須**
2. **モックが `pathInfo.wildcardCount` を持っていなかった** 2 件（型定義上は必須）。
   モック側を型どおりに直した

つまり「末尾アンカー化は Δ=0 で挙動不変」は**確認済みの事実**であり、
(A) だけを挙動変更ゼロの単独コミットとして先に着地させた。

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

## 6. 検証

### テスト

happy-dom 統合テスト
[`integration.bindComponentNestedFor.test.ts`](../packages/state/__tests__/integration.bindComponentNestedFor.test.ts)（20 ケース）:

- 初期描画（2 グループ × 各行）
- 親からの行フィールド書き込み → 子の該当行だけが更新
- 子からの書き戻し → 親 state に届く
- 子のリスト（`groups.*.children`）差し替え・**行追加 / 行削除**
- 親のリスト（`groups`）差し替え・並べ替え・**並べ替え後の行書き込み**
- 行削除で未処理例外が出ないこと（§8.1）
- `$1` とイベントハンドラのインデックスが**子スコープのもの**であること
- `$resolve` の往復
- Δ=0 の既存形との併存（同じコンポーネントを親 `for` の外でも使う）
- **shadow を constructor で組む形と connectedCallback で組む形の両方**（§1.9 の教訓）

base listIndex 自体は
[`webComponent.baseListIndex.test.ts`](../packages/state/__tests__/webComponent.baseListIndex.test.ts)
で単体固定（キャッシュしないことを含む）。

**判別子は必ず Shadow 内のビュー**（§1.7 の罠）。親スコープの行は親自身のバインディングなので、
子への配送が死んでいても更新される。

結果: 全 2190 テスト green、`tsc --noEmit` / `eslint` / `rollup` ビルドとも通過。
新規 3 モジュール（`wildcardLevel.ts` / `baseListIndex.ts` / 変更した `loopContext.ts`）は
カバレッジ 100%。

**実ブラウザ e2e は未実施**（§8.4）。

### 残るリスク

1. **(B) の 5 箇所取りこぼし**。混在は初期描画では見えず、**行を追加したときだけ**壊れる。
   → 統合テストで「初期描画 → 行追加 → 行削除 → リスト差し替え → 並べ替え」を通している
2. **性能**。`getBaseListIndex` は `getLoopContextByNode` の parentNode walk を含む。
   `hasMappedComponentState` の早期 return で通常 state のホットパスには載せていない
   （§1.8 の `crossBoundaryAddress` と同じ方針）が、**jsfb ベンチでの非回帰確認は未実施**

## 7. 実装の経緯

計画どおり 4 段階で進め、各段階を独立してコミットした。

| 段階 | 内容 | 結果 |
|---|---|---|
| Phase 1 | 一時プローブで §3.2 の前提を**計測** | 実経路の食い違いゼロ。範囲ガードの必要性を発見 |
| Phase 2 | (A) 末尾アンカー化を単独コミット | 2168 テスト green・挙動変更ゼロ |
| Phase 3 | (B)〜(E) + 統合テスト | 入れ子形が成立 |
| 追加 | §8.1 の stale read を修正 | 未処理例外ゼロ |

Phase 0 として計画していた「入れ子形と分かる診断メッセージ」は**不要になった**（形自体が成立したため）。
ただしその動機だった構造的欠陥は残っている — §8.2。

## 8. 実装中に発見した課題

### 8.1 消えた行の読みが生の `TypeError` になり、バッチ全体を巻き添えにする（修正済み）

入れ子形で子スコープのリストから行を減らすと、
`TypeError: Reflect.get called on non-object` が**未処理例外**として出ていた。
適用順をトレースして判明した実際の並び:

```
1. groups.*.children → state.items   （親→子の再読込通知）
2. items.*.name                      （行 0・OK）
3. items.*.name                      （行 1 = 削除済み → 例外）
4. items  (for)                      ← 行を実際に外すのはここ
5. items.*.name                      （行 0・再適用）
```

**親スコープ起点の行通知が、その行を外す子の `for` より先に適用される。**
同一スコープならトポロジカル順（`items` → `items.*` → `items.*.name`）で `for` が先に来るので
この窓は開かない。素の入れ子 `for`（コンポーネント無し）でも Δ=0 の既存形でも再現せず、
**親の通知と子の `for` が別経路で流れる入れ子形でだけ**開く。

[`getByAddress`](../packages/state/src/proxy/methods/getByAddress.ts) で
**親が居ないパスの読みを `undefined` にした**。`undefined` は既に
「state に意見が無い」＝プロパティ書き込みをスキップする値なので DOM は触られず、
直後に `for` が行ごと外して整合する。

重要なのは見た目の問題ではないこと。生の `TypeError` は
**updater の drain も `applyChangeToFor` の行ループも捕まえない**ので、
stale な読み 1 本が同じバッチの無関係な更新まで道連れにする —
§1.7 / §1.9 で 2 度潰したのと同じ構図の 3 度目である。

### 8.2 バインディング初期化中の例外が ready promise を永久に未解決のまま残す（未修正・別件）

修正前の入れ子形は `ListIndex not found` を投げていたが、その例外は
**unhandled rejection として外に出るだけで `State.getBindingsReady` は解決も reject もしなかった**。
結果、症状は「エラーが出る」ではなく「**無言でハングする**」になり、
`await State.getBindingsReady(...)` の先が丸ごと動かなくなる。

入れ子形自体は成立したのでこの経路は踏まなくなったが、**構造は残っている** —
バインディング初期化で何か 1 つでも投げれば同じことが起きる。
§8.1・§1.7・§1.9 と同じ「1 件の失敗が全体を巻き込む」系統で、
起票して個別に扱う価値がある。少なくとも ready promise を reject させれば、
無言のハングは「原因の分かる失敗」になる。

### 8.3 `listIndexAtWildcard` の範囲ガードは落とせない

末尾アンカー化は Δ=0 で挙動不変 —— **ただし範囲外要求を除く**。
`at(pos)` は範囲外で null を返すが、`at(pos - W)` は負値に化けて
**末尾から数え直した別の段を返してしまう**。具体的には
「1 段ループの中で `$2` を読む」が raiseError から「黙って `$1` を返す」に退行する。
`wildcardPos >= wildcardCount` の明示ガードで塞いだ。
既存テスト 1 本がこれを捕まえた ＝ **カバレッジが設計の穴を検出した**（§1.8 と同じ効き方）。

### 8.4 実ブラウザ e2e が未実施

§1.8 / §1.9 はどちらも happy-dom と実ブラウザの両方で固定している。
本件は happy-dom のみ。特に content プール再利用まわりは
「実ブラウザのみ再現」の実績がある領域（ADR-15 の罠: `template.content` の clone は
upgrade されない）なので、リリース前に
`e2e/tests/state-bind-component-nested-for.spec.ts` 相当を足すこと。

### 8.5 テスト作成上の罠: happy-dom の `textContent = 0` は `""` になる

`$1` の検証中に `textContent: $1` が行 0 で空文字になり、Δ が漏れているように見えた。
切り分けた結果、**happy-dom で `element.textContent = 0` が `""` になる**非準拠挙動だった
（`= 1` は `"1"`。実ブラウザは `"0"`）。wcstack 側の挙動ではない。
数値 0 を DOM 経由で判別子に使わないこと。

### 8.6 型定義より緩いモックが 2 件

`pathInfo.wildcardCount` を持たないモックが 2 件あり、末尾アンカー化で初めて露見した
（`0 - undefined = NaN`）。`IPathInfo` 上は必須のフィールドで、モック側を直した。
**`as any` を通したモックは型検査の網に載らない**ので、この種の乖離は
実際に読むコードが増えたときにだけ表面化する。
