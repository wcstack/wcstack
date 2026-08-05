# webComponent/ — `bind-component`

**正本は [`packages/state/README.md`](../../README.md) の "Web Component Binding" 節。**
ここは実装側の補足のみを置く。

`<wcs-state bind-component="<prop>">` がコンポーネント直下にあると、
`State._initializeBindWebComponent` が親要素の `<prop>` を state のソースとして取り込み、
`bindWebComponent()` がそのプロパティを proxy に差し替える。

## ファイル

| ファイル | 役割 |
|---|---|
| `bindWebComponent.ts` | 分岐の入口。outer proxy を要素に defineProperty し、`$stateReadyCallback` を呼ぶ |
| `innerState.ts` | 子側の state proxy。マッピングがあれば親 state へ、無ければローカル値へ解決する |
| `outerState.ts` | **mapped 分岐**の外向き proxy。read は最後に観測した値、write は `$postUpdate` 通知のみ |
| `plainOuterState.ts` | **plain 分岐**の外向き proxy。read / write とも子の state proxy へ素通し |
| `MappingRule.ts` | 親パス ↔ 子パスの対応表。プライマリ規則から部分パスの規則を派生させる |
| `meltFrozenObject.ts` | `Object.freeze` された初期 state を書き込み可能に複製する |
| `stateElementByWebComponent.ts` / `completeWebComponent.ts` / `lastValueByAbsoluteStateAddress.ts` | 台帳 |

## 2 つの分岐

`bindWebComponent` は **`<prop>.*` バインディングが 1 件以上あるか**で分岐する
（`data-wcs` 属性の有無ではない — 属性だけあってマッピングが 0 件だと
outer proxy が死ぬため。§1.2）。

- **mapped**（`<my-c data-wcs="state.msg: user.name">`）— 値の正本は親 state。
  親が変わると `applyChangeToWebComponent` が `element[prop][path] = v` を実行するが、
  これは「読み直せ」という通知であって値の格納ではない。
- **plain**（親からのバインドなし）— 値の正本は子の state。read / write とも素通し。

## Light DOM

Shadow DOM を持たないコンポーネントでも使えるが、名前空間が上位スコープと共有されるため
`name` 属性が必須（`<wcs-state bind-component="state" name="light-user">`）。
バインドは `@light-user` で state 名を明示する。

## DCC との排他

`bind-component` と DCC はコンポーネントごとにどちらか一方だけを使う。
`bind-component` のコンポーネントは `static wcBindable` を持たない ＝ wc-bindable の producer では
ないため、spread（`...: obj`）と command token は使えない。宣言されたプロパティ面ではなく
**パス**で配線するのがこの機構であり、これは意図的な設計。
機構の選び方と対応表は
[`packages/state/README.md` の「Choosing a Component Mechanism」](../../README.md#choosing-a-component-mechanism)。

## 既知の制約

実装と設計の食い違いは
[`docs/architecture-hardening/15-state-component-mechanism-consistency.md`](../../../../docs/architecture-hardening/15-state-component-mechanism-consistency.md)
に集約してある。最大の未修正項目は §1.1 — mapped / plain で `this.state` の read / write の
意味論が異なる（mapped では書き込みが値を捨てる）。内部チャネル用の proxy が
そのまま公開 API を兼ねていることが原因で、統一方針は decision gate G1 待ち。
