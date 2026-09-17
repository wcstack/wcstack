# 設計: アドレス型の統合 — 正方形を 1 本に畳む

- **状態**: 検討（2026-09-17・2026-09-18 レビュー反映）。**未決**。§0 の優先順位と決定レコードは提案であって合意ではない。実装前。
- **対象**: `@wcstack/state` の内部アドレス型（`src/address/`）と、それをキーにする全台帳。proxy・updater・依存グラフの**契約は変えない**（同じ意味の型に名前と形が付け替わるだけ）。
- **一言で**: 「パス × ツリー × 行」の 3 次元を、**4 つの型が成す正方形**で表すのをやめ、**1 本のアドレス型**に畳む。`IAbsoluteStateAddress` を削除し、`IStateAddress` が `stateElement` を持つ。
- **契機**: `IAbsoluteStateAddress` は「名前付き State」の名前次元を運ぶために生まれた型で（§2）、v2 でその次元を撤去したあとも形を変えて残っている。ツリーが 1 rootNode 1 本になった今、2 本のアドレス型を持ち続ける理由が何なのかを確定させる。
- **結論の先出し**: **`stateElement` 次元そのものは消せない**（§3）。消せるのは**次元を足したり降ろしたりする往復**のほう（§4）。
- **双対**: [state-mount-design.md](./state-mount-design.md) の D16（名前次元の撤去）。本書はその撤去が型に残した跡地の整理。
- **改訂（2026-09-18）**: 設計レビューの反映。①判断の優先順位を明示（§0-1）②「行はツリーに属さない」という実測を足し、intern のキーを 3 つ組の不変条件として書き直した（§3-1・§5-3）③ホットパス収支を intern の置き場所ごとに分けた（§5-5）④罠だけを塞ぐ案 E を追加（§6-4）⑤devtools をリポジトリ内 consumer として移行計画に入れ、互換を両方向に張った（§7-1・§8）⑥アドレス生成 31 箇所を移行範囲に計上（§4-6）。

---

## 0. 優先順位と決定レコード（提案）

### 0-1. 判断の優先順位

以下の決定はすべてこの順序を根拠にする。**順序そのものが未合意**（§10 の 1）。

**制約**（取引しない）

- **C1 契約不変** — proxy・updater・依存グラフ・drain の機構間順序は変えない。
- **C2 正しさ** — ツリーを混線させない。`<wcs-state>` を GC から隠さない。

**優先順位**（上が勝つ）

1. **P1 ホットパスの性能中立** — 読み（`traps/get`）と行バインディング登録を退行させない。改善は副産物であって目的ではない。
2. **P2 誤用の構造的防止** — 新しい台帳を書く人が「覚えておくこと」を減らす（§4-3）。
3. **P3 移行コスト** — 差分・テスト・モック・外部 consumer への波及を小さくする。

順序が変われば結論も変わる。**P3 を P1 の上**に置くなら intern の表は module 側の WeakMap で足りる（§5-5 の (b)。素のパスの読みが 1 回増えるが差分は最小）。**P2 を最下位**に置くなら案 A は要らず、案 E（§6-4）だけで終わる。P1 を P2 の上に置くのは、案 E が P2 を安く部分的に満たせる一方で、P1 の退行は案の外から補えないため。

### 0-2. 決定レコード

| ゲート | 論点 | 決定（提案） |
|---|---|---|
| **D1** | `IAbsoluteStateAddress` を消して `IStateAddress` に戻せるか | **戻せない**。updater はモジュール単一で drain のバッチはツリーをまたぐ（§3）。台帳のキーはツリーを識別できなければならない。 |
| **D2** | ではどうするか | **正方形を 1 本に畳む**。`IStateAddress` に `stateElement` を足し、`IAbsoluteStateAddress` を削除して全台帳のキーを `IStateAddress` に統一する（§5）。 |
| **D3** | `IAbsolutePathInfo` はどうするか | **内部の intern 中間ノードとして残す**（改名して `src/address/` に閉じる）。行バインディング台帳（`patternLedger`）が `(absolutePathInfo, listIndex)` の 2 段キーで**アドレスを intern せずに**引く設計を支えているため（[state-row-instantiation-redesign.md](./state-row-instantiation-redesign.md) §3-3）。公開概念からは落とす。 |
| **D4** | intern の構造 | 2 つの不変条件で縛る（§5-3）。**I1: キーは常に `(stateElement, pathInfo, listIndex)` の 3 つ組**。**I2: アドレスへの強参照経路は、必ず `stateElement` を弱キーとする表か、要素が所有する表を通る**。どちらも性能ではなく C2 の要請。現行の `_cacheNullListIndex` は不滅の `PathInfo` をキーにしているので、そこに `stateElement` 参照を入れると要素が永久に回収されない。表の**置き場所**は P1 と P3 の取引なので実測で決める（§5-5・§10 の 6）。 |
| **D5** | ツリー非依存アドレスは残すか | **残さない**。全アドレスがツリーを持つ。`getByAddressSymbol` に別ツリーのアドレスを渡す取り違えが assert で検出可能になる（今は黙って通る）。 |
| **D6** | 台帳をツリー側に持たせる案（アドレスは非依存のまま）は | **却下**（§6-1）。単一 updater の queue とバッチがツリーをまたぐので `(stateElement, address)` のタプル生成が復活し、複雑さの移動にしかならない。 |
| **D7** | devtools hook protocol への影響 | **最終的に破壊的**。`ContractEvent` の payload が `absoluteAddress.absolutePathInfo.pathInfo.path` の形を公開している（§7-1）。ただし破壊的なのは互換 getter を消す PR ③であって、PR ②は追加的変更（protocol §2 の規則では版を上げない）。consumer は**リポジトリ内にもある**（`packages/devtools`）。互換は**両方向**に張る — 旧 devtools × 新 state は state 側の deprecated getter、新 devtools × 旧 state は devtools 側の両読み。版印は不一致を**警告するだけで配送を止めない**ので、互換の手段にはならない。 |
| **D8** | 段階 | **PR 4 本**（§8）。⓪番人と基準試験（案 E・振る舞い不変）→ ①内部化と改名（振る舞い不変）→ ②統合と lift 削除 → ③互換面の撤去。⓪は案 A の採否と独立に着地できる。 |
| **D9** | 期待する利得と費用 | **利得**: 中心概念 5 → 3、lift 21 + downgrade 20 サイトの消滅、台帳到達アドレスあたりのオブジェクト割当 2 → 1、`parentAddress` 実装の一本化、D5 の assert、そして §4-3 の「ツリー非依存アドレスを台帳のキーにしてはならない」という**覚えておくしかない罠の構造的消滅**（案 E は典型的な綴りを塞ぐだけ — §6-4）。**費用**: アドレス生成 31 箇所とテスト 123 箇所のシグネチャ変更（§4-6）、devtools の両読み（§7-1）。行数の削減は 200 行前後で、そこは主眼ではない。 |
| **D10** | 罠だけを先に塞ぐか（案 E） | **塞ぐ**。モジュール寿命の台帳がツリー非依存アドレスをキーにする綴りを、走査テストで禁じる（§6-4）。数行で入り、案 A を採れば対象の型が無くなって消える。**案 A の根拠からは §4-3 を割り引いて読むこと** — 案 A を正当化するのは D9 の残りの利得である（§6-3）。 |
| **D11** | 行付きアドレスの intern | **`listIndex` はツリーを決めない**（§3-1・実測）。行付きでも `stateElement` をキーに含める。現行の `WeakMap<IListIndex, WeakMap<IPathInfo, _>>` の 2 段を**そのまま残してはならない**。 |
| **D12** | バインディングのアドレス | 「切断中でも引ける非依存アドレス」（`getStateAddressByBindingInfo`）を廃し、要素を引数で受ける 1 本にまとめる。呼び出し元 2 箇所はどちらも要素を既に持っている（§4-6）。前提は「接続されていること」ではなく「要素が分かっていること」になる。 |

---

## 1. 現状 — 5 本の型と正方形

[types.ts](../packages/state/src/address/types.ts) にあるのは 3 本ではなく 5 本である。

| 型 | 内容 | intern キー | 寿命 |
|---|---|---|---|
| `IPathInfo` | パス文字列の構文解析結果 | `Map<string, _>` | **不滅**（強参照・tooling 以外クリア不可） |
| `IResolvedAddress` | 生パス（`items.0.name`）→ pathInfo + 添字 | `Map<string, _>` | **不滅** |
| `IStateAddress` | pathInfo + listIndex | `WeakMap<listIndex, WeakMap<pathInfo, _>>` / listIndex が null なら `WeakMap<pathInfo, _>` | 行付きは行と同寿命（**行はツリーに属さない** — §3-1）、**null 行は不滅** |
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

### 3-1. 行（`ListIndex`）はツリーに属さない

ツリーをまたぐのは updater だけではない。行の正本台帳 [listIndexesByList.ts](../packages/state/src/list/listIndexesByList.ts) は**配列だけをキーにするモジュール単一の WeakMap** で、「1 本の配列につき行集合は 1 組」を全ツリーで共有する。

**実測（2026-09-18）**: 独立した ShadowRoot に `<wcs-state>` を 2 つ置き、**同じ配列インスタンス**を両方の初期値に渡して `for` で描画すると、

- 両ツリーの 1 行目の `ListIndex` は**同一オブジェクト**
- したがって `createStateAddress(pathInfo, listIndex)` も**同一オブジェクト**
- `createAbsoluteStateAddress` だけが 2 つを分ける

つまり今日、行付きアドレスの側でツリーを区別しているのは `IAbsolutePathInfo` **だけ**である。§4-3 の罠は null 行に限った話ではなく、「同じ配列を 2 ツリーが持つ」形なら行付きでも成立する。統合後の intern がこの次元を落とすと、2 本目のツリーが 1 本目の `stateElement` を持つアドレスを受け取る（D11）。

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

### 4-6. 生成箇所 — 統合で要素が要るのは lift ではなく生成

§4-1 は「lift の 21 箇所で `stateElement` が自明に取れる」ことを示したが、統合後に要素が要るのは lift ではなく **`createStateAddress` の呼び出しすべて**である。`src/address/` の外に **31 箇所**（18 ファイル）。

| 分類 | 箇所数 | 内容 |
|---|---|---|
| `handler` / `context` / 引数から要素が取れる | 27 | proxy の traps・methods・apis、`walkDependency`（6）、`applyChangeToFor`、`reapplyStateBindings`、`overlay`、`recursion/walk` ほか |
| 引数の追加か解決順の入れ替えが要る | 4（3 関数） | 下記 |

- [getStateAddressByBindingInfo.ts](../packages/state/src/binding/getStateAddressByBindingInfo.ts)（2 箇所）— `IBindingInfo` は要素を持たない。呼び出し元は [applyChange.ts:94](../packages/state/src/apply/applyChange.ts#L94) の `getValue(context.state, binding)` と [initialSync.ts](../packages/state/src/bindings/initialSync.ts) の `isBindingStateInitialized` の 2 つで、**どちらも要素を既に持っている**（`context.stateElement`／直前の `getStateElement(rootNode)`）。
- [rowLanding.ts](../packages/state/src/watch/rowLanding.ts) の `placementOf(state, pathInfo, row)` — proxy しか受け取らない。呼び出し元（`scanRuntime`・`watchRuntime`）は要素単位で動くので、引数を 1 つ通す。
- [hydrateBindings.ts](../packages/state/src/hydrateBindings.ts) の `hydrateBlocks` — 要素の解決（`getStateElement(rootNode)`）がアドレス生成より**後**にある。順序を入れ替える。

バインディングには今日、非対称がある。`getStateAddressByBindingInfo` は**切断中でも引ける**が、[getAbsoluteStateAddressByBinding.ts](../packages/state/src/binding/getAbsoluteStateAddressByBinding.ts) は root が解決できないと raise する。統合すると前者が消えるので、どちらの前提に寄せるかを決める必要がある（D12）。

`ILoopContext` も `IStateAddress` を継承している（[list/types.ts:27](../packages/state/src/list/types.ts#L27)）。`hydrateBlocks` と `applyChangeToFor` の生成箇所はループ文脈を作るためのもので、統合後は**ループ文脈も要素を持つ**（§5-1）。

テスト側は `createStateAddress(` が **17 ファイル・123 箇所**、`stateElement` のモックを自前で作るテストが**約 60 ファイル**ある。後者は intern の置き場所の選択に効く（§5-5）。

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

内部には intern 中間ノード（§5-4）への参照も持つ。`patternLedger` は今日 `address.absolutePathInfo` で行バインディングを引いている（[getBindingSetByAbsoluteStateAddress.ts:136](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts#L136)）。これを再解決なしで引き続けるため。`src/address/` と `patternLedger` 以外は読まない。

`ILoopContext` は `IStateAddress` を継承しているので、**ループ文脈も要素を持つようになる**。ループ文脈は DOM の content に結び付く値で、content は 1 つのツリーにしか属さないから意味は変わらない。ただし今日は §3-1 の形で 2 ツリーが同じループ文脈オブジェクトを共有しうるのに対し、統合後はツリーごとに別オブジェクトになる。

### 5-2. `parentAddress` は 1 本になる

`(stateElement, pathInfo.parentPathInfo, 末尾が `*` なら parentListIndex)` の 1 実装。`AbsolutePathInfo.parentAbsolutePathInfo` の連鎖も不要になる。

### 5-3. intern の 2 つの不変条件 — 同一性と GC

**ここを間違えると、混線か参照リークになる。** どちらも性能ではなく C2 の要請（D4）。

**I1（同一性）— キーは常に `(stateElement, pathInfo, listIndex)` の 3 つ組。** `listIndex` はツリーを決めない（§3-1）。現行の行付き intern

```ts
const _cache: WeakMap<IListIndex, WeakMap<IPathInfo, IStateAddress>> = new WeakMap();
```

に `stateElement` を持つアドレスをそのまま入れると、同じ配列を持つ 2 本目のツリーが、1 本目の要素を持つアドレスを引き当てる。D5 の assert が有効なら気付けるが、`config.debug` が off なら**黙って別ツリーの台帳を読み書きする** — 本書が消そうとしている事故を、アドレスの内側に埋め込むことになる（D11）。

**I2（GC）— アドレスへの強参照経路は、必ず `stateElement` を弱キーとする表か、要素が所有する表を通る。** 現行の null 行 intern

```ts
const _cacheNullListIndex: WeakMap<IPathInfo, IStateAddress> = new WeakMap();
```

のキー `IPathInfo` は強参照の `Map<string, IPathInfo>` に載っていて**不滅**である（[PathInfo.ts:5](../packages/state/src/address/PathInfo.ts#L5)）。したがってこの WeakMap のエントリは実質不滅。今日はアドレスがツリーを知らないので害がない。**ここへ `stateElement` を持つアドレスを入れると、不滅のキーから `<wcs-state>` 要素への強参照が伸び、要素を DOM から外しても永久に回収されなくなる。**

今日の絶対側がリークしないのは、経路の途中に `stateElement` を弱キーとする段があるからである（`WeakMap<IStateElement, WeakMap<IPathInfo, IAbsolutePathInfo>>`）。WeakMap は ephemeron なので、値（アドレス）が自分のキー（要素）を参照していても要素は保持されない。**要るのは「その段があること」であって「外側にあること」ではない**。段の位置を決めるのは GC ではなく引きの回数である（§5-5）。

行を共有する 2 ツリーの片方だけが消える場合も I2 で足りる。残ったツリーが `ListIndex` を生かし続けても、消えたツリーのアドレスへ届く経路は消えた要素の段を通るので、まとめて回収される。

### 5-4. `IAbsolutePathInfo` は内部に残す

行バインディング台帳 [patternLedger](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts#L81) は `(absolutePathInfo, listIndex)` の 2 段キーで引き、**登録側でアドレスを一切 intern しない**（[state-row-instantiation-redesign.md](./state-row-instantiation-redesign.md) §3-3）。これは行のホットパスを支える実測済みの構造なので壊さない。

そこで `IAbsolutePathInfo` は**公開概念からは落とすが、`src/address/` 内部の intern 中間ノードとして残す**。アドレス intern の内部表であり、`patternLedger` のキーでもある。名前は「ツリーに固定されたパス」を表す `IScopedPath`（または `ITreePath`）に改める — `Absolute` は絶対/相対の対が無くなった時点で意味を失う語である。

中間ノードは**アドレスの表も持つ**。

```ts
// src/address/ScopedPath.ts（内部）
class ScopedPath {
  readonly stateElement: IStateElement;
  readonly pathInfo: IPathInfo;
  nullRowAddress: IStateAddress | undefined;                     // listIndex === null
  rowAddresses: WeakMap<IListIndex, IStateAddress> | undefined;   // 行付き
}
```

`(stateElement, pathInfo)` で中間ノードを引いたあとは、null 行ならフィールド読み、行付きなら WeakMap 1 回でアドレスに届く。I1 は「中間ノードが要素ごとにある」ことで、I2 は「中間ノードへの経路が要素の段を通る」ことで満たす。今日の絶対側（中間ノードを引いたあと module-global の `listIndex → absPathInfo → address` をさらに 2 段）より浅い。

### 5-5. ホットパスの収支 — 表の置き場所で変わる

中間ノードの表（`pathInfo → ScopedPath`）をどこに置くかで 3 案ある。I1・I2 はどれも満たす。

- **(a1)** `IStateElement` にメソッド `addressFor()` を生やし、表を要素のフィールドに持つ
- **(a2)** 入口は `src/address/` の自由関数のまま、表だけを要素のプロパティ（symbol キー）に置く。`State` クラスはフィールドとして宣言し、テストのモックには初回に遅延生成する
- **(b)** `src/address/` が `WeakMap<IStateElement, Map<IPathInfo, ScopedPath>>` を持つ（今日の `AbsolutePathInfo.ts` の構造を継ぐ）

数えるのは WeakMap / Map を引く段数（プロパティ読みは数えない）。現行の lift は `getAbsolutePathInfo` 2 段 ＋ `createAbsoluteStateAddress` 1〜2 段。

| 経路 | 現行 | (a1) / (a2) | (b) |
|---|---|---|---|
| **素のパスの読み**（ワイルドカードも getter も無く、`isCacheable` が偽） | **1**（null 行 intern のみ。lift しない） | 1 | **2** |
| キャッシュを引く読み・null 行（getter） | 1 ＋ lift 3 ＝ 4 | 1 | 2 |
| キャッシュを引く読み・行付き | 2 ＋ lift 4 ＝ 6 | 2 | 3 |
| 台帳到達アドレス 1 個の割当 | StateAddress ＋ AbsoluteStateAddress（＋ AbsolutePathInfo は path 単位） | **1 個**（＋ ScopedPath は path 単位） | 同左 |
| 行バインディング登録 | アドレス intern なし（patternLedger） | 同じ（不変） | 同じ（不変） |

キャッシュを引く読みはどの案でも減る（行付きで 3〜4 段）。**差が出るのは 1 行目**である。素のパスの読み（`state.count`）は最も頻度が高く、今日は lift を一切通らない。(b) はここを 1 段増やすので、P1 に照らすと**実測で無害と示せない限り採れない**。一方 P3 では (b) が最も安い — 要素の API 面が不変で、`stateElement` を自前のモックで作る約 60 本のテストは**モックに手を入れずに済む**（`createStateAddress` の引数追加は別勘定 — §4-6）。

(a1) は同じ 60 本すべてに `addressFor` の実装を要求する。(a2) に対する利点は型の素直さだけなので **(a1) は却下**。(a2) の欠点は、要素オブジェクトへの書き込み（モックへの遅延生成）を伴うこと。

**提案**: (a2) と (b) を §9 のベンチで並べて測り、**素のパスの読みの差が測定誤差に収まるなら (b)、収まらないなら (a2)**。P1 が P3 より上なので、差が出たら差分の小ささは理由にならない（§10 の 6）。

段数はいずれも見積もりであり、実測（§9）で確認する。

---

## 6. 代替案 — 却下した 3 つと、先に採る 1 つ

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

台帳は増え続けており（v2.3 で `recursion`、v2.4 で `scan`、v2.5 で `prevValues` 周辺）、そのたびに「絶対アドレスをキーにする」ことを人間が覚えている必要がある。これは時間とともに確率的に破れる種類の前提である。

**ただし、それだけでは案 A の理由にならない。** §4-3 の罠そのものは案 E（§6-4）で安く塞げる。案 D ＋ E で**残るもの**は次の 4 つで、案 A を採るかどうかは、これらに P3 の費用（§4-6）を払う価値があるかで決まる。

- 往復の 41 サイトと、キャッシュを引く読みごとの lift（§5-5 で 3〜4 段）
- `parentAddress` と intern の二重実装（§4-4）
- 別ツリーのアドレスを proxy に渡す取り違えが検出できないこと（D5。走査テストでは捕まえられない）
- 案 E が塞ぐのは**典型的な綴りだけ**であること（§6-4）

本書の提案は「払う価値がある」だが、P2 を P3 の下に置く読み手には案 D ＋ E が正解になる（§0-1）。

### 6-4. 案 E: 罠だけを塞ぐ番人 — **採用。案 A と独立**

§4-3 の罠は「モジュール寿命の台帳が、ツリー非依存のアドレスをキーにする」という**綴り**として現れる。綴りは機械的に検出できる。

- `src/**/*.ts` を走査し、**モジュール直下**の `WeakMap` / `Map` / `WeakSet` / `Set` の型引数が `IStateAddress` または `ILoopContext` で始まる宣言を失敗にするテストを置く。関数内の局所集合（`walkDependency` の `visited`・`StateHandler` の `seen`）は 1 回の walk に閉じるので対象外。
- ESLint の `no-restricted-syntax` でも書けるが、各パッケージの `eslint.config.js` は `/config-templates/` からの**自動生成**で、パッケージ固有の規則を足す口が無い。ソースを走査するテストには前例がある（`__tests__/tagNameMap.test.ts`）。
- 許可リストが 1 件要る。[getListIndexByBindingInfo.ts:7](../packages/state/src/list/getListIndexByBindingInfo.ts#L7) の `WeakMap<ILoopContext, WeakMap<IBindingInfo, _>>` は今日すでにこの綴りである。ただし内側のキー `IBindingInfo` が DOM ノード単位＝ツリー単位なので、§3-1 の形でループ文脈が共有されても混線しない。**理由つきで許可する**。

2026-09-18 時点で、この 1 件以外にモジュール寿命の該当台帳は無い。つまり罠は**今日は踏まれていない**。

**塞げないもの**: 型引数を `object` や別名で書いた台帳、アドレスを包んだ値をキーにする台帳、そして D5 の取り違え（キーの綴りではなく、値の受け渡しの誤り）。案 E は「うっかり」を捕まえる番人であって、案 A のような構造的な消滅ではない。

**位置付け**: 数行で入り、振る舞いを変えず、案 A を採れば対象の型が無くなって自然に消える。案 A を採らない場合はこれが恒久策になる。どちらに転んでも無駄にならないので、PR ⓪として先に入れる（§8・D10）。

---

## 7. 外部契約への影響

### 7-1. devtools hook protocol（PR ②は追加的・PR ③が破壊的）

[exports.ts:32](../packages/state/src/exports.ts#L32) が `ContractEvent` を公開しており、その payload が `IAbsoluteStateAddress` を運ぶ。[devtools-hook-protocol.md](./devtools-hook-protocol.md) が明記している形は次のとおり。

- §4.2 — `{ absoluteAddress, value, oldValue, hasOldValue }`、「the `absoluteAddress` carries the stateElement, path and listIndex — in v2 the state-element reference is the identity」
- §4.3 — `state:update-batch` の `{ addresses: ReadonlySet<IAbsoluteStateAddress> }`
- §4.4 — `{ absoluteAddress, binding }`
- §5 の表の脚注が [AbsoluteStateAddress.ts:5](../packages/state/src/address/AbsoluteStateAddress.ts#L5) を**行番号つきで**参照している

consumer は `absoluteAddress.absolutePathInfo.pathInfo.path` の経路でパスを読む。**その consumer はリポジトリ内にある。** [packages/devtools](../packages/devtools) は構造的なミラー型（[protocol/types.ts](../packages/devtools/src/protocol/types.ts) の `IAbsoluteAddressLike` / `IAbsolutePathInfoLike`）を持ち、[DevtoolsCore.ts](../packages/devtools/src/core/DevtoolsCore.ts) の 4 箇所（`_labelOf`・`state:binding-added` のパスと要素・`state:binding-cleared`）で旧経路を読む。テストで旧形に触れるのは 2 ファイル・44 箇所。プロトコル文書は英日 2 本あり、[devtools-hook-protocol.ja.md](./devtools-hook-protocol.ja.md) も同じ行番号参照を持つ。

buildless 配布なので devtools と state のバージョンが揃わない期間が必ずある。不一致は**両方向**に起きる。

| 組み合わせ | 起きる状況 | 守る手段 |
|---|---|---|
| 旧 devtools × 新 state | devtools をピン留めし、state を更新する | state 側の deprecated getter（下） |
| **新 devtools × 旧 state** | **state を SRI つきでピン留めしたページに、devtools を版無しの CDN URL で足す**（[devtools の README](../packages/devtools/README.md) が示す URL は版無し） | devtools 側の**両読み** |

現実に多いのは下の行で、これは state 側の getter では守れない。devtools は読み取りを 1 つのヘルパーに集め、`address.pathInfo ?? address.absolutePathInfo.pathInfo`（`stateElement` も同様）の両読みにする。旧 state 2.x を見に行ける間は残す。

**版印は互換の手段にならない。** `DEVTOOLS_PROTOCOL_VERSION` の不一致は `console.warn` を出すだけで、先勝ちの registry がそのままイベントを配送する（[bridge.ts](../packages/state/src/devtools/bridge.ts) の `getOrCreateHookRegistry`・protocol §2）。版を上げても旧 consumer は旧経路を読みに来る。しかも **registry の配送にも `DevtoolsCore` の `onEvent` にも try/catch が無い**。旧経路が消えたあとの `TypeError` は、state の計装点（updater の `_applyChange` を含む 23 箇所）から**検査対象アプリの更新経路へ伝播する**。壊れるのは devtools の表示だけではない。

**方針**:

1. PR ②は**追加的変更**にする。アドレスに `pathInfo` / `stateElement` を直接生やし、旧経路は deprecated getter で残す。protocol §2 の規則（追加は版を上げない）どおり、版印は据え置く。
2. devtools は同じリリースで両読みにする。
3. 旧経路を消す PR ③が破壊的変更で、ここで版印を 3 に上げる。**時期は次の major を提案する**（§10 の 5）。getter 1 個を残す費用はほぼゼロで、消したときの失敗は上のとおり検査対象アプリに届くため。

```ts
/** @deprecated 次の major で撤去。`address.pathInfo` / `address.stateElement` を直接読むこと */
get absolutePathInfo(): { pathInfo: IPathInfo; stateElement: IStateElement } { return this; }
```

アドレス自身が `pathInfo` と `stateElement` を持つので、`this` を返すだけで `absoluteAddress.absolutePathInfo.pathInfo.path` が通る。ただし `parentAbsolutePathInfo` は返さない（`packages/devtools` は読んでいない — grep で確認済み）。

### 7-2. README の internals 節

[packages/state/README.md:2969](../packages/state/README.md#L2969) が 5 本の型を説明している。ここは 3 本の説明に書き換える（`README.ja.md` も同時）。README は `npm view` で読まれる AI 向けの正本でもあるので、統合と同じ PR で更新する。

### 7-3. 影響しないもの

- `package.json` の `exports`（`.` / `./manifest` / `./parser` / `./auto`）— アドレス型は型としてもエクスポートされていない（`ContractEvent` 経由の構造的露出のみ）
- `data-wcs` 構文・`wc-bindable` / command-token / event-token / transition-runner の各プロトコル
- `@wcstack/server`（SSR）・`vscode-wcs`（state の `dist` を消費するが `parser` エントリ経由）
- wcstack-skill（オーサリング面に変化なし）

---

## 8. 移行手順

### PR ⓪ 番人と基準試験（振る舞い不変・案 A の採否と独立）

- 案 E の走査テスト（§6-4）。許可リストは `getListIndexByBindingInfo.ts` の 1 件
- §9 の GC 回帰試験とクロスツリー試験（同じパス形状・**同じ配列インスタンス**の両方）を**現行実装に対して**通し、基準を取る
- §9 の「素のパスの読み」のベンチ項目を足す（今のベンチは append / clear と深さ方向が中心で、§5-5 の 1 行目を測れない）

### PR ① 内部化と改名（振る舞い不変）

- `IAbsolutePathInfo` → `IScopedPath`、`AbsolutePathInfo.ts` → `ScopedPath.ts`
- `src/address/` の外から `getAbsolutePathInfo` を直接呼ばせない（`patternLedger` と `src/address/` 内部だけに閉じる）ため、まず lift を `liftAddress(stateElement, address)` の 1 関数に集約する（21 箇所 → 1 実装）
- テストは名前の追随のみ。**この PR は差分レビューで「意味が変わっていない」ことだけを確認できる形にする**

### PR ② 統合と lift 削除（本体）

- `IStateAddress` に `stateElement` を追加し、`createStateAddress` のシグネチャを `(stateElement, pathInfo, listIndex)` に変える。`src/address/` の外 31 箇所のうち 27 箇所は手元の要素を渡すだけ、残り 4 箇所 3 関数は引数の追加か解決順の入れ替え（§4-6・D12）。テストは 17 ファイル・123 箇所
- intern を §5-3 の I1・I2 を満たす形に組み替える。表の置き場所は PR ⓪のベンチで (a2) と (b) を測って決める（§5-5）
- `IAbsoluteStateAddress` を `IStateAddress` の型エイリアスにして、`liftAddress` を恒等関数にする — **この時点で全台帳が正しく動くことをテストで確認**
- エイリアスと `liftAddress` の呼びを機械的に削除
- `.absolutePathInfo.pathInfo` → `.pathInfo`、`.absolutePathInfo.stateElement` → `.stateElement`
- `getByAddress` / `setByAddress` / `hasByAddress` の入口に `address.stateElement === handler.stateElement` の assert を入れる（D5・`config.debug` 時のみ）
- `packages/devtools` — ミラー型を新旧両形にし、`DevtoolsCore` の読み取りを両読みのヘルパーに集約する（§7-1）。旧形の payload を流すテストは**残す**（新 devtools × 旧 state の回帰試験になる）
- README internals（§7-2）と devtools protocol doc の**英日両方**（§7-1）を同時更新。版印は据え置き
- 案 E の走査テストは対象の型が無くなるので削除する。許可していた `ILoopContext` キーの台帳は、キーが要素を含むようになったことを確認して終える

### PR ③ 互換面の撤去（次の major）

- deprecated な `absolutePathInfo` getter を削除
- `DEVTOOLS_PROTOCOL_VERSION` を 3 に上げる（state の bridge と devtools の registry の両方）。protocol doc の英日両方に反映
- devtools の両読みは、旧 state を見に行く可能性が残る間は消さない

---

## 9. 検証

- **カバレッジ**: 100/97/100/100 を維持（state の閾値）。アドレス周りのテストは `__tests__` 301 本中 49 本が絶対アドレス型に触れる。
- **GC 回帰**（§5-3 が本題なので必須）: `<wcs-state>` を接続 → パスを読ませて intern を作る → 切断・参照破棄 → `FinalizationRegistry` か heap snapshot で要素が回収されることを確認する。**PR ② の受け入れ条件**。現行でも同じ試験を先に通して基準を取る（PR ⓪）。**行を共有する 2 ツリーの片方だけを破棄する**場合も測る（§5-3 の最後の段落 — 残ったツリーが `ListIndex` を生かしていても、破棄した側の要素が回収されること）。
- **性能**: §5-5 の見積もりを実測で確認する。既存のベンチ（[__e2e__/benchmark](../packages/state/__e2e__/benchmark) と [benchmark-component](../packages/state/__e2e__/benchmark-component) の append / clear・深さ方向）を branch と main の両方で測る。**片側だけ測った主張は採用しない**。加えて**素のパスの読み**（ワイルドカードも getter も無いパスを大量に読む）の項目を足し、(a2) と (b) を並べて測る。§5-5 の置き場所はこの結果で決める。
- **クロスツリー**: 独立した `<wcs-state>` を持つコンポーネントを 2 つ並べ、**同じパス形状のルート配列**を持たせて baseline が混線しないことを確認する（§4-3 が今日ぎりぎりで避けている事故の再現テスト）。これは統合前に**現行で落ちるか通るか**を先に測る。
- **クロスツリー（同じ配列インスタンス）**: 2 ツリーに**同じ配列インスタンス**を持たせ、片方の行への書き込みが、もう片方の台帳（cache・bindings・baseline）と描画に触れないことを確認する。今日は `IAbsolutePathInfo` がこれを分けているので現行では通るはず（§3-1）。**統合後に落ちたら I1 違反**。D5 の assert を有効にして同じ試験を流し、発火しないことも見る。
- **devtools 互換**: 旧形の payload（`absolutePathInfo` 経由）と新形の両方を `DevtoolsCore` に流し、roster / wiring / timeline が同じになること。state 側は getter 経由の旧経路が読めること。§7-1 の表の 2 行がそれぞれ 1 本の試験になる。
- **SSR**: `@wcstack/server` の hydration 経路（`hydrateBindings`）が旧台帳側に登録する経路を持つので、素の Node での SSR スモークを通す（vitest は素 Node の代替にならない）。

---

## 10. 未決の論点

1. **優先順位（§0-1）の合意**。P1 > P2 > P3 は本書の提案であって、決めるのは著者。とくに P1 と P3 の順は §5-5 の結論を、P2 の位置は案 A を採るか案 E で止めるか（§6-3）を直接変える。
2. **`IResolvedAddress` を残すか**。正方形の外側だが、`Map<string, _>` の不滅キャッシュを持つ 5 本目である。`ResolvedAddress` → `PathInfo` は 1:多の正規化で、`getResolvedAddress` は proxy の入口でしか使われない。統合とは独立に畳めるかもしれないが、本書では触らない。
3. **改名先**（`IScopedPath` / `ITreePath` / `IPathInSite` …）。`Absolute` を捨てるのは決めたが、代わりの語は未決。
4. **assert の常時 ON**（D5）。`config.debug` 時のみにするか、統合直後の 1 リリースだけ常時 ON にして実地で取り違えを炙り出すか。
5. **互換 getter の撤去時期**（D7）。本書の提案は次の major。「1 リリースだけ」にすると、旧 devtools をピン留めしたページが state の更新で**検査対象アプリごと**例外を受ける（§7-1）。getter を残す費用と釣り合うかは著者の判断。
6. **intern の表の置き場所**（§5-5 の (a2) か (b) か）。これは責務の論点ではなく **P1 と P3 の取引**で、素のパスの読みの実測が決める。(b) は要素の API 面が不変で、約 60 本のテストのモックに手を入れずに済み、実装は今日の `AbsolutePathInfo.ts` の構造を継ぐ — 差が測定誤差に収まるならこちら。(a1) は却下済み。
