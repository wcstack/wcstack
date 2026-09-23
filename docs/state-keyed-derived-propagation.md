# 鍵付き購読の派生先へ通知が伝播しない（3.0 の穴・修正済み）

**状態**: **修正済み**（3.x の次のリリース）。回帰テストは
[`packages/state/__tests__/integration.keyedDerived.test.ts`](../packages/state/__tests__/integration.keyedDerived.test.ts)
（characterization から、修正後の正しい挙動を固定する形へ書き換え済み）。
何をどう直したかは末尾の「[修正（いつ・どう直したか）](#修正いつどう直したか)」。
以下の「症状」「原因」は**修正前の記述**で、経緯として残してある。

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
- それまでは characterization test が現状を固定し、CHANGELOG の Known issues が作者に知らせる。

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

`integration.keyedDerived.test.ts` は 7 件。次の変異でそれぞれ落ちることを実測した:

1. `walkKeyedDependents` を丸ごと no-op → 4 件失敗
2. `setByAddress` 側の 2 呼び出しだけ削除 → 3 件失敗（`$postUpdate` の 1 件は通る）
3. `notifyKeyedPostUpdate` 側の呼び出しだけ削除 → `$postUpdate` の 1 件だけ失敗
4. ウォークを書き込みの**前**へ移す → 「鍵で切り替わるリスト getter」の 1 件が失敗

変異 5（短絡の削除）は**落ちない**。短絡は純粋な最適化で挙動を変えないので、これは期待どおり
（守るのはテストではなく上の実測）。
