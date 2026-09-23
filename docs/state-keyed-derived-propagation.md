# 鍵付き購読の派生先へ通知が伝播しない（3.0 の穴・修正済み）

**状態**: **修正済み**（3.x の次のリリース）。回帰テストは
[`packages/state/__tests__/integration.keyedDerived.test.ts`](../packages/state/__tests__/integration.keyedDerived.test.ts)
（characterization から、修正後の正しい挙動を固定する形へ書き換え済み）。
何をどう直したかは末尾の「[修正（いつ・どう直したか）](#修正いつどう直したか)」。
以下の「症状」「原因」は**修正前の記述**で、経緯として残してある。

書き込み起点（`notifyKeyed` / `notifyKeyedPostUpdate`）を先に塞ぎ、リスト差分起点の 2 経路と
入れ子リストの親行退役によるリークはその次の巡で塞いだ。どちらも節を残してあるので、
穴の姿と塞ぎ方は下の 2 節を参照。

## 症状

鍵付き選択（`$eq` / `$eqPath` / `$eqIndex` — 3.0）で値を出す getter に**依存する別の getter** は、
鍵の書き込みで再評価されない。購読者自身（`$eq` を呼んだ getter）は正しく更新される。

```js
// マウントもボリュームも無い、素のツリーで再現する
{
  sel: 1,
  items: [{ id: 0 }, { id: 1 }],
  get "items.*.picked"() { return this.$eq("sel", this["items.*.id"]) ? "Y" : "N"; },
  get "items.*.label"()  { return `<${this["items.*.picked"]}>`; },
}
// textContent: items.*.picked  → "N","Y" → sel=0 で "Y","N"   ✅ 更新される
// textContent: items.*.label   → "<N>","<Y>" → sel=0 でも "<N>","<Y>"  ❌ 陳腐化
```

`$eq` を普通の追跡読み（`this.sel === this["items.*.id"]`）に置き換えると、派生 getter も追随する。
**鍵付き購読に固有**である。

### マウントの公開 getter も同じ穴

`bind-component` のコンポーネントが `$eqIndex` で行を選ぶと、コンポーネント**内**のバインドは
更新されるのに、公開 getter を読む**外側**のバインド（`textContent: .active`）が陳腐化する。
`webComponent/exportIndex.ts` が張る別名（`users.*.#m1.active → users.*.active`）は
`addDynamicDependency` の辺、つまり**依存グラフの辺**なので、下記の理由でそのまま届かない。
鍵を使わない公開 getter（`get label() { return "S" + this.sel; }`）は正しく追随する。

この形は 3.x の「スコープの chroot が `$eq` 系のパスを翻訳する」修正で**内側が初めて動くようになり、
初めて観測可能になった**（それまでは内側もルートのパスを読んでいて、症状が別の形で隠れていた）。

## 原因

`proxy/methods/setByAddress.ts` の 2 つの通知経路が非対称。

| 経路 | 書いたアドレスの enqueue | そこからの依存ウォーク |
|---|---|---|
| 通常の書き込み（`notifyWrite`） | する | **する**（`walkDependency` — 静的・動的の辺を推移的に辿る） |
| 鍵付き購読（`notifyKeyed` → `createKeyedEnqueue`） | する | **しない** |

```ts
function createKeyedEnqueue(): (absAddress: IAbsoluteStateAddress) => void {
  const updater = getUpdater();
  const context = ...;
  return (absAddress) => {
    dirtyCacheEntryByAbsoluteStateAddress(absAddress);
    updater.enqueueAbsoluteAddress(absAddress, context);   // ← ここで終わり
  };
}
```

`notifyWrite` は同じ enqueue のあとに `walkDependency(...)` を回して依存先を dirty ＋ enqueue する。
鍵付きはそれをしないので、「購読者 → その依存先」の辺（静的でも動的でも）が 1 本も辿られない。
`$postUpdate` 経由の `notifyKeyedPostUpdate` も同じ `createKeyedEnqueue` を使うので同じ穴を持つ。

## 直すときの注意

1. **順序**: `notifyKeyed` は `Reflect.set` の**前**に呼ばれる（旧値の鍵で「前に選ばれていた行」を
   引く必要があるため）。一方 `walkDependency` はリスト展開で書き込み**後**の値を読む前提で、
   `notifyWrite` は `finally` にいる。したがって「購読者アドレスの収集（書き込み前）」と
   「そこからの依存ウォーク（書き込み後）」を分ける必要がある。単に `createKeyedEnqueue` の中で
   walk を呼ぶと、書き込み前の値でリストを展開する。
2. **型**: `keyedDependents` が返すのは `IAbsoluteStateAddress`、`walkDependency` が取るのは
   `IStateAddress`。`treePath.pathInfo` ＋ `listIndex` から組み直す必要がある。
3. **ホットパス（R2）**: 鍵付き選択の存在理由は「選択の更新を 2 行に抑える」こと。購読者ごとに
   `walkDependency` を回すと、その利点を削らないか測ってから決める。購読者のパスに依存先が
   1 つも無いのが普通なので、`staticDependency` / `dynamicDependency` に項が無ければ即抜ける
   短絡（`notifyWrite` の `cacheable` と同じ形）を先に置くこと。
4. **範囲**: `notifyKeyed` と `notifyKeyedPostUpdate` の両方。片方だけ直すと `$postUpdate` の
   in-place 変異だけが取り残される。
5. **非破壊性**: 外側・派生先が**新たに再描画されるようになる**だけなので 3.x で非破壊のはず。
   ただし enqueue が増えるぶん更新の順序と回数が変わるので、`__tests__/proxy.keyed.test.ts` と
   `integration.mountExport.test.ts` の全件を通すこと。

## 推奨する着地

`proxy/` / `dependency/` の担当が 1 サイクル取って直す。理由:

- 穴は**マウント／ボリュームに固有ではない**（素のツリーで再現する）。`webComponent/` 側では直せない。
- 直す場所が `_setByAddress`（パッケージで最も順序に敏感な関数）なので、通知順の設計判断と
  R2 の実測がセットで要る。
- それまでは characterization test が現状を固定し、CHANGELOG の Known issues が作者に知らせた
  （サイクル 5 で全経路が塞がり、Known issues からは外れている）。

回避策（作者向け・**修正前**）: 鍵付き getter の値を**直接**バインドする（派生 getter を挟まない）か、
派生が要る場所では `$eq` をやめて普通の追跡読みにする（選択の更新コストは全行に戻る）。
修正後はどちらも不要。

## 修正（いつ・どう直したか）

`proxy/methods/setByAddress.ts` に、上の注意 1 のとおり**収集とウォークを分ける**形で入れた。

- `notifyKeyed` は `void` から `IAbsoluteStateAddress[] | null` を返すようになった。購読の無いパスは
  従来どおり `null` を即返す（`hasKeyedDependents` / `hasKeyedDescendants` の 2 参照で抜ける）。
  `createKeyedEnqueue(collected)` が enqueue のついでに購読者を `collected` へ控える。
- 新設の `walkKeyedDependents(subscribers, receiver, handler)` が、控えた購読者 1 つずつを起点に
  `walkDependency` を回して依存先を dirty ＋ enqueue する。起点（購読者自身）は
  `createKeyedEnqueue` が済ませているので `depAddress === address` で飛ばす（`notifyWrite` と同じ形）。
- 呼ぶ位置は**書き込みの後**。fast path は `finally` の `notifyWrite` の直後、通常経路は
  `finally` の先頭（`notifyWrite` は `_setByAddress` の中で済んでいる）。
- `$postUpdate`（`notifyKeyedPostUpdate`）は変異がもう起きた後に呼ばれるので、収集とウォークを
  分ける必要がない — 同じ関数をその場で呼ぶ。引数に `receiver` / `handler` が増えた。
- 短絡（注意 3）: 購読者ごとに `staticDependency` / `dynamicDependency` を 2 回引き、どちらにも
  無ければ `createStateAddress` も `walkDependency` も呼ばない。

### 実測

| 経路（happy-dom・10,000 行・バッチ 500 書き込み × 40 窓の中央値） | 修正前 | 修正後 |
|---|---|---|
| 鍵付き購読ゼロの書き込み（R2 / create-10k の経路） | 0.64 / 0.90 µs/write | 0.64 / 0.74 µs/write |
| 鍵付き選択の入れ替え（購読者 2 + 派生 getter） | 1.08–1.14 µs/write | 2.96–3.11 µs/write |

- 購読の無い書き込みは**変わらない**（2 回測って差は run 間のばらつきの内側）。`notifyKeyed` の
  早期 `null` 返しと `walkKeyedDependents` の `null` 判定 1 個しか増えていない。
- 鍵付き選択は 1 回あたり **+約 2 µs**。これは今まで**やっていなかった仕事**（購読者 2 件ぶんの
  `walkDependency`）そのもので、**行数に比例しない**（10,000 行でも購読者は 2 件）。
  選択の入れ替え 1 回あたりの getter 再評価は **1.9 回**（20 行の版を `evals` で計測。全行追跡なら 20 回）。
  鍵付き選択の存在理由（選択の更新を 2 行に抑える）は保たれている。

  µs/write の A/B は happy-dom ではばらつきが大きく（JIT の暖まり順で 200 行と 2000 行が逆転しうる）、
  「行数に比例しない」の決定的な根拠は**getter 評価回数**のほう。入れ替え 1 回あたり `picked` 2 回 /
  `label` 2 回で、20 / 200 / 500 / 2000 行のすべてで**完全に一定**（対照の非鍵版は 200 行 740–990 µs →
  2000 行 2727–3319 µs と明確に比例）。1 つの集計 getter を多数の購読者が共有する形（1000 行・鍵 2 値）
  でも、その getter の再評価は**ちょうど 1 回**で、購読者数ぶんの重複評価は起きない。
- **「購読者は 2 件」は鍵が一意なとき**（＝ README が説明している「選択」）に限った話。鍵を複数行が
  共有する形（2000 行・ステータス 2 値・半々）では購読者＝一致行数になり、同期部分は 8.13 ms
  （修正前 0.82 ms）、派生 getter は 2000 回評価される。ただし**修正前の出力は誤り**（派生が反転した
  まま）だったので、この差は「やっていなかった正しい仕事」そのもの。計算量は購読者数に比例する
  （`a swap stays O(subscribers)`）。
- 鍵付き購読者が**入れ子リスト**になる形（`get groups() { return [{ rows: this.$eq("sel",1) ? this.a : this.b }]; }`
  ＋ 二重 `for`）も実測で追随することを確認済み（`listExpansion: "diff"` で壊れていない）。番人は
  置いていない。

### 番人（変異で確認）

`integration.keyedDerived.test.ts` は当時 7 件（サイクル 5 の追加で 13 件）。次の変異でそれぞれ
落ちることを実測した:

1. `walkKeyedDependents` を丸ごと no-op → 4 件失敗
2. `setByAddress` 側の 2 呼び出しだけ削除 → 3 件失敗（`$postUpdate` の 1 件は通る）
3. `notifyKeyedPostUpdate` 側の呼び出しだけ削除 → `$postUpdate` の 1 件だけ失敗
4. ウォークを書き込みの**前**へ移す → 「鍵で切り替わるリスト getter」の 1 件が失敗

変異 5（短絡の削除）は**落ちない**。短絡は純粋な最適化で挙動を変えないので、これは期待どおり
（守るのはテストではなく上の実測）。

## リスト差分が駆動する経路（サイクル 4 で判明 → サイクル 5 で修正）

`d76ae9ca` の修正は `setByAddress.ts` の `notifyKeyed` / `notifyKeyedPostUpdate` の 2 箇所にしか
入っておらず、**リスト差分が駆動する 2 つの enqueue 経路**は購読者を enqueue するだけで
依存ウォークをしなかった。

| 経路 | 呼び出し元 | 状態 |
|---|---|---|
| `notifyKeyed`（鍵への書き込み） | `setByAddress` | 修正済み（`d76ae9ca`） |
| `notifyKeyedPostUpdate`（`$postUpdate`） | `proxy/apis/postUpdate.ts` | 修正済み（`d76ae9ca`） |
| `moveIndexWatchers`（`$eqIndex` 最内段・リスト配列の付け替え） | `list/createListDiff.ts:101` | **修正済み（サイクル 5）** |
| `rekeyIndexSubscriptions`（`$eqIndex` 外側の段・index の付け替え） | `list/createListDiff.ts:66`（`syncListIndexes`） | **修正済み（サイクル 5）** |

再現（当時の characterization test）: 3 行のリストで `$eqIndex("sel")` の行 getter とその派生
getter を描き、先頭行を削除すると購読者は `["N","Y"]`（正）に更新されるのに派生は
`["<Y>","<N>"]`（陳腐化）。`$1 === this.sel` の非鍵版は正しく追随した。

### 塞げなかった理由（サイクル 4 時点の記録）

`walkKeyedDependents` は `walkDependency` を呼ぶため **state proxy** が要る（リスト展開が
書き込み後の値を読む）。ところが `moveIndexWatchers` / `rekeyIndexSubscriptions` は
`createListDiff` から呼ばれ、そこには proxy も handler も無い。`createListDiff` 自身が
`walkDependency` の中（`_collectDependencies` のリスト展開）から呼ばれる場合もあれば、
`applyChangeToFor` や `collectWildcardIndexes` から呼ばれる場合もあるので、
「呼び出し元へ返して drain 側で回す」形も 1 つの seam では足りない。

検討した案（どれも 1 サイクルで安全に着地しないと判断した）:

1. **進行中のウォークの frontier へ差し込む** — `walkDependency` に「いま走っているウォークの
   `nextEntries` に押し込む sink」をモジュール変数で持たせ、鍵付きフックがそこへ積む。
   proxy の受け渡しが要らず、順序も自動的に「書き込み後」になるのが利点。
   欠点: `createListDiff` がウォークの外から呼ばれた場合は sink が null で、穴が残る（部分修正）。
   rank が `ranks` に無いパスになるので訪問順は minRank に倒れる。
2. **保留バッファ + drain 側で回す** — `keyedDependency.ts` に pending 配列を持ち、updater の
   drain が proxy を作って回す。全経路を覆えるが、drain に新しい段を足すことになる。
3. **proxy を要らない縮小版ウォーク** — リスト展開の枝だけを落とした walk を別に書く。
   「同じ規準の実装が 2 つ」になり、過去 3 巡で繰り返し出ている失敗様式そのもの。

### どう塞いだか（サイクル 5・案 2 を採った）

「複数の呼び出し元があるから seam が足りない」という見立てが誤りだった。**積む側は引き取り手を
知らなくてよい**。差分フックは起点のアドレスを保留バッファへ積むだけにして、**proxy を持っている
地点**が引き取る。案 2 の「drain に新しい段を足す」形ではなく、既にある `walkDependency` の
末尾で引き取ることで、段も proxy の受け渡しも増えなかった。

- `dependency/keyedDependency.ts` — `pushPendingKeyedWalk()` を `moveIndexWatchers` と
  `rekeyIndexSubscriptions` の enqueue の隣に置く（`getUpdater().enqueueAbsoluteAddress` と対で
  1 行）。両フックは先頭で `anyRegistered` を見て抜けるので、**鍵付き購読が 1 件も無いページは
  1 回も通らない**。
- `dependency/walkDependency.ts` — `walkDependency()` の本体ウォークの直後に `drainKeyedWalk()`。
  同じ `context` で `_walkDependency` を回すので、proxy・依存表・`visited` 集合・基線コミットが
  そのまま共有され、既に訪問済みのアドレスは二度走らない。ウォークの**後**なので、
  「収集は書き込み前・ウォークは書き込み後」の順序制約（上記「直すときの注意」）も満たす。
  引き取った先で更にフックが積む場合があるので `MAX_DEPENDENCY_DEPTH` 回まで回す。

保留バッファは `WeakMap<IStateElement, Set<IAbsoluteStateAddress>>`。ツリー別に分けたのは、
引き取り手が自分のツリーしか辿れない（`walkDependency` は 1 ツリーの依存表と proxy で回る）ため
で、1 本の配列にすると別ツリーのウォークが他人の分を取り出して捨ててしまう。`Set` なので、
引き取り手が来ないまま差分が続いても溜まるのは「相異なる購読者アドレス」止まり
（アドレスは intern 済み ＝ 台帳が既に持っている分を超えない）。

**残る限界**: 引き取りは `walkDependency` の末尾だけなので、ウォークの外から `createListDiff` が
呼ばれた分（`applyChangeToFor` / `collectWildcardIndexes`）は、そのツリーの**次のウォーク**まで
持ち越される。捨てられはしない（上記のツリー別バッファ）が、同一バッチ内での伝播は保証しない。
そこまで必要になったら、`applyChangeToFor` 側にも `context.state` で同じ drain を置くのが素直。

番人（変異で確認、`integration.keyedDerived.test.ts`）:

| 変異 | 落ちるテスト |
|---|---|
| `drainKeyedWalk(context, callback)` を消す | `$eqIndex`（最内段）／（外段）の 2 件 |
| `moveIndexWatchers` の `pushPendingKeyedWalk` を消す | `$eqIndex`（最内段）1 件 |
| `rekeyIndexSubscriptions` の `pushPendingKeyedWalk` を消す | `$eqIndex`（外段）1 件 |

## 入れ子リストの親行退役で鍵付き購読が残る（サイクル 4 で判明 → サイクル 5 で修正）

`dropKeyedSubscriptionsByListIndex` はそのリスト自身の `diff.deleteIndexSet` にしか呼ばれない。
入れ子リストの**親行**（`groups.*`）が退役しても、その子（`groups.*.rows.*`）の listIndex には
届かず、`ledger.byPath` の強参照が残る。`IListIndex` は `parentListIndex`（上向き）しか持たず、
子への逆引きが無いので親から辿れない。

実測（characterization test 済み）: 描画行を 4 に保ったまま `groups` を 4 回差し替えると
D17 の `rows` が 4 → 8 → 12 → 16 → 20。`groups = []` で全消ししても 0 に戻らない。
描画は正しい（updater が dead アドレスを弾く）が、(a) メモリリーク、(b) **D17 が嘘の数字を返す**
（4 行のページで `rows 20` — この機能の存在理由に対して最悪の失敗様式）。

`watchersByElement`（`$eqIndex` 最内段のリスト監視）にも同じ形の解除漏れがある
（`moveIndexWatchers` は `watchersByIndexes` 間で移すだけ）。

### 直し方の候補（サイクル 4 時点の記録）

- 登録時（`registerKeyedDependency`）に、行の **祖先 listIndex** ごとに
  `WeakMap<IListIndex, Set<IListIndex>>` へ自分を積む（`listIndex.listIndexes` が祖先チェーンの
  WeakRef 配列を持っているので深さぶんのループで済む）。`dropKeyedSubscriptionsByListIndex` は
  この逆引きで子孫へ再帰する。WeakMap なので祖先が回収されれば集合ごと消える。
- 退役時に `watchersByElement` の watcher も外す。
- **devtools 側で `isRetiredListIndex` を使って数えから除く対症療法は効かない** — 退役印が付くのは
  そのリストの `deleteIndexSet` の行だけで、子行には付かない（実測）。

### どう塞いだか（サイクル 5・上の候補どおり）

`dependency/keyedDependency.ts` に 2 本の逆引きを足した。どちらも `WeakMap` なので、祖先が
回収されれば中身ごと消える。

- `descendantRowsByAncestor: WeakMap<IListIndex, Set<IListIndex>>` — **鍵付き購読を持つ行**を
  全段の祖先へ 1 回だけ載せる（`linkAncestors`）。載せるのは `pushEntry` が「この行の最初の
  エントリ」を返したときだけなので、購読ごとではなく行ごと。`dropKeyedSubscriptionsByListIndex`
  はこの逆引きを 1 回引くだけで子孫をまとめて落とせる（再帰不要）。行が単体で落ちるときは
  `unlinkAncestors` で外す。
- `watchersByOwnerListIndex: WeakMap<IListIndex, Set<IIndexWatcher>>` — `$eqIndex` 最内段の監視を
  「そのリストを抱える親行」に紐づける（`registerIndexWatcher`）。親の退役で
  `dropWatchersOwnedBy` が `watchersByElement` / `watchersByIndexes` の両方から外す。
  トップレベルのリスト（`indexes[0].parentListIndex === null`）は孤児にならないので紐づけない。

祖先チェーンは `listIndex.listIndexes`（WeakRef 配列）ではなく **`parentListIndex` を辿る**。
`parentListIndex` は強参照なので「自分が生きていれば祖先も生きている」＝ `deref()` の空振りを
考えなくてよく、`listIndexes` getter の再構築（`reparent` で世代が変わると配列を作り直す）も
踏まない。

コスト: 登録側のフックは `pushEntry` が true を返したときだけ、退役側は
`dropKeyedSubscriptionsByListIndex` の先頭にある `anyRegistered` ガードの内側。**`$eq` 系を
使わないページは 1 回も通らない。**

番人（変異で確認、`integration.keyedDerived.test.ts`）:

| 変異 | 落ちるテスト |
|---|---|
| `dropKeyedSubscriptionsByListIndex` の子孫掃除を消す | 台帳の `rows` が増えないこと |
| `dropWatchersOwnedBy(listIndex)` を消す | 台帳の `lists` 2 件 |
| `record()` の `linkAncestors` を消す | 台帳の `rows` が増えないこと |
| `dropRowSubscriptions` の `unlinkAncestors` を消す | 台帳検査の 2 件（別ファイル・下記） |

`unlinkAncestors` が防ぐのは「**生きている**祖先の集合に、単体で落ちた行が残り続ける」ことで、
公開されている面（描画・D17 の `rows`/`lists`）からは観測できない — 残った行に対する
`dropRowSubscriptions` は冪等で、二度目は即 return するため、`integration.keyedDerived.test.ts`
の 13 件は全部素通りする。

**当初これを「出荷コードにテスト専用の口を開けるしかなく、サイズ予算に対して割に合わない」と
書いたが、それは誤りだった。** vitest 側で計装すれば core は 1 バイトも変わらない。
`vitest.config.ts` の `wcs-keyed-dependency-probe`（vite の `transform` フック）が
`keyedDependency.ts` の内部台帳を読み出し口として足し、
[`__tests__/dependency.keyedAncestorIndex.test.ts`](../packages/state/__tests__/dependency.keyedAncestorIndex.test.ts)
が不変条件を突き合わせる。bundle にも `d.ts` にも出ないので**サイズ予算は掛からない**。
このリポジトリには既にソース走査型の番人があり（`webComponent.dollarPathApis.test.ts` /
`protocol.typesDrift.test.ts`）、同じ発想の延長にある。

この番人が見ているのは 3 つ:

1. **購読を失った行が、生きている祖先の逆引きに残っていないこと** — `unlinkAncestors` を消すと
   `[0,0] under [0]` を挙げて落ちる（M4 を殺せた）。
2. **記録した祖先が今も `parentListIndex` チェーン上に居ること** — 下の R1。
3. **保留バッファに取り残しが出ないこと** — 下の R2。`drainKeyedWalk` を消すと残 1 で落ちる
   （＝この検査が空振りではないことの証拠）。

計装の目印（`linkAncestors` の `rows.add(listIndex);`）が消えたらプラグイン側が throw するので、
リファクタで番人が黙って無効になることはない。

## 残っているリスク（実証はされていない・監視下にある）

サイクル 5 の締めで指摘者が挙げた 2 件。どちらも**全 4086 テストに計装して実測した結果 0 件**で、
現状は壊れていない。壊れたら気づけるよう、上の台帳検査に組み込んである。

### R1: 逆引きが `reparentListIndex` に追随しない

`linkAncestors` は「行の最初の購読」の時点で `parentListIndex` チェーンを 1 回だけ記録し、
`unlinkAncestors` は行が落ちるときだけ走る。一方 `list/listIndexesByList.ts` の
`getRepairTarget` の**第 1 分岐**は `home !== null && home !== oldParent && !retiredListIndexes.has(home)`
で、**旧親が退役していなくても** `home` へ付け替える（`canReparent` / `isRestoredHome` の
2 分岐だけが退役を要求する）。付け替えが起きると逆引きは古い親を指したままになり、

- (a) 旧親の退役が、**生きている**行の購読を落とす（選択が効かなくなる）
- (b) 実親の退役が子を落とし損ねる（＝この節が塞いだリークの再発）

の 2 方向で壊れうる。**つまり「購読を持つ行は生きたまま付け替えられない」が暗黙の不変条件**で、
現状はこれが成立している。`linkAncestors` の doc コメントに明文化し、台帳検査の 2 番目が
突き合わせている。付け替えを許す必要が出たら、`reparentListIndex` から
`unlinkAncestors` → `linkAncestors` を張り直す形にするのが構造的に強い。

### R2: `walkDependency` 冒頭の fast path は drain を通らない

依存ゼロの起点は `callback(startAddress); return [];` で抜けるので `drainKeyedWalk` に届かない。
ただし**積むのは `createListDiff` の中だけ**で、この経路はそれを呼ばないので自分の分を
取り残すことはない。残りうるのは「ウォークの外（`applyChangeToFor` / `collectWildcardIndexes`）で
積まれ、そのバッチのウォークが fast path だけだった」場合に限られ、その形は現状作れない
（同じリストの 2 度目の `createListDiff` はキャッシュに当たり、`moveIndexWatchers` が早戻りする）。

drain を足すと保留の有無を見る `WeakMap#get` が 1 回増える。**実測 +3.3 ns/回**（fast path の
判定自体が 1.9 ns）で、ここはリスト行の値書き込みが set 毎に通るホットパス。起こせない事象の
ために恒久的に乗せる取引としては割に合わないと判断し、置いていない。前提が崩れれば台帳検査の
3 番目（取り残し 0）が落ちるので、そのときに置く。判断の材料は `walkDependency.ts` の
fast path のコメントにも残した。
