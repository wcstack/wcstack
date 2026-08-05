# 非表示中に落ちた更新が再表示で復元されない（deactivate 済みコンテンツの stale）

/ 対象: `@wcstack/state` / 状態: **未修正**（現行挙動を pin テストで固定）/ 起票: 2026-08-06

## 1. 症状

`if` で非表示にしている間にリスト行の値を更新すると、再表示しても DOM に旧値が残る。
state 側は正しく更新されている。

```js
// <template data-wcs="if: show">
//   <ul><template data-wcs="for: items">
//     <li><input data-wcs="value: .name"></li>
//   </template></ul>
// </template>
show = false;
items = [{ id: 1, name: "A" }, { id: 2, name: "b" }];  // 行の同一性は保たれる更新
show = true;
// → state: ["A", "b"]（正しい）
// → DOM  : ["a", "b"]（旧値のまま）
```

## 2. 再現条件

| 更新の綴り | 再表示後の DOM |
|---|---|
| `$listKeys` のキー突合 | ❌ 旧値 |
| 行参照を保つ手書き id マージ（`Object.assign(cur, fresh)` + コピー再代入） | ❌ 旧値 |
| 全行置換（参照が変わる） | ✅ 新値 |
| `if` 直下の非リストパス（`textContent: title`） | ✅ 新値 |

条件は **「行オブジェクトの参照が保たれる更新」×「対象の `for` が非表示（deactivate 済み）」**。
`$listKeys` に固有ではなく、[list-replacement-dependency-scaling.md](list-replacement-dependency-scaling.md)
§7.0 が「常に正しい」と規定した per-path 書き込みイディオムでも同じに壊れる。

## 3. 原因

3 つが噛み合って更新が消える。

1. **非表示中の適用は捨てられる。** `applyChangeFromBindings`（`apply/applyChangeFromBindings.ts`）は
   `binding.replaceNode.isConnected === false` のバインディングをスキップする。`if` が false の間、
   行の DOM は文書から切り離されているため、per-path 書き込みで dirty 化された行内バインディングは
   適用されずに落ちる。
2. **再 activate は「そのコンテンツ自身の」バインディングしか再適用しない。** `applyChangeToIf` →
   `activateContent`（`structural/activateContent.ts`）が回すのは if コンテンツ直下のバインディング群で、
   `for` 配下の行 content は対象外。表 4 行目（`if` 直下の単純パス）が直るのはこの経路のため。
3. **`for` は「変化なし」と判断する。** 2 で再適用される `for` バインディングは
   `applyChangeToFor` に入るが、行の同一性が保たれているので `createListDiff` の
   add / change / delete がすべて空になり、既存の行 content を再マウントするだけで
   値の再適用は起きない。参照が変わる更新（表 3 行目）が直るのは、行が作り直されるから。

## 4. なぜ今書き残すか

`$listKeys`（[state-list-key-design.md](state-list-key-design.md)）は「行オブジェクトの参照を保つ」ことを
**正常系にする**機能なので、この穴を踏む確率を大きく上げる。タブ・アコーディオン・モーダルの中の
リストを裏でポーリング更新する、という構成はごく普通に現れる。

## 5. 直し方の候補（未検討・未採択）

| 案 | 内容 | 懸念 |
|---|---|---|
| A | 再 activate 時に配下の行 content まで再帰的に再適用する | 大きなリストの表示切り替えが O(全行) になる。現在の「再マウントだけ」の軽さを失う |
| B | deactivate 中に落ちた適用を content 単位で dirty マークし、再 activate 時にマーク分だけ再適用する | 台帳が増える。マークの寿命管理（unmount 済み content の GC）が要る |
| C | deactivate 時に配下の行バインディングも registry から確実に外し、再 activate で全バインディングを無条件再適用する | A と同じコスト。ただし `isConnected` によるサイレントスキップという曖昧さは消える |

いずれも `structural/activateContent.ts` と `apply/applyChangeToFor.ts` の責務分担に触るため、
`$listKeys` とは独立した変更として扱う。

## 6. 現行挙動の pin

`packages/state/__tests__/integration.listKeys.test.ts` の
「非表示中の行内更新は再表示で反映されない（既存の穴・…）」が、`$listKeys` 版と手書きマージ版の
両方で現行挙動（state は新値・DOM は旧値）を固定している。修正する際はこの pin を期待値ごと
書き換えること。
