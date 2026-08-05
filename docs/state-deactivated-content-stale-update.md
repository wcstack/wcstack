# 非表示を跨いだ `for` 行のバインディングが復活しない

/ 対象: `@wcstack/state` / 状態: **修正済み**（2026-08-06）/ 起票: 2026-08-06

## 1. 症状

`if` で非表示にしたリストを再表示すると、行は元どおり表示されるが**行のバインディングが死んでいる**。
行オブジェクトの参照が保たれる更新は、以後すべて DOM に反映されない。

```js
// <template data-wcs="if: show">
//   <ul><template data-wcs="for: items">
//     <li><span data-wcs="textContent: .name"></span></li>
//   </template></ul>
// </template>
show = false;
show = true;                       // 表示は元どおり
items[0].name = "Z"; items = [...items];  // 行の同一性を保つ更新
// → state: ["Z", "b"] / DOM: ["a", "b"]  ← 以後ずっと反映されない
```

起票時は「非表示中に落ちた更新が再表示で復元されない」= 一度きりの stale と見ていたが、
実測すると**非表示を挟んだだけで以後の更新がすべて落ちる**（更新の有無に関わらず壊れる）。

| 状況 | 修正前 |
|---|---|
| 非表示中に行の同一性を保って更新 → 再表示 | ❌ 旧値 |
| 非表示 → 再表示だけ → その後に行内更新 | ❌ 反映されない（恒久） |
| 全行置換（参照が変わる） | ✅ 反映される（行を作り直すため） |
| `if` 直下の非リストパス（`textContent: title`） | ✅ 反映される |
| `if` を挟まない `for` | ✅ 反映される |

`$listKeys`（[state-list-key-design.md](state-list-key-design.md)）に固有ではない。ただし
`$listKeys` は「行オブジェクトの参照を保つ」ことを正常系にする機能なので、この穴を踏む確率を上げる。

## 2. 原因

1. **非表示は行 binding ごと解体する。** `applyChangeToIf(false)` は `deactivateContent` に加えて
   `Content.unmount()` を呼ぶ。`unmount()` はネストした構造ディレクティブの content を再帰的に
   unmount し、各 content の binding session を `dispose()` する。行 binding は台帳から外れる
   （devtools の `state:binding-removed` で実測）。
2. **非表示中の書き込みは配送先が居ない。** 行 binding が台帳に無いので、更新は
   `applyChangeFromBindings` の disconnected スキップにすら到達せず落ちる。
3. **再表示は行を物理的に戻すだけ。** `activateContent(ifContent)` が再活性化するのは
   if コンテンツ自身の binding のみ。その中の `for` は `applyChangeToFor` に入るが、行の同一性が
   保たれていれば diff は空で、既存行は位置合わせの `mountAfter`（`isPhysicallyAfter` が
   切断ノードを false と判定するため必ず通る）で DOM に戻るだけ。**dispose 済みの record は
   再構築されない。**

全行置換だけが直るのは、行が `createContent`（またはプール取り出し）から作り直され、
追加行として `activateContent` を通るため。

## 3. 修正

`apply/applyChangeToFor.ts` の既存行経路で、位置合わせの前に `!content.mounted`
（= 祖先の `unmount()` で解体された行）を判定し、DOM へ戻したあとに `activateContent` する。

```ts
const unmountedByAncestor = !content.mounted;
...
if (!stable && lastNode.nextSibling !== content.firstNode) {
  content.mountAfter(lastNode);
}
if (unmountedByAncestor) {
  loopContextStack.createLoopContext(stateAddress, (loopContext) => {
    activateContent(revivedContent, loopContext, context);
  });
}
```

`BindingSession.activate` は disposed record の再構築（プール再利用と同じ経路）を含むため、
アドレス台帳への再登録と現在値の再適用がまとめて行われる。ネストした `for` は、親行の
再活性化がその `for` バインディングを再適用することで自然に再帰する。

コストは既存行あたり boolean 1 回。復活の実作業は実際に解体された行にしか発生しない。

## 4. 回帰テスト

`packages/state/__tests__/integration.ifRemountRowBindings.test.ts`

- 非表示中に行の同一性を保ったまま更新 → 再表示で新しい値
- 非表示 → 再表示だけ → その後の行内更新が届く
- 再表示後も行 DOM が再利用され、非バインド DOM 状態（`<details>` の開閉）が保たれる
- ネストした `for` の行も再表示後に更新が届く

`integration.listKeys.test.ts` の「非表示中のキー付き代入が、再表示で反映されること」が
`$listKeys` 経由でも成立することを押さえる。
