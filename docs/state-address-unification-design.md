# 設計: アドレス型の統合 — 正方形を 1 本に畳む

- **状態**: 検討（2026-09-17）。**未決**。§0 の決定レコードは提案であって合意ではない。実装前。
- **対象**: `@wcstack/state` の内部アドレス型（`src/address/`）と、それをキーにする全台帳。proxy・updater・依存グラフの**契約は変えない**（同じ意味の型に名前と形が付け替わるだけ）。
- **一言で**: 「パス × ツリー × 行」の 3 次元を、**4 つの型が成す正方形**で表すのをやめ、**1 本のアドレス型**に畳む。`IAbsoluteStateAddress` を削除し、`IStateAddress` が `stateElement` を持つ。
- **契機**: `IAbsoluteStateAddress` は「名前付き State」の名前次元を運ぶために生まれた型で（§2）、v2 でその次元を撤去したあとも形を変えて残っている。ツリーが 1 rootNode 1 本になった今、2 本のアドレス型を持ち続ける理由が何なのかを確定させる。
- **結論の先出し**: **`stateElement` 次元そのものは消せない**（§3）。消せるのは**次元を足したり降ろしたりする往復**のほう（§4）。
- **双対**: [state-mount-design.md](./state-mount-design.md) の D16（名前次元の撤去）。本書はその撤去が型に残した跡地の整理。

---

## 0. 決定レコード（提案）

| ゲート | 論点 | 決定（提案） |
|---|---|---|
| **D1** | `IAbsoluteStateAddress` を消して `IStateAddress` に戻せるか | **戻せない**。updater はモジュール単一で drain のバッチはツリーをまたぐ（§3）。台帳のキーはツリーを識別できなければならない。 |
| **D2** | ではどうするか | **正方形を 1 本に畳む**。`IStateAddress` に `stateElement` を足し、`IAbsoluteStateAddress` を削除して全台帳のキーを `IStateAddress` に統一する（§5）。 |
| **D3** | `IAbsolutePathInfo` はどうするか | **内部の intern 中間ノードとして残す**（改名して `src/address/` に閉じる）。行バインディング台帳（`patternLedger`）が `(absolutePathInfo, listIndex)` の 2 段キーで**アドレスを intern せずに**引く設計を支えているため（[state-row-instantiation-redesign.md](./state-row-instantiation-redesign.md) §3-3）。公開概念からは落とす。 |
| **D4** | intern の根をどこに置くか | **`stateElement` の上**（module-global WeakMap をやめる）。性能ではなく **GC 正しさの要請**（§5-3）。現行の `_cacheNullListIndex` は不滅の `PathInfo` をキーにしているので、そこに `stateElement` 参照を入れると要素が永久に回収されない。 |
| **D5** | ツリー非依存アドレスは残すか | **残さない**。全アドレスがツリーを持つ。`getByAddressSymbol` に別ツリーのアドレスを渡す取り違えが assert で検出可能になる（今は黙って通る）。 |
| **D6** | 台帳をツリー側に持たせる案（アドレスは非依存のまま）は | **却下**（§6-1）。単一 updater の queue とバッチがツリーをまたぐので `(stateElement, address)` のタプル生成が復活し、複雑さの移動にしかならない。 |
| **D7** | devtools hook protocol への影響 | **破壊的**。`ContractEvent` の payload が `absoluteAddress.absolutePathInfo.pathInfo.path` の形を公開している（§7-1）。protocol のバージョン印を上げ、1 リリースだけ deprecated getter で互換を張る。 |
| **D8** | 段階 | **PR 3 本**（§8）。①内部化と改名（振る舞い不変）→ ②統合と lift 削除 → ③互換面の撤去。 |
| **D9** | 期待する利得 | 中心概念 5 → 3、lift 21 + downgrade 20 サイトの消滅、台帳到達アドレスあたりのオブジェクト割当 2 → 1、`parentAddress` 実装の一本化、そして §4-3 の「ツリー非依存アドレスを台帳のキーにしてはならない」という**覚えておくしかない罠の構造的消滅**。行数の削減は 200 行前後で、そこは主眼ではない。 |

---

## 1. 現状 — 5 本の型と正方形

[types.ts](../packages/state/src/address/types.ts) にあるのは 3 本ではなく 5 本である。

| 型 | 内容 | intern キー | 寿命 |
|---|---|---|---|
| `IPathInfo` | パス文字列の構文解析結果 | `Map<string, _>` | **不滅**（強参照・tooling 以外クリア不可） |
| `IResolvedAddress` | 生パス（`items.0.name`）→ pathInfo + 添字 | `Map<string, _>` | **不滅** |
| `IStateAddress` | pathInfo + listIndex | `WeakMap<listIndex, WeakMap<pathInfo, _>>` / listIndex が null なら `WeakMap<pathInfo, _>` | 行付きは行と同寿命、**null 行は不滅** |
| `IAbsolutePathInfo` | stateElement + pathInfo | `WeakMap<stateElement, WeakMap<pathInfo, _>>` | stateElement と同寿命 |
| `IAbsoluteStateAddress` | absolutePathInfo + listIndex | `WeakMap<listIndex, WeakMap<absPathInfo, _>>` / `WeakMap<absPathInfo, _>` | stateElement と同寿命 |

下 4 本は正方形を成す。

```
        PathInfo ──────(+listIndex)──────▶ StateAddress
           │                                    │
     (+stateElement)                      (+stateElement)
           ▼                                    ▼
   AbsolutePathInfo ────(+listIndex)────▶ AbsoluteStateAddress
```

`IResolvedAddress` は正方形の外側の入口（生パス文字列の正規化）で、本書の対象ではない。

---

## 2. 起源 — なぜ 2 本あるのか

`git log --diff-filter=A` で追うと、`IAbsoluteStateAddress` は `9dc72175`（2026-02-04, *feat: Refactor state management and versioning system*）で次の形で生まれている。

```ts
export interface IAbsoluteStateAddress {
  readonly address: IStateAddress;
  readonly stateName: string;      // ← 名前付き State の名前
}
```

つまり**「名前付き State」の名前次元を運ぶためだけの型**だった。`createAbsoluteStateAddress(stateName, address)` が `getStateElementByName(stateName)` で要素を引いていた。

v2（[state-mount-design.md](./state-mount-design.md) D16）で名前次元を撤去したとき、**型は消えず、`stateName` が `stateElement` に置き換わって生き延びた**。`40fd7d06` で `IAbsolutePathInfo` が挟まって現在の形になる。

したがって「ツリーが 1 本になったのだから 2 本は要らないのでは」という直感は、**起源としては正しい**。正しくないのは次節。

---

## 3. `stateElement` 次元は今も実在する

v2 の不変条件は「**1 rootNode に 1 ツリー**」であって「**1 ページに 1 ツリー**」ではない。

- rootNode はページに複数ある。独自の `<wcs-state>` を持つコンポーネントの ShadowRoot がそれぞれ自分のツリーを持つ（[stateElementByName.ts](../packages/state/src/stateElementByName.ts) の `stateElementByNode`・`liveStateElements`）。
- マウントスコープとボリュームは**別ツリーではない**。`setStateElementAlias` は子の ShadowRoot に**親の**要素を別名で載せるだけ、`mount=` のボリュームは[自分の台帳を持たず](../packages/state/src/webComponent/volume.ts)ルートへ接ぎ木する。よって実効的な濃度はページあたりたいてい 1 だが、**1 とは限らない**。

そして決定的なのは **updater がモジュール単一**であることだ。

- [updater.ts:304](../packages/state/src/updater/updater.ts#L304) — `const updater = new Updater()`
- drain のバッチ通知は `ReadonlySet<IAbsoluteStateAddress>`（`$scan` / `$watch` / `$streams` restart が消費）
- 恒久台帳（cache / bindings / listBaseline / prevValues / scan / stream の依存集合）はすべてモジュール単位の WeakMap

バッチも台帳もツリーをまたぐ。**キーはツリーを識別できなければならない**（D1）。

---

## 4. 実測 — 無駄は次元ではなく「往復」

### 4-1. 持ち上げ（lift）

```ts
const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
const absAddress  = createAbsoluteStateAddress(absPathInfo, address.listIndex);
```

この 2 行が `src/address/` の外に **21 箇所**（`getAbsolutePathInfo` の呼びは 19 箇所）。全箇所で `stateElement` は `handler.stateElement` / `context.stateElement` から自明に取れる。**選択の余地がない決定的変換を毎回手で書いている**。

最ホットな例は読みのキャッシュ経路で、[getByAddress.ts:172-173](../packages/state/src/proxy/methods/getByAddress.ts#L172) がキャッシュを引くためだけに毎回 2 段持ち上げる。その直前の [traps/get.ts:220](../packages/state/src/proxy/traps/get.ts#L220) は `handler.stateElement` を同じ関数の中で既に触っている（`hasRecursion` の判定）。

### 4-2. 降ろし（downgrade）

| 形 | 箇所数 | 統合後 |
|---|---|---|
| `.absolutePathInfo.pathInfo` | 11 | `.pathInfo` |
| `.absolutePathInfo.stateElement` | 9 | `.stateElement` |

パス 1 つ・要素 1 つを読むために 2 ホップしている。

### 4-3. 「ツリー非依存アドレスを台帳のキーにしてはならない」という罠

これが本書を書く一番の理由である。[stateListBaseline.ts](../packages/state/src/list/stateListBaseline.ts) には次のコメントがある。

> キーは **絶対アドレス**。`IStateAddress` は listIndex が null のとき pathInfo だけで intern されるため、同じパス形状のルートリストを持つ 2 つの state 要素がエントリを共有してしまう（`createStateAddress` の `_cacheNullListIndex`）。

つまり `IStateAddress` を台帳のキーにすると**静かにツリーを混線させる**。これは型では防げず、台帳を足すたびに思い出すしかない。正方形がある限り、新しい台帳を書く人は毎回この落とし穴の前を通る。**統合はこの罠を構造的に消す**（ツリー非依存のアドレスがそもそも存在しなくなる）。

### 4-4. 同一ロジックの二重実装

`StateAddress.parentAddress` と `AbsoluteStateAddress.parentAbsoluteAddress` は、末尾セグメントの `WILDCARD` 判定と `parentListIndex` の選択が**完全に同じコード**。intern も「二段 WeakMap ＋ null 行用の別 WeakMap」が 4 箇所に複製されている。

### 4-5. 次元の持ち場が定まっていない兆候

既に「stateElement で分割してから、stateElement を内包するキーで引く」二重キーが出ている。

- [computedSnapshots.ts:19](../packages/state/src/watch/computedSnapshots.ts#L19) — `WeakMap<IStateElement, Map<IAbsoluteStateAddress, unknown>>`
- [apply/types.ts:20](../packages/state/src/apply/types.ts#L20) — `updatedAbsAddressSetByStateElement: Map<IStateElement, Set<IAbsoluteStateAddress>>`

どちらも「絶対アドレスは stateElement を含む」という前提があれば外側のキーは要らない（実際には走査の都合で分けている）。次元の所在が型から読み取れていないということでもある。

---

## 5. 案 A: 正方形を 1 本に畳む（推奨）

### 5-1. 型

```ts
export interface IStateAddress {
  readonly stateElement: IStateElement;   // 追加
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;
  readonly parentAddress: IStateAddress | null;
}
```

`IAbsoluteStateAddress` は削除。全台帳のキーを `IStateAddress` に統一する。**アドレスがツリーを持つので意味は一切変わらない** — 今日 `IAbsoluteStateAddress` と書いてある場所が `IStateAddress` になるだけで、識別の粒度は同じ。

### 5-2. `parentAddress` は 1 本になる

`(stateElement, pathInfo.parentPathInfo, 末尾が `*` なら parentListIndex)` の 1 実装。`AbsolutePathInfo.parentAbsolutePathInfo` の連鎖も不要になる。

### 5-3. intern の根は `stateElement` に置く — GC 正しさの要請

**ここを間違えると参照リークになる。** 現行の `StateAddress` の intern は

```ts
const _cacheNullListIndex: WeakMap<IPathInfo, IStateAddress> = new WeakMap();
```

だが、`IPathInfo` は強参照の `Map<string, IPathInfo>` で**不滅**である（[PathInfo.ts:5](../packages/state/src/address/PathInfo.ts#L5)）。したがってこの WeakMap のエントリは実質不滅。今日はアドレスがツリーを知らないので害がない。

**`stateElement` を足したまま同じ intern 構造を使うと、不滅のキーから `<wcs-state>` 要素への強参照が伸び、要素を DOM から外しても永久に回収されなくなる。**

今日の絶対側がリークしないのは、intern の**外側の弱キーが `stateElement` だから**である（`WeakMap<IStateElement, WeakMap<IPathInfo, IAbsolutePathInfo>>`）。統合後も同じ性質を保つには、intern の根を module-global ではなく `stateElement` の側に置く。

```ts
// IStateElement 側
addressFor(pathInfo: IPathInfo, listIndex: IListIndex | null): IStateAddress
```

副産物として、ホットパスの引きは今日と同じ 2 段のままになる（`stateElement` は既に手元にあるので 3 段化しない）。**根を stateElement へ移すのは性能最適化ではなく、統合の前提条件**（D4）。

### 5-4. `IAbsolutePathInfo` は内部に残す

行バインディング台帳 [patternLedger](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts#L81) は `(absolutePathInfo, listIndex)` の 2 段キーで引き、**登録側でアドレスを一切 intern しない**（[state-row-instantiation-redesign.md](./state-row-instantiation-redesign.md) §3-3）。これは行のホットパスを支える実測済みの構造なので壊さない。

そこで `IAbsolutePathInfo` は**公開概念からは落とすが、`src/address/` 内部の intern 中間ノードとして残す**。`stateElement.addressFor()` の内部表であり、`patternLedger` のキーでもある。名前は「ツリーに固定されたパス」を表す `IScopedPath`（または `ITreePath`）に改める — `Absolute` は絶対/相対の対が無くなった時点で意味を失う語である。

### 5-5. ホットパスの収支

| 経路 | 現行 | 統合後 |
|---|---|---|
| `traps/get.ts` の読み 1 回 | StateAddress intern 2 段 | StateAddress intern 2 段（根が stateElement） |
| `_getByAddressWithCache` | ＋ AbsolutePathInfo 2 段 ＋ AbsoluteStateAddress 2 段 | **0**（アドレスがそのままキー） |
| 台帳到達アドレス 1 個の割当 | StateAddress ＋ AbsoluteStateAddress（＋ AbsolutePathInfo は path 単位） | **1 個** |
| 行バインディング登録 | アドレス intern なし（patternLedger） | 同じ（不変） |

**キャッシュを引く読みで WeakMap lookup が 4 回減る。** ただしこれは見積もりであり、実測（§9）で確認する。

---

## 6. 却下した案

### 6-1. 案 B: 台帳をツリー側へ移し、アドレスはツリー非依存のままにする

`stateElement.cache.get(address)` / `stateElement.bindings.get(address)` の形。アドレスは `(pathInfo, listIndex)` のまま、`IAbsolutePathInfo` と `IAbsoluteStateAddress` は完全に消える。§4-3 の罠も消える。

**却下理由**: 単一 updater の queue とバッチ（`ReadonlySet<...>`）がツリーをまたぐ。ここを通すには `(stateElement, address)` のタプルを作るか、queue をツリー別に分けて drain を協調させるしかない。

- タプル案 — intern 済みアドレスが今提供している「オブジェクト同一性 1 発で dedup できる」性質（[updater.ts の `_applyChange` の前提](../packages/state/src/updater/updater.ts#L176)）が失われる。coalescing のために `Map<IStateElement, Map<IStateAddress, _>>` の 2 段が要る。
- queue 分割案 — drain の単位がツリーごとになり、`$scan` → `$watch` → `$streams` restart の**機構間順序がツリーをまたいで保証できなくなる**（[state-scan-design.md](./state-scan-design.md) D11）。これは契約の変更であり、本書の範囲を超える。

どちらも複雑さの移動にしかならない。**「1 つの drain が全ツリーを見る」という現行の契約を保つ限り、アドレスがツリーを持つのが素直**。

### 6-2. 案 C: `IAbsolutePathInfo` だけ消す

`IAbsoluteStateAddress = { stateElement, pathInfo, listIndex }` の 3 段 intern にして中間ノードを消す案。型は 5 → 4 になるが、

- lift は残る（`createAbsoluteStateAddress(stateElement, address.pathInfo, address.listIndex)` と書くだけ）
- `patternLedger` のキーが失われ、`WeakMap<IStateElement, WeakMap<IPathInfo, WeakMap<IListIndex, _>>>` の 3 段になる（行のホットパスが 1 段増える）

**得るものが小さく、失うものが具体的**。却下。

### 6-3. 案 D: 何もしない

現行は正しく動いており、Issue も出ていない。往復のコストは WeakMap lookup 数発で、実測上のボトルネックとして報告されたことはない。

**採らない理由**: §4-3 の罠が型で防げないまま残ること。台帳は増え続けており（v2.3 で `recursion`、v2.4 で `scan`、v2.5 で `prevValues` 周辺）、そのたびに「絶対アドレスをキーにする」ことを人間が覚えている必要がある。これは時間とともに確率的に破れる種類の前提である。

---

## 7. 外部契約への影響

### 7-1. devtools hook protocol（破壊的）

[exports.ts:32](../packages/state/src/exports.ts#L32) が `ContractEvent` を公開しており、その payload が `IAbsoluteStateAddress` を運ぶ。[devtools-hook-protocol.md](./devtools-hook-protocol.md) が明記している形は次のとおり。

- §4.2 — `{ absoluteAddress, value, oldValue, hasOldValue }`、「the `absoluteAddress` carries the stateElement, path and listIndex — in v2 the state-element reference is the identity」
- §4.3 — `state:update-batch` の `{ addresses: ReadonlySet<IAbsoluteStateAddress> }`
- §4.4 — `{ absoluteAddress, binding }`
- §5 の表の脚注が [AbsoluteStateAddress.ts:5](../packages/state/src/address/AbsoluteStateAddress.ts#L5) を**行番号つきで**参照している

consumer は `absoluteAddress.absolutePathInfo.pathInfo.path` の経路でパスを読む。buildless 配布なので DevTools 側と state のバージョンが揃わない期間が必ずある。

**方針**: protocol のバージョン印を上げ、統合後のアドレスに 1 リリースだけ deprecated な互換 getter を置く。

```ts
/** @deprecated v2.x で撤去。`address.pathInfo` / `address.stateElement` を直接読むこと */
get absolutePathInfo(): { pathInfo: IPathInfo; stateElement: IStateElement } { return this; }
```

アドレス自身が `pathInfo` と `stateElement` を持つので、`this` を返すだけで `absoluteAddress.absolutePathInfo.pathInfo.path` が通る。ただし `parentAbsolutePathInfo` は返さない（読んでいる consumer は無い）。

### 7-2. README の internals 節

[packages/state/README.md:2969](../packages/state/README.md#L2969) が 5 本の型を説明している。ここは 3 本の説明に書き換える（`README.ja.md` も同時）。README は `npm view` で読まれる AI 向けの正本でもあるので、統合と同じ PR で更新する。

### 7-3. 影響しないもの

- `package.json` の `exports`（`.` / `./manifest` / `./parser` / `./auto`）— アドレス型は型としてもエクスポートされていない（`ContractEvent` 経由の構造的露出のみ）
- `data-wcs` 構文・`wc-bindable` / command-token / event-token / transition-runner の各プロトコル
- `@wcstack/server`（SSR）・`vscode-wcs`（state の `dist` を消費するが `parser` エントリ経由）
- wcstack-skill（オーサリング面に変化なし）

---

## 8. 移行手順

### PR ① 内部化と改名（振る舞い不変）

- `IAbsolutePathInfo` → `IScopedPath`、`AbsolutePathInfo.ts` → `ScopedPath.ts`
- `src/address/` の外から `getAbsolutePathInfo` を直接呼ばせない（`patternLedger` と `src/address/` 内部だけに閉じる）ため、まず lift を `liftAddress(stateElement, address)` の 1 関数に集約する（21 箇所 → 1 実装）
- テストは名前の追随のみ。**この PR は差分レビューで「意味が変わっていない」ことだけを確認できる形にする**

### PR ② 統合と lift 削除（本体）

- `IStateAddress` に `stateElement` を追加、intern の根を `IStateElement` へ移す（§5-3）
- `IAbsoluteStateAddress` を `IStateAddress` の型エイリアスにして、`liftAddress` を恒等関数にする — **この時点で全台帳が正しく動くことをテストで確認**
- エイリアスと `liftAddress` の呼びを機械的に削除
- `.absolutePathInfo.pathInfo` → `.pathInfo`、`.absolutePathInfo.stateElement` → `.stateElement`
- `getByAddress` / `setByAddress` / `hasByAddress` の入口に `address.stateElement === handler.stateElement` の assert を入れる（D5・`config.debug` 時のみ）
- README internals（§7-2）と devtools protocol doc（§7-1）を同時更新

### PR ③ 互換面の撤去

- deprecated な `absolutePathInfo` getter を削除
- devtools protocol のバージョン印を確定

---

## 9. 検証

- **カバレッジ**: 100/97/100/100 を維持（state の閾値）。アドレス周りのテストは `__tests__` 301 本中 49 本が絶対アドレス型に触れる。
- **GC 回帰**（§5-3 が本題なので必須）: `<wcs-state>` を接続 → パスを読ませて intern を作る → 切断・参照破棄 → `FinalizationRegistry` か heap snapshot で要素が回収されることを確認する。**PR ② の受け入れ条件**。現行でも同じ試験を先に通して基準を取る。
- **性能**: §5-5 の見積もりを実測で確認する。既存のベンチ（[__e2e__/benchmark](../packages/state/__e2e__/benchmark) と [benchmark-component](../packages/state/__e2e__/benchmark-component) の append / clear・深さ方向）を branch と main の両方で測る。**片側だけ測った主張は採用しない**。
- **クロスツリー**: 独立した `<wcs-state>` を持つコンポーネントを 2 つ並べ、**同じパス形状のルート配列**を持たせて baseline が混線しないことを確認する（§4-3 が今日ぎりぎりで避けている事故の再現テスト）。これは統合前に**現行で落ちるか通るか**を先に測る。
- **SSR**: `@wcstack/server` の hydration 経路（`hydrateBindings`）が旧台帳側に登録する経路を持つので、素の Node での SSR スモークを通す（vitest は素 Node の代替にならない）。

---

## 10. 未決の論点

1. **`IResolvedAddress` を残すか**。正方形の外側だが、`Map<string, _>` の不滅キャッシュを持つ 5 本目である。`ResolvedAddress` → `PathInfo` は 1:多の正規化で、`getResolvedAddress` は proxy の入口でしか使われない。統合とは独立に畳めるかもしれないが、本書では触らない。
2. **改名先**（`IScopedPath` / `ITreePath` / `IPathInSite` …）。`Absolute` を捨てるのは決めたが、代わりの語は未決。
3. **assert の常時 ON**（D5）。`config.debug` 時のみにするか、統合直後の 1 リリースだけ常時 ON にして実地で取り違えを炙り出すか。
4. **`IStateElement` の肥大**。`addressFor()` を要素に生やすのは責務として妥当か、`src/address/` 側が `WeakMap<IStateElement, …>` を持つ形（外側の弱キーが stateElement なら GC 要件は同じく満たす）にするか。後者なら要素の API 面は不変で、実装だけ今日の `AbsolutePathInfo.ts` の構造を継ぐ。**こちらのほうが差分が小さい可能性が高い**。
